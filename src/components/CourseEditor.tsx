import { useEffect, useState } from "react";
import {
  fetchCourse,
  publishLesson,
  type CourseUnit,
} from "../api/socialClient";
import type { Lesson, Question } from "../types";

const input =
  "block w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2";
const button = "rounded border border-red-800 px-3 py-2 disabled:opacity-40";
function newQuestion(): Question {
  return {
    id: crypto.randomUUID(),
    question: "",
    options: ["", ""],
    correctAnswer: "",
    translation: "",
  };
}
function emptyUnit(): CourseUnit {
  return {
    track: {
      id: crypto.randomUUID(),
      lesson_id: "",
      step: 0,
      title: "",
      description: "",
      category: "",
      xp_reward: 100,
      status: "locked",
    },
    lesson: {
      id: "",
      title: "",
      topic: "",
      level: "Beginner",
      challenge: "",
      questions: [newQuestion()],
    },
  };
}
export default function CourseEditor() {
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [unit, setUnit] = useState<CourseUnit | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    fetchCourse()
      .then((rows) => {
        if (active) setUnits(rows);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  function lesson(change: Partial<Lesson>) {
    if (unit) setUnit({ ...unit, lesson: { ...unit.lesson, ...change } });
  }
  function question(i: number, change: Partial<Question>) {
    if (unit)
      lesson({
        questions: unit.lesson.questions.map((q, j) =>
          i === j ? { ...q, ...change } : q,
        ),
      });
  }
  async function save() {
    if (!unit || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await publishLesson(unit);
      setUnit(null);
      setReload((n) => n + 1);
      setMessage("Lesson published to the learning path.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not publish.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4">
      <h2 className="font-heading text-xl">Learning tracks and lessons</h2>
      {message && <p role="status">{message}</p>}
      {!unit ? (
        <>
          <button
            className={button}
            onClick={() => {
              setUnit(emptyUnit());
              setMessage("");
            }}
          >
            Add lesson and track step
          </button>
          <button className={button} onClick={() => setReload((n) => n + 1)}>
            Refresh curriculum
          </button>
          {units.map((u) => (
            <article
              key={u.track.id}
              className="flex items-center justify-between border-b border-neutral-800 py-3"
            >
              <div>
                <strong>{u.track.title}</strong>
                <p>
                  {u.lesson.title} · {u.lesson.questions.length} questions
                </p>
              </div>
              <button
                className={button}
                onClick={() => {
                  setUnit(u);
                  setMessage("");
                }}
              >
                Edit lesson
              </button>
            </article>
          ))}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            {(["title", "description", "category"] as const).map((k) => (
              <label key={k} className="block">
                Track {k}
                <input
                  required
                  className={input}
                  value={unit.track[k]}
                  onChange={(e) =>
                    setUnit({
                      ...unit,
                      track: { ...unit.track, [k]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
            <label className="block">
              XP reward
              <input
                required
                type="number"
                min="1"
                max="2000"
                className={input}
                value={unit.track.xp_reward}
                onChange={(e) =>
                  setUnit({
                    ...unit,
                    track: { ...unit.track, xp_reward: Number(e.target.value) },
                  })
                }
              />
            </label>
            {(["title", "topic"] as const).map((k) => (
              <label key={k} className="block">
                Lesson {k}
                <input
                  required
                  className={input}
                  value={unit.lesson[k]}
                  onChange={(e) => lesson({ [k]: e.target.value })}
                />
              </label>
            ))}
            <label className="block">
              Level
              <select
                className={input}
                value={unit.lesson.level}
                onChange={(e) =>
                  lesson({ level: e.target.value as Lesson["level"] })
                }
              >
                {["Beginner", "Intermediate", "Advanced"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="block">
              Real-life Idoma challenge
              <textarea
                required
                className={input}
                value={unit.lesson.challenge}
                onChange={(e) => lesson({ challenge: e.target.value })}
              />
            </label>
            {unit.lesson.questions.map((q, i) => (
              <fieldset
                key={q.id}
                className="space-y-2 rounded border border-neutral-800 p-3"
              >
                <legend>Question {i + 1}</legend>
                <label>
                  Prompt
                  <input
                    required
                    className={input}
                    value={q.question}
                    onChange={(e) => question(i, { question: e.target.value })}
                  />
                </label>
                {q.options.map((o, j) => (
                  <label key={j} className="block">
                    Choice {j + 1}
                    <input
                      required
                      className={input}
                      value={o}
                      onChange={(e) =>
                        question(i, {
                          options: q.options.map((x, k) =>
                            k === j ? e.target.value : x,
                          ),
                          correctAnswer:
                            q.correctAnswer === o && o !== ""
                              ? e.target.value
                              : q.correctAnswer,
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  type="button"
                  className={button}
                  disabled={q.options.length >= 6}
                  onClick={() => question(i, { options: [...q.options, ""] })}
                >
                  Add choice
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={q.options.length <= 2}
                  onClick={() =>
                    question(i, {
                      options: q.options.slice(0, -1),
                      correctAnswer:
                        q.correctAnswer === q.options[q.options.length - 1]
                          ? ""
                          : q.correctAnswer,
                    })
                  }
                >
                  Remove last choice
                </button>
                <label className="block">
                  Correct answer
                  <select
                    required
                    className={input}
                    value={q.correctAnswer}
                    onChange={(e) =>
                      question(i, { correctAnswer: e.target.value })
                    }
                  >
                    <option value="">Select answer</option>
                    {q.options.map((o, j) => o && <option key={j}>{o}</option>)}
                  </select>
                </label>
                <label>
                  Explanation
                  <input
                    className={input}
                    value={q.translation || ""}
                    onChange={(e) =>
                      question(i, { translation: e.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className={button}
                  disabled={unit.lesson.questions.length <= 1}
                  onClick={() =>
                    lesson({
                      questions: unit.lesson.questions.filter(
                        (_, j) => j !== i,
                      ),
                    })
                  }
                >
                  Remove question
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className={button}
              disabled={unit.lesson.questions.length >= 20}
              onClick={() =>
                lesson({ questions: [...unit.lesson.questions, newQuestion()] })
              }
            >
              Add question
            </button>
            <button className={button} type="submit">
              Publish lesson
            </button>
            <button
              className={button}
              type="button"
              onClick={() => setUnit(null)}
            >
              Cancel
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
