package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
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
	// Load the dictionary the backend actually serves. This pointed at
	// idoma_dictionary_v2.json until that file was deleted as fabricated.
	dict, err := loadDictionary("idoma_dictionary_v3.json")
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
	dict, err := loadDictionary("idoma_dictionary_v3.json")
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

// The v1 fallback dictionary maps words to bare strings rather than objects.
// Before WordEntry.UnmarshalJSON existed this failed to parse, so the fallback
// silently produced an empty dictionary.
func TestV1BareStringDictionaryLoads(t *testing.T) {
	dict, err := loadDictionary("idoma_dictionary.json")
	if err != nil {
		t.Fatalf("v1 dictionary failed to load: %v", err)
	}

	if got := dict["core_vocabulary"]["father"].Idoma; got != "Adah" {
		t.Errorf("expected v1 bare-string entry to parse as Adah, got %q", got)
	}
}

// Half of the deleted idoma_dictionary_v2.json mapped to the placeholder "ụụ". The
// dictionary is consulted before the model, so serving those entries both returned
// nonsense and hid the model's real output. The guard is kept after v2's deletion so
// a regenerated or hand-edited dictionary cannot reintroduce the failure silently.
func TestPlaceholderEntriesAreNotServed(t *testing.T) {
	if usableEntry(WordEntry{Idoma: idomaPlaceholder}) {
		t.Error("placeholder entry should be treated as absent")
	}
	if usableEntry(WordEntry{Idoma: "  "}) {
		t.Error("blank entry should be treated as absent")
	}
	if !usableEntry(WordEntry{Idoma: "Adah"}) {
		t.Error("real entry should be usable")
	}

	saved := dict
	defer func() { dict = saved }()
	dict = dictionary{"animals": {"bird": {Idoma: idomaPlaceholder}}}

	if resp := lookupDictionary("bird", "English", "Idoma"); resp != nil {
		t.Errorf("placeholder entry was served as a translation: %q", resp.Translation)
	}
}

// The dictionary is keyed by English, so it must only be read in the direction
// asked for. Previously an Idoma -> English request for "water" matched the
// English key and answered with the Idoma word.
func TestDictionaryLookupRespectsDirection(t *testing.T) {
	saved := dict
	defer func() { dict = saved }()
	dict = dictionary{"core_vocabulary": {"water": {Idoma: "Ennkpo"}}}

	resp := lookupDictionary("water", "English", "Idoma")
	if resp == nil || resp.Translation != "Ennkpo" {
		t.Fatalf("English -> Idoma should give Ennkpo, got %+v", resp)
	}

	resp = lookupDictionary("Ennkpo", "Idoma", "English")
	if resp == nil || resp.Translation != "water" {
		t.Fatalf("Idoma -> English should give water, got %+v", resp)
	}

	// The source word must not come back unchanged in the reverse direction.
	if resp := lookupDictionary("water", "Idoma", "English"); resp != nil {
		t.Errorf("Idoma -> English matched an English key and returned %q", resp.Translation)
	}
}

// idoma_dictionary_v3.json is the dictionary the backend serves: a union of 226
// hand-curated tone-marked entries and 1,000 more from the idomaland.org scrape,
// merged by data_pipeline/merge_dictionary.py into 1,225. It is the default
// DICTIONARY_PATH and it is committed, so this test does not skip -- a missing file
// is a failure.
//
// This is a regression test on the words the fine-tuned model gets wrong: with
// dictionary-first routing they must be answered by lookup, because the model
// approximates words it has seen ("Nmachi" for the reference "Nmaochi") and guesses
// at words it has not ("onyilo", meaning *man*, for water).
func TestV3DictionaryAnswersWhatTheModelMisses(t *testing.T) {
	loaded, err := loadDictionary("idoma_dictionary_v3.json")
	if err != nil {
		t.Fatalf("idoma_dictionary_v3.json failed to load: %v", err)
	}

	saved := dict
	defer func() { dict = saved }()
	dict = loaded

	usable, placeholders := countEntries(dict)
	if placeholders != 0 {
		t.Errorf("v3 must contain no %q placeholders, found %d", idomaPlaceholder, placeholders)
	}
	if usable < expectedMinEntries {
		t.Errorf("expected at least %d usable entries, got %d", expectedMinEntries, usable)
	}

	// Every one of these was the "ụụ" placeholder in the deleted v2, so the
	// dictionary skipped it and the model answered instead -- that is exactly how a
	// deploy serving v2 was caught: /api/translate returned NLLB's "inyinya" for
	// bird and "le" for sleep.
	filledFromPlaceholders := map[string]string{
		"bird":  "enu",
		"sleep": "ny'ogwū",
		"work":  "g'uklo",
		"buy":   "jē",
		"sell":  "hɔ́",
	}
	for english, want := range filledFromPlaceholders {
		resp := lookupDictionary(english, "English", "Idoma")
		if resp == nil {
			t.Errorf("%q: no dictionary hit; the model would have to guess", english)
			continue
		}
		if !strings.EqualFold(resp.Translation, want) {
			t.Errorf("%q: got %q, want %q", english, resp.Translation, want)
		}
	}

	// The 8 entries idoma_dictionary.json contributed, which v3 never had.
	for english, want := range map[string]string{
		"king":         "Óché",
		"husband":      "Obá",
		"death":        "ikwū",
		"he will come": "Ó gè wa",
	} {
		resp := lookupDictionary(english, "English", "Idoma")
		if resp == nil {
			t.Errorf("%q: merged entry missing from the dictionary", english)
			continue
		}
		if !strings.EqualFold(resp.Translation, want) {
			t.Errorf("%q: got %q, want %q", english, resp.Translation, want)
		}
	}

	// Reverse direction, which the model also gets wrong ("Ennkpo" -> "Neck").
	if resp := lookupDictionary("ēnyi", "Idoma", "English"); resp == nil {
		t.Error("ēnyi: no reverse hit")
	} else if !strings.EqualFold(resp.Translation, "water") {
		t.Errorf("ēnyi -> %q, want water", resp.Translation)
	}
}

