import { useState, useEffect } from "react";
import type { LearningTrack, LearningProfile, User } from "../types";
import { fetchLearningTracks, completeLearningTrack } from "../api/socialClient";

interface LearningDashboardProps {
  currentUser: User;
  onLaunchLesson?: (lessonId: string) => void;
}

export default function LearningDashboard({
  currentUser,
  onLaunchLesson,
}: LearningDashboardProps) {
  const [profile, setProfile] = useState<LearningProfile | null>(null);
  const [tracks, setTracks] = useState<LearningTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchLearningTracks(currentUser.id);
      setProfile(data.profile);
      setTracks(data.tracks);
    } catch (err) {
      console.error("Failed to load tracks:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentUser.id]);

  const handleCompleteTrack = async (track: LearningTrack) => {
    if (track.status === "completed") {
      setFeedback({ message: `Track '${track.title}' is already mastered! Keep reviewing.` });
      return;
    }

    if (track.status === "locked") {
      setFeedback({
        message: `Lazy Progression Locked: You must complete prior tracks before unlocking '${track.title}'.`,
        isError: true,
      });
      return;
    }

    setCompletingId(track.id);
    setFeedback(null);
    try {
      const res = await completeLearningTrack(currentUser.id, track.id);
      setProfile(res.learning_profile);
      setTracks(res.tracks);
      setFeedback({
        message: res.message || `Mastered ${track.title}! (+${track.xp_reward} XP)`,
      });
    } catch (err: unknown) {
      setFeedback({
        message: err instanceof Error ? err.message : "Failed to complete track due to progression rules",
        isError: true,
      });
    } finally {
      setCompletingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 space-y-6">
      {/* Gamified Header Card matching wireframe */}
      <div className="card-glow rounded-xl border border-red-900/60 bg-neutral-950 p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-red-900/30 pb-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">
              Active Learner Matrix
            </span>
            <h2 className="font-heading text-xl font-bold text-red-100">
              {currentUser.display_name} (@{currentUser.username})
            </h2>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-red-700 bg-red-950/80 px-2.5 py-0.5 text-xs font-semibold capitalize text-red-200">
                ⭐ {profile?.fluency_tier || "Beginner"} Speaker
              </span>
              <span className="text-xs text-neutral-400">
                {profile?.completed_tracks.length || 0} of {tracks.length} tracks mastered
              </span>
            </div>
          </div>

          <div className="sm:text-right">
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">
              Progress Tracker
            </span>
            <p className="font-mono text-xl font-bold text-red-300">
              ({profile?.xp_points || 0} / 1000 XP)
            </p>
          </div>
        </div>

        {/* XP Progress Bar */}
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-neutral-400 mb-1">
            <span>Beginner (0 XP)</span>
            <span>Intermediate (400 XP)</span>
            <span>Advanced (800+ XP)</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-900 border border-red-950">
            <div
              className="h-full bg-gradient-to-r from-red-800 via-red-600 to-red-500 transition-all duration-700 rounded-full"
              style={{
                width: `${Math.min(100, ((profile?.xp_points || 0) / 1000) * 100)}%`,
              }}
            />
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mt-4 rounded-lg border p-3 text-xs flex items-center justify-between ${
              feedback.isError
                ? "border-red-600/70 bg-red-950/40 text-red-300"
                : "border-green-600/70 bg-green-950/40 text-green-300"
            }`}
          >
            <span>{feedback.message}</span>
            <button
              onClick={() => setFeedback(null)}
              className="text-neutral-400 hover:text-white ml-2 text-sm"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Gamified Linear Progress Stepper */}
      <div className="card-glow rounded-xl border border-red-900/40 bg-neutral-950 p-6 shadow">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-heading text-base font-bold text-red-100">
            Completed Track Milestones
          </h3>
          <span className="text-[11px] text-neutral-500">
            Strict Lazy Linear Progression
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4">
            {tracks.map((track, idx) => {
              const isCompleted = track.status === "completed";
              const isActive = track.status === "active";

              return (
                <div
                  key={track.id}
                  className={`relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border p-4 transition-all ${
                    isCompleted
                      ? "border-green-900/60 bg-green-950/10 hover:border-green-800"
                      : isActive
                      ? "border-red-600 bg-red-950/20 shadow-md ring-1 ring-red-600/30"
                      : "border-neutral-800 bg-neutral-900/40 opacity-70"
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-3">
                    {/* Status Icon Indicator */}
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold ${
                        isCompleted
                          ? "bg-green-950 text-green-400 border border-green-700"
                          : isActive
                          ? "bg-red-900 text-red-100 border border-red-500 animate-pulse"
                          : "bg-neutral-800 text-neutral-500 border border-neutral-700"
                      }`}
                    >
                      {isCompleted ? "✓" : isActive ? "▶" : "🔒"}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-red-100">
                          {track.title}
                        </h4>
                        <span className="rounded bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-red-400 border border-red-950">
                          +{track.xp_reward} XP
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-400">
                        {track.description}
                      </p>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="flex items-center gap-2 sm:self-center">
                    {isCompleted ? (
                      <span className="flex items-center gap-1 text-xs font-semibold text-green-400 px-3 py-1.5">
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Passed
                      </span>
                    ) : isActive ? (
                      <div className="flex items-center gap-2">
                        {onLaunchLesson && (
                          <button
                            onClick={() => onLaunchLesson("anatomy")}
                            className="rounded border border-red-800 bg-neutral-900 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900/40"
                          >
                            Quiz
                          </button>
                        )}
                        <button
                          onClick={() => handleCompleteTrack(track)}
                          disabled={completingId === track.id}
                          className="rounded-lg bg-red-700 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-white shadow hover:bg-red-600 active:scale-95 disabled:opacity-50"
                        >
                          {completingId === track.id ? "Validating..." : "Complete Milestone"}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleCompleteTrack(track)}
                        className="rounded border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-xs text-neutral-500 cursor-not-allowed"
                        title="Complete previous track to unlock"
                      >
                        Prerequisite Locked
                      </button>
                    )}
                  </div>

                  {/* Connecting Line between steps */}
                  {idx < tracks.length - 1 && (
                    <div className="hidden" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
