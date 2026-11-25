package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

func trialCookie(t *testing.T) *http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	handleTranslationAccess(rec, httptest.NewRequest("GET", "/api/translation/access", nil))
	if rec.Code != 200 {
		t.Fatalf("Access: %d %s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly {
		t.Fatal("Expected HttpOnly guest cookie")
	}
	return cookies[0]
}

func trialRequest(cookie *http.Cookie) *http.Request {
	req := httptest.NewRequest("POST", "/api/translate", nil)
	req.AddCookie(cookie)
	return req
}

func TestGuestTrialAndAuthenticatedAccess(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	cookie := trialCookie(t)
	called := 0
	handler := translationAccess(true, func(w http.ResponseWriter, r *http.Request) {
		called++
		writeJSON(w, 200, map[string]string{"translation": "Olé"})
	})
	first := httptest.NewRecorder()
	handler(first, trialRequest(cookie))
	second := httptest.NewRecorder()
	handler(second, trialRequest(cookie))
	if first.Code != 200 || second.Code != 401 || called != 1 {
		t.Fatalf("Trial statuses %d, %d, calls %d", first.Code, second.Code, called)
	}
	access := httptest.NewRequest("GET", "/api/translation/access", nil)
	access.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handleTranslationAccess(rec, access)
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"trial_remaining":false`)) {
		t.Fatalf("Trial reset: %s", rec.Body.String())
	}
	// The allowance is shared with the audio pipeline and transcription routes.
	rec = httptest.NewRecorder()
	translationAccess(false, func(w http.ResponseWriter, r *http.Request) { t.Fatal("Used trial transcribed") })(rec, trialRequest(cookie))
	if rec.Code != 401 {
		t.Fatal("Transcription bypass")
	}
	rec = httptest.NewRecorder()
	translationAccess(true, func(w http.ResponseWriter, r *http.Request) { t.Fatal("Used trial used pipeline") })(rec, trialRequest(cookie))
	if rec.Code != 401 {
		t.Fatal("Pipeline bypass")
	}
	for i := 0; i < 2; i++ {
		req := trialRequest(cookie)
		authenticateTestRequest(t, req, "user_oche")
		rec = httptest.NewRecorder()
		handler(rec, req)
		if rec.Code != 200 {
			t.Fatalf("Signed-in request: %d", rec.Code)
		}
	}
	noCookie := httptest.NewRecorder()
	handler(noCookie, httptest.NewRequest("POST", "/api/translate", nil))
	if noCookie.Code != 401 {
		t.Fatal("Requests without established guest identity must be rejected")
	}
}

func TestFailedTranslationDoesNotConsumeTrial(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	cookie := trialCookie(t)
	rec := httptest.NewRecorder()
	translationAccess(true, func(w http.ResponseWriter, r *http.Request) { writeError(w, 502, "Model unavailable") })(rec, trialRequest(cookie))
	rec = httptest.NewRecorder()
	translationAccess(true, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })(rec, trialRequest(cookie))
	if rec.Code != 200 {
		t.Fatalf("Failed request consumed trial: %d", rec.Code)
	}
}

func TestConcurrentGuestRequestsAllowOnlyOne(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	cookie := trialCookie(t)
	var succeeded atomic.Int32
	handler := translationAccess(true, func(w http.ResponseWriter, r *http.Request) { succeeded.Add(1); w.WriteHeader(200) })
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); handler(httptest.NewRecorder(), trialRequest(cookie)) }()
	}
	wg.Wait()
	if succeeded.Load() != 1 {
		t.Fatalf("Allowed %d concurrent translations", succeeded.Load())
	}
}

func TestAdminRoutesAndPromotion(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	if _, err := db.Exec(`UPDATE users SET email='owner@example.com',password_hash='registered-hash' WHERE id='user_oche'`); err != nil {
		t.Fatal(err)
	}
	endpoints := []struct {
		path    string
		handler http.HandlerFunc
	}{
		{"/api/admin/overview", handleAdminOverview}, {"/api/admin/users", handleAdminUsers}, {"/api/admin/library", handleAdminLibrary},
	}
	for _, endpoint := range endpoints {
		for _, user := range []string{"", "user_oche"} {
			req := httptest.NewRequest("GET", endpoint.path, nil)
			if user != "" {
				authenticateTestRequest(t, req, user)
			}
			rec := httptest.NewRecorder()
			requireRole("admin", endpoint.handler)(rec, req)
			expected := 401
			if user != "" {
				expected = 403
			}
			if rec.Code != expected {
				t.Fatalf("%s: expected %d, got %d", endpoint.path, expected, rec.Code)
			}
		}
	}
	if err := promoteAdmin(db, "absent@example.com"); err == nil {
		t.Fatal("Promoted missing user")
	}
	if err := promoteAdmin(db, "owner@example.com"); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range endpoints {
		req := httptest.NewRequest("GET", endpoint.path, nil)
		authenticateTestRequest(t, req, "user_oche")
		rec := httptest.NewRecorder()
		requireRole("admin", endpoint.handler)(rec, req)
		if rec.Code != 200 {
			t.Fatalf("Admin %s: %d %s", endpoint.path, rec.Code, rec.Body.String())
		}
		if bytes.Contains(rec.Body.Bytes(), []byte("registered-hash")) {
			t.Fatal("Leaked password hash")
		}
	}
	// Registration cannot assign its own role.
	body, _ := json.Marshal(map[string]string{"username": "badadmin", "email": "bad@example.com", "password": "longpassword123", "role": "admin"})
	req := httptest.NewRequest("POST", "/api/auth/signup", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handleSignup(rec, req)
	if rec.Code != 400 {
		t.Fatalf("Signup accepted a role: %d", rec.Code)
	}
}
