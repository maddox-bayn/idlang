import { fetchResponse } from "./request";
import type { TranslateResponse, TranscriptionResponse, FullPipelineResponse } from "../types";

// Use the same backend origin as authentication. Vite proxies /api locally.
// VITE_API_URL is only needed for a separately hosted Go API.
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

/**
 * Pull a human-readable message off an error response.
 *
 * The Go backend replies with `{"error": ...}` but the proxied FastAPI service
 * replies with `{"detail": ...}`. Reading only `error` swallowed every upstream
 * message from /api/transcribe and /api/pipeline.
 */
export class TranslationAPIError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = "TranslationAPIError";
  }
}

async function responseError(response: Response, fallback: string): Promise<TranslationAPIError> {
  const data = await response.json().catch(() => ({}));
  const raw = data.error ?? data.detail;
  return new TranslationAPIError(typeof raw === "string" ? raw : `${fallback} (HTTP ${response.status})`, response.status, data.code);
}

/**
 * Translation API client for Idlang
 */
export class TranslationClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async access(signal?: AbortSignal): Promise<{ authenticated: boolean; trial_remaining: boolean }> {
    const response = await fetchResponse(`${this.baseUrl}/api/translation/access`, { credentials: "include", cache: "no-store", signal });
    if (!response.ok) throw await responseError(response, "Could not check translation access");
    return response.json();
  }

  /**
   * Translate text between English and Idoma
   */
  async translateText(
    text: string,
    sourceLang: "English" | "Idoma" = "English",
    targetLang: "English" | "Idoma" = "Idoma",
    signal?: AbortSignal
  ): Promise<TranslateResponse> {
    const response = await fetchResponse(`${this.baseUrl}/api/translate`, {
      method: "POST",
      signal,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        source_lang: sourceLang,
        target_lang: targetLang,
      }),
    }, 100_000);

    if (!response.ok) {
      throw await responseError(response, "Translation request failed");
    }

    const data = await response.json();
    if (typeof data.translation !== "string" || !data.translation.trim()) throw new Error("The service returned an empty translation. Please try again.");
    return {
      translation: data.translation,
      explanation: data.explanation,
      model: data.model,
      confidence: data.confidence,
      warning: data.warning,
    };
  }

  /**
   * Transcribe audio to text
   */
  async transcribeAudio(
    audioBlob: Blob,
    sourceLang: "English" | "Idoma",
    signal?: AbortSignal
  ): Promise<TranscriptionResponse> {
    const formData = new FormData();
    formData.append("audio", audioBlob, audioFilename(audioBlob));
    formData.append("source_lang", sourceLang);

    const response = await fetchResponse(`${this.baseUrl}/api/transcribe`, {
      method: "POST",
      signal,
      credentials: "include",
      body: formData,
    }, 125_000);

    if (!response.ok) {
      throw await responseError(response, "Transcription request failed");
    }

    const data = await response.json();
    return {
      transcription: data.transcription || "",
      language: data.language || sourceLang,
      confidence: data.confidence || 0,
      model: data.model,
      timestamp: data.timestamp,
    };
  }

  /**
   * Full pipeline: Audio → Transcription → Translation → Synthesis
   */
  async fullPipeline(
    audioBlob: Blob,
    sourceLang: "English" | "Idoma",
    signal?: AbortSignal
  ): Promise<FullPipelineResponse> {
    const formData = new FormData();
    formData.append("audio", audioBlob, audioFilename(audioBlob));
    formData.append("source_lang", sourceLang);

    const response = await fetchResponse(`${this.baseUrl}/api/pipeline`, {
      method: "POST",
      signal,
      credentials: "include",
      body: formData,
    }, 125_000);

    if (!response.ok) {
      throw await responseError(response, "Pipeline request failed");
    }

    const data = await response.json();
    if (typeof data.translation?.translation !== "string" || !data.translation.translation.trim()) throw new Error("The service returned an empty translation. Please try again.");
    return {
      transcription: {
        transcription: data.transcription?.transcription || "",
        language: data.transcription?.language || sourceLang,
        confidence: data.transcription?.confidence || 0,
        model: data.transcription?.model,
        timestamp: data.transcription?.timestamp,
      },
      translation: {
        translation: data.translation?.translation || "Missing from Idlang archives.",
        model: data.translation?.model,
        confidence: data.translation?.confidence || 0,
        source_lang: data.translation?.source_lang || sourceLang,
        target_lang: data.translation?.target_lang,
        timestamp: data.translation?.timestamp,
        warning: data.translation?.warning,
      },
      audio: data.audio,
      audioFormat: data.audio_format,
      timestamp: data.timestamp,
    };
  }

  /**
   * Get translation history from localStorage
   */
  getHistory(): TranslateResponse[] {
    try {
      const history = localStorage.getItem("idlang_history");
      const parsed = history ? JSON.parse(history) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Add entry to translation history
   */
  addToHistory(entry: TranslateResponse): void {
    try {
      const history = this.getHistory();
      history.unshift(entry);
      // Keep only last 20 entries
      localStorage.setItem("idlang_history", JSON.stringify(history.slice(0, 20)));
    } catch {
      // Ignore errors
    }
  }
}

// Create singleton instance
export const translationClient = new TranslationClient();

export function audioFilename(blob: Blob): string {
  const type = blob.type.toLowerCase();
  const extension = type.includes("webm") ? "webm" : type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "wav";
  return `recording.${extension}`;
}
