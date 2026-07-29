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
}
