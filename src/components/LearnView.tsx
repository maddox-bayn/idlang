import { useState } from "react";
import { getAllLessons } from "../data/mockData";
import type { Lesson } from "../types";
import DuolingoLesson from "./DuolingoLesson";

export default function LearnView() {
  const lessons = getAllLessons();
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);

  if (activeLesson) {
    return (
      <div className="mx-auto w-full max-w-lg px-4">
        <button
          onClick={() => setActiveLesson(null)}
          className="mb-4 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-red-500 transition-colors hover:text-red-400"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to lessons
        </button>
        <DuolingoLesson
          lesson={activeLesson}
          onComplete={() => setActiveLesson(null)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4">
      <p className="text-center text-xs font-medium uppercase tracking-widest text-red-600">
        Choose a lesson
      </p>

      {lessons.map((lesson) => (
        <button
          key={lesson.id}
          onClick={() => setActiveLesson(lesson)}
          className="group card-glow w-full rounded-lg border border-red-900/40 bg-neutral-950 p-5 text-left transition-all duration-200 hover:border-red-600 hover:bg-neutral-900"
        >
          <h3 className="font-heading text-lg font-bold text-red-100">
            {lesson.title}
          </h3>
          <p className="mt-2 text-xs text-red-500">
            {lesson.questions.length} questions
          </p>
          <span className="mt-3 inline-block text-xs font-semibold text-red-600 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            Start lesson →
          </span>
        </button>
      ))}
    </div>
  );
}
