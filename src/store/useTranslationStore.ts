import { create } from 'zustand';
import type { TranslateResponse } from '../types';

type TranslationDirection = 'en-to-id' | 'id-to-en';
type TranslationMode = 'text' | 'speech' | 'full';

interface HistoryEntry {
  id: string;
  timestamp: string;
  sourceText: string;
  translatedText: string;
  direction: TranslationDirection;
}

interface TranslationState {
  // Current state
  mode: TranslationMode;
  direction: TranslationDirection;
  isRecording: boolean;
  isTranscribing: boolean;
  isTranslating: boolean;
  isSynthesizing: boolean;

  // Input/Output
  inputText: string;
  audioBlob: Blob | null;
  transcription: string;
  translation: TranslateResponse | null;
  synthesizedAudio: string | null;

  // History
  history: HistoryEntry[];
  maxHistorySize: number;

  // Error state
  error: string | null;

  // Actions
  setMode: (mode: TranslationMode) => void;
  setDirection: (direction: TranslationDirection) => void;
  setInputText: (text: string) => void;
  setAudioBlob: (blob: Blob | null) => void;
  clearAudio: () => void;
  setTranscription: (transcription: string) => void;
  setTranslation: (translation: TranslateResponse | null) => void;
  setSynthesizedAudio: (audio: string | null) => void;
  setError: (error: string | null) => void;
  clearTranslation: () => void;

  // Loading states
  setIsRecording: (isRecording: boolean) => void;
  setIsTranscribing: (isTranscribing: boolean) => void;
  setIsTranslating: (isTranslating: boolean) => void;
  setIsSynthesizing: (isSynthesizing: boolean) => void;

  // History management
  addToHistory: (translation: TranslateResponse, sourceText: string) => void;
  getHistory: () => HistoryEntry[];
  clearHistory: () => void;
}

export const useTranslationStore = create<TranslationState>((set, get) => ({
  // Current state
  mode: 'text',
  direction: 'en-to-id',
  isRecording: false,
  isTranscribing: false,
  isTranslating: false,
  isSynthesizing: false,

  // Input/Output
  inputText: '',
  audioBlob: null,
  transcription: '',
  translation: null,
  synthesizedAudio: null,

  // History
  history: [],
  maxHistorySize: 20,

  // Error state
  error: null,

  // Actions
  setMode: (mode) => set({ mode, translation: null, transcription: '', synthesizedAudio: null }),
  setDirection: (direction) => set({ direction, translation: null }),
  setInputText: (text) => set({ inputText: text, error: null }),
  setAudioBlob: (blob) => set({ audioBlob: blob, error: null }),
  clearAudio: () => set({ audioBlob: null, synthesizedAudio: null, transcription: '' }),
  setTranscription: (transcription) => set({ transcription, error: null }),
  setTranslation: (translation) => set({ translation, error: null }),
  setSynthesizedAudio: (audio) => set({ synthesizedAudio: audio, error: null }),
  setError: (error) => set({ error }),

  clearTranslation: () => set({ translation: null, transcription: '', synthesizedAudio: null }),

  // Loading states
  setIsRecording: (isRecording) => set({ isRecording }),
  setIsTranscribing: (isTranscribing) => set({ isTranscribing }),
  setIsTranslating: (isTranslating) => set({ isTranslating }),
  setIsSynthesizing: (isSynthesizing) => set({ isSynthesizing }),

  // History management
  addToHistory: (translation, sourceText) => {
    const { direction, history, maxHistorySize } = get();
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      sourceText,
      translatedText: translation.translation,
      direction,
    };
    set({ history: [entry, ...history].slice(0, maxHistorySize) });
  },

  getHistory: () => get().history,

  clearHistory: () => set({ history: [] }),
}));
