package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthAndConnections(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()

	// 1. Attempt login with non-existent account -> MUST fail with 404 USER_NOT_FOUND
	loginPayload := map[string]string{
		"identifier": "nonexistent_user",
		"password":   "password123",
	}
	body, _ := json.Marshal(loginPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleLogin(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("Expected 404 StatusNotFound for missing account, got %d: %s", rec.Code, rec.Body.String())
	}
	var notFoundResp map[string]any
	json.NewDecoder(rec.Body).Decode(&notFoundResp)
	if notFoundResp["code"] != "USER_NOT_FOUND" {
		t.Errorf("Expected code 'USER_NOT_FOUND', got %v", notFoundResp["code"])
	}

	// 2. Signup real user 1 with native_name
	signupUser1 := map[string]any{
		"username":       "enoche_ada",
		"display_name":   "Enoche Ada",
		"native_name":    "Ochanya",
		"email":          "enoche@example.com",
		"password":       "securepass123",
		"native_speaker": true,
		"dialect":        "Otukpo",
	}
	b1, _ := json.Marshal(signupUser1)
	reqSignup1 := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewReader(b1))
	reqSignup1.Header.Set("Content-Type", "application/json")
	recSignup1 := httptest.NewRecorder()
	handleSignup(recSignup1, reqSignup1)

	if recSignup1.Code != http.StatusCreated {
		t.Fatalf("Expected 201 Created for signup, got %d: %s", recSignup1.Code, recSignup1.Body.String())
	}
	var creds1 credentialsResponse
	json.NewDecoder(recSignup1.Body).Decode(&creds1)
	if creds1.User.NativeName != "Ochanya" {
		t.Errorf("Expected NativeName 'Ochanya', got %s", creds1.User.NativeName)
	}
	cookie1 := recSignup1.Result().Cookies()

	// 3. Signup real user 2 with native_name
	signupUser2 := map[string]any{
		"username":       "agbo_idoma",
		"display_name":   "Agbo Idoma",
		"native_name":    "Alechenu",
		"email":          "agbo@example.com",
		"password":       "securepass456",
		"native_speaker": false,
		"dialect":        "Okpokwu",
	}
	b2, _ := json.Marshal(signupUser2)
	reqSignup2 := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewReader(b2))
	reqSignup2.Header.Set("Content-Type", "application/json")
	recSignup2 := httptest.NewRecorder()
	handleSignup(recSignup2, reqSignup2)

	if recSignup2.Code != http.StatusCreated {
		t.Fatalf("Expected 201 Created for user 2 signup, got %d: %s", recSignup2.Code, recSignup2.Body.String())
	}
	var creds2 credentialsResponse
	json.NewDecoder(recSignup2.Body).Decode(&creds2)
	cookie2 := recSignup2.Result().Cookies()

	// 4. Test login with wrong password
	wrongPass := map[string]string{
		"identifier": "enoche_ada",
		"password":   "wrongpassword",
	}
	bWrong, _ := json.Marshal(wrongPass)
	reqWrong := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(bWrong))
	reqWrong.Header.Set("Content-Type", "application/json")
	recWrong := httptest.NewRecorder()
	handleLogin(recWrong, reqWrong)

	if recWrong.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401 StatusUnauthorized for wrong password, got %d", recWrong.Code)
	}

	// 5. Test login with correct password
	correctPass := map[string]string{
		"identifier": "enoche_ada",
		"password":   "securepass123",
	}
	bCorrect, _ := json.Marshal(correctPass)
	reqCorrect := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(bCorrect))
	reqCorrect.Header.Set("Content-Type", "application/json")
	recCorrect := httptest.NewRecorder()
	handleLogin(recCorrect, reqCorrect)

	if recCorrect.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK for valid login, got %d: %s", recCorrect.Code, recCorrect.Body.String())
	}

	// 6. User 1 sends a friend request to User 2
	connReqBody, _ := json.Marshal(map[string]string{
		"target_id": creds2.User.ID,
		"action":    "connect",
	})
	reqConn := httptest.NewRequest(http.MethodPost, "/api/connections", bytes.NewReader(connReqBody))
	reqConn.Header.Set("Content-Type", "application/json")
	for _, c := range cookie1 {
		reqConn.AddCookie(c)
	}
	recConn := httptest.NewRecorder()
	handleConnections(recConn, reqConn)

	if recConn.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK sending connect request, got %d: %s", recConn.Code, recConn.Body.String())
	}

	// Check status: User 1 and User 2 are NOT connected yet (pending handshake)
	connected, _ := areUsersConnected(creds1.User.ID, creds2.User.ID)
	if connected {
		t.Fatalf("Users should NOT be connected until recipient accepts request")
	}

	// 7. User 2 checks incoming connection requests via GET /api/connections
	reqGetConn := httptest.NewRequest(http.MethodGet, "/api/connections", nil)
	for _, c := range cookie2 {
		reqGetConn.AddCookie(c)
	}
	recGetConn := httptest.NewRecorder()
	handleConnections(recGetConn, reqGetConn)

	if recGetConn.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK getting connections, got %d", recGetConn.Code)
	}
	var connLists struct {
		Connected []ConnectionUserItem `json:"connected"`
		Incoming  []ConnectionUserItem `json:"incoming"`
		Outgoing  []ConnectionUserItem `json:"outgoing"`
	}
	json.NewDecoder(recGetConn.Body).Decode(&connLists)
	if len(connLists.Incoming) != 1 {
		t.Fatalf("Expected 1 incoming friend request for User 2, got %d", len(connLists.Incoming))
	}
	if connLists.Incoming[0].User.NativeName != "Ochanya" {
		t.Errorf("Expected incoming request user NativeName 'Ochanya', got %s", connLists.Incoming[0].User.NativeName)
	}

	// 8. User 2 accepts the friend request
	acceptBody, _ := json.Marshal(map[string]string{
		"target_id": creds1.User.ID,
		"action":    "accept",
	})
	reqAccept := httptest.NewRequest(http.MethodPost, "/api/connections", bytes.NewReader(acceptBody))
	reqAccept.Header.Set("Content-Type", "application/json")
	for _, c := range cookie2 {
		reqAccept.AddCookie(c)
	}
	recAccept := httptest.NewRecorder()
	handleConnections(recAccept, reqAccept)

	if recAccept.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK accepting connection, got %d: %s", recAccept.Code, recAccept.Body.String())
	}

	// 9. Now they MUST be connected!
	connectedNow, _ := areUsersConnected(creds1.User.ID, creds2.User.ID)
	if !connectedNow {
		t.Fatalf("Users MUST be connected after accepting friend request")
	}

	// 10. Test updating profile: edit native name, display name, bio
	newDisplayName := "Ochanya Ada-Idoma"
	newNativeName := "Ochanya-K'Oche"
	newBio := "Dedicated ancestral linguist and storyteller."
	updateBody, _ := json.Marshal(map[string]any{
		"display_name": newDisplayName,
		"native_name":  newNativeName,
		"bio":          newBio,
	})
	reqUpdate := httptest.NewRequest(http.MethodPatch, "/api/profile/update", bytes.NewReader(updateBody))
	reqUpdate.Header.Set("Content-Type", "application/json")
	for _, c := range cookie1 {
		reqUpdate.AddCookie(c)
	}
	recUpdate := httptest.NewRecorder()
	handleUpdateProfile(recUpdate, reqUpdate)

	if recUpdate.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK updating profile, got %d: %s", recUpdate.Code, recUpdate.Body.String())
	}
	var updatedCreds credentialsResponse
	json.NewDecoder(recUpdate.Body).Decode(&updatedCreds)
	if updatedCreds.User.NativeName != newNativeName {
		t.Errorf("Expected updated NativeName %s, got %s", newNativeName, updatedCreds.User.NativeName)
	}
	if updatedCreds.User.DisplayName != newDisplayName {
		t.Errorf("Expected updated DisplayName %s, got %s", newDisplayName, updatedCreds.User.DisplayName)
	}
	if updatedCreds.User.Bio != newBio {
		t.Errorf("Expected updated Bio %s, got %s", newBio, updatedCreds.User.Bio)
	}
}
