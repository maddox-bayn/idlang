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
  /** Set when the loaded checkpoint cannot truly emit Idoma. */
  warning?: string;
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

export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  bio?: string;
  created_at?: string;
}

export type MediaType = "text" | "image" | "audio" | "video";

export interface Post {
  id: string;
  user_id: string;
  author?: User;
  content: string;
  media_type: MediaType;
  media_url?: string;
  created_at: string;
}

export type ConnectionStatus = "none" | "pending" | "connected" | "blocked";

export interface DirectMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  uploaded_by: string;
  file_url: string;
  description?: string;
  created_at?: string;
}

export type FluencyTier = "beginner" | "intermediate" | "advanced";

export interface LearningProfile {
  user_id: string;
  completed_tracks: string[];
  xp_points: number;
  fluency_tier: FluencyTier;
  created_at?: string;
  updated_at?: string;
}

export interface LearningTrack {
  id: string;
  step: number;
  title: string;
  description: string;
  xp_reward: number;
  category: string;
  status: "completed" | "active" | "locked";
}

export interface ProfileResponse {
  user: User;
  is_owner: boolean;
  connection_status: ConnectionStatus;
  connection_direction?: string;
  learning_profile: LearningProfile;
  posts: Post[];
  connection_count: number;
}

