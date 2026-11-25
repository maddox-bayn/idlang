import { useEffect, useRef, useState } from "react";
import { useTranslationStore } from "../store/useTranslationStore";
import AudioRecorder from "./AudioRecorder";
import AudioPlayer from "./AudioPlayer";
import { translationClient, TranslationAPIError } from "../api/translationClient";
import { fetchSavedItems, saveItem, unsaveItem } from "../api/socialClient";

type TranslationMode = "text" | "speech" | "full";

interface TranslateViewProps {
  isAuthenticated: boolean;
  authLoading: boolean;
  onRequireAuth: () => void;
}

export default function TranslateView({ isAuthenticated, authLoading, onRequireAuth }: TranslateViewProps) {
  const operation = useRef<AbortController | null>(null);
  const [recordedAudioURL, setRecordedAudioURL] = useState<string | null>(null);
  const [trialRemaining, setTrialRemaining] = useState<boolean | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    if (authLoading || isAuthenticated) return;
    setTrialRemaining(null);
    setAccessError(null);
    translationClient.access(controller.signal).then(data => {
      if (!cancelled) setTrialRemaining(data.authenticated || data.trial_remaining);
    }).catch(error => {
      if (!cancelled) setAccessError(error instanceof Error ? error.message : "Could not check translation access.");
    });
    return () => { cancelled = true; controller.abort(); };
  }, [isAuthenticated, authLoading, accessAttempt]);

  function checkAccess(): boolean {
    if (authLoading || isBusy) return false;
    if (isAuthenticated) return true;
    if (trialRemaining === false) { onRequireAuth(); return false; }
    return trialRemaining === true;
  }

  function trialCompleted() {
    if (!isAuthenticated) { setTrialRemaining(false); onRequireAuth(); }
  }

  function translationFailed(error: unknown) {
    if (error instanceof TranslationAPIError && error.status === 401 && error.code !== "TRIAL_SESSION_REQUIRED") {
      setTrialRemaining(false);
      onRequireAuth();
    }
    if (error instanceof TranslationAPIError && error.code === "TRIAL_SESSION_REQUIRED") {
      setTrialRemaining(null);
      setAccessAttempt(value => value + 1);
    }
    setError(error instanceof Error ? error.message : "Translation failed");
  }

  const {
    mode,
    direction,
    inputText,
    audioBlob,
    transcription,
    translation,
    synthesizedAudio,
    error,
    // Subscribed, not read via getState(): getState() does not register a
    // dependency, so the button's disabled/spinner state could go stale.
    isTranscribing,
    isTranslating,
    isSynthesizing,
    isRecording,
    setMode,
    setDirection,
    setInputText,
    setIsTranscribing,
    setIsTranslating,
    setIsSynthesizing,
    setError,
    setAudioBlob,
    setTranscription,
    setTranslation,
    setSynthesizedAudio,
    addToHistory,
    clearAudio,
  } = useTranslationStore();

  const isBusy = isTranslating || isTranscribing || isSynthesizing;
  const savedSourceText = mode === "text" ? inputText : transcription || inputText;
  const savedTranslationId = translation ? stableTranslationId(savedSourceText, translation.translation) : "";

  useEffect(() => {
    if (!translation || !isAuthenticated) { setIsSaved(false); return; }
    fetchSavedItems().then(items => setIsSaved(items.some(item => item.item_type === "translation" && item.item_id === savedTranslationId))).catch(() => setIsSaved(false));
  }, [translation?.translation, savedTranslationId, isAuthenticated]);

  async function toggleSaveTranslation() {
    if (!translation || !savedTranslationId) return;
    try {
      if (isSaved) await unsaveItem("translation", savedTranslationId);
      else await saveItem({ item_type: "translation", item_id: savedTranslationId, title: `${sourceLang} → ${targetLang}`, body: `${savedSourceText}\n\n${translation.translation}${translation.explanation ? `\n\n${translation.explanation}` : ""}` });
      setIsSaved(!isSaved);
      setSaveFeedback(isSaved ? "Removed from saved review." : "Saved for later review.");
      window.setTimeout(() => setSaveFeedback(null), 2500);
    } catch (error) { setSaveFeedback(error instanceof Error ? error.message : "Could not save this translation."); }
  }

  useEffect(() => () => {
    operation.current?.abort();
    useTranslationStore.setState({ isTranscribing: false, isTranslating: false, isSynthesizing: false });
  }, []);

  useEffect(() => {
    if (!audioBlob) { setRecordedAudioURL(null); return; }
    const url = URL.createObjectURL(audioBlob);
    setRecordedAudioURL(url);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);

  function beginOperation() {
    if (operation.current) return null;
    const controller = new AbortController();
    operation.current = controller;
    return controller;
  }

  // Cleanup audio URL on unmount
  useEffect(() => {
    return () => {
      if (synthesizedAudio) {
        URL.revokeObjectURL(synthesizedAudio);
      }
    };
  }, [synthesizedAudio]);

  const sourceLang = direction === "en-to-id" ? "English" : "Idoma";
  const targetLang = direction === "en-to-id" ? "Idoma" : "English";

  async function handleTranslate() {
    const text = inputText.trim();
    if (!text || !checkAccess() || text.length > 4000) return;
    const controller = beginOperation();
    if (!controller) return;

    setIsTranslating(true);
    setError(null);
    setTranslation(null);

    try {
      const data = await translationClient.translateText(text, sourceLang, targetLang, controller.signal);
      if (controller.signal.aborted) return;
      setTranslation(data);
      addToHistory(data, text);
      trialCompleted();
    } catch (err) {
      if (!controller.signal.aborted) translationFailed(err);
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setIsTranslating(false);
    }
  }

  async function handleTranscribeAndTranslate() {
    if (!audioBlob || !checkAccess() || isRecording) return;
    const controller = beginOperation();
    if (!controller) return;

    setIsTranscribing(true);
    setError(null);
    setTranslation(null);
    setTranscription("");

    try {
      // Step 1: Transcribe audio
      const transcribeData = await translationClient.transcribeAudio(audioBlob, sourceLang, controller.signal);
      if (controller.signal.aborted) return;
      setTranscription(transcribeData.transcription);

      // Step 2: Translate transcription
      const translateData = await translationClient.translateText(
        transcribeData.transcription,
        sourceLang,
        targetLang,
        controller.signal
      );
      if (controller.signal.aborted) return;
      setTranslation(translateData);
      addToHistory(translateData, transcribeData.transcription);
      trialCompleted();
    } catch (err) {
      if (!controller.signal.aborted) translationFailed(err);
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setIsTranscribing(false);
    }
  }

  async function handleFullPipeline() {
    if (!audioBlob || !checkAccess() || isRecording) return;
    const controller = beginOperation();
    if (!controller) return;

    setIsSynthesizing(true);
    setError(null);
    setTranslation(null);
    setTranscription("");
    setSynthesizedAudio(null);

    try {
      const data = await translationClient.fullPipeline(audioBlob, sourceLang, controller.signal);
      if (controller.signal.aborted) return;
      setTranscription(data.transcription.transcription);
      setTranslation(data.translation);
      setSynthesizedAudio(data.audio ? `data:audio/wav;base64,${data.audio}` : null);
      addToHistory(data.translation, data.transcription.transcription);
      trialCompleted();
    } catch (err) {
      if (!controller.signal.aborted) translationFailed(err);
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setIsSynthesizing(false);
    }
  }

  function handleAudioRecorded(blob: Blob) {
    setAudioBlob(blob);

  }

  return (
    <div aria-busy={isBusy} className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4">
      <div className="text-center space-y-3 pb-2">
        <p className="text-xs uppercase tracking-[0.25em] text-red-400">English ↔ Idoma</p>
        <h2 className="font-heading text-3xl sm:text-4xl font-bold text-red-50">Keep the language close.</h2>
        <p className="text-sm text-neutral-400">Translate words and ideas between English and Idoma.</p>
        {!isAuthenticated && <p className="text-sm text-red-300">
          {trialRemaining === false ? "Your free translation is complete. Sign in or create an account to keep translating." : "Try one translation free. Sign in to continue and explore the community."}
        </p>}
        {!isAuthenticated && trialRemaining === false && <button onClick={onRequireAuth} className="rounded-lg border border-red-700 px-4 py-2 text-sm text-red-200 hover:bg-red-950">Sign in / Create account</button>}
        {accessError && <div role="alert" className="text-sm text-red-300">{accessError} <button onClick={() => setAccessAttempt(value => value + 1)} className="underline">Retry</button></div>}
      </div>
      {(authLoading || (!isAuthenticated && trialRemaining === null && !accessError)) &&
        <p role="status" className="text-sm text-neutral-300">Connecting to Idlang… The server may take a moment to wake up.</p>}
      {isBusy && <p role="status" className="text-sm text-neutral-300">{isTranscribing ? "Transcribing and translating your recording…" : isSynthesizing ? "Preparing your spoken translation…" : "Translating your text…"}</p>}
      {/* Mode Selection */}
      <div className="flex gap-2 rounded-lg border border-red-900/30 bg-neutral-950 p-1">
        {[
          { id: "text" as TranslationMode, label: "Text" },
          { id: "speech" as TranslationMode, label: "Speech" },
          { id: "full" as TranslationMode, label: "Voice translation" },
        ].map((m) => (
          <button
            key={m.id}
            aria-pressed={mode === m.id}
            disabled={isBusy || isRecording}
            onClick={() => {
              setMode(m.id);
              clearAudio();
            }}
            className={`flex-1 rounded-md py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
              mode === m.id
                ? "bg-red-900 text-red-100 shadow"
                : "text-neutral-300 hover:text-red-400"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Direction Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-widest text-neutral-300">
          Translation Direction
        </span>
        <button
          disabled={isBusy || isRecording}
          aria-label={`Switch direction. Currently ${sourceLang} to ${targetLang}`}
          onClick={() => {
            setDirection(direction === "en-to-id" ? "id-to-en" : "en-to-id");
          }}
          className="flex items-center gap-2 rounded-lg border border-red-900/30 bg-neutral-950 px-4 py-2 text-xs font-semibold text-neutral-300 transition-all hover:border-red-600 hover:text-red-400"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
          {direction === "en-to-id" ? "English → Idoma" : "Idoma → English"}
        </button>
      </div>

      {/* Input Area */}
      <div className="flex flex-col gap-3">
        <label htmlFor={mode === "text" ? "translation-input" : undefined} className="text-xs font-medium uppercase tracking-widest text-neutral-300">
          {mode === "text" ? "Input Text" : "Record Audio"}
        </label>

        {mode === "text" ? (
          <textarea
            id="translation-input"
            aria-describedby="translation-input-help"
            maxLength={4000}
            disabled={isBusy}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleTranslate();
              }
            }}
            placeholder={
              direction === "en-to-id"
                ? "Type English text to translate..."
                : "Type Idoma text to translate..."
            }
            rows={4}
            className="w-full resize-none rounded-lg border border-red-900/40 bg-neutral-950 p-4 text-sm leading-relaxed text-red-100 placeholder-neutral-400 outline-none transition-colors focus:border-red-600"
          />
        ) : (
          <AudioRecorder
            onAudioRecorded={handleAudioRecorded}
            maxDuration={30}
            disabled={isBusy}
            className="w-full"
          />
        )}
      </div>

      {mode === "text" && <p id="translation-input-help" className="text-xs text-neutral-400">{inputText.length.toLocaleString()} / 4,000 characters · Enter adds a line; Ctrl/⌘ + Enter translates.</p>}

      {/* Record Button (for speech modes) */}
      {mode !== "text" && !audioBlob && (
        <div className="flex items-center justify-center py-2">
          <p className="text-xs text-neutral-400">
            Record audio to begin translation
          </p>
        </div>
      )}

      {/* Playback Controls (for speech modes) */}
      {audioBlob && mode !== "text" && (
        <div className="rounded-lg border border-red-900/30 bg-neutral-950 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-widest text-neutral-300">
              Recorded Audio
            </span>
            <button
              onClick={clearAudio}
              disabled={isBusy || isRecording}
              className="text-xs font-semibold text-red-400 hover:text-red-300"
            >
              Clear
            </button>
          </div>
          <AudioPlayer audioUrl={recordedAudioURL || ""} className="w-full" />
        </div>
      )}

      {/* Translate Button */}
      <button
        onClick={
          mode === "text" ? handleTranslate : mode === "speech" ? handleTranscribeAndTranslate : handleFullPipeline
        }
        disabled={
          (mode === "text" && !inputText.trim()) ||
          (mode !== "text" && !audioBlob) ||
          isBusy || isRecording || authLoading || (!isAuthenticated && trialRemaining === null)
        }
        className="flex items-center justify-center gap-2 rounded-lg bg-red-900 px-6 py-3 text-sm font-semibold text-red-100 transition-all hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {(mode === "text" && isTranslating) ||
        (mode === "speech" && isTranscribing) ||
        (mode === "full" && isSynthesizing) ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-300 border-t-transparent" />
            Processing...
          </>
        ) : mode === "text" ? (
          `Translate to ${targetLang}`
        ) : mode === "speech" ? (
          "Transcribe & Translate"
        ) : (
          "Translate and play audio"
        )}
      </button>

      {/* Transcription Display (for speech modes) */}
      {transcription && mode !== "text" && (
        <div className="rounded-lg border border-red-700/30 bg-neutral-950 p-4">
          <label className="text-xs font-medium uppercase tracking-widest text-neutral-300">
            Transcription
          </label>
          <p className="mt-2 font-heading text-sm text-red-300">{transcription}</p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Result */}
      {translation && (
        <section aria-label="Translation result" aria-live="polite" className="break-words rounded-lg border border-red-700/30 bg-neutral-950 p-6">
          <div className="flex items-center justify-between gap-3"><label className="text-xs font-medium uppercase tracking-widest text-neutral-300">Translation</label>{isAuthenticated && <button onClick={() => void toggleSaveTranslation()} aria-pressed={isSaved} className="rounded border border-red-900 px-3 py-1.5 text-xs text-red-200 hover:bg-red-950">{isSaved ? "★ Saved" : "☆ Save for review"}</button>}</div>
          {saveFeedback && <p role="status" className="mt-2 text-xs text-green-300">{saveFeedback}</p>}
          {translation.translation === "Missing from Idlang archives." ? (
            <div className="mt-2">
              <p className="font-heading text-lg font-bold text-red-400/60">
                Missing from Idlang archives.
              </p>
              <p className="mt-2 text-xs italic text-neutral-400">
                This word has not yet been documented in the archives.
              </p>
            </div>
          ) : (
            <p className="mt-2 font-heading text-xl font-bold leading-relaxed text-red-100">
              {translation.translation}
            </p>
          )}
          {translation.explanation && !translation.translation.startsWith("Missing") && (
            <p className="mt-3 border-t border-red-900/20 pt-3 text-xs italic text-neutral-300">
              {translation.explanation}
            </p>
          )}
          {translation.warning && (
            <p className="mt-3 rounded-md border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
              {translation.warning}
            </p>
          )}
          {translation.model && (

            <p className="mt-2 text-xs text-neutral-500">
              Model: {translation.model}
              {typeof translation.confidence === "number" &&
                ` | Confidence: ${Math.round(translation.confidence * 100)}%`}
            </p>
          )}

          {/* Synthesized Audio (for full pipeline) */}
          {synthesizedAudio && mode === "full" && (
            <div className="mt-4 rounded-lg border border-red-900/20 bg-neutral-900 p-4">
              <label className="text-xs font-medium uppercase tracking-widest text-neutral-300">
                Synthesized Speech
              </label>
              <AudioPlayer audioUrl={synthesizedAudio} className="mt-2 w-full" />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function stableTranslationId(source: string, result: string): string {
  const value = `${source.trim()}\u0000${result.trim()}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `translation-${(hash >>> 0).toString(16)}`;
}