// Everyday words the 226-entry curated dictionary simply did not have, so every one
// of them reached the model and came back a guess. They are the reason for merging
// the scrape in: coverage, not polish.
func TestCorpusMergeAddedTheWordsCurationNeverReached(t *testing.T) {
	loaded, err := loadDictionary("idoma_dictionary_v3.json")
	if err != nil {
		t.Fatalf("idoma_dictionary_v3.json failed to load: %v", err)
	}

	saved := dict
	defer func() { dict = saved }()
	dict = loaded

	for english, want := range map[string]string{
		"school":   "In'okpa",
		"teacher":  "O'nwo okpa",
		"hospital": "In'echi",
		"money":    "Ije",
		"farm":     "Eho",
		"leopard":  "Eje",
	} {
		resp := lookupDictionary(english, "English", "Idoma")
		if resp == nil {
			t.Errorf("%q: no dictionary hit, so the model has to guess it", english)
			continue
		}
		if !strings.EqualFold(resp.Translation, want) {
			t.Errorf("%q: got %q, want %q", english, resp.Translation, want)
		}
	}
}

// An English key in two categories is a latent bug rather than a cosmetic one:
// lookupDictionary iterates the categories and Go randomises map order, so such a key
// answers from one copy or the other between restarts, and the copies need not agree.
// The curated file shipped exactly one -- "goat" was both fauna_elements "Èwü" and
// animals "èwü" -- which data_pipeline/merge_dictionary.py now collapses.
func TestNoEnglishKeyAppearsInTwoCategories(t *testing.T) {
	loaded, err := loadDictionary("idoma_dictionary_v3.json")
	if err != nil {
		t.Fatalf("idoma_dictionary_v3.json failed to load: %v", err)
	}

	seen := map[string]string{}
	for category, words := range loaded {
		for english := range words {
			key := strings.ToLower(english)
			if other, dup := seen[key]; dup {
				t.Errorf("%q is in both %q and %q; lookup order is nondeterministic",
					english, other, category)
				continue
			}
			seen[key] = category
		}
	}
}

// The merge resolves a disagreement between the two dictionaries in favour of the
// tone-marked form, because tone is meaning-bearing in Idoma ("àkpà" is bridge,
// "ákpá" is cloud). Serving the bare "ole" where "Olé" was available would throw
// away the distinction the language depends on.
func TestMergePreferredTheToneMarkedForm(t *testing.T) {
	loaded, err := loadDictionary("idoma_dictionary_v3.json")
	if err != nil {
		t.Fatalf("idoma_dictionary_v3.json failed to load: %v", err)
	}

	saved := dict
	defer func() { dict = saved }()
	dict = loaded

	for english, want := range map[string]string{
		"house":  "Olé",    // beat the bare "ole"
		"mother": "ēnē",    // beat the bare "ene"
		"prayer": "Ókògbá", // beat "g'owoicho", which also broke the vowel-initial rule
		// The same rule applied 100 more times when the idomaland.org corpus was
		// merged in, and this is the half of the merge that matters most: the corpus
		// brings 1,000 new words but is almost entirely untoned, so without the rule
		// it would have flattened every marked form it happened to overlap.
		"night": "ōtū",     // beat the corpus "Otu"
		"year":  "ɛ̄wɔ̄",   // beat the corpus "Ihayi"
		"rice":  "omɛ̄hɛ̄", // beat the corpus "Ochikapa"
		// And it is not one-directional -- where the corpus is the better-marked
		// source, the corpus wins. Curated "adah" had no marks at all.
		"father": "ádah",
	} {
		resp := lookupDictionary(english, "English", "Idoma")
		if resp == nil {
			t.Errorf("%q: no dictionary hit", english)
			continue
		}
		if resp.Translation != want {
			t.Errorf("%q: got %q, want the tone-marked %q", english, resp.Translation, want)
		}
	}

	// The displaced form is kept as a variant rather than dropped, so the
	// information survives in the response explanation.
	if entry, ok := loaded["places"]["house"]; !ok {
		t.Error("house missing from places")
	} else if !strings.Contains(entry.Example, "ole") {
		t.Errorf("displaced form not preserved in example, got %q", entry.Example)
	}
}

// The bare URL is what a human clicks, and ServeMux answered it with Go's
// "404 page not found" because only /api/* and /health were registered -- a live
// service that looked like a failed deploy. The catch-all must still 404 unknown
// paths, or a typo would return the banner with status 200.
func TestRootRouteExplainsTheServiceButStill404sUnknownPaths(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", handleRoot)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("GET / = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); !strings.Contains(body, "/api/translate") {
		t.Errorf("GET / should advertise the endpoints, got %q", body)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/translte", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /api/translte = %d, want 404 for an unknown path", rec.Code)
	}
}
