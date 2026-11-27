package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCoursePublishingAndChallengeReview(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	if _, err := db.Exec("UPDATE users SET role='admin' WHERE id='user_oche'"); err != nil {
		t.Fatal(err)
	}
	call := func(handler http.HandlerFunc, method, user string, payload any, want int) []byte {
		t.Helper()
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, "/", bytes.NewReader(body))
		authenticateTestRequest(t, r, user)
		w := httptest.NewRecorder()
		handler(w, r)
		if w.Code != want {
			t.Fatalf("%s got %d, want %d: %s", method, w.Code, want, w.Body)
		}
		return w.Body.Bytes()
	}
	units, err := readCourse(context.Background())
	if err != nil || len(units) != 4 {
		t.Fatalf("seed: %v %d", err, len(units))
	}
	first := units[0]
	first.Lesson.Challenge = "Describe a greeting you used in Otukpo."
	first.Lesson.Questions = []Question{{ID: "custom", Question: "Choose the greeting from the lesson", Options: []string{"Nmaochi", "Nmoo"}, CorrectAnswer: "Nmaochi"}}
	edit := requireRole("admin", editCourse)
	call(edit, "PUT", "user_ada", first, 403)
	call(edit, "PUT", "user_oche", first, 200)
	call(edit, "PUT", "user_oche", first, 409)
	newUnit := first
	newUnit.Track.ID = "eebccbee-5116-48aa-a5ca-fe35861d3094"
	call(edit, "POST", "user_oche", newUnit, 200)
	call(edit, "POST", "user_oche", newUnit, 409)
	updated, err := readCourse(context.Background())
	if err != nil || len(updated) != 5 || updated[0].Lesson.Revision != 2 || updated[4].Track.Step != 5 {
		t.Fatalf("published path: %v %#v", err, updated)
	}
	quiz := map[string]any{"track_id": first.Track.ID, "revision": 1, "answers": map[string]string{"custom": "Nmaochi"}}
	call(requireAuth(handleCompleteLearningTrack), "POST", "user_ada", quiz, 409)
	quiz["revision"] = 2
	call(requireAuth(handleCompleteLearningTrack), "POST", "user_ada", quiz, 200)
	task := map[string]any{"track": first.Track.ID, "revision": 2, "response": "My greeting response"}
	call(requireAuth(learnerTasks), "POST", "user_ada", task, 200)
	call(requireAuth(learnerTasks), "POST", "user_ada", task, 409)
	var queue struct{ Items []taskEntry }
	inspect := func(handler http.HandlerFunc, user string) {
		t.Helper()
		if err := json.Unmarshal(call(handler, "GET", user, nil, 200), &queue); err != nil {
			t.Fatal(err)
		}
	}
	inspect(requireAuth(learnerTasks), "user_oche")
	if len(queue.Items) != 0 {
		t.Fatal("learner history leaked")
	}
	admin := requireRole("admin", reviewTasks)
	inspect(admin, "user_oche")
	if len(queue.Items) != 1 || queue.Items[0].Prompt != first.Lesson.Challenge {
		t.Fatal(queue)
	}
	decision := map[string]any{"id": queue.Items[0].ID, "status": "accepted", "feedback": "Good use of the morning greeting."}
	call(admin, "PATCH", "user_ada", decision, 403)
	call(admin, "PATCH", "user_oche", decision, 200)
	call(admin, "PATCH", "user_oche", decision, 409)
	inspect(requireAuth(learnerTasks), "user_ada")
	if len(queue.Items) != 1 || queue.Items[0].Feedback != decision["feedback"] || queue.Items[0].Status != "accepted" {
		t.Fatal(queue)
	}
}

func TestRemovedLibraryDocumentBlocksOwnerAndGuestDownloads(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	if _, err := db.Exec("UPDATE users SET role='admin' WHERE id='user_oche'"); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := db.QueryRow("SELECT id FROM library_items WHERE status='published' LIMIT 1").Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE library_items SET uploaded_by='user_ada' WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	remove := func(user string) int {
		req := httptest.NewRequest("PATCH", "/api/library/"+id+"/status", bytes.NewBufferString(`{"status":"removed","expected_status":"published"}`))
		authenticateTestRequest(t, req, user)
		w := httptest.NewRecorder()
		updateLibraryStatus(w, req, id)
		return w.Code
	}
	if remove("user_ada") != 403 || remove("user_oche") != 200 {
		t.Fatal("removal permissions or transition failed")
	}
	for _, user := range []string{"", "user_ada"} {
		req := httptest.NewRequest("GET", libraryFilePath(id), nil)
		if user != "" {
			authenticateTestRequest(t, req, user)
		}
		w := httptest.NewRecorder()
		handleLibraryByID(w, req)
		if w.Code != 404 {
			t.Fatalf("removed document returned %d", w.Code)
		}
	}
}
