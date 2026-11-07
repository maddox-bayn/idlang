import type { Question } from "../types";

export interface ReviewItem {
  lessonId: string;
  lessonTitle: string;
  question: Question;
  missedAt: string;
}

interface SavedProgress { lessonId: string; questionIndex: number }

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}

export function saveLessonProgress(userId: string, progress: SavedProgress): void {
  try { localStorage.setItem(`idlang_learning_progress_${userId}`, JSON.stringify(progress)); } catch { /* Browser storage is optional. */ }
}

export function getLessonProgress(userId: string): SavedProgress | null {
  return read<SavedProgress | null>(`idlang_learning_progress_${userId}`, null);
}

export function clearLessonProgress(userId: string): void {
  try { localStorage.removeItem(`idlang_learning_progress_${userId}`); } catch { /* Browser storage is optional. */ }
}

export function getReviewItems(userId: string): ReviewItem[] {
  return read<ReviewItem[]>(`idlang_review_items_${userId}`, []);
}

export function saveReviewItem(userId: string, item: ReviewItem): void {
  const current = getReviewItems(userId).filter((saved) => !(saved.lessonId === item.lessonId && saved.question.id === item.question.id));
  try { localStorage.setItem(`idlang_review_items_${userId}`, JSON.stringify([item, ...current].slice(0, 100))); } catch { /* Browser storage is optional. */ }
}

export function removeReviewItem(userId: string, lessonId: string, questionId: string): void {
  const next = getReviewItems(userId).filter((item) => !(item.lessonId === lessonId && item.question.id === questionId));
  try { localStorage.setItem(`idlang_review_items_${userId}`, JSON.stringify(next)); } catch { /* Browser storage is optional. */ }
}
