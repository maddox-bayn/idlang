package main

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestUpgradePopulatedLegacyDatabase(t *testing.T) {
	legacy, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.Close()
	if err := baselineSchema(legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(`INSERT INTO users(id, username, display_name) VALUES ('legacy', 'legacy', 'Legacy'); INSERT INTO books(id,title,author,uploaded_by,file_url) VALUES ('old-book','Old book','Author','legacy','/old.pdf')`); err != nil {
		t.Fatal(err)
	}
	if err := runMigrations(legacy); err != nil {
		t.Fatal(err)
	}
	if err := runMigrations(legacy); err != nil {
		t.Fatal(err)
	}
	var title, updated string
	if err := legacy.QueryRow(`SELECT title, updated_at FROM library_items WHERE id='old-book'`).Scan(&title, &updated); err != nil {
		t.Fatal(err)
	}
	if title != "Old book" || updated == "" {
		t.Fatal("Legacy book was not preserved/backfilled")
	}
}

func TestSessionExpiryValidation(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	rec := httptest.NewRecorder()
	if err := issueSession(rec, req, "user_oche"); err != nil {
		t.Fatal(err)
	}
	req.AddCookie(rec.Result().Cookies()[0])
	if sessionUser(req) == nil {
		t.Fatal("Fresh session rejected")
	}
	for _, expiry := range []string{"not-a-date", "2000-01-01 00:00:00"} {
		rec = httptest.NewRecorder()
		if err := issueSession(rec, req, "user_oche"); err != nil {
			t.Fatal(err)
		}
		req = httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
		req.AddCookie(rec.Result().Cookies()[0])
		if _, err := db.Exec(`UPDATE sessions SET expires_at = ?`, expiry); err != nil {
			t.Fatal(err)
		}
		if sessionUser(req) != nil {
			t.Errorf("Accepted invalid expiry %q", expiry)
		}
	}
}

func TestIdentityRequiresSession(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	for _, route := range []string{"/api/messages?user_id=user_oche&peer_id=user_ada", "/api/connections?user_id=user_oche"} {
		req := httptest.NewRequest(http.MethodGet, route, nil)
		req.Header.Set("X-Viewer-ID", "user_oche")
		rec := httptest.NewRecorder()
		requireAuth(func(w http.ResponseWriter, r *http.Request) { t.Fatal("Unauthenticated handler dispatched") })(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("Expected 401, got %d", rec.Code)
		}
	}
}

func TestCrossSiteSessionAndOriginGate(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	t.Setenv("CROSS_SITE_COOKIES", "true")
	t.Setenv("INSECURE_COOKIES", "false")
	t.Setenv("ALLOWED_ORIGINS", "https://frontend.example")
	req := httptest.NewRequest(http.MethodPost, "https://backend.example/api/auth/login", nil)
	rec := httptest.NewRecorder()
	if err := issueSession(rec, req, "user_oche"); err != nil {
		t.Fatal(err)
	}
	cookie := rec.Result().Cookies()[0]
	if !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteNoneMode {
		t.Fatalf("Invalid cross-site cookie flags: %+v", cookie)
	}
	for _, origin := range []string{"https://frontend.example", "https://untrusted.example"} {
		req.Header.Set("Origin", origin)
		rec = httptest.NewRecorder()
		dispatched := false
		corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { dispatched = true; w.WriteHeader(http.StatusNoContent) })).ServeHTTP(rec, req)
		if origin == "https://frontend.example" {
			if !dispatched || rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
				t.Fatal("Allowed origin failed")
			}
		} else if dispatched || rec.Code != http.StatusForbidden {
			t.Fatal("Untrusted mutation was allowed")
		}
	}
}
