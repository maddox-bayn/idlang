package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// --- Timeline Engine ---

type PostResponse struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Author    *User     `json:"author"`
	Content   string    `json:"content"`
	MediaType string    `json:"media_type"`
	MediaURL  string    `json:"media_url"`
	CreatedAt time.Time `json:"created_at"`
}

type PostsListResponse struct {
	Posts []PostResponse `json:"posts"`
	Total int            `json:"total"`
	Page  int            `json:"page"`
	Limit int            `json:"limit"`
}

func handleGetPosts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 50 {
		limit = 10
	}
	offset := (page - 1) * limit

	var total int
	err := db.QueryRow("SELECT COUNT(*) FROM posts").Scan(&total)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to query posts count: %v", err), http.StatusInternalServerError)
		return
	}

	rows, err := db.Query(`
		SELECT p.id, p.user_id, p.content, p.media_type, p.media_url, p.created_at,
		       u.id, u.username, u.display_name, u.avatar_url, u.bio, u.created_at
		FROM posts p
		LEFT JOIN users u ON p.user_id = u.id
		ORDER BY p.created_at DESC
		LIMIT ? OFFSET ?
	`, limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to query posts: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	posts := make([]PostResponse, 0)
	for rows.Next() {
		var p PostResponse
		var u User
		var postCreatedStr, userCreatedStr string

		err := rows.Scan(
			&p.ID, &p.UserID, &p.Content, &p.MediaType, &p.MediaURL, &postCreatedStr,
			&u.ID, &u.Username, &u.DisplayName, &u.AvatarURL, &u.Bio, &userCreatedStr,
		)
		if err != nil {
			http.Error(w, fmt.Sprintf("Row scan error: %v", err), http.StatusInternalServerError)
			return
		}
		p.CreatedAt = parseDBTime(postCreatedStr)
		u.CreatedAt = parseDBTime(userCreatedStr)
		p.Author = &u
		posts = append(posts, p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(PostsListResponse{
		Posts: posts,
		Total: total,
		Page:  page,
		Limit: limit,
	})
}

func handleCreatePost(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var userID, content, mediaType, mediaURL string

	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		err := r.ParseMultipartForm(25 << 20) // 25 MB max
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to parse form: %v", err), http.StatusBadRequest)
			return
		}
		userID = r.FormValue("user_id")
		content = r.FormValue("content")
		mediaType = r.FormValue("media_type")
		mediaURL = r.FormValue("media_url")

		file, header, err := r.FormFile("media_file")
		if err == nil && file != nil {
			defer file.Close()
			uploadDir := "uploads"
			os.MkdirAll(uploadDir, 0755)
			filename := fmt.Sprintf("%d-%s", time.Now().UnixNano(), filepath.Base(header.Filename))
			filePath := filepath.Join(uploadDir, filename)
			dst, err := os.Create(filePath)
			if err == nil {
				io.Copy(dst, file)
				dst.Close()
				mediaURL = "/uploads/" + filename
			}
		}
	} else {
		var req struct {
			UserID    string `json:"user_id"`
			Content   string `json:"content"`
			MediaType string `json:"media_type"`
			MediaURL  string `json:"media_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON body", http.StatusBadRequest)
			return
		}
		userID = req.UserID
		content = req.Content
		mediaType = req.MediaType
		mediaURL = req.MediaURL
	}

	if userID == "" || strings.TrimSpace(content) == "" {
		http.Error(w, "user_id and content are required", http.StatusBadRequest)
		return
	}

	if mediaType == "" {
		mediaType = "text"
	}
	validTypes := map[string]bool{"text": true, "image": true, "audio": true, "video": true}
	if !validTypes[mediaType] {
		http.Error(w, "media_type must be text, image, audio, or video", http.StatusBadRequest)
		return
	}

	// Ensure user exists
	author, err := getUserByID(userID)
	if err != nil {
		// Auto-create user if missing (helpful for testing)
		author = &User{
			ID:          userID,
			Username:    strings.ToLower(strings.ReplaceAll(userID, " ", "_")),
			DisplayName: userID,
			AvatarURL:   "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
			Bio:         "Idoma cultural explorer",
			CreatedAt:   time.Now(),
		}
		db.Exec(`
			INSERT OR IGNORE INTO users (id, username, display_name, avatar_url, bio)
			VALUES (?, ?, ?, ?, ?)
		`, author.ID, author.Username, author.DisplayName, author.AvatarURL, author.Bio)
	}

	postID := uuid.New().String()
	now := time.Now()
	_, err = db.Exec(`
		INSERT INTO posts (id, user_id, content, media_type, media_url, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, postID, userID, content, mediaType, mediaURL, now)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to insert post: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(PostResponse{
		ID:        postID,
		UserID:    userID,
		Author:    author,
		Content:   content,
		MediaType: mediaType,
		MediaURL:  mediaURL,
		CreatedAt: now,
	})
}

// --- Profile Engine Routing ---

type ProfileResponse struct {
	User                User             `json:"user"`
	IsOwner             bool             `json:"is_owner"`
	ConnectionStatus    string           `json:"connection_status"` // none, pending, connected, blocked
	ConnectionDirection string           `json:"connection_direction"` // outgoing, incoming, mutual, none
	LearningProfile     *LearningProfile `json:"learning_profile"`
	Posts               []PostResponse   `json:"posts"`
	ConnectionCount     int              `json:"connection_count"`
}

func handleProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Determine destination user ID from path or query
	// Supports /api/profile/:id, /api/profile?id=:id, /profile/:id
	targetID := strings.TrimSpace(r.URL.Query().Get("id"))
	if targetID == "" {
		path := strings.Trim(r.URL.Path, "/")
		parts := strings.Split(path, "/")
		for i, part := range parts {
			if part == "profile" && i+1 < len(parts) {
				targetID = parts[i+1]
				break
			}
		}
	}

	if targetID == "" {
		http.Error(w, "Target user id required (e.g., /api/profile?id=user_oche or /api/profile/user_oche)", http.StatusBadRequest)
		return
	}

	// Determine viewer ID from headers or query
	viewerID := r.Header.Get("X-Viewer-ID")
	if viewerID == "" {
		viewerID = r.URL.Query().Get("viewer_id")
	}

	user, err := getUserByID(targetID)
	if err != nil {
		http.Error(w, fmt.Sprintf("User %q not found", targetID), http.StatusNotFound)
		return
	}

	isOwner := viewerID != "" && viewerID == targetID

	connStatus, connDir, err := getConnectionStatus(viewerID, targetID)
	if err != nil {
		connStatus = "none"
	}

	learnProf, _ := getLearningProfile(targetID)

	var connCount int
	db.QueryRow(`
		SELECT COUNT(*) FROM connections
		WHERE (requester_id = ? OR receiver_id = ?) AND status = 'connected'
	`, targetID, targetID).Scan(&connCount)

	// Fetch user's posts
	rows, err := db.Query(`
		SELECT id, user_id, content, media_type, media_url, created_at
		FROM posts WHERE user_id = ?
		ORDER BY created_at DESC
		LIMIT 20
	`, targetID)
	var posts []PostResponse
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var p PostResponse
			var cStr string
			if err := rows.Scan(&p.ID, &p.UserID, &p.Content, &p.MediaType, &p.MediaURL, &cStr); err == nil {
				p.CreatedAt = parseDBTime(cStr)
				p.Author = user
				posts = append(posts, p)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ProfileResponse{
		User:                *user,
		IsOwner:             isOwner,
		ConnectionStatus:    connStatus,
		ConnectionDirection: connDir,
		LearningProfile:     learnProf,
		Posts:               posts,
		ConnectionCount:     connCount,
	})
}

// --- Connections Handlers ---

func handleConnections(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var req struct {
			RequesterID string `json:"requester_id"`
			ReceiverID  string `json:"receiver_id"`
			Action      string `json:"action"` // connect, accept, reject, block
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON body", http.StatusBadRequest)
			return
		}

		if req.RequesterID == "" || req.ReceiverID == "" || req.RequesterID == req.ReceiverID {
			http.Error(w, "Valid requester_id and receiver_id required", http.StatusBadRequest)
			return
		}

		switch req.Action {
		case "connect":
			// Check if connection already exists in either direction
			var existingID, existingStatus, existingReq string
			err := db.QueryRow(`
				SELECT id, status, requester_id FROM connections
				WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)
			`, req.RequesterID, req.ReceiverID, req.ReceiverID, req.RequesterID).Scan(&existingID, &existingStatus, &existingReq)
			now := time.Now()
			if err == nil {
				// Already exists
				if existingStatus == string(ConnectionConnected) {
					w.Header().Set("Content-Type", "application/json")
					json.NewEncoder(w).Encode(map[string]any{"status": "connected", "message": "Already connected"})
					return
				}
				if existingReq == req.ReceiverID && existingStatus == string(ConnectionPending) {
					// The other user previously sent a request: mutual connection achieved!
					db.Exec(`UPDATE connections SET status = 'connected', updated_at = ? WHERE id = ?`, now, existingID)
					w.Header().Set("Content-Type", "application/json")
					json.NewEncoder(w).Encode(map[string]any{"status": "connected", "message": "Connection accepted mutually"})
					return
				}
				// Otherwise refresh pending status
				db.Exec(`UPDATE connections SET status = 'pending', updated_at = ? WHERE id = ?`, now, existingID)
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]any{"status": "pending", "message": "Connection request refreshed"})
				return
			}

			// Create new pending connection
			connID := uuid.New().String()
			_, err = db.Exec(`
				INSERT INTO connections (id, requester_id, receiver_id, status, created_at, updated_at)
				VALUES (?, ?, ?, 'pending', ?, ?)
			`, connID, req.RequesterID, req.ReceiverID, now, now)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to request connection: %v", err), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"status": "pending", "message": "Connection request sent"})

		case "accept":
			now := time.Now()
			res, err := db.Exec(`
				UPDATE connections SET status = 'connected', updated_at = ?
				WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)
			`, now, req.ReceiverID, req.RequesterID, req.RequesterID, req.ReceiverID)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to accept connection: %v", err), http.StatusInternalServerError)
				return
			}
			affected, _ := res.RowsAffected()
			if affected == 0 {
				// Insert as connected directly
				connID := uuid.New().String()
				db.Exec(`
					INSERT INTO connections (id, requester_id, receiver_id, status, created_at, updated_at)
					VALUES (?, ?, ?, 'connected', ?, ?)
				`, connID, req.RequesterID, req.ReceiverID, now, now)
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"status": "connected", "message": "Connection accepted"})

		case "block":
			now := time.Now()
			db.Exec(`
				UPDATE connections SET status = 'blocked', updated_at = ?
				WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)
			`, now, req.RequesterID, req.ReceiverID, req.ReceiverID, req.RequesterID)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"status": "blocked", "message": "User blocked"})

		case "reject":
			db.Exec(`
				DELETE FROM connections
				WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)
			`, req.RequesterID, req.ReceiverID, req.ReceiverID, req.RequesterID)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"status": "none", "message": "Connection removed"})

		default:
			http.Error(w, "Invalid action (connect, accept, reject, block)", http.StatusBadRequest)
		}

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// --- Connected Messaging Guard (DM Gateway Policy) ---

