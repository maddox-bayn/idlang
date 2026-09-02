package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const omniRouteURL = "http://localhost:20128/v1/chat/completions"
const model = "groq/llama-3.3-70b-versatile"

type TranslateRequest struct {
	Text       string `json:"text"`
	SourceLang string `json:"source_lang,omitempty"`
	TargetLang string `json:"target_lang,omitempty"`
	Operation  string `json:"operation,omitempty"`
}

type TranslateResponse struct {
	Translation string  `json:"translation"`
	Explanation string  `json:"explanation,omitempty"`
	Model       string  `json:"model,omitempty"`
	Confidence  float64 `json:"confidence,omitempty"`
	// Warning is forwarded from the Python service when the loaded checkpoint
	// cannot genuinely produce Idoma, so the UI can say so instead of
	// presenting untranslated text as a translation.
	Warning string `json:"warning,omitempty"`
}

type Question struct {
	ID            string   `json:"id"`
	Question      string   `json:"question"`
	Options       []string `json:"options"`
	CorrectAnswer string   `json:"correctAnswer"`
	Translation   string   `json:"translation,omitempty"`
}

type LessonResponse struct {
	AncestorID   string     `json:"ancestorId"`
	AncestorName string     `json:"ancestorName,omitempty"`
	Questions    []Question `json:"questions"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type omniRouteRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
}

type omniRouteResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type dictionary map[string]map[string]WordEntry

type WordEntry struct {
	Idoma   string `json:"idoma"`
	Tone    string `json:"tone,omitempty"`
	POS     string `json:"pos,omitempty"`
	Example string `json:"example,omitempty"`
}

// UnmarshalJSON accepts both dictionary schemas: the v2 object form
// {"idoma": "...", "tone": "..."} and the v1 bare-string form "Adah".
// Without this the v1 fallback file fails to parse and the dictionary
// silently loads as empty.
func (e *WordEntry) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		e.Idoma = s
		return nil
	}

	type wordEntryAlias WordEntry
	var alias wordEntryAlias
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}
	*e = WordEntry(alias)
	return nil
}

var dict dictionary

func main() {
	var err error
	dict, err = loadDictionary("idoma_dictionary_v2.json")
	if err != nil {
		log.Printf("Warning: could not load primary dictionary: %v", err)
		dict, err = loadDictionary("idoma_dictionary.json")
	}
	if err != nil {
		log.Printf("Warning: could not load dictionary fallback: %v", err)
		dict = dictionary{}
	}
	log.Printf("Loaded %d categories from dictionary", len(dict))

	mux := http.NewServeMux()
	mux.HandleFunc("/api/translate", handleTranslate)
	mux.HandleFunc("/api/generate-lesson", handleGenerateLesson)
	mux.HandleFunc("/api/transcribe", proxyAudioToTranslator("/transcribe"))
	mux.HandleFunc("/api/pipeline", proxyAudioToTranslator("/pipeline"))
	mux.HandleFunc("/health", handleHealth)

	handler := corsMiddleware(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Idlang backend listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}

func translatorBaseURL() string {
	if u := os.Getenv("TRANSLATOR_URL"); u != "" {
		return u
	}
	return "http://localhost:5005"
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":     "healthy",
		"service":    "idlang-backend",
		"dictionary": len(dict),
	})
}

// proxyAudioToTranslator streams multipart audio uploads through to the Python
// translator service. The frontend calls /api/transcribe and /api/pipeline, so
// these must exist on the Go backend or Speech and Full Pipeline modes 404.
func proxyAudioToTranslator(upstreamPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		contentType := r.Header.Get("Content-Type")
		if contentType == "" {
			http.Error(w, `{"error":"Content-Type is required"}`, http.StatusBadRequest)
			return
		}

		// Audio + model inference is slow; allow well beyond the text timeout.
		client := &http.Client{Timeout: 120 * time.Second}
		upstream := translatorBaseURL() + upstreamPath

		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, upstream, r.Body)
		if err != nil {
			http.Error(w, `{"error":"Failed to build upstream request"}`, http.StatusInternalServerError)
			return
		}
		req.Header.Set("Content-Type", contentType)

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("translator %s unavailable: %v", upstreamPath, err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "Translator service unavailable. Ensure the Python service is running.",
			})
			return
		}
		defer resp.Body.Close()

		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
		w.WriteHeader(resp.StatusCode)
		if _, err := io.Copy(w, resp.Body); err != nil {
			log.Printf("proxy %s copy failed: %v", upstreamPath, err)
		}
	}
}

func loadDictionary(path string) (dictionary, error) {
	candidates := []string{
		path,
		filepath.Join("backend", path),
		filepath.Join("..", "backend", path),
	}

	for _, candidate := range candidates {
		f, err := os.Open(candidate)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, fmt.Errorf("open %s: %w", candidate, err)
		}

		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", candidate, err)
		}

		var d dictionary
		if err := json.Unmarshal(data, &d); err != nil {
			return nil, fmt.Errorf("parse %s: %w", candidate, err)
		}

		log.Printf("Loaded dictionary from %s", candidate)
		return d, nil
	}

	return nil, fmt.Errorf("dictionary file %q not found", path)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

const linguisticRules = `LINGUISTIC GUARDRAILS — Idoma Language Rules:

1. Tone Enforcement: Apply diacritics precisely as provided in the dictionary. Tone differentiates meaning in Idoma (e.g., "àkpà" = bridge, "ákpá" = cloud).

2. Initial Vowel Rule: All native Idoma nouns begin with a vowel sound. Do not generate native nouns starting with a consonant.

3. Borrowed Nouns: If translating a modern or foreign word starting with a consonant, prepend a vowel to simulate mother-tongue phonology (e.g., "James" → "Ijamisi", "table" → "iteburu").

4. Pluralization: Do NOT use English inflectional suffixes (like adding 's'). Pluralize using:
   - Prefix "áá" (e.g., "Obá" → "Ááòbá")
   - Reduplication (e.g., "Ékpà" → "ékpà ékpà")
   - Quantifiers or number determiners after the noun (e.g., "òlé éyè" = one house, "òlé wùné" = many houses)

5. Noun Formation: No native Idoma noun begins with a consonant. No zero morphemes for singular/plural.

6. Scope: Focus strictly on authentic Idoma dialects of Benue State, Nigeria. Exclude Igede and Igbo (Obi).`

func buildResourceContext() string {
	var buf bytes.Buffer
	buf.WriteString("INJECTED VOCABULARY RESOURCES (verified Idoma dictionary):\n\n")
	for category, words := range dict {
		buf.WriteString(fmt.Sprintf("--- %s ---\n", category))
		for english, entry := range words {
			if entry.POS != "" {
				buf.WriteString(fmt.Sprintf("[%s] %s -> %s", entry.POS, english, entry.Idoma))
			} else {
				buf.WriteString(fmt.Sprintf("%s -> %s", english, entry.Idoma))
			}
			if entry.Example != "" {
				buf.WriteString(fmt.Sprintf("  Example: %s", entry.Example))
			}
			buf.WriteString("\n")
		}
		buf.WriteString("\n")
	}
	return buf.String()
}

func buildSystemPrompt() string {
	return `You are the OmniRoute language processing engine for Idlang. Your translations must strictly adhere to the phonological and grammatical rules of the Idoma language.

` + linguisticRules + `

Execution:
- Base all output exclusively on the provided injected JSON vocabulary resources.
- If a requested word falls outside the scope of the provided dictionary, output the fallback string: "Missing from Idlang archives."`
}

func handleTranslate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req TranslateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if req.Text == "" {
		http.Error(w, `{"error":"Text is required"}`, http.StatusBadRequest)
		return
	}

	// Set defaults
	if req.SourceLang == "" {
		req.SourceLang = "English"
	}
	if req.TargetLang == "" {
		if req.SourceLang == "English" {
			req.TargetLang = "Idoma"
		} else {
			req.TargetLang = "English"
		}
	}

	// 1. First, try case-insensitive dictionary lookup
	if resp := lookupDictionary(req.Text); resp != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}

	// 2. Not in dictionary — try Python NMT service
	resp, err := callPythonNMT(req.Text, req.SourceLang, req.TargetLang)
	if err == nil && resp.Translation != "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}
	log.Printf("Python NMT failed: %v", err)

	// 3. AI gateway fallback with deferred recovery
	(func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("OmniRoute panic recovered: %v", r)
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(&TranslateResponse{
				Translation: "Missing from Idlang archives.",
				Explanation: "This word or phrase is not yet documented in the Idlang Idoma dictionary archives.",
			})
		}()

		resourceContext := buildResourceContext()
		resp, err := callOmniRouteTranslate(req.Text, resourceContext)
		if err != nil {
			log.Printf("OmniRoute translate failed: %v", err)
		}
		if resp != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		}
	})()
}

func lookupDictionary(text string) *TranslateResponse {
	lower := bytes.ToLower([]byte(text))

	for category, words := range dict {
		for english, entry := range words {
			if bytes.Equal(lower, bytes.ToLower([]byte(english))) {
				explanation := fmt.Sprintf("Found in dictionary [%s]: '%s' translates to '%s'", category, english, entry.Idoma)
				if entry.Tone != "" {
					explanation += fmt.Sprintf(" (tone: %s)", entry.Tone)
				}
				if entry.POS != "" {
					explanation += fmt.Sprintf(" [%s]", entry.POS)
				}
				return &TranslateResponse{
					Translation: entry.Idoma,
					Explanation: explanation,
				}
			}
		}
	}

	return nil
}

func callPythonNMT(text, sourceLang, targetLang string) (*TranslateResponse, error) {
	translatorURL := translatorBaseURL()

	type PythonRequest struct {
		Text       string `json:"text"`
		SourceLang string `json:"source_lang"`
		TargetLang string `json:"target_lang,omitempty"`
	}

	reqBody := PythonRequest{
		Text:       text,
		SourceLang: sourceLang,
		TargetLang: targetLang,
	}
	b, _ := json.Marshal(&reqBody)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(fmt.Sprintf("%s/translate", translatorURL), "application/json", bytes.NewBuffer(b))
	if err != nil {
		return nil, fmt.Errorf("translator service unavailable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var msg map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&msg)
		return nil, fmt.Errorf("translator error: status %d: %v", resp.StatusCode, msg)
	}

	type PythonResponse struct {
		Translation string  `json:"translation"`
		Model       string  `json:"model,omitempty"`
		Confidence  float64 `json:"confidence,omitempty"`
		Warning     string  `json:"warning,omitempty"`
	}

	var pr PythonResponse
	if err := json.NewDecoder(resp.Body).Decode(&pr); err != nil {
		return nil, err
	}

	return &TranslateResponse{
		Translation: pr.Translation,
		Model:       pr.Model,
		Confidence:  pr.Confidence,
		Warning:     pr.Warning,
		Explanation: fmt.Sprintf("Translation via %s (confidence: %.0f%%)", pr.Model, pr.Confidence*100),
	}, nil
}

func callOmniRouteTranslate(text, resourceContext string) (*TranslateResponse, error) {
	prompt := fmt.Sprintf(`Translate the following text into the appropriate language.

Text: "%s"

%s

Respond with valid JSON only (no markdown, no preamble) in this exact shape:
{"translation": "the translation here", "explanation": "brief note referencing the dictionary entry, or 'Missing from Idlang archives' if not found"}

IMPORTANT: If you cannot find the word or phrase in the injected vocabulary resources above, you MUST set the translation field to exactly "Missing from Idlang archives." Do not guess or invent words.`, text, resourceContext)

	body := omniRouteRequest{
		Model: model,
		Messages: []chatMessage{
			{Role: "system", Content: buildSystemPrompt()},
			{Role: "user", Content: prompt},
		},
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(omniRouteURL, "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("omniRoute request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("omniRoute status %d: %s", resp.StatusCode, string(respBody))
	}

	var omniResp omniRouteResponse
	if err := json.Unmarshal(respBody, &omniResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if len(omniResp.Choices) == 0 {
		return nil, fmt.Errorf("no choices in response")
	}

	raw := []byte(omniResp.Choices[0].Message.Content)
	raw = bytes.TrimSpace(raw)
	raw = bytes.TrimPrefix(raw, []byte("```json"))
	raw = bytes.TrimPrefix(raw, []byte("```"))
	raw = bytes.TrimSuffix(raw, []byte("```"))
	raw = bytes.TrimSpace(raw)

	var result TranslateResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("parse response: %w (content: %s)", err, string(raw))
	}

	return &result, nil
}

