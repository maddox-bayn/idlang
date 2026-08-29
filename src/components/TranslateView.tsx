import { useState, useEffect } from "react";
import AudioRecorder from "./AudioRecorder";
import AudioPlayer from "./AudioPlayer";
import { translationClient } from "../api/translationClient";
import type { TranslateResponse } from "../types";

type TranslationMode = "text" | "speech" | "full";
type TranslationDirection = "en-to-id" | "id-to-en";

export default function TranslateView() {
  const [mode, setMode] = useState<TranslationMode>("text");
  const [direction, setDirection] = useState<TranslationDirection>("en-to-id");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcription, setTranscription] = useState("");

  // Cleanup audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const sourceLang = direction === "en-to-id" ? "English" : "Idoma";
  const targetLang = direction === "en-to-id" ? "Idoma" : "English";

  async function handleTranslate() {
    const text = input.trim();
    if (!text) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await translationClient.translateText(text, sourceLang, targetLang);
      setResult(data);
      translationClient.addToHistory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleTranscribeAndTranslate() {
    if (!audioBlob) return;

    setLoading(true);
    setError(null);
    setResult(null);
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
      setResult(translateData);
      translationClient.addToHistory(translateData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleFullPipeline() {
    if (!audioBlob) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setTranscription("");
    setAudioUrl(null);

    try {
      const data = await translationClient.fullPipeline(audioBlob, sourceLang);
      setTranscription(data.transcription.transcription);
      setResult(data.translation);
      setAudioUrl(`data:audio/wav;base64,${data.audio}`);
      translationClient.addToHistory(data.translation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setLoading(false);
    }
  }

  function handleAudioRecorded(blob: Blob) {
    setAudioBlob(blob);
    // Create a temporary URL for immediate playback
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    const url = URL.createObjectURL(blob);
    setAudioUrl(url);
  }

  function clearAudio() {
    setAudioBlob(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4">
      {/* Mode Selection */}
      <div className="flex gap-2 rounded-lg border border-red-900/30 bg-neutral-950 p-1">
        {[
          { id: "text", label: "Text" },
          { id: "speech", label: "Speech" },
          { id: "full", label: "Full Pipeline" },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setMode(m.id as TranslationMode);
              clearAudio();
              setInput("");
              setResult(null);
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
            setDirection(direction === "en-to-id" ? "id-to-en" : "en-to-id");
            setInput("");
            setResult(null);
            clearAudio();
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
          <AudioPlayer audioUrl={audioUrl || ""} className="w-full" />
        </div>
      )}

      {/* Translate Button */}
      <button
        onClick={
          mode === "text" ? handleTranslate : mode === "speech" ? handleTranscribeAndTranslate : handleFullPipeline
        }
        disabled={loading || (!input.trim() && mode === "text") || (!audioBlob && mode !== "text")}
        className="flex items-center justify-center gap-2 rounded-lg bg-red-900 px-6 py-3 text-sm font-semibold text-red-100 transition-all hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? (
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
      {result && (
        <div className="rounded-lg border border-red-700/30 bg-neutral-950 p-6">
          <label className="text-xs font-medium uppercase tracking-widest text-red-600">
            Translation
          </label>
          {result.translation === "Missing from Idlang archives." ? (
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
              {result.translation}
            </p>
          )}
          {result.explanation && !result.translation.startsWith("Missing") && (
            <p className="mt-3 border-t border-red-900/20 pt-3 text-xs italic text-red-400/70">
              {result.explanation}
            </p>
          )}
          {result.model && (
            <p className="mt-2 text-xs text-neutral-500">
              Model: {result.model} {result.confidence && `| Confidence: ${Math.round(result.confidence * 100)}%`}
            </p>
          )}

          {/* Synthesized Audio (for full pipeline) */}
          {audioUrl && mode === "full" && (
            <div className="mt-4 rounded-lg border border-red-900/20 bg-neutral-900 p-4">
              <label className="text-xs font-medium uppercase tracking-widest text-red-600">
                Synthesized Speech
              </label>
              <AudioPlayer audioUrl={audioUrl} className="mt-2 w-full" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
