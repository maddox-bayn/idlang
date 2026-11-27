package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

//go:embed curriculum_seed.json
var courseSeed []byte

type courseLesson struct {
	ID        string     `json:"id"`
	TrackID   string     `json:"track_id"`
	Title     string     `json:"title"`
	Level     string     `json:"level"`
	Topic     string     `json:"topic"`
	Questions []Question `json:"questions"`
	Challenge string     `json:"challenge"`
	Revision  int        `json:"revision"`
}
type courseUnit struct {
	Track  LearningTrack `json:"track"`
	Lesson courseLesson  `json:"lesson"`
}

func migrateCourses(d *sql.DB) error {
	for _, q := range []string{
		`CREATE TABLE IF NOT EXISTS course_units(step INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT UNIQUE NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS course_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT NOT NULL, version INTEGER NOT NULL, learner TEXT NOT NULL REFERENCES users(id), prompt TEXT NOT NULL, response TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', feedback TEXT NOT NULL DEFAULT '', reviewer TEXT, reviewed_at TEXT)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS course_tasks_active ON course_tasks(track_id,version,learner) WHERE status IN ('pending','accepted')`,
		`CREATE INDEX IF NOT EXISTS course_tasks_review ON course_tasks(status,id)`, `CREATE INDEX IF NOT EXISTS course_tasks_learner ON course_tasks(learner,id)`,
	} {
		if _, e := d.Exec(q); e != nil {
			return e
		}
	}
	var lessons []courseLesson
	if e := json.Unmarshal(courseSeed, &lessons); e != nil {
		return e
	}
	prompts := []string{"Write a greeting in Idoma that you used today. Explain whom you greeted and when.", "Write a short shopping list using two Idoma numbers and explain what each number counts.", "Choose an Idoma cultural term from the lesson and describe when your community uses it.", "Write a short exchange in Idoma using two phrases from this lesson, then give its meaning in English."}
	for i, t := range CurriculumTracks {
		l := lessons[i]
		l.Challenge = prompts[i]
		l.Revision = 1
		data, e := json.Marshal(courseUnit{t, l})
		if e != nil {
			return e
		}
		if _, e = d.Exec("INSERT INTO course_units(step,track_id,version,body) VALUES(?,?,1,?) ON CONFLICT(track_id) DO NOTHING", t.Step, t.ID, string(data)); e != nil {
			return e
		}
	}
	return nil
}

func readCourse(ctx context.Context) ([]courseUnit, error) {
	rows, e := db.QueryContext(ctx, "SELECT step,version,body FROM course_units ORDER BY step")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []courseUnit{}
	for rows.Next() {
		var step, v int
		var raw string
		var u courseUnit
		if e := rows.Scan(&step, &v, &raw); e != nil {
			return nil, e
		}
		if e := json.Unmarshal([]byte(raw), &u); e != nil {
			return nil, e
		}
		u.Track.Step = step
		u.Lesson.Revision = v
		out = append(out, u)
	}
	return out, rows.Err()
}
func courseTracks(units []courseUnit) []LearningTrack {
	tracks := make([]LearningTrack, len(units))
	for i, u := range units {
		tracks[i] = u.Track
	}
	return tracks
}
func courseCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		methodNotAllowed(w, "GET")
		return
	}
	units, e := readCourse(r.Context())
	if e != nil {
		writeError(w, 503, "Could not load the curriculum.")
		return
	}
	writeJSON(w, 200, units)
}
func bounded(s string, max int) bool { return strings.TrimSpace(s) != "" && len([]rune(s)) <= max }
func validUnit(u courseUnit) bool {
	l := u.Lesson
	if !bounded(u.Track.Title, 160) || !bounded(u.Track.Description, 1500) || !bounded(u.Track.Category, 100) || u.Track.XPReward < 1 || u.Track.XPReward > 2000 || !bounded(l.Title, 160) || !bounded(l.Topic, 100) || (l.Level != "Beginner" && l.Level != "Intermediate" && l.Level != "Advanced") || !bounded(l.Challenge, 2000) || len(l.Questions) < 1 || len(l.Questions) > 20 {
		return false
	}
	ids := map[string]bool{}
	for _, q := range l.Questions {
		if !bounded(q.ID, 80) || ids[q.ID] || !bounded(q.Question, 600) || len(q.Options) < 2 || len(q.Options) > 6 || len(q.Translation) > 1500 {
			return false
		}
		ids[q.ID] = true
		seen := map[string]bool{}
		match := false
		for _, o := range q.Options {
			key := strings.ToLower(strings.TrimSpace(o))
			if !bounded(o, 150) || seen[key] {
				return false
			}
			seen[key] = true
			if o == q.CorrectAnswer {
				match = true
			}
		}
		if !match {
			return false
		}
	}
	return true
}
func editCourse(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" && r.Method != "PUT" {
		methodNotAllowed(w, "POST, PUT")
		return
	}
	var u courseUnit
	if e := decodeJSON(w, r, &u, 96<<10); e != nil || !validUnit(u) {
		writeError(w, 422, "Enter track details, a challenge, and 1–20 questions with distinct choices and a correct answer.")
		return
	}
	create := r.Method == "POST"
	if create {
		if _, err := uuid.Parse(u.Track.ID); err != nil {
			writeError(w, 422, "New track requires a unique identifier.")
			return
		}
		u.Lesson.ID = uuid.NewString()
	} else {
		var raw string
		err := db.QueryRowContext(r.Context(), "SELECT body FROM course_units WHERE track_id=?", u.Track.ID).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 404, "Track unavailable.")
			return
		}
		var stored courseUnit
		if err != nil || json.Unmarshal([]byte(raw), &stored) != nil {
			writeError(w, 503, "Could not read track.")
			return
		}
		u.Lesson.ID = stored.Lesson.ID
	}
	u.Track.LessonID = u.Lesson.ID
	u.Lesson.TrackID = u.Track.ID
	u.Track.Status = ""
	raw, err := json.Marshal(u)
	if err != nil {
		writeError(w, 500, "Could not encode lesson.")
		return
	}
	var result sql.Result
	if create {
		result, err = db.ExecContext(r.Context(), `INSERT INTO course_units(track_id,version,body) SELECT ?,1,? WHERE (SELECT COUNT(*) FROM course_units)<200 ON CONFLICT(track_id) DO NOTHING`, u.Track.ID, string(raw))
	} else {
		result, err = db.ExecContext(r.Context(), "UPDATE course_units SET version=version+1,body=? WHERE track_id=? AND version=?", string(raw), u.Track.ID, u.Lesson.Revision)
	}
	if err != nil {
		writeError(w, 503, "Could not save lesson.")
		return
	}
	n, err := result.RowsAffected()
	if err != nil {
		writeError(w, 503, "Could not confirm save.")
		return
	}
	if n != 1 {
		writeError(w, 409, "The lesson changed or the curriculum is full. Reload before editing.")
		return
	}
	writeJSON(w, 200, map[string]string{"id": u.Track.ID})
}

