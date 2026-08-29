import { useEffect } from "react";
import { useTranslationStore } from "../store/useTranslationStore";
import AudioRecorder from "./AudioRecorder";
import AudioPlayer from "./AudioPlayer";
import { translationClient } from "../api/translationClient";

type TranslationMode = "text" | "speech" | "full";

export default function TranslateView() {
  const {
    mode,
    direction,
    inputText,
    audioBlob,
    transcription,
    translation,
    synthesizedAudio,
    error,
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
    if (!text) return;

    setIsTranslating(true);
    setError(null);
    setTranslation(null);

    try {
      const data = await translationClient.translateText(text, sourceLang, targetLang);
      setTranslation(data);
      addToHistory(data, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setIsTranslating(false);
    }
  }

  async function handleTranscribeAndTranslate() {
    if (!audioBlob) return;

    setIsTranscribing(true);
    setError(null);
    setTranslation(null);
    setTranscription("");

    try {
      // Step 1: Transcribe audio
      const transcribeData = await translationClient.transcribeAudio(audioBlob, sourceLang);
      setTranscription(transcribeData.transcription);

      // Step 2: Translate transcription
      const translateData = await translationClient.translateText(
        transcribeData.transcription,
        sourceLang,
        targetLang
      );
      setTranslation(translateData);
      addToHistory(translateData, transcribeData.transcription);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setIsTranscribing(false);
    }
  }

  async function handleFullPipeline() {
    if (!audioBlob) return;

    setIsSynthesizing(true);
    setError(null);
    setTranslation(null);
    setTranscription("");
    setSynthesizedAudio(null);

    try {
      const data = await translationClient.fullPipeline(audioBlob, sourceLang);
      setTranscription(data.transcription.transcription);
      setTranslation(data.translation);
      setSynthesizedAudio(data.audio ? `data:audio/wav;base64,${data.audio}` : null);
      addToHistory(data.translation, data.transcription.transcription);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setIsSynthesizing(false);
    }
  }

  function handleAudioRecorded(blob: Blob) {
    setAudioBlob(blob);
    // Create a temporary URL for immediate playback
    if (synthesizedAudio) {
      URL.revokeObjectURL(synthesizedAudio);
    }
    const url = URL.createObjectURL(blob);
    setSynthesizedAudio(url);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4">
      {/* Mode Selection */}
      <div className="flex gap-2 rounded-lg border border-red-900/30 bg-neutral-950 p-1">
        {[
          { id: "text" as TranslationMode, label: "Text" },
          { id: "speech" as TranslationMode, label: "Speech" },
          { id: "full" as TranslationMode, label: "Full Pipeline" },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => {
              useTranslationStore.getState().setMode(m.id);
              clearAudio();
            }}
            className={`flex-1 rounded-md py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
              mode === m.id
                ? "bg-red-900 text-red-100 shadow"
                : "text-red-600 hover:text-red-400"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Direction Toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-red-600">
          Translation Direction
        </span>
        <button
          onClick={() => {
            useTranslationStore.getState().setDirection(
              direction === "en-to-id" ? "id-to-en" : "en-to-id"
            );
          }}
          className="flex items-center gap-2 rounded-lg border border-red-900/30 bg-neutral-950 px-4 py-2 text-xs font-semibold text-red-600 transition-all hover:border-red-600 hover:text-red-400"
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
        <label className="text-xs font-medium uppercase tracking-widest text-red-600">
          {mode === "text" ? "Input Text" : "Record Audio"}
        </label>

        {mode === "text" ? (
          <textarea
            value={inputText}
            onChange={(e) => useTranslationStore.getState().setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
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
            className="w-full resize-none rounded-lg border border-red-900/40 bg-neutral-950 p-4 text-sm leading-relaxed text-red-100 placeholder-red-700/50 outline-none transition-colors focus:border-red-600"
          />
        ) : (
          <AudioRecorder
            onAudioRecorded={handleAudioRecorded}
            maxDuration={30}
            className="w-full"
          />
        )}
      </div>

      {/* Record Button (for speech modes) */}
      {mode !== "text" && !audioBlob && (
        <div className="flex items-center justify-center py-2">
          <p className="text-xs text-red-500/50">
            Record audio to begin translation
          </p>
        </div>
      )}

      {/* Playback Controls (for speech modes) */}
      {audioBlob && mode !== "text" && (
        <div className="rounded-lg border border-red-900/30 bg-neutral-950 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-widest text-red-600">
              Recorded Audio
            </span>
            <button
              onClick={clearAudio}
              className="text-xs font-semibold text-red-400 hover:text-red-300"
            >
              Clear
            </button>
          </div>
          <AudioPlayer audioUrl={synthesizedAudio || ""} className="w-full" />
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
          useTranslationStore.getState().isTranslating ||
          useTranslationStore.getState().isTranscribing ||
          useTranslationStore.getState().isSynthesizing
        }
        className="flex items-center justify-center gap-2 rounded-lg bg-red-900 px-6 py-3 text-sm font-semibold text-red-100 transition-all hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {(mode === "text" && useTranslationStore.getState().isTranslating) ||
        (mode === "speech" && useTranslationStore.getState().isTranscribing) ||
        (mode === "full" && useTranslationStore.getState().isSynthesizing) ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-300 border-t-transparent" />
            Processing...
          </>
        ) : mode === "text" ? (
          "Translate to Idoma"
        ) : mode === "speech" ? (
          "Transcribe & Translate"
        ) : (
          "Full Pipeline (STT → NMT → TTS)"
        )}
      </button>

      {/* Transcription Display (for speech modes) */}
      {transcription && mode !== "text" && (
        <div className="rounded-lg border border-red-700/30 bg-neutral-950 p-4">
          <label className="text-xs font-medium uppercase tracking-widest text-red-600">
            Transcription
          </label>
          <p className="mt-2 font-heading text-sm text-red-300">{transcription}</p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Result */}
      {translation && (
        <div className="rounded-lg border border-red-700/30 bg-neutral-950 p-6">
          <label className="text-xs font-medium uppercase tracking-widest text-red-600">
            Translation
          </label>
          {translation.translation === "Missing from Idlang archives." ? (
            <div className="mt-2">
              <p className="font-heading text-lg font-bold text-red-400/60">
                Missing from Idlang archives.
              </p>
              <p className="mt-2 text-xs italic text-red-500/50">
                This word has not yet been documented in the archives.
              </p>
            </div>
          ) : (
            <p className="mt-2 font-heading text-xl font-bold leading-relaxed text-red-100">
              {translation.translation}
            </p>
          )}
          {translation.explanation && !translation.translation.startsWith("Missing") && (
            <p className="mt-3 border-t border-red-900/20 pt-3 text-xs italic text-red-400/70">
              {translation.explanation}
            </p>
          )}
          {translation.model && (
            <p className="mt-2 text-xs text-neutral-500">
              Model: {translation.model} {translation.confidence && `| Confidence: ${Math.round(translation.confidence * 100)}%`}
            </p>
          )}

          {/* Synthesized Audio (for full pipeline) */}
          {synthesizedAudio && mode === "full" && (
            <div className="mt-4 rounded-lg border border-red-900/20 bg-neutral-900 p-4">
              <label className="text-xs font-medium uppercase tracking-widest text-red-600">
                Synthesized Speech
              </label>
              <AudioPlayer audioUrl={synthesizedAudio} className="mt-2 w-full" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
