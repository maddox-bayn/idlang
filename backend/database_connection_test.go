package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestTursoConfigurationValidation(t *testing.T) {
	for _, entry := range []struct {
		url, token string
		valid      bool
	}{
		{"libsql://idlang-org.turso.io", "secret", true}, {"https://idlang-org.turso.io", "secret", true},
		{"", "secret", false}, {"libsql://idlang-org.turso.io", "", false},
		{"http://idlang-org.turso.io", "secret", false}, {"file:local.db", "secret", false},
		{"https://user:secret@example.com", "secret", false}, {"libsql://idlang-org.turso.io?authToken=secret", "secret", false},
	} {
		err := validateTursoConfig(entry.url, entry.token)
		if (err == nil) != entry.valid {
			t.Errorf("Unexpected config result for %q: %v", entry.url, err)
		}
		if err != nil && strings.Contains(err.Error(), "secret") {
			t.Fatal("Credential appeared in error")
		}
	}
	t.Setenv("TURSO_DATABASE_URL", "")
	t.Setenv("TURSO_AUTH_TOKEN", "token")
	t.Setenv("DATABASE_PATH", filepath.Join(t.TempDir(), "fallback.db"))
	if database, err := openConfiguredDB(); err == nil {
		database.Close()
		t.Fatal("Partial Turso configuration silently fell back to SQLite")
	}
}

func TestTursoUsesTLSBearerAuthAndSanitizesErrors(t *testing.T) {
	requests := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/v2/pipeline" || r.Header.Get("Authorization") != "Bearer test-only-secret" {
			t.Error("Wrong remote request or auth header")
		}
		w.Header().Set("Content-Type", "application/json")
		if requests == 1 {
			// Real libSQL driver transport, with a protocol fixture for SELECT 1.
			json.NewEncoder(w).Encode(map[string]any{"results": []any{map[string]any{"type": "ok", "response": map[string]any{"type": "execute", "result": map[string]any{"cols": []any{map[string]any{"name": "1", "decltype": "INTEGER"}}, "rows": []any{[]any{map[string]string{"type": "integer", "value": "1"}}}, "affected_row_count": 0}}}}})
			return
		}
		w.WriteHeader(403)
		w.Write([]byte(`{"error":"permission denied test-only-secret"}`))
	}))
	defer server.Close()
	oldClient := http.DefaultClient
	http.DefaultClient = server.Client()
	defer func() { http.DefaultClient = oldClient }()
	t.Setenv("TURSO_DATABASE_URL", server.URL)
	t.Setenv("TURSO_AUTH_TOKEN", "test-only-secret")
	database, err := openConfiguredDB()
	if database != nil {
		database.Close()
	}
	if err == nil || requests < 2 {
		t.Fatalf("Expected migration permission error after connection; requests=%d err=%v", requests, err)
	}
	if strings.Contains(err.Error(), "test-only-secret") {
		t.Fatal("Remote error exposed the token")
	}
}

func TestTursoSchemaDiagnosticsDoNotExposeRemoteResponses(t *testing.T) {
	for _, tc := range []struct{ input, stage string }{
		{"failed to run migrations: read user_version: secret-token SQL_PARSE_ERROR remote-url", "read schema version"},
		{"failed to run migrations: migration 2: secret-token SQLITE_AUTH", "migration 2"},
		{"failed to run migrations: set user_version 3: secret-token", "record migration 3"},
		{"failed to seed database: secret-token", "seed baseline data"},
	} {
		got := tursoSchemaError(errors.New(tc.input)).Error()
		if !strings.Contains(got, tc.stage) || strings.Contains(got, "secret-token") || strings.Contains(got, "remote-url") {
			t.Fatalf("unsafe or missing diagnostic: %s", got)
		}
	}
}