func handleGenerateLesson(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		AncestorID string `json:"ancestorId"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
		return
	}

	lesson := &LessonResponse{
		AncestorID: req.AncestorID,
		Questions:  generateLessonQuestions(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(lesson)
}

func generateLessonQuestions() []Question {
	return []Question{
		{ID: "q1", Question: "What is the Idoma word for 'ancestor'?", Options: []string{"Ekwu", "Ekwu", "Alekwu", "Ogiri"}, CorrectAnswer: "Ekwu", Translation: "Ekwu — ancestor or elder in Idoma"},
		{ID: "q2", Question: "What does 'Ole' mean in Idoma?", Options: []string{"Spirit", "Family tree", "Warrior", "King"}, CorrectAnswer: "Family tree", Translation: "Ole — the family tree or lineage"},
		{ID: "q3", Question: "How do you say 'Our ancestor' in Idoma?", Options: []string{"Ekwu wa che", "Ekwu oma", "Oche wa", "Alekwu ka"}, CorrectAnswer: "Ekwu wa che", Translation: "'Ekwu wa che' — 'Our ancestor'"},
		{ID: "q4", Question: "Which Idoma word means 'spirit guardian'?", Options: []string{"Ekwu", "Onyonu", "Alekwu", "Ogiri"}, CorrectAnswer: "Alekwu", Translation: "Alekwu — spirit or guardian deity"},
		{ID: "q5", Question: "What is the Idoma word for 'water'?", Options: []string{"ēnyi", "ēchō", "Olà", "ōchi"}, CorrectAnswer: "ēnyi", Translation: "ēnyi — water"},
	}
}