type taskEntry struct {
	ID       int64  `json:"id"`
	Learner  string `json:"learner"`
	Prompt   string `json:"prompt"`
	Response string `json:"response"`
	Status   string `json:"status"`
	Feedback string `json:"feedback"`
}

func listTasks(w http.ResponseWriter, r *http.Request, admin bool) {
	filter := "learner=?"
	args := []any{currentUser(r).ID}
	if admin {
		filter = "status='pending'"
		args = nil
	}
	if raw := r.URL.Query().Get("before"); raw != "" {
		v, e := strconv.ParseInt(raw, 10, 64)
		if e != nil || v < 1 {
			writeError(w, 400, "Invalid page.")
			return
		}
		filter += " AND id<?"
		args = append(args, v)
	}
	rows, err := db.QueryContext(r.Context(), "SELECT id,learner,prompt,response,status,feedback FROM course_tasks WHERE "+filter+" ORDER BY id DESC LIMIT 26", args...)
	if err != nil {
		writeError(w, 503, "Could not load challenges.")
		return
	}
	defer rows.Close()
	items := []taskEntry{}
	for rows.Next() {
		var x taskEntry
		if rows.Scan(&x.ID, &x.Learner, &x.Prompt, &x.Response, &x.Status, &x.Feedback) != nil {
			writeError(w, 503, "Could not read challenges.")
			return
		}
		items = append(items, x)
	}
	if rows.Err() != nil {
		writeError(w, 503, "Could not read challenges.")
		return
	}
	more := len(items) > 25
	if more {
		items = items[:25]
	}
	writeJSON(w, 200, map[string]any{"items": items, "more": more})
}
func learnerTasks(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		listTasks(w, r, false)
		return
	}
	if r.Method != "POST" {
		methodNotAllowed(w, "GET, POST")
		return
	}
	var in struct {
		Track    string `json:"track"`
		Revision int    `json:"revision"`
		Response string `json:"response"`
	}
	if decodeJSON(w, r, &in, 16<<10) != nil || !bounded(in.Response, 2500) {
		writeError(w, 422, "Write a response of up to 2,500 characters.")
		return
	}
	// Snapshot the exact published prompt in the same statement as the submission.
	res, e := db.ExecContext(r.Context(), `INSERT INTO course_tasks(track_id,version,learner,prompt,response)
 SELECT track_id,version,?,json_extract(body,'$.lesson.challenge'),? FROM course_units WHERE track_id=? AND version=?
 ON CONFLICT DO NOTHING`, currentUser(r).ID, strings.TrimSpace(in.Response), in.Track, in.Revision)
	finishChange(w, res, e, "Already submitted or the lesson changed. Check your submissions and reload.")
}
func reviewTasks(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		listTasks(w, r, true)
		return
	}
	if r.Method != "PATCH" {
		methodNotAllowed(w, "GET, PATCH")
		return
	}
	var in struct {
		ID       int64  `json:"id"`
		Status   string `json:"status"`
		Feedback string `json:"feedback"`
	}
	if decodeJSON(w, r, &in, 8<<10) != nil || (in.Status != "accepted" && in.Status != "needs_practice") || !bounded(in.Feedback, 1000) {
		writeError(w, 422, "Choose a decision and enter feedback.")
		return
	}
	res, e := db.ExecContext(r.Context(), `UPDATE course_tasks SET status=?, feedback=?,reviewer=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`, in.Status, strings.TrimSpace(in.Feedback), currentUser(r).ID, in.ID)
	finishChange(w, res, e, "This submission has already been reviewed or is unavailable.")
}
func finishChange(w http.ResponseWriter, res sql.Result, err error, conflict string) {
	if err != nil {
		writeError(w, 503, "Could not save the change.")
		return
	}
	n, e := res.RowsAffected()
	if e != nil {
		writeError(w, 503, "Could not confirm the change.")
		return
	}
	if n != 1 {
		writeError(w, 409, conflict)
		return
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}
