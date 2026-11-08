package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func setupTestDB(t *testing.T) {
	t.Helper()
	oldDemo := demoMode
	demoMode = true
	t.Cleanup(func() { demoMode = oldDemo })
	t.Setenv("LIBRARY_DIR", t.TempDir())
	var err error
	db, err = initDB(filepath.Join(t.TempDir(), "idlang.db"))
	if err != nil {
		t.Fatal(err)
	}
}

func cleanupTestDB() {
	if db != nil {
		db.Close()
	}
}

func authenticateTestRequest(t *testing.T, req *http.Request, userID string) {
	t.Helper()
	rec := httptest.NewRecorder()
	if err := issueSession(rec, req, userID); err != nil {
		t.Fatal(err)
	}
	req.AddCookie(rec.Result().Cookies()[0])
}

func TestPostsAPI(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()

	// 1. GET /api/posts - Should retrieve seeded posts
	req := httptest.NewRequest(http.MethodGet, "/api/posts?page=1&limit=5", nil)
	rec := httptest.NewRecorder()
	handleGetPosts(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", rec.Code)
	}

	var postsResp PostsListResponse
	if err := json.NewDecoder(rec.Body).Decode(&postsResp); err != nil {
		t.Fatalf("Failed to decode posts response: %v", err)
	}
	if len(postsResp.Posts) == 0 {
		t.Errorf("Expected seeded posts, got 0")
	}

	// Verify author info is attached
	if postsResp.Posts[0].Author == nil || postsResp.Posts[0].Author.DisplayName == "" {
		t.Errorf("Expected author details in post, got nil or empty")
	}

	// 2. POST /api/posts - Create a new post
	newPost := map[string]string{

		"content":    "Exploring ancient tone inflections in Idoma storytelling.",
		"media_type": "audio",
		"media_url":  "https://example.com/audio/inflections.mp3",
	}
	body, _ := json.Marshal(newPost)
	postReq := httptest.NewRequest(http.MethodPost, "/api/posts", bytes.NewReader(body))
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	authenticateTestRequest(t, postReq, "user_oche")
	handleCreatePost(postRec, postReq)

	if postRec.Code != http.StatusCreated {
		t.Fatalf("Expected 201 Created for post, got %d: %s", postRec.Code, postRec.Body.String())
	}

	// 3. POST /api/posts - Invalid media_type should fail
	invalidPost := map[string]string{

		"content":    "Testing invalid media",
		"media_type": "invalid_format",
	}
	invBody, _ := json.Marshal(invalidPost)
	invReq := httptest.NewRequest(http.MethodPost, "/api/posts", bytes.NewReader(invBody))
	invReq.Header.Set("Content-Type", "application/json")
	invRec := httptest.NewRecorder()
	authenticateTestRequest(t, invReq, "user_oche")
	handleCreatePost(invRec, invReq)

	if invRec.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for invalid media_type, got %d", invRec.Code)
	}
}

