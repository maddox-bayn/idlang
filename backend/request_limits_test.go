package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTranslationRejectsOversizeAndInvalidInput(t *testing.T) {
	for _, tc := range []struct {
		body string
		code int
	}{
		{`{"text":"` + strings.Repeat("a", 4001) + `"}`, 413},
		{`{"text":"` + strings.Repeat("a", 40000) + `"}`, 413},
		{`{"text":"   "}`, 400},
		{`{"text":"house","source_lang":"French"}`, 400},
		{`{"text":"house","source_lang":"English","target_lang":"English"}`, 400},
		{`{"text":"house"} {"text":"second"}`, 400},
	} {
		recorder := httptest.NewRecorder()
		handleTranslate(recorder, httptest.NewRequest("POST", "/api/translate", strings.NewReader(tc.body)))
		if recorder.Code != tc.code {
			t.Fatalf("expected %d, got %d: %s", tc.code, recorder.Code, recorder.Body.String())
		}
	}
}
func TestCancelledTranslationDoesNotReachModel(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("cancelled request reached model") }))
	defer upstream.Close()
	t.Setenv("TRANSLATOR_URL", upstream.URL)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := callPythonNMT(ctx, "house", "English", "Idoma"); err == nil {
		t.Fatal("expected cancellation")
	}
}
func TestOversizedAudioRejectedBeforeProxy(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/pipeline", strings.NewReader("audio"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=test")
	req.ContentLength = (10 << 20) + 1
	recorder := httptest.NewRecorder()
	proxyAudioToTranslator("/pipeline")(recorder, req)
	if recorder.Code != 413 {
		t.Fatalf("got %d", recorder.Code)
	}
}

func TestFailedInferenceReturnsErrorInsteadOfPlaceholder(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "model unavailable", http.StatusServiceUnavailable)
	}))
	defer upstream.Close()
	t.Setenv("TRANSLATOR_URL", upstream.URL)
	recorder := httptest.NewRecorder()
	handleTranslate(recorder, httptest.NewRequest("POST", "/api/translate", strings.NewReader(`{"text":"a phrase not in the dictionary","source_lang":"Idoma","target_lang":"English"}`)))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "archives") {
		t.Fatal("fabricated translation returned")
	}
}
