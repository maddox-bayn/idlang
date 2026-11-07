import { useEffect, useState } from "react";
import type { Lesson, Post, User } from "../types";
import DuolingoLesson from "./DuolingoLesson";
import LearningDashboard from "./LearningDashboard";
import AudioRecorder from "./AudioRecorder";
import AudioPlayer from "./AudioPlayer";
import NativeAudioPlayer from "./NativeAudioPlayer";
import { completeDailyPractice, completeLearningTrack, fetchDailyPractice, fetchSavedItems, fetchPosts, unsaveItem, type DailyPractice } from "../api/socialClient";
import type { SavedItem } from "../types";
import { curriculumLessons } from "../data/curriculum";
import { clearLessonProgress, getLessonProgress, getReviewItems, type ReviewItem } from "../data/learningProgress";

interface LearnViewProps { currentUser: User }
type LearnMode = "tracks" | "practice" | "review";

export default function LearnView({ currentUser }: LearnViewProps) {
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [activeMode, setActiveMode] = useState<LearnMode>("tracks");
  const [lessonStartIndex, setLessonStartIndex] = useState(0);
  const [savedProgress, setSavedProgress] = useState(() => getLessonProgress(currentUser.id));
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>(() => getReviewItems(currentUser.id));
  const [daily, setDaily] = useState<DailyPractice | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [dailyAnswer, setDailyAnswer] = useState("");
  const [dailyChecked, setDailyChecked] = useState(false);
  const [dailySaving, setDailySaving] = useState(false);
  const [dailyFeedback, setDailyFeedback] = useState<string | null>(null);
  const [recordedPractice, setRecordedPractice] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [communityAudio, setCommunityAudio] = useState<Post | null>(null);
  const [savedItemsError, setSavedItemsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDailyPractice().then((value) => { if (!cancelled) setDaily(value); })
      .catch((error) => { if (!cancelled) setDailyError(error instanceof Error ? error.message : "Could not load today's practice."); });
    fetchSavedItems().then((items) => { if (!cancelled) setSavedItems(items); }).catch(() => {});
    fetchPosts(1, 20, "greetings").then(({ posts }) => { if (!cancelled) setCommunityAudio(posts.find((post) => post.media_type === "audio") || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser.id]);

  useEffect(() => {
    if (!recordedPractice) return;
    return () => URL.revokeObjectURL(recordedPractice);
  }, [recordedPractice]);

  function refreshSavedState() {
    setSavedProgress(getLessonProgress(currentUser.id));
    setReviewItems(getReviewItems(currentUser.id));
  }

  function launchLesson(lesson: Lesson, startIndex = 0) {
    setLessonStartIndex(Math.min(startIndex, lesson.questions.length - 1));
    setActiveLesson(lesson);
  }

  async function finishTrackLesson(answers: Record<string, string>) {
    if (!activeLesson?.track_id) return;
    await completeLearningTrack(activeLesson.track_id, answers);
    clearLessonProgress(currentUser.id);
    refreshSavedState();
    setActiveLesson(null);
  }

  async function checkDailyAnswer() {
    if (!daily || dailySaving) return;
    const normalize = (value: string) => value.trim().normalize("NFC").toLocaleLowerCase();
    if (normalize(dailyAnswer) !== normalize(daily.answer)) {
      setDailyChecked(false);
      setDailyFeedback("Not quite yet. Check the tones and spelling, then try again.");
      return;
    }
    setDailyChecked(true);
    setDailyFeedback("Correct. Say the phrase aloud or record yourself, then save today's practice.");
  }

  async function completePractice() {
    if (!daily || !dailyChecked || dailySaving) return;
    setDailySaving(true);
    try {
      const result = await completeDailyPractice(daily.date, dailyAnswer.trim().normalize("NFC"));
      setDaily({ ...daily, completed: true, streak: result.streak });
      setDailyFeedback(`Practice saved. Your streak is ${result.streak} day${result.streak === 1 ? "" : "s"}.`);
    } catch (error) {
      setDailyFeedback(error instanceof Error ? error.message : "Could not save today's practice.");
    } finally { setDailySaving(false); }
  }

  function startReview() {
    const items = getReviewItems(currentUser.id);
    setReviewItems(items);
    if (!items.length) return;
    const lesson: Lesson = {
      id: `review-${Date.now()}`,
      title: "Review missed answers",
      level: "Review",
      questions: items.map((item) => item.question),
    };
    setLessonStartIndex(0);
    setActiveLesson(lesson);
  }

  async function removeSaved(item: SavedItem) {
    setSavedItemsError(null);
    try {
      await unsaveItem(item.item_type, item.item_id);
      setSavedItems((items) => items.filter((saved) => !(saved.item_type === item.item_type && saved.item_id === item.item_id)));
    } catch (error) { setSavedItemsError(error instanceof Error ? error.message : "Could not remove saved item."); }
  }

  if (activeLesson) {
    const hasTrack = !!activeLesson.track_id;
    return (
      <div className="mx-auto w-full max-w-lg px-4">
        <button onClick={() => { setActiveLesson(null); refreshSavedState(); }} className="mb-4 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-red-500 hover:text-red-400">
          <span aria-hidden="true">←</span> Back to learning
        </button>
        <DuolingoLesson
          key={activeLesson.id}
          lesson={activeLesson}
          currentUserId={currentUser.id}
          initialIndex={lessonStartIndex}
          onComplete={() => { setActiveLesson(null); refreshSavedState(); }}
          onPass={hasTrack ? finishTrackLesson : undefined}
        />
      </div>
    );
  }

  const resumeLesson = savedProgress && curriculumLessons.find((lesson) => lesson.id === savedProgress.lessonId);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4">
      <DailyPracticeCard
        daily={daily}
        error={dailyError}
        answer={dailyAnswer}
        checked={dailyChecked}
        feedback={dailyFeedback}
        saving={dailySaving}
        recordedAudio={recordedPractice}
        communityAudio={communityAudio}
        onAnswer={setDailyAnswer}
        onCheck={() => void checkDailyAnswer()}
        onComplete={() => void completePractice()}
        onRetry={() => { setDailyError(null); fetchDailyPractice().then(setDaily).catch((e) => setDailyError(e instanceof Error ? e.message : "Could not load today's practice.")); }}
        onRecord={(blob) => setRecordedPractice(URL.createObjectURL(blob))}
      />

      {resumeLesson && savedProgress && (
        <section className="flex flex-col gap-3 rounded-xl border border-red-700/50 bg-red-950/20 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-red-400">Pick up where you left off</p>
            <p className="mt-1 font-heading text-lg font-bold text-red-100">{resumeLesson.title}</p>
            <p className="text-xs text-neutral-400">Question {savedProgress.questionIndex + 1} of {resumeLesson.questions.length}</p>
          </div>
          <button onClick={() => launchLesson(resumeLesson, savedProgress.questionIndex)} className="rounded-lg bg-red-800 px-4 py-2 text-xs font-semibold text-red-100 hover:bg-red-700">Continue lesson</button>
        </section>
      )}

      <div className="flex flex-wrap justify-center gap-1 rounded-lg border border-red-900/40 bg-neutral-950 p-1">
        {([ ["tracks", "Learning path"], ["practice", "Lessons"], ["review", `Review (${reviewItems.length + savedItems.length})`] ] as const).map(([mode, label]) => (
          <button key={mode} onClick={() => setActiveMode(mode)} aria-pressed={activeMode === mode} className={`rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-wider ${activeMode === mode ? "bg-red-900 text-red-100" : "text-neutral-300 hover:text-red-300"}`}>
            {label}
          </button>
        ))}
      </div>

      {activeMode === "tracks" && <LearningDashboard currentUser={currentUser} onLaunchLesson={(lessonId) => {
        const lesson = curriculumLessons.find((item) => item.id === lessonId);
        if (lesson) launchLesson(lesson);
      }} />}

      {activeMode === "practice" && (
        <section className="space-y-3" aria-label="Lessons">
          <p className="text-center text-xs uppercase tracking-widest text-neutral-400">Dictionary-sourced vocabulary and phrases; examples follow the bundled Idoma entries</p>
          {curriculumLessons.map((lesson) => (
            <button key={lesson.id} onClick={() => launchLesson(lesson)} className="card-glow flex w-full items-center justify-between rounded-xl border border-red-900/40 bg-neutral-950 p-5 text-left hover:border-red-600">
              <span><span className="block font-heading text-lg font-bold text-red-100">{lesson.title}</span><span className="text-xs text-neutral-400">{lesson.level} · {lesson.questions.length} questions · {lesson.topic}</span></span>
              <span className="text-sm font-semibold text-red-300">Practice →</span>
            </button>
          ))}
        </section>
      )}

      {activeMode === "review" && (
        <div className="space-y-4">
        <section className="rounded-xl border border-red-900/40 bg-neutral-950 p-5">
          <div className="flex items-center justify-between gap-3">
            <div><h3 className="font-heading text-lg font-bold text-red-100">Missed answers</h3><p className="text-xs text-neutral-400">Incorrect answers are saved on this device and removed after you answer them correctly.</p></div>
            {reviewItems.length > 0 && <button onClick={startReview} className="rounded-lg bg-red-800 px-4 py-2 text-xs font-semibold text-red-100">Start review</button>}
          </div>
          {reviewItems.length === 0 ? <p className="mt-4 text-sm text-neutral-400">Nothing to review yet. Complete a lesson and missed answers will appear here.</p> : <ul className="mt-4 space-y-2">{reviewItems.slice(0, 8).map((item) => <li key={`${item.lessonId}-${item.question.id}`} className="rounded-lg border border-neutral-800 p-3"><p className="text-sm text-red-100">{item.question.question}</p><p className="mt-1 text-xs text-neutral-400">From {item.lessonTitle}</p></li>)}</ul>}
        </section>
        <section className="rounded-xl border border-red-900/40 bg-neutral-950 p-5">
          <div><h3 className="font-heading text-lg font-bold text-red-100">Saved translations and posts</h3><p className="text-xs text-neutral-400">Keep useful language and cultural material close for later review.</p></div>
          {savedItemsError && <p role="alert" className="mt-2 text-xs text-red-300">{savedItemsError}</p>}
          {savedItems.length === 0 ? <p className="mt-4 text-sm text-neutral-400">Save a translation or feed post to build your review collection.</p> : <ul className="mt-4 space-y-3">{savedItems.map((item) => <li key={`${item.item_type}-${item.item_id}`} className="flex items-start justify-between gap-3 rounded-lg border border-neutral-800 p-3"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-red-400">Saved {item.item_type}</p><p className="mt-1 font-semibold text-red-100">{item.title}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-300">{item.body}</p></div><button onClick={() => void removeSaved(item)} className="shrink-0 text-xs text-neutral-400 underline">Remove</button></li>)}</ul>}
        </section>
        </div>
      )}
    </div>
  );
}

interface DailyPracticeCardProps {
  daily: DailyPractice | null;
  error: string | null;
  answer: string;
  checked: boolean;
  feedback: string | null;
  saving: boolean;
  recordedAudio: string | null;
  communityAudio: Post | null;
  onAnswer: (value: string) => void;
  onCheck: () => void;
  onComplete: () => void;
  onRetry: () => void;
  onRecord: (blob: Blob) => void;
}

function DailyPracticeCard(props: DailyPracticeCardProps) {
  const { daily, error, answer, checked, feedback, saving, recordedAudio, communityAudio, onAnswer, onCheck, onComplete, onRetry, onRecord } = props;
  return (
    <section className="rounded-2xl border border-red-700/50 bg-gradient-to-br from-red-950/50 to-neutral-950 p-5 shadow-lg sm:p-6" aria-labelledby="daily-practice-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400">Today's practice · {daily?.category || "Idoma"}</p><h2 id="daily-practice-title" className="mt-1 font-heading text-xl font-bold text-red-100">A small step every day</h2></div>
        <span className="rounded-full border border-red-700/70 px-3 py-1 text-xs font-semibold text-red-200">🔥 {daily?.streak || 0} day streak</span>
      </div>
      {error ? <div role="alert" className="mt-4 text-sm text-red-200">{error}<button onClick={onRetry} className="ml-2 underline">Retry</button></div> : !daily ? <p role="status" className="mt-5 text-sm text-neutral-300">Loading today's word…</p> : daily.completed ? <div className="mt-5 rounded-lg border border-green-800/60 bg-green-950/30 p-4"><p className="text-sm font-semibold text-green-200">Practice complete for today</p><p className="mt-1 text-sm text-neutral-200">{daily.prompt} — <span className="font-semibold">{daily.answer}</span></p>{daily.example && <p className="mt-1 text-xs text-neutral-400">{daily.example}</p>}</div> : <>
        {communityAudio ? <div className="mt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-300">Listen to a community greeting</p><NativeAudioPlayer audioUrl={communityAudio.media_url} title={`Greeting shared by ${communityAudio.author?.display_name || "a community member"}`} /></div> : <p className="mt-3 text-xs text-neutral-400">No greeting recording tagged yet. Community audio posts tagged “greetings” will appear here.</p>}
        <p className="mt-5 text-base text-neutral-100">Translate: <strong className="text-red-200">{daily.prompt}</strong></p>
        <form onSubmit={(event) => { event.preventDefault(); onCheck(); }} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="daily-practice-answer">Your Idoma answer</label>
          <input id="daily-practice-answer" value={answer} onChange={(event) => onAnswer(event.target.value)} disabled={checked} placeholder="Type the Idoma phrase…" className="min-w-0 flex-1 rounded-lg border border-red-900 bg-neutral-900 px-3 py-2 text-sm text-red-100 placeholder-neutral-500" />
          <button type="submit" disabled={!answer.trim() || checked} className="rounded-lg bg-red-800 px-4 py-2 text-sm font-semibold text-red-100 disabled:opacity-50">Check answer</button>
        </form>
        {feedback && <p role="status" className={`mt-3 text-sm ${checked ? "text-green-300" : "text-red-300"}`}>{feedback}</p>}
        {checked && <div className="mt-4 space-y-3 rounded-lg border border-green-800/50 bg-green-950/20 p-4">
          <p className="text-sm text-green-100">Answer: <strong>{daily.answer}</strong></p>
          {daily.example && <p className="text-xs text-green-200/80">{daily.example}</p>}
          <p className="text-xs text-neutral-300">Optional: record yourself saying the answer and play it back.</p>
          <AudioRecorder onAudioRecorded={onRecord} maxDuration={10} />
          {recordedAudio && <AudioPlayer audioUrl={recordedAudio} className="w-full" />}
          <button onClick={onComplete} disabled={saving} className="rounded-lg border border-green-700 px-4 py-2 text-xs font-semibold text-green-100 hover:bg-green-900/40 disabled:opacity-50">{saving ? "Saving…" : "Complete today's practice"}</button>
        </div>}
      </>}
    </section>
  );
}
