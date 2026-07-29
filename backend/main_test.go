package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetAllowedOrigin(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   string
	}{
		{name: "vite dev server", origin: "http://localhost:5173", want: "http://localhost:5173"},
		{name: "other origin", origin: "https://example.com", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := getAllowedOrigin(tt.origin); got != tt.want {
				t.Fatalf("getAllowedOrigin(%q) = %q, want %q", tt.origin, got, tt.want)
			}
		})
	}
}

func TestCorsMiddlewareAllowsViteOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/api/translate", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rr := httptest.NewRecorder()

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	corsMiddleware(next).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rr.Code)
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("expected allow-origin header %q, got %q", "http://localhost:5173", got)
	}
}
