import { useState } from "react";
import type { TranslateResponse } from "../types";

export default function TranslateView() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleTranslate() {
    const text = input.trim();
    if (!text) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("http://localhost:8080/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error("Translation request failed");
      const data: TranslateResponse = await res.json();
      setResult(data);
    } catch {
      setError("The spirits could not be reached. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleTranslate();
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4">
      {/* Input */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-widest text-red-600">
          English
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type an English word or sentence..."
          rows={4}
          className="w-full resize-none rounded-lg border border-red-900/40 bg-neutral-950 p-4 text-sm leading-relaxed text-red-100 placeholder-red-700/50 outline-none transition-colors focus:border-red-600"
        />
      </div>

      {/* Translate Button */}
      <button
        onClick={handleTranslate}
        disabled={loading || !input.trim()}
        className="flex items-center justify-center gap-2 rounded-lg bg-red-900 px-6 py-3 text-sm font-semibold text-red-100 transition-all hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-300 border-t-transparent" />
            Consulting the archives...
          </>
        ) : (
          "Translate to Idoma"
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="rounded-lg border border-red-700/30 bg-neutral-950 p-6">
          <label className="text-xs font-medium uppercase tracking-widest text-red-600">
            Idoma
          </label>
          {result.translation === "Missing from Idlang archives." ? (
            <div className="mt-2">
              <p className="font-heading text-lg font-bold text-red-400/60">
                ⚱ Missing from Idlang archives.
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
        </div>
      )}
    </div>
  );
}
