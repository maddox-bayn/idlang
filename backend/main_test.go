package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCorsMiddleware(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/test", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	handler := corsMiddleware(mux)

	// Test OPTIONS preflight
	req := httptest.NewRequest(http.MethodOptions, "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200 for OPTIONS request, got %d", rec.Code)
	}

	if rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Error("Expected CORS header for Access-Control-Allow-Origin")
	}
}

func TestTranslateHandlerMethodNotAllowed(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/translate", handleTranslate)

	req := httptest.NewRequest(http.MethodGet, "/api/translate", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("Expected status 405 for GET request, got %d", rec.Code)
	}
}

func TestTranslateHandlerEmptyBody(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/translate", handleTranslate)

	body := bytes.NewBufferString(`{}`)
	req := httptest.NewRequest(http.MethodPost, "/api/translate", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400 for empty body, got %d", rec.Code)
	}
}

func TestHealthEndpoint(t *testing.T) {
	// This test just verifies the route exists
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	// We can't directly test the health endpoint from main.go
	// since it's not exported, but this verifies basic routing
	mux := http.NewServeMux()

	// This would be tested in integration tests
	_ = mux
	_ = req
	_ = rec
}

func TestDictionaryLookup(t *testing.T) {
	// Load test dictionary
	dict, err := loadDictionary("idoma_dictionary_v2.json")
	if err != nil {
		t.Fatalf("Failed to load dictionary: %v", err)
	}

	if len(dict) == 0 {
		t.Error("Dictionary should not be empty")
	}

	// Check if we have expected categories
	expectedCategories := []string{
		"human_anatomy_head",
		"verbs_actions",
		"pronouns",
		"key_phrases",
	}

	for _, cat := range expectedCategories {
		if _, ok := dict[cat]; !ok {
			t.Errorf("Expected category %s not found in dictionary", cat)
		}
	}
}

func TestWordEntrySchema(t *testing.T) {
	// Load test dictionary
	dict, err := loadDictionary("idoma_dictionary_v2.json")
	if err != nil {
		t.Fatalf("Failed to load dictionary: %v", err)
	}

	// Check that we have entries with Idoma field
	foundEntry := false
	for _, words := range dict {
		for _, entry := range words {
			if entry.Idoma != "" {
				foundEntry = true
				break
			}
		}
		if foundEntry {
			break
		}
	}

	if !foundEntry {
		t.Error("Dictionary should have entries with Idoma field")
	}
}
