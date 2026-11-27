package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestFeedAttachmentSurvivesRestartAndSupportsVideoRanges(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	var seq int
	var schema, path string
	if err := db.QueryRow("PRAGMA database_list").Scan(&seq, &schema, &path); err != nil {
		t.Fatal(err)
	}
	// WebM magic plus multiple chunks exercises a seek that crosses storage boundaries.
	data := append([]byte{0x1a, 0x45, 0xdf, 0xa3}, bytes.Repeat([]byte{42}, postMediaChunk+100)...)
	kind := "video"
	upload := func(route, user string, handler http.HandlerFunc) *httptest.ResponseRecorder {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, err := form.CreateFormFile("media_file", "clip.webm")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(data); err != nil {
			t.Fatal(err)
		}
		for k, v := range map[string]string{"media_type": kind, "content": "Clip"} {
			if err := form.WriteField(k, v); err != nil {
				t.Fatal(err)
			}
		}
		if err := form.Close(); err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", route, &body)
		req.Header.Set("Content-Type", form.FormDataContentType())
		authenticateTestRequest(t, req, user)
		rec := httptest.NewRecorder()
		handler(rec, req)
		return rec
	}
	created := upload("/api/posts", "user_oche", handleCreatePost)
	var post PostResponse
	if created.Code != 201 || json.Unmarshal(created.Body.Bytes(), &post) != nil {
		t.Fatalf("create: %d %s", created.Code, created.Body)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	var err error
	db, err = initDB(filepath.Clean(path))
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", post.MediaURL, nil)
	req.Header.Set("Range", "bytes=262142-262148")
	rec := httptest.NewRecorder()
	handleUploadedFile(rec, req)
	if rec.Code != 206 || rec.Header().Get("Content-Type") != "video/webm" || !bytes.Equal(rec.Body.Bytes(), data[262142:262149]) {
		t.Fatalf("range: %d %v", rec.Code, rec.Header())
	}
	if _, err := db.Exec("INSERT INTO posts(id,user_id,content,media_type,media_url) VALUES('legacy-clip','user_oche','Old clip','video','/uploads/media/lost.webm')"); err != nil {
		t.Fatal(err)
	}
	restore := "/api/restore-post-media/legacy-clip"
	if other := upload(restore, "user_ada", restorePostMedia); other.Code != 404 {
		t.Fatal(other.Code)
	}
	repaired := upload(restore, "user_oche", restorePostMedia)
	if repaired.Code != 200 {
		t.Fatalf("restore: %d %s", repaired.Code, repaired.Body)
	}
	if repeat := upload(restore, "user_oche", restorePostMedia); repeat.Code != 409 {
		t.Fatal(repeat.Code)
	}
	var url string
	if err := db.QueryRow("SELECT media_url FROM posts WHERE id='legacy-clip'").Scan(&url); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	handleUploadedFile(rec, httptest.NewRequest("GET", url, nil))
	if rec.Code != 200 || !bytes.Equal(rec.Body.Bytes(), data) {
		t.Fatal("restored media differs")
	}

	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewGray(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	kind, data = "image", encoded.Bytes()
	created = upload("/api/posts", "user_ada", handleCreatePost)
	if created.Code != 201 || json.Unmarshal(created.Body.Bytes(), &post) != nil {
		t.Fatalf("image create: %d %s", created.Code, created.Body)
	}
	rec = httptest.NewRecorder()
	handleUploadedFile(rec, httptest.NewRequest("GET", post.MediaURL, nil))
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" || !bytes.Equal(rec.Body.Bytes(), data) {
		t.Fatal("stored image did not round trip")
	}
}

func TestAvatarSurvivesRestart(t *testing.T) {
	setupTestDB(t)
	defer cleanupTestDB()
	var seq int
	var schema, path string
	if err := db.QueryRow("PRAGMA database_list").Scan(&seq, &schema, &path); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("avatar", "portrait.png")
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(part, image.NewGray(image.Rect(0, 0, 3, 2))); err != nil {
		t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("POST", "/api/profile/avatar", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	authenticateTestRequest(t, req, "user_oche")
	reply := httptest.NewRecorder()
	handleUploadAvatar(reply, req)
	var account credentialsResponse
	if reply.Code != 200 || json.Unmarshal(reply.Body.Bytes(), &account) != nil || account.User == nil {
		t.Fatalf("avatar upload: %d %s", reply.Code, reply.Body)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = initDB(path)
	if err != nil {
		t.Fatal(err)
	}
	var url string
	if err := db.QueryRow("SELECT avatar_url FROM users WHERE id=?", "user_oche").Scan(&url); err != nil {
		t.Fatal(err)
	}
	if url == "" || url != account.User.AvatarURL {
		t.Fatal("profile did not retain uploaded URL")
	}
	reply = httptest.NewRecorder()
	handleUploadedFile(reply, httptest.NewRequest("GET", url, nil))
	cfg, _, err := image.DecodeConfig(reply.Body)
	if reply.Code != 200 || err != nil || cfg.Width != 3 || cfg.Height != 2 {
		t.Fatal("stored avatar did not round trip")
	}
}