func TestDMGatewayPolicy(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()

	// In baseline seed:
	// Oche and Ada are CONNECTED
	// Idoko and Oche are PENDING (not connected)
	// Idoko and Ada have NO connection (strangers)

	// 1. Unconnected peers (Idoko -> Ada): MUST FAIL AT CONTROLLER with 403 Forbidden
	unconnectedPayload := map[string]string{

		"receiver_id": "user_ada",
		"body":        "Hello Ada, can I send you this unsolicited message?",
	}
	body, _ := json.Marshal(unconnectedPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	authenticateTestRequest(t, req, "user_idoko")
	handleMessages(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("DM Gateway Violation: Expected 403 Forbidden for unconnected peers, got %d", rec.Code)
	}

	// 2. Pending peers (Idoko -> Oche): MUST ALSO FAIL WITH 403 Forbidden
	pendingPayload := map[string]string{

		"receiver_id": "user_oche",
		"body":        "Hello Oche, our connection is still pending!",
	}
	pBody, _ := json.Marshal(pendingPayload)
	pReq := httptest.NewRequest(http.MethodPost, "/api/messages", bytes.NewReader(pBody))
	pReq.Header.Set("Content-Type", "application/json")
	pRec := httptest.NewRecorder()
	authenticateTestRequest(t, pReq, "user_idoko")
	handleMessages(pRec, pReq)

	if pRec.Code != http.StatusForbidden {
		t.Fatalf("DM Gateway Violation: Expected 403 Forbidden for pending connection, got %d", pRec.Code)
	}

	// 3. Connected peers (Oche -> Ada): MUST SUCCEED with 201 Created
	connectedPayload := map[string]string{

		"receiver_id": "user_ada",
		"body":        "Aôlô Ada, thank you for sharing the folklore recording!",
	}
	cBody, _ := json.Marshal(connectedPayload)
	cReq := httptest.NewRequest(http.MethodPost, "/api/messages", bytes.NewReader(cBody))
	cReq.Header.Set("Content-Type", "application/json")
	cRec := httptest.NewRecorder()
	authenticateTestRequest(t, cReq, "user_oche")
	handleMessages(cRec, cReq)

	if cRec.Code != http.StatusCreated {
		t.Fatalf("Expected 201 Created for connected peers, got %d: %s", cRec.Code, cRec.Body.String())
	}

	// 4. Retrieve conversation history between connected peers
	getReq := httptest.NewRequest(http.MethodGet, "/api/messages?user_id=user_oche&peer_id=user_ada", nil)
	getRec := httptest.NewRecorder()
	authenticateTestRequest(t, getReq, "user_oche")
	handleMessages(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK retrieving messages, got %d", getRec.Code)
	}

	var messages []DirectMessageResponse
	if err := json.NewDecoder(getRec.Body).Decode(&messages); err != nil {
		t.Fatalf("Failed to decode messages: %v", err)
	}
	if len(messages) == 0 {
		t.Errorf("Expected message history, got 0 messages")
	}

	// Cursor reads return only newer/older messages and remain deterministic.
	baseTime := time.Now().Add(365 * 24 * time.Hour)
	for i, id := range []string{"cursor-message-2", "cursor-message-3"} {
		if _, err := db.Exec(`INSERT INTO messages (id, sender_id, receiver_id, body, is_read, created_at)
			VALUES (?, ?, ?, ?, 0, ?)`, id, "user_oche", "user_ada", id, baseTime.Add(time.Duration(i)*time.Second)); err != nil {
			t.Fatalf("Insert cursor fixture: %v", err)
		}
	}

	firstID := messages[len(messages)-1].ID
	afterReq := httptest.NewRequest(http.MethodGet, "/api/messages?peer_id=user_ada&after_id="+firstID, nil)
	afterRec := httptest.NewRecorder()
	authenticateTestRequest(t, afterReq, "user_oche")
	handleMessages(afterRec, afterReq)
	var newer []DirectMessageResponse
	afterBody := afterRec.Body.Bytes()
	if afterRec.Code != http.StatusOK || json.Unmarshal(afterBody, &newer) != nil || len(newer) != 2 {
		t.Fatalf("Expected two newer messages after %s (initial %d), got status %d and body %s", firstID, len(messages), afterRec.Code, afterBody)
	}

	beforeReq := httptest.NewRequest(http.MethodGet, "/api/messages?peer_id=user_ada&before_id=cursor-message-3", nil)
	beforeRec := httptest.NewRecorder()
	authenticateTestRequest(t, beforeReq, "user_oche")
	handleMessages(beforeRec, beforeReq)
	var older []DirectMessageResponse
	beforeBody := beforeRec.Body.Bytes()
	if beforeRec.Code != http.StatusOK || json.Unmarshal(beforeBody, &older) != nil || len(older) != len(messages)+1 {
		t.Fatalf("Expected %d older messages, got %d with status %d and body %s", len(messages)+1, len(older), beforeRec.Code, beforeBody)
	}
}

func TestLazyModuleProgression(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()

	// Create fresh test user with 0 completed tracks
	testUserID := "user_test_learner"
	db.Exec(`
		INSERT INTO users (id, username, display_name)
		VALUES (?, ?, ?)
	`, testUserID, "testlearner", "Test Learner")

	// Verify track list
	req := httptest.NewRequest(http.MethodGet, "/api/learning/tracks?user_id="+testUserID, nil)
	rec := httptest.NewRecorder()
	authenticateTestRequest(t, req, testUserID)
	handleGetLearningTracks(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", rec.Code)
	}

	// Try to complete Track 3 (Proverbial Idioms) directly without completing Track 1 & 2
	skipPayload := map[string]any{
		"track_id": "track_3_idioms",
		"answers":  curriculumAnswerKeys["track_3_idioms"],
	}
	sBody, _ := json.Marshal(skipPayload)
	sReq := httptest.NewRequest(http.MethodPost, "/api/learning/complete-track", bytes.NewReader(sBody))
	sReq.Header.Set("Content-Type", "application/json")
	sRec := httptest.NewRecorder()
	authenticateTestRequest(t, sReq, testUserID)
	handleCompleteLearningTrack(sRec, sReq)

	// MUST FAIL with 400 Bad Request due to Lazy Module Progression rule!
	if sRec.Code != http.StatusBadRequest {
		t.Fatalf("Lazy Module Progression Violation: Expected 400 Bad Request when skipping tracks, got %d", sRec.Code)
	}

	// Now complete Track 1 (Daily Greetings)
	t1Payload := map[string]any{
		"track_id": "track_1_greetings",
		"answers":  curriculumAnswerKeys["track_1_greetings"],
	}
	t1Body, _ := json.Marshal(t1Payload)
	t1Req := httptest.NewRequest(http.MethodPost, "/api/learning/complete-track", bytes.NewReader(t1Body))
	t1Req.Header.Set("Content-Type", "application/json")
	t1Rec := httptest.NewRecorder()
	authenticateTestRequest(t, t1Req, testUserID)
	handleCompleteLearningTrack(t1Rec, t1Req)

	if t1Rec.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK completing Track 1, got %d: %s", t1Rec.Code, t1Rec.Body.String())
	}

	var resp1 CompleteTrackResponse
	json.NewDecoder(t1Rec.Body).Decode(&resp1)
	if resp1.XPEarned != 200 || resp1.LearningProfile.XPPoints != 200 {
		t.Errorf("Expected 200 XP, got %d", resp1.LearningProfile.XPPoints)
	}

	// Still cannot complete Track 3 yet (Track 2 is still pending!)
	sReq2 := httptest.NewRequest(http.MethodPost, "/api/learning/complete-track", bytes.NewReader(sBody))
	sReq2.Header.Set("Content-Type", "application/json")
	sRec2 := httptest.NewRecorder()
	authenticateTestRequest(t, sReq2, testUserID)
	handleCompleteLearningTrack(sRec2, sReq2)

	if sRec2.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 Bad Request when Track 2 still missing, got %d", sRec2.Code)
	}

	// Complete Track 2 (Numerical Quantifiers)
	t2Payload := map[string]any{
		"track_id": "track_2_numbers",
		"answers":  curriculumAnswerKeys["track_2_numbers"],
	}
	t2Body, _ := json.Marshal(t2Payload)
	t2Req := httptest.NewRequest(http.MethodPost, "/api/learning/complete-track", bytes.NewReader(t2Body))
	t2Req.Header.Set("Content-Type", "application/json")
	t2Rec := httptest.NewRecorder()
	authenticateTestRequest(t, t2Req, testUserID)
	handleCompleteLearningTrack(t2Rec, t2Req)

	if t2Rec.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK completing Track 2, got %d", t2Rec.Code)
	}

	// Now complete Track 3 (Proverbial Idioms) - should now succeed!
	t3Req := httptest.NewRequest(http.MethodPost, "/api/learning/complete-track", bytes.NewReader(sBody))
	t3Req.Header.Set("Content-Type", "application/json")
	t3Rec := httptest.NewRecorder()
	authenticateTestRequest(t, t3Req, testUserID)
	handleCompleteLearningTrack(t3Rec, t3Req)

	if t3Rec.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK completing Track 3 after prerequisites met, got %d: %s", t3Rec.Code, t3Rec.Body.String())
	}

	var resp3 CompleteTrackResponse
	json.NewDecoder(t3Rec.Body).Decode(&resp3)
	// 200 + 250 + 300 = 750 XP -> Intermediate Tier
	if resp3.LearningProfile.XPPoints != 750 {
		t.Errorf("Expected 750 total XP, got %d", resp3.LearningProfile.XPPoints)
	}
	if resp3.LearningProfile.FluencyTier != FluencyIntermediate {
		t.Errorf("Expected Intermediate tier at 750 XP, got %s", resp3.LearningProfile.FluencyTier)
	}
}

