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
	Text string `json:"text"`
}

type TranslateResponse struct {
	Translation string `json:"translation"`
	Explanation string `json:"explanation,omitempty"`
}

type Question struct {
	ID            string `json:"id"`
	Question      string `json:"question"`
	Options       []string `json:"options"`
	CorrectAnswer string `json:"correctAnswer"`
	Translation   string `json:"translation,omitempty"`
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

type dictionary map[string]map[string]string

var dict dictionary

func main() {
	var err error
	dict, err = loadDictionary("idoma_dictionary.json")
	if err != nil {
		log.Printf("Warning: could not load primary dictionary: %v", err)
		dict, err = loadDictionary("idoma_dictionary_v2.json")
	}
	if err != nil {
		log.Printf("Warning: could not load dictionary fallback: %v", err)
		dict = dictionary{}
	}
	log.Printf("Loaded %d categories from dictionary", len(dict))

	mux := http.NewServeMux()
	mux.HandleFunc("/api/translate", handleTranslate)
	mux.HandleFunc("/api/generate-lesson", handleGenerateLesson)

	handler := corsMiddleware(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Idlang backend listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
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
        // Accept localhost, local network IPs, and Vercel deployments
        origin := r.Header.Get("Origin")
        if origin != "" {
            w.Header().Set("Access-Control-Allow-Origin", origin)
        } else {
            w.Header().Set("Access-Control-Allow-Origin", "*")
        }
        
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
		for english, idoma := range words {
			buf.WriteString(fmt.Sprintf("%s -> %s\n", english, idoma))
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

	// 1. First, try case-insensitive dictionary lookup
	if resp := lookupDictionary(req.Text); resp != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	}

	// 2. Not in dictionary — try OmniRoute with context injection
	resourceContext := buildResourceContext()
	resp, err := callOmniRouteTranslate(req.Text, resourceContext)
	if err != nil {
		log.Printf("OmniRoute translate failed: %v", err)
		resp = &TranslateResponse{
			Translation: "Missing from Idlang archives.",
			Explanation: "This word or phrase is not yet documented in the Idlang Idoma dictionary archives.",
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func lookupDictionary(text string) *TranslateResponse {
	lower := bytes.ToLower([]byte(text))

	for category, words := range dict {
		for english, idoma := range words {
			if bytes.Equal(lower, bytes.ToLower([]byte(english))) {
				return &TranslateResponse{
					Translation: idoma,
					Explanation: fmt.Sprintf("Found in dictionary [%s]: '%s' translates to '%s'", category, english, idoma),
				}
			}
		}
	}

	return nil
}

func callOmniRouteTranslate(text, resourceContext string) (*TranslateResponse, error) {
	prompt := fmt.Sprintf(`Translate the following English text into Idoma.

English text: "%s"

%s

Respond with valid JSON only (no markdown, no preamble) in this exact shape:
{"translation": "the Idoma translation here", "explanation": "brief note referencing the dictionary entry, or 'Missing from Idlang archives' if not found"}

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
		Questions:  fallbackQuestions(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(lesson)
}

func fallbackQuestions() []Question {
	return []Question{
		{ID: "q1", Question: "What is the Idoma word for 'ancestor'?", Options: []string{"Oche", "Ekwu", "Alekwu", "Ochom"}, CorrectAnswer: "Ekwu", Translation: "Ekwu — ancestor or elder in Idoma"},
		{ID: "q2", Question: "What does 'Ole' mean in Idoma?", Options: []string{"Spirit", "Journey", "Family tree", "Warrior"}, CorrectAnswer: "Family tree", Translation: "Ole — the family tree or lineage"},
		{ID: "q3", Question: "How do you say 'Our ancestor' in Idoma?", Options: []string{"Ekwu wa che", "Ekwu oma", "Oche wa", "Alekwu ka"}, CorrectAnswer: "Ekwu wa che", Translation: "'Ekwu wa che' — 'Our ancestor'"},
		{ID: "q4", Question: "Which Idoma word means 'spirit guardian'?", Options: []string{"Ekwu", "Onyonu", "Alekwu", "Ogiri"}, CorrectAnswer: "Alekwu", Translation: "Alekwu — spirit or guardian deity"},
	}
}
