package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func setupTestDB(t *testing.T) {
	testDBPath := "test_idlang.db"
	os.Remove(testDBPath)
	var err error
	db, err = initDB(testDBPath)
	if err != nil {
		t.Fatalf("Failed to initialize test DB: %v", err)
	}
}

func cleanupTestDB() {
	if db != nil {
		db.Close()
	}
	os.Remove("test_idlang.db")
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
		"user_id":    "user_oche",
		"content":    "Exploring ancient tone inflections in Idoma storytelling.",
		"media_type": "audio",
		"media_url":  "https://example.com/audio/inflections.mp3",
	}
	body, _ := json.Marshal(newPost)
	postReq := httptest.NewRequest(http.MethodPost, "/api/posts", bytes.NewReader(body))
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	handleCreatePost(postRec, postReq)

	if postRec.Code != http.StatusCreated {
		t.Fatalf("Expected 201 Created for post, got %d: %s", postRec.Code, postRec.Body.String())
	}

	// 3. POST /api/posts - Invalid media_type should fail
	invalidPost := map[string]string{
		"user_id":    "user_oche",
		"content":    "Testing invalid media",
		"media_type": "invalid_format",
	}
	invBody, _ := json.Marshal(invalidPost)
	invReq := httptest.NewRequest(http.MethodPost, "/api/posts", bytes.NewReader(invBody))
	invReq.Header.Set("Content-Type", "application/json")
	invRec := httptest.NewRecorder()
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
		"sender_id":   "user_idoko",
		"receiver_id": "user_ada",
		"body":        "Hello Ada, can I send you this unsolicited message?",
	}
	body, _ := json.Marshal(unconnectedPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleMessages(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("DM Gateway Violation: Expected 403 Forbidden for unconnected peers, got %d", rec.Code)
	}

	// 2. Pending peers (Idoko -> Oche): MUST ALSO FAIL WITH 403 Forbidden
	pendingPayload := map[string]string{
		"sender_id":   "user_idoko",
		"receiver_id": "user_oche",
		"body":        "Hello Oche, our connection is still pending!",
	}
	pBody, _ := json.Marshal(pendingPayload)
	pReq := httptest.NewRequest(http.MethodPost, "/api/messages", bytes.NewReader(pBody))
	pReq.Header.Set("Content-Type", "application/json")
	pRec := httptest.NewRecorder()
	handleMessages(pRec, pReq)

	if pRec.Code != http.StatusForbidden {
		t.Fatalf("DM Gateway Violation: Expected 403 Forbidden for pending connection, got %d", pRec.Code)
	}

	// 3. Connected peers (Oche -> Ada): MUST SUCCEED with 201 Created
	connectedPayload := map[string]string{
		"sender_id":   "user_oche",
		"receiver_id": "user_ada",
		"body":        "Aôlô Ada, thank you for sharing the folklore recording!",
	}
	cBody, _ := json.Marshal(connectedPayload)
	cReq := httptest.NewRequest(http.MethodPost, "/api/messages", bytes.NewReader(cBody))
	cReq.Header.Set("Content-Type", "application/json")
	cRec := httptest.NewRecorder()
	handleMessages(cRec, cReq)

	if cRec.Code != http.StatusCreated {
		t.Fatalf("Expected 201 Created for connected peers, got %d: %s", cRec.Code, cRec.Body.String())
	}

	// 4. Retrieve conversation history between connected peers
	getReq := httptest.NewRequest(http.MethodGet, "/api/messages?user_id=user_oche&peer_id=user_ada", nil)
	getRec := httptest.NewRecorder()
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
	handleGetLearningTracks(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", rec.Code)
	}

	// Try to complete Track 3 (Proverbial Idioms) directly without completing Track 1 & 2
	skipPayload := map[string]string{
		"user_id":  testUserID,
		"track_id": "track_3_idioms",
	}
	sBody, _ := json.Marshal(skipPayload)
	sReq := httptest.NewRequest(http.MethodPost, "/api/learning/complete-track", bytes.NewReader(sBody))
	sReq.Header.Set("Content-Type", "application/json")
	sRec := httptest.NewRecorder()
	handleCompleteLearningTrack(sRec, sReq)

	// MUST FAIL with 400 Bad Request due to Lazy Module Progression rule!
	if sRec.Code != http.StatusBadRequest {
		t.Fatalf("Lazy Module Progression Violation: Expected 400 Bad Request when skipping tracks, got %d", sRec.Code)
	}

	// Now complete Track 1 (Daily Greetings)
	t1Payload := map[string]string{
		"user_id":  testUserID,
		"track_id": "track_1_greetings",
	}
	t1Body, _ := json.Marshal(t1Payload)
	t1Req := httptest.NewRequest(http.MethodPost, "/api/learning/complete-track", bytes.NewReader(t1Body))
	t1Req.Header.Set("Content-Type", "application/json")
	t1Rec := httptest.NewRecorder()
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
	handleCompleteLearningTrack(sRec2, sReq2)

	if sRec2.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 Bad Request when Track 2 still missing, got %d", sRec2.Code)
	}

	// Complete Track 2 (Numerical Quantifiers)
	t2Payload := map[string]string{
		"user_id":  testUserID,
		"track_id": "track_2_numbers",
	}
	t2Body, _ := json.Marshal(t2Payload)
	t2Req := httptest.NewRequest(http.MethodPost, "/api/learning/complete-track", bytes.NewReader(t2Body))
	t2Req.Header.Set("Content-Type", "application/json")
	t2Rec := httptest.NewRecorder()
	handleCompleteLearningTrack(t2Rec, t2Req)

	if t2Rec.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK completing Track 2, got %d", t2Rec.Code)
	}

	// Now complete Track 3 (Proverbial Idioms) - should now succeed!
	t3Req := httptest.NewRequest(http.MethodPost, "/api/learning/complete-track", bytes.NewReader(sBody))
	t3Req.Header.Set("Content-Type", "application/json")
	t3Rec := httptest.NewRecorder()
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

	// 2. POST /api/books - Catalog a new document
	newBook := map[string]string{
		"title":       "Dialects of the Lower Benue Valley",
		"author":      "Dr. O. Armstrong",
		"uploaded_by": "user_oche",
		"description": "Comparative linguistic analysis of Okpokwu, Otukpo, and Ogbadibo dialects.",
		"file_url":    "/api/books/sample/lower_benue.txt",
	}
	bJSON, _ := json.Marshal(newBook)
	postReq := httptest.NewRequest(http.MethodPost, "/api/books", bytes.NewReader(bJSON))
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	handleBooks(postRec, postReq)

	if postRec.Code != http.StatusCreated {
		t.Fatalf("Expected 201 Created for cataloged book, got %d", postRec.Code)
	}
}

func TestProfileEngineRouting(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()

	// 1. Non-owner view: Ada viewing Oche
	req := httptest.NewRequest(http.MethodGet, "/api/profile?id=user_oche", nil)
	req.Header.Set("X-Viewer-ID", "user_ada")
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
	req2.Header.Set("X-Viewer-ID", "user_oche")
	rec2 := httptest.NewRecorder()
	handleProfile(rec2, req2)

	var ownerResp ProfileResponse
	json.NewDecoder(rec2.Body).Decode(&ownerResp)

	if !ownerResp.IsOwner {
		t.Errorf("Expected is_owner = true when Oche views himself")
	}
}