func TestELibraryAPI(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()

	// 1. GET /api/books
	req := httptest.NewRequest(http.MethodGet, "/api/books", nil)
	rec := httptest.NewRecorder()
	handleBooks(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", rec.Code)
	}

	var books []Book
	json.NewDecoder(rec.Body).Decode(&books)
	if len(books) == 0 {
		t.Errorf("Expected baseline books in e-library, got 0")
	}

	// Upload a real document through the authenticated multipart API.
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for key, value := range map[string]string{"title": "Dialects", "author": "Test Author", "license": "CC-BY-4.0"} {
		if err := form.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	file, err := form.CreateFormFile("file", "dialects.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("An Idoma language study.")); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	postReq := httptest.NewRequest(http.MethodPost, "/api/library", &body)
	postReq.Header.Set("Content-Type", form.FormDataContentType())
	authenticateTestRequest(t, postReq, "user_oche")
	postRec := httptest.NewRecorder()
	handleLibrary(postRec, postReq)
	if postRec.Code != http.StatusCreated {
		t.Fatalf("Upload: %d %s", postRec.Code, postRec.Body.String())
	}
	var item LibraryItem
	if err := json.NewDecoder(postRec.Body).Decode(&item); err != nil {
		t.Fatal(err)
	}
	if item.UploadedBy != "user_oche" || item.Status != "draft" {
		t.Fatalf("Unexpected upload: %+v", item)
	}
}

func TestProfileEngineRouting(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()

	// 1. Non-owner view: Ada viewing Oche
	req := httptest.NewRequest(http.MethodGet, "/api/profile?id=user_oche", nil)
	authenticateTestRequest(t, req, "user_ada")
	rec := httptest.NewRecorder()
	handleProfile(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", rec.Code)
	}

	var profResp ProfileResponse
	json.NewDecoder(rec.Body).Decode(&profResp)

	if profResp.IsOwner {
		t.Errorf("Expected is_owner = false when Ada views Oche")
	}
	if profResp.ConnectionStatus != "connected" {
		t.Errorf("Expected connection_status = 'connected', got %s", profResp.ConnectionStatus)
	}

	// 2. Owner view: Oche viewing himself
	req2 := httptest.NewRequest(http.MethodGet, "/api/profile?id=user_oche", nil)
	authenticateTestRequest(t, req2, "user_oche")
	rec2 := httptest.NewRecorder()
	handleProfile(rec2, req2)

	var ownerResp ProfileResponse
	json.NewDecoder(rec2.Body).Decode(&ownerResp)

	if !ownerResp.IsOwner {
		t.Errorf("Expected is_owner = true when Oche views himself")
	}
}
