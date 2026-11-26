package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLibraryReviewHistoryRejectsStaleDecision(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	if _, err := db.Exec("UPDATE users SET role='admin' WHERE id='user_oche'"); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := db.QueryRow("SELECT id FROM library_items LIMIT 1").Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE library_items SET status='draft',reviewed_by=NULL WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	review := func(status string) int {
		r := httptest.NewRequest(http.MethodPatch, "/api/library/"+id+"/status", strings.NewReader(`{"status":"`+status+`","expected_status":"draft"}`))
		authenticateTestRequest(t, r, "user_oche")
		w := httptest.NewRecorder()
		updateLibraryStatus(w, r, id)
		return w.Code
	}
	if code := review("published"); code != 200 {
		t.Fatal(code)
	}
	if code := review("rejected"); code != 409 {
		t.Fatal(code)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM admin_library_events WHERE target=? AND actor='user_oche' AND previous='draft' AND status='published'", id).Scan(&count); err != nil || count != 1 {
		t.Fatalf("history: count %d, error %v", count, err)
	}
	r := httptest.NewRequest("GET", "/api/admin/activity", nil)
	w := httptest.NewRecorder()
	requireRole("admin", handleAdminActivity)(w, r)
	if w.Code == 200 {
		t.Fatal("anonymous history request succeeded")
	}
}
