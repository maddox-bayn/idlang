import { useState } from "react";
import { getAllLessons } from "../data/mockData";
import type { Lesson, User } from "../types";
import DuolingoLesson from "./DuolingoLesson";
import LearningDashboard from "./LearningDashboard";

interface LearnViewProps {
  currentUser: User;
}

export default function LearnView({ currentUser }: LearnViewProps) {
  const lessons = getAllLessons();
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [activeMode, setActiveMode] = useState<"tracks" | "quizzes">("tracks");

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
          Back to learning tracks
        </button>
        <DuolingoLesson
          lesson={activeLesson}
          onComplete={() => setActiveLesson(null)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 space-y-6">
      {/* Subnavigation toggle: Tracks vs Quizzes */}
      <div className="flex items-center justify-center">
        <div className="inline-flex rounded-lg border border-red-900/40 bg-neutral-950 p-1">
          <button
            onClick={() => setActiveMode("tracks")}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              activeMode === "tracks"
                ? "bg-red-900 text-red-100 shadow"
                : "text-red-500 hover:text-red-300"
            }`}
          >
            Gamified Tracks Stepper
          </button>
          <button
            onClick={() => setActiveMode("quizzes")}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
              activeMode === "quizzes"
                ? "bg-red-900 text-red-100 shadow"
                : "text-red-500 hover:text-red-300"
            }`}
          >
            Practice Lessons ({lessons.length})
          </button>
        </div>
      </div>

      {activeMode === "tracks" ? (
        <LearningDashboard
          currentUser={currentUser}
          onLaunchLesson={(lessonId) => {
            const l = lessons.find((item) => item.id === lessonId) || lessons[0];
            setActiveLesson(l);
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-center text-xs font-medium uppercase tracking-widest text-red-600">
            Interactive Vocabulary Quizzes
          </p>

          {lessons.map((lesson) => (
            <button
              key={lesson.id}
              onClick={() => setActiveLesson(lesson)}
              className="group card-glow w-full rounded-lg border border-red-900/40 bg-neutral-950 p-5 text-left transition-all duration-200 hover:border-red-600 hover:bg-neutral-900"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-heading text-lg font-bold text-red-100">
                    {lesson.title}
                  </h3>
                  <p className="mt-1 text-xs text-red-500">
                    {lesson.questions.length} questions
                  </p>
                </div>
                <span className="rounded bg-red-950 border border-red-900 px-3 py-1 text-xs font-semibold text-red-400 group-hover:bg-red-900 group-hover:text-red-100 transition-all">
                  Start Quiz →
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
