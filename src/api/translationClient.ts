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

  async access(): Promise<{ authenticated: boolean; trial_remaining: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/translation/access`, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw await responseError(response, "Could not check translation access");
    return response.json();
  }

  /**
   * Translate text between English and Idoma
   */
  async translateText(
    text: string,
    sourceLang: "English" | "Idoma" = "English",
    targetLang: "English" | "Idoma" = "Idoma"
  ): Promise<TranslateResponse> {
    const response = await fetch(`${this.baseUrl}/api/translate`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        source_lang: sourceLang,
        target_lang: targetLang,
      }),
    });

    if (!response.ok) {
      throw await responseError(response, "Translation request failed");
    }

    const data = await response.json();
    return {
      translation: data.translation || "Missing from Idlang archives.",
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
    sourceLang: "English" | "Idoma"
  ): Promise<TranscriptionResponse> {
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.wav");
    formData.append("source_lang", sourceLang);

    const response = await fetch(`${this.baseUrl}/api/transcribe`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

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
    sourceLang: "English" | "Idoma"
  ): Promise<FullPipelineResponse> {
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.wav");
    formData.append("source_lang", sourceLang);

    const response = await fetch(`${this.baseUrl}/api/pipeline`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      throw await responseError(response, "Pipeline request failed");
    }

    const data = await response.json();
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
      return history ? JSON.parse(history) : [];
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
