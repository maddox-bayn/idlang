import { useEffect, useState } from "react";
import type { Lesson, Question } from "../types";
import { removeReviewItem, saveLessonProgress, saveReviewItem } from "../data/learningProgress";

interface DuolingoLessonProps {
  lesson: Lesson;
  onComplete: () => void;
  currentUserId?: string;
  initialIndex?: number;
  onPass?: (answers: Record<string, string>) => Promise<void>;
}

type FeedbackState = "idle" | "correct" | "incorrect";

export default function DuolingoLesson({ lesson, onComplete, currentUserId, initialIndex = 0, onPass }: DuolingoLessonProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>("idle");
  const [score, setScore] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [awardError, setAwardError] = useState<string | null>(null);
  const [awarding, setAwarding] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const currentQuestion: Question | undefined = lesson.questions[currentIndex];
  const progress =
    ((currentIndex + (feedback === "correct" ? 1 : 0)) /
      lesson.questions.length) *
    100;

  useEffect(() => {
    if (currentUserId && lesson.track_id && !completed) saveLessonProgress(currentUserId, { lessonId: lesson.id, questionIndex: currentIndex });
  }, [currentUserId, lesson.id, lesson.track_id, currentIndex, completed]);

  function handleOptionSelect(option: string) {
    if (feedback !== "idle") return;
    setSelectedOption(option);
    if (currentQuestion) setAnswers((current) => ({ ...current, [currentQuestion.id]: option }));

    if (option === currentQuestion?.correctAnswer) {
      setFeedback("correct");
      setScore((s) => s + 1);
      if (currentUserId && currentQuestion) removeReviewItem(currentUserId, lesson.id, currentQuestion.id);
    } else {
      setFeedback("incorrect");
      setShakeKey((k) => k + 1);
      if (currentUserId && currentQuestion) saveReviewItem(currentUserId, {
        lessonId: lesson.id, lessonTitle: lesson.title, question: currentQuestion, missedAt: new Date().toISOString(),
      });
    }
  }

  function handleNext() {
    if (currentIndex < lesson.questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setSelectedOption(null);
      setFeedback("idle");
    } else {
      setCompleted(true);
    }
  }

  async function handleClaimXP() {
    if (!onPass || awarding) { if (!onPass) onComplete(); return; }
    setAwarding(true); setAwardError(null);
    try { await onPass(answers); }
    catch (error) { setAwardError(error instanceof Error ? error.message : "Could not save lesson progress."); }
    finally { setAwarding(false); }
  }

  const getOptionStyle = (option: string) => {
    const base =
      "w-full rounded-lg border-2 px-5 py-4 text-left text-sm font-medium transition-all duration-200 cursor-pointer";

    if (feedback === "idle") {
      return `${base} border-red-900/40 bg-neutral-950 text-red-200 hover:border-red-500 hover:bg-neutral-900`;
    }

    if (option === currentQuestion?.correctAnswer) {
      return `${base} border-green-500 bg-green-900/40 text-green-200`;
    }

    if (option === selectedOption && feedback === "incorrect") {
      return `${base} border-red-500 bg-red-900/40 text-red-200`;
    }

    return `${base} border-red-900/20 bg-neutral-950 text-red-400/50`;
  };

  if (completed) {
    const percentage = Math.round((score / lesson.questions.length) * 100);
    return (
      <div className="rounded-xl border border-red-900/50 bg-neutral-950 p-8 text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border-2 border-red-600">
          <span className="font-heading text-4xl text-red-500">
            {percentage >= 80 ? "🎉" : percentage >= 50 ? "💪" : "🕯️"}
          </span>
        </div>
        <h2 className="font-heading text-2xl font-bold text-red-100">
          Lesson Complete
        </h2>
        <p className="mt-2 text-red-400">
          You scored {score} out of {lesson.questions.length}
        </p>
        <div className="mx-auto my-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-neutral-800">
          <div
            className="lesson-progress-bar h-full rounded-full bg-red-600"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <p className="text-sm text-red-400">
          {percentage === 100
            ? "Perfect! The ancestors honour you."
            : percentage >= 50
            ? "Good. Keep learning our language."
            : "Ekwu wa will guide you. Try again."}
        </p>
        {percentage >= 80 ? (
          <div className="mt-6 flex flex-col items-center gap-3">
            {awardError && <p role="alert" className="text-sm text-red-300">{awardError}</p>}
            <button onClick={() => void handleClaimXP()} disabled={awarding} className="rounded-lg bg-red-800 px-8 py-3 font-semibold text-red-100 hover:bg-red-700 disabled:opacity-50">
              {awarding ? "Saving progress…" : onPass ? "Pass lesson & earn track XP" : "Finish lesson"}
            </button>
            <button onClick={onComplete} className="text-sm text-neutral-400 underline">Back to lessons</button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-3">
            <p className="text-xs text-neutral-300">Score at least 80% to pass. Missed questions are saved for review.</p>
          <button onClick={() => { setCurrentIndex(0); setSelectedOption(null); setFeedback("idle"); setScore(0); setAnswers({}); setCompleted(false); setAwardError(null); }} className="rounded-lg border border-red-800 bg-red-900/30 px-8 py-3 font-semibold text-red-200 hover:bg-red-900/60">Try again</button>
            <button onClick={onComplete} className="text-sm text-neutral-400 underline">Back to lessons</button>
          </div>
        )}
      </div>
    );
  }

  if (!currentQuestion) return null;

  return (
    <div className="flex flex-col rounded-xl border border-red-900/50 bg-neutral-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-red-900/30 px-6 py-4">
        <span className="text-sm font-medium text-red-400">
          {lesson.title}
        </span>
        <span className="text-xs text-red-500">
          {currentIndex + 1} of {lesson.questions.length}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="h-1 w-full bg-neutral-800">
        <div
          className="lesson-progress-bar h-full rounded-r bg-red-600"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Question */}
      <div className="px-6 py-8" key={currentQuestion.id}>
        <p className="font-heading text-lg font-bold leading-relaxed text-red-100">
          {currentQuestion.question}
        </p>
      </div>

      {/* Options */}
      <div
        className="flex flex-col gap-3 px-6 pb-6"
        key={`${currentQuestion.id}-${shakeKey}`}
      >
        {currentQuestion.options.map((option) => (
          <button
            key={option}
            onClick={() => handleOptionSelect(option)}
            className={`${getOptionStyle(option)} ${
              shakeKey > 0 ? "shake" : ""
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {/* Feedback Banner */}
      {feedback !== "idle" && (
        <div
          className={`rounded-b-xl px-6 py-4 ${
            feedback === "correct"
              ? "border-t border-green-700/50 bg-green-900/20"
              : "border-t border-red-700/50 bg-red-900/20"
          }`}
        >
          {feedback === "correct" ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-300">
                  ✓ Correct!
                </p>
                {currentQuestion.translation && (
                  <p className="mt-1 text-xs text-green-400/80">
                    {currentQuestion.translation}
                  </p>
                )}
              </div>
              <button
                onClick={handleNext}
                className="rounded-lg bg-green-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-600"
              >
                {currentIndex < lesson.questions.length - 1
                  ? "Next"
                  : "Finish"}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-red-300">
                  ✗ Not quite
                </p>
                <p className="mt-1 text-xs text-red-400/80">
                  The correct answer is{" "}
                  <span className="font-semibold text-red-200">
                    {currentQuestion.correctAnswer}
                  </span>
                </p>
              {currentQuestion.translation && <p className="mt-1 text-xs text-red-300/80">Example: {currentQuestion.translation}</p>}
              </div>
              <button
                onClick={handleNext}
                className="rounded-lg border border-red-700 bg-red-900/40 px-5 py-2 text-sm font-semibold text-red-200 transition-colors hover:bg-red-900/70"
              >
                {currentIndex < lesson.questions.length - 1
                  ? "Next"
                  : "Finish"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
