export interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
  translation?: string;
}

export interface Lesson {
  id: string;
  title: string;
  questions: Question[];
}

export interface TranslateResponse {
  translation: string;
  explanation?: string;
  model?: string;
  confidence?: number;
  source_lang?: string;
  target_lang?: string;
  timestamp?: string;
}

export interface TranscriptionResponse {
  transcription: string;
  language: string;
  confidence: number;
  model?: string;
  timestamp?: string;
}

export interface FullPipelineResponse {
  transcription: TranscriptionResponse;
  translation: TranslateResponse;
  audio?: string;
  audioFormat?: string;
  timestamp?: string;
}