type DirectMessageResponse struct {
	ID         string    `json:"id"`
	SenderID   string    `json:"sender_id"`
	ReceiverID string    `json:"receiver_id"`
	Body       string    `json:"body"`
	IsRead     bool      `json:"is_read"`
	CreatedAt  time.Time `json:"created_at"`
}

func handleMessages(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var req struct {
			SenderID   string `json:"sender_id"`
			ReceiverID string `json:"receiver_id"`
			Body       string `json:"body"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON body", http.StatusBadRequest)
			return
		}

		req.SenderID = strings.TrimSpace(req.SenderID)
		req.ReceiverID = strings.TrimSpace(req.ReceiverID)
		req.Body = strings.TrimSpace(req.Body)

		if req.SenderID == "" || req.ReceiverID == "" {
			http.Error(w, "sender_id and receiver_id are required", http.StatusBadRequest)
			return
		}

		// CORE RULE 1: The DM Gateway Policy
		// "If an un-connected user tries to directly send a payload to another peer,
		// validation scripts inside the backend API layer must fail immediately at
		// the controller stage before executing database mutations.
		// Throw an explicit 403 Forbidden status message if the requester_id and receiver_id
		// parameters fail to match an active connected status."
		connected, err := areUsersConnected(req.SenderID, req.ReceiverID)
		if err != nil || !connected {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]any{
				"error":   "Forbidden: Direct messaging is strictly restricted to active connected peers",
				"status":  403,
				"details": fmt.Sprintf("Users %q and %q are not connected", req.SenderID, req.ReceiverID),
			})
			return
		}

		if req.Body == "" {
			http.Error(w, "body is required", http.StatusBadRequest)
			return
		}

		msgID := uuid.New().String()
		now := time.Now()
		_, err = db.Exec(`
			INSERT INTO messages (id, sender_id, receiver_id, body, is_read, created_at)
			VALUES (?, ?, ?, ?, 0, ?)
		`, msgID, req.SenderID, req.ReceiverID, req.Body, now)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to store message: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(DirectMessageResponse{
			ID:         msgID,
			SenderID:   req.SenderID,
			ReceiverID: req.ReceiverID,
			Body:       req.Body,
			IsRead:     false,
			CreatedAt:  now,
		})

	case http.MethodGet:
		userID := r.URL.Query().Get("user_id")
		peerID := r.URL.Query().Get("peer_id")

		if userID == "" || peerID == "" {
			http.Error(w, "user_id and peer_id query parameters are required", http.StatusBadRequest)
			return
		}

		// Check connection status
		connected, err := areUsersConnected(userID, peerID)
		if err != nil || !connected {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]any{
				"error":  "Forbidden: Messaging history is restricted to connected peers",
				"status": 403,
			})
			return
		}

		// Mark incoming messages as read
		db.Exec(`
			UPDATE messages SET is_read = 1
			WHERE sender_id = ? AND receiver_id = ? AND is_read = 0
		`, peerID, userID)

		rows, err := db.Query(`
			SELECT id, sender_id, receiver_id, body, is_read, created_at
			FROM messages
			WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
			ORDER BY created_at ASC
		`, userID, peerID, peerID, userID)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to query messages: %v", err), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		messages := make([]DirectMessageResponse, 0)
		for rows.Next() {
			var m DirectMessageResponse
			var cStr string
			if err := rows.Scan(&m.ID, &m.SenderID, &m.ReceiverID, &m.Body, &m.IsRead, &cStr); err == nil {
				m.CreatedAt = parseDBTime(cStr)
				messages = append(messages, m)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(messages)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// --- E-Library Store ---

func handleBooks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := db.Query(`
			SELECT id, title, author, uploaded_by, file_url, description, created_at
			FROM books
			ORDER BY created_at DESC
		`)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to query books: %v", err), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		books := make([]Book, 0)
		for rows.Next() {
			var b Book
			var cStr string
			if err := rows.Scan(&b.ID, &b.Title, &b.Author, &b.UploadedBy, &b.FileURL, &b.Description, &cStr); err == nil {
				b.CreatedAt = parseDBTime(cStr)
				books = append(books, b)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(books)

	case http.MethodPost:
		var title, author, uploadedBy, fileURL, description string

		contentType := r.Header.Get("Content-Type")
		if strings.HasPrefix(contentType, "multipart/form-data") {
			r.ParseMultipartForm(25 << 20)
			title = r.FormValue("title")
			author = r.FormValue("author")
			uploadedBy = r.FormValue("uploaded_by")
			description = r.FormValue("description")
			fileURL = r.FormValue("file_url")

			file, header, err := r.FormFile("book_file")
			if err == nil && file != nil {
				defer file.Close()
				uploadDir := "uploads"
				os.MkdirAll(uploadDir, 0755)
				filename := fmt.Sprintf("book-%d-%s", time.Now().UnixNano(), filepath.Base(header.Filename))
				filePath := filepath.Join(uploadDir, filename)
				dst, err := os.Create(filePath)
				if err == nil {
					io.Copy(dst, file)
					dst.Close()
					fileURL = "/uploads/" + filename
				}
			}
		} else {
			var req struct {
				Title       string `json:"title"`
				Author      string `json:"author"`
				UploadedBy  string `json:"uploaded_by"`
				FileURL     string `json:"file_url"`
				Description string `json:"description"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid JSON body", http.StatusBadRequest)
				return
			}
			title = req.Title
			author = req.Author
			uploadedBy = req.UploadedBy
			fileURL = req.FileURL
			description = req.Description
		}

		if title == "" || author == "" {
			http.Error(w, "title and author are required", http.StatusBadRequest)
			return
		}
		if uploadedBy == "" {
			uploadedBy = "user_oche"
		}
		if fileURL == "" {
			fileURL = "/api/books/sample/idoma_orthography.txt"
		}

		bookID := uuid.New().String()
		now := time.Now()
		_, err := db.Exec(`
			INSERT INTO books (id, title, author, uploaded_by, file_url, description, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, bookID, title, author, uploadedBy, fileURL, description, now)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to insert book: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(Book{
			ID:          bookID,
			Title:       title,
			Author:      author,
			UploadedBy:  uploadedBy,
			FileURL:     fileURL,
			Description: description,
			CreatedAt:   now,
		})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// Sample book text content server
func handleSampleBookContent(w http.ResponseWriter, r *http.Request) {
	filename := filepath.Base(r.URL.Path)
	content := fmt.Sprintf("--- Idoma Heritage Document: %s ---\n\nStandard orthographic recording and cultural documentation for the Idoma linguistic corpus.\nPublished for educational and historical preservation under the Idlang archive.\nAll rights reserved for cultural research.", filename)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Write([]byte(content))
}

// --- Gamified Learning Tracks API ---

type CompleteTrackRequest struct {
	UserID  string `json:"user_id"`
	TrackID string `json:"track_id"`
}

type CompleteTrackResponse struct {
	Success         bool             `json:"success"`
	Message         string           `json:"message"`
	LearningProfile *LearningProfile `json:"learning_profile"`
	XPEarned        int              `json:"xp_earned"`
	NewTier         FluencyTier      `json:"new_tier"`
	Tracks          []LearningTrack  `json:"tracks"`
}

func handleGetLearningTracks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "user_oche"
	}

	profile, err := getLearningProfile(userID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to retrieve profile: %v", err), http.StatusInternalServerError)
		return
	}

	completedMap := make(map[string]bool)
	for _, id := range profile.CompletedTracks {
		completedMap[id] = true
	}

	tracks := make([]LearningTrack, len(CurriculumTracks))
	copy(tracks, CurriculumTracks)

	// Compute state milestones step-by-step
	// The first track not completed is "active", subsequent tracks are "locked"
	foundActive := false
	for i := range tracks {
		if completedMap[tracks[i].ID] {
			tracks[i].Status = "completed"
		} else if !foundActive {
			tracks[i].Status = "active"
			foundActive = true
		} else {
			tracks[i].Status = "locked"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"profile": profile,
		"tracks":  tracks,
	})
}

func handleCompleteLearningTrack(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CompleteTrackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.UserID == "" || req.TrackID == "" {
		http.Error(w, "user_id and track_id are required", http.StatusBadRequest)
		return
	}

	// Find the targeted track
	var targetTrack *LearningTrack
	var targetIndex = -1
	for i, t := range CurriculumTracks {
		if t.ID == req.TrackID {
			targetTrack = &CurriculumTracks[i]
			targetIndex = i
			break
		}
	}

	if targetTrack == nil {
		http.Error(w, fmt.Sprintf("Track %q not found", req.TrackID), http.StatusNotFound)
		return
	}

	profile, err := getLearningProfile(req.UserID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load learning profile: %v", err), http.StatusInternalServerError)
		return
	}

	completedMap := make(map[string]bool)
	for _, id := range profile.CompletedTracks {
		completedMap[id] = true
	}

	// CORE RULE 3: Lazy Module Progression
	// "The learning tracking module must compute state milestones step-by-step;
	// unlocking subsequent modules requires the user to successfully pass previous tracks."
	for i := 0; i < targetIndex; i++ {
		prevID := CurriculumTracks[i].ID
		if !completedMap[prevID] {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{
				"error":   fmt.Sprintf("Lazy Module Progression: You must complete '%s' before unlocking '%s'", CurriculumTracks[i].Title, targetTrack.Title),
				"status":  400,
				"blocked": true,
			})
			return
		}
	}

	// If already completed, return without double-awarding XP
	if completedMap[targetTrack.ID] {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(CompleteTrackResponse{
			Success:         true,
			Message:         "Track was already completed",
			LearningProfile: profile,
			XPEarned:        0,
			NewTier:         profile.FluencyTier,
		})
		return
	}

	// Append track, award XP, update fluency tier
	profile.CompletedTracks = append(profile.CompletedTracks, targetTrack.ID)
	profile.XPPoints += targetTrack.XPReward
	profile.FluencyTier = calculateFluencyTier(profile.XPPoints)
	profile.UpdatedAt = time.Now()

	tracksJSON, _ := json.Marshal(profile.CompletedTracks)
	_, err = db.Exec(`
		UPDATE learning_profiles
		SET completed_tracks = ?, xp_points = ?, fluency_tier = ?, updated_at = ?
		WHERE user_id = ?
	`, string(tracksJSON), profile.XPPoints, string(profile.FluencyTier), profile.UpdatedAt, profile.UserID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to update profile: %v", err), http.StatusInternalServerError)
		return
	}

	// Compute updated track list
	completedMap[targetTrack.ID] = true
	tracks := make([]LearningTrack, len(CurriculumTracks))
	copy(tracks, CurriculumTracks)
	foundActive := false
	for i := range tracks {
		if completedMap[tracks[i].ID] {
			tracks[i].Status = "completed"
		} else if !foundActive {
			tracks[i].Status = "active"
			foundActive = true
		} else {
			tracks[i].Status = "locked"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(CompleteTrackResponse{
		Success:         true,
		Message:         fmt.Sprintf("Congratulations! Completed %s (+%d XP)", targetTrack.Title, targetTrack.XPReward),
		LearningProfile: profile,
		XPEarned:        targetTrack.XPReward,
		NewTier:         profile.FluencyTier,
		Tracks:          tracks,
	})
}

// Get all users (useful for user switcher)
func handleGetUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rows, err := db.Query("SELECT id, username, display_name, avatar_url, bio, created_at FROM users")
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to query users: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	users := make([]User, 0)
	for rows.Next() {
		var u User
		var cStr string
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.AvatarURL, &u.Bio, &cStr); err == nil {
			u.CreatedAt = parseDBTime(cStr)
			users = append(users, u)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}
