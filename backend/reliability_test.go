package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMessageRetryReplaysCommittedMessage(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	send := func(body string, status int) string {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/messages", strings.NewReader(fmt.Sprintf(
			`{"receiver_id":"user_ada","body":%q,"client_id":"2dcb29a0-4588-4637-914f-ec08836270fb"}`, body)))
		authenticateTestRequest(t, req, "user_oche")
		rec := httptest.NewRecorder()
		handleMessages(rec, req)
		if rec.Code != status {
			t.Fatalf("got %d, want %d: %s", rec.Code, status, rec.Body)
		}
		if status == http.StatusConflict {
			return ""
		}
		var msg DirectMessageResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &msg); err != nil || msg.ID == "" {
			t.Fatalf("invalid message: %s", rec.Body)
		}
		return msg.ID
	}
	first := send("Hello", http.StatusCreated)
	if send("Hello", http.StatusOK) != first {
		t.Fatal("retry returned a different message")
	}
	send("Changed", http.StatusConflict)
}

func TestLibrarySearchPaginatesAllVisibleMatches(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	if !libraryFTSAvailable {
		t.Skip("SQLite compiled without FTS5")
	}
	for i := 0; i < 8; i++ {
		id := fmt.Sprintf("search-%d", i)
		status := "published"
		if i == 0 {
			status = "draft"
		}
		if _, err := db.Exec(`INSERT INTO library_items(id,title,author,uploaded_by,file_url,status)
			VALUES (?, 'PaginationProbe', 'author', 'user_oche', '', ?)`, id, status); err != nil {
			t.Fatal(err)
		}
		if err := indexLibraryItem(db, id, "PaginationProbe", "author", "", ""); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(http.MethodGet, "/api/library?q=PaginationProbe&page=7&limit=1", nil)
	rec := httptest.NewRecorder()
	listLibrary(rec, req)
	var page struct {
		Items []LibraryItem
		Total int
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &page) != nil || page.Total != 7 || len(page.Items) != 1 || page.Items[0].Status != "published" {
		t.Fatalf("unexpected page: %d %s", rec.Code, rec.Body)
	}
}
