import { useEffect, useState } from "react";
import {
  decideTask,
  fetchTasks,
  submitTask,
  type TaskEntry,
} from "../api/socialClient";
import type { Lesson } from "../types";
const field =
  "block w-full rounded border border-neutral-700 bg-neutral-950 p-2";
const button = "rounded border border-red-800 px-3 py-2 disabled:opacity-40";

export default function ChallengeTasks({
  admin = false,
  lessons = [],
}: {
  admin?: boolean;
  lessons?: Lesson[];
}) {
  const [history, setHistory] = useState<TaskEntry[]>([]);
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState<number>();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState("");
  const [response, setResponse] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const lesson = lessons.find((l) => l.id === selected);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    fetchTasks(admin, cursor)
      .then((data) => {
        if (active) {
          setHistory(data.items);
          setMore(data.more);
        }
      })
      .catch((e) => {
        if (active) setLoadError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [admin, cursor, revision]);
  async function act(work: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await work();
      setMessage(success);
      setResponse("");
      setCursor(undefined);
      setRevision((n) => n + 1);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4">
      <h2 className="font-heading text-xl">
        {admin ? "Challenge review queue" : "Real-life Idoma challenges"}
      </h2>
      {!admin && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (lesson?.track_id && lesson.revision)
              void act(
                () => submitTask(lesson.track_id!, lesson.revision!, response),
                "Submitted for review.",
              );
          }}
        >
          <label>
            Choose a lesson
            <select
              required
              className={field}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setResponse("");
              }}
            >
              <option value="">Choose a lesson</option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          {lesson && (
            <>
              <p>{lesson.challenge}</p>
              <label>
                Your written response
                <textarea
                  required
                  maxLength={2500}
                  className={field}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                />
              </label>
              <button disabled={busy || !response.trim()} className={button}>
                Submit challenge
              </button>
            </>
          )}
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {!admin && <h3>Your submissions and feedback</h3>}
      {loading ? (
        <p>Loading submissions…</p>
      ) : loadError ? (
        <p role="alert">{loadError}</p>
      ) : (
        <>
          {history.length === 0 && (
            <p>
              {admin
                ? "No pending submissions on this page."
                : "No submissions on this page."}
            </p>
          )}
          {history.map((t) => (
            <article
              key={t.id}
              className="space-y-2 rounded border border-neutral-800 p-4"
            >
              <h3>{t.prompt}</h3>
              {admin && <p>Learner: {t.learner}</p>}
              <p className="whitespace-pre-wrap">{t.response}</p>
              <p>{t.status.replace("_", " ")}</p>
              {t.feedback && <p>Reviewer feedback: {t.feedback}</p>}
              {admin && (
                <>
                  <label>
                    Feedback
                    <textarea
                      maxLength={1000}
                      className={field}
                      value={notes[t.id] || ""}
                      onChange={(e) =>
                        setNotes({ ...notes, [t.id]: e.target.value })
                      }
                    />
                  </label>
                  {(["accepted", "needs_practice"] as const).map((s) => (
                    <button
                      key={s}
                      disabled={busy || !notes[t.id]?.trim()}
                      className={button}
                      onClick={() =>
                        void act(
                          () => decideTask(t.id, s, notes[t.id]),
                          "Feedback sent to learner.",
                        )
                      }
                    >
                      {s === "accepted" ? "Accept task" : "Needs practice"}
                    </button>
                  ))}
                </>
              )}
            </article>
          ))}
          {more && (
            <button
              className={button}
              onClick={() => setCursor(history[history.length - 1].id)}
            >
              Older submissions
            </button>
          )}
        </>
      )}
      <button
        className={button}
        onClick={() => {
          setCursor(undefined);
          setRevision((n) => n + 1);
        }}
      >
        Refresh submissions
      </button>
    </section>
  );
}
