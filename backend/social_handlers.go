package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
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
		methodNotAllowed(w, http.MethodGet)
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
	if err := db.QueryRow("SELECT COUNT(*) FROM posts").Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load the feed.")
		return
	}

	rows, err := db.Query(`
		SELECT p.id, p.user_id, p.content, p.media_type, p.media_url, p.created_at,
		       u.id, u.username, u.display_name, u.native_name, u.avatar_url, u.bio, u.dialect,
		       u.native_speaker, u.role
		FROM posts p
		LEFT JOIN users u ON p.user_id = u.id
		ORDER BY p.created_at DESC
		LIMIT ? OFFSET ?
	`, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load the feed.")
		return
	}
	defer rows.Close()

	posts := make([]PostResponse, 0)
	for rows.Next() {
		var (
			p          PostResponse
			u          User
			createdStr sql.NullString
			authorID   sql.NullString
		)
		err := rows.Scan(
			&p.ID, &p.UserID, &p.Content, &p.MediaType, &p.MediaURL, &createdStr,
			&authorID, &u.Username, &u.DisplayName, &u.NativeName, &u.AvatarURL, &u.Bio, &u.Dialect,
			&u.NativeSpeaker, &u.Role,
		)
		if err != nil {
			continue
		}
		if authorID.Valid {
			u.ID = authorID.String
			p.Author = &u
		}
		p.CreatedAt = parseDBTime(createdStr.String)
		posts = append(posts, p)
	}

	writeJSON(w, http.StatusOK, PostsListResponse{Posts: posts, Total: total, Page: page, Limit: limit})
}

func handleCreatePost(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}

	author := currentUser(r)

	var content, mediaType, mediaURL string

	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		r.Body = http.MaxBytesReader(w, r.Body, 25<<20)
		if err := r.ParseMultipartForm(4 << 20); err != nil {
			writeError(w, http.StatusBadRequest, "Could not read that upload.")
			return
		}
		content = r.FormValue("content")
		mediaType = r.FormValue("media_type")
		mediaURL = r.FormValue("media_url")

		file, header, err := r.FormFile("media_file")
		if err == nil && file != nil {
			defer file.Close()
			stored, err := storePostMedia(file, header)
			if err != nil {
				writeError(w, http.StatusUnsupportedMediaType, err.Error())
				return
			}
			mediaURL = stored
		}
	} else {
		var req struct {
			Content   string `json:"content"`
			MediaType string `json:"media_type"`
			MediaURL  string `json:"media_url"`
		}
		if err := decodeJSON(w, r, &req, 32<<10); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON body.")
			return
		}
		content = req.Content
		mediaType = req.MediaType
		mediaURL = req.MediaURL
	}
	if author == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to post.")
		return
	}
	if !allowRate(w, r, "post:"+author.ID, 30, time.Hour) {
		return
	}

	content = strings.TrimSpace(content)
	if content == "" {
		writeError(w, http.StatusBadRequest, "Write something before posting.")
		return
	}
	if len(content) > 2000 {
		writeError(w, http.StatusBadRequest, "Posts must be 2000 characters or fewer.")
		return
	}

	if mediaType == "" {
		mediaType = "text"
	}
	validTypes := map[string]bool{"text": true, "image": true, "audio": true, "video": true}
	if !validTypes[mediaType] {
		writeError(w, http.StatusBadRequest, "media_type must be text, image, audio, or video.")
		return
	}
	if !safeMediaURL(mediaURL) {
		writeError(w, http.StatusBadRequest, "media_url must be an http(s) URL or an uploaded file.")
		return
	}

	postID := uuid.New().String()
	now := time.Now()
	if _, err := db.Exec(`
		INSERT INTO posts (id, user_id, content, media_type, media_url, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, postID, author.ID, content, mediaType, mediaURL, now); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not save that post.")
		return
	}

	writeJSON(w, http.StatusCreated, PostResponse{
		ID:        postID,
		UserID:    author.ID,
		Author:    author,
		Content:   content,
		MediaType: mediaType,
		MediaURL:  mediaURL,
		CreatedAt: now,
	})
}

func handleDeletePost(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	viewer := currentUser(r)
	if viewer == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to continue.")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/posts/")
	id = strings.Trim(id, "/")
	if id == "" || strings.Contains(id, "/") {
		writeError(w, http.StatusNotFound, "Not found.")
		return
	}

	res, err := db.Exec(`
		DELETE FROM posts WHERE id = ? AND (user_id = ? OR ? IN ('curator', 'admin'))
	`, id, viewer.ID, viewer.Role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not delete that post.")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "That post does not exist, or it is not yours.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- Profile Engine Routing ---

type ProfileResponse struct {
	User                User             `json:"user"`
	IsOwner             bool             `json:"is_owner"`
	Visible             bool             `json:"visible"`
	ConnectionStatus    string           `json:"connection_status"`
	ConnectionDirection string           `json:"connection_direction"`
	LearningProfile     *LearningProfile `json:"learning_profile"`
	Posts               []PostResponse   `json:"posts"`
	ConnectionCount     int              `json:"connection_count"`
}

func handleProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}

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
		writeError(w, http.StatusBadRequest, "Target user id required.")
		return
	}

	viewer := currentUser(r)
	viewerID := ""
	if viewer != nil {
		viewerID = viewer.ID
	}

	target, err := getUserByID(targetID)
	if err != nil {
		writeError(w, http.StatusNotFound, "That profile does not exist.")
		return
	}
	if target.Status != "" && target.Status != "active" && target.ID != viewerID {
		writeError(w, http.StatusNotFound, "That profile does not exist.")
		return
	}

	// A block hides the profile in both directions.
	if blocked, _ := isBlocked(viewerID, target.ID); blocked {
		writeError(w, http.StatusNotFound, "That profile does not exist.")
		return
	}

	isOwner := viewerID != "" && viewerID == target.ID
	visible := visibleTo(target, viewerID)

	// Never leak contact details or the hash.
	target.Email = ""
	target.PasswordHash = ""
	target.Status = ""

	status, direction, _ := getConnectionStatus(viewerID, target.ID)

	resp := ProfileResponse{
		User:                *target,
		IsOwner:             isOwner,
		Visible:             visible,
		ConnectionStatus:    status,
		ConnectionDirection: direction,
		Posts:               []PostResponse{},
	}

	if visible {
		var connCount int
		db.QueryRow(`
			SELECT COUNT(*) FROM connections
			WHERE (requester_id = ? OR receiver_id = ?) AND status = 'connected'
		`, target.ID, target.ID).Scan(&connCount)
		resp.ConnectionCount = connCount

		if profile, err := getLearningProfile(target.ID); err == nil {
			resp.LearningProfile = profile
		}

		rows, err := db.Query(`
			SELECT id, user_id, content, media_type, media_url, created_at
			FROM posts WHERE user_id = ?
			ORDER BY created_at DESC
			LIMIT 20
		`, target.ID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var p PostResponse
				var cStr sql.NullString
				if err := rows.Scan(&p.ID, &p.UserID, &p.Content, &p.MediaType, &p.MediaURL, &cStr); err == nil {
					p.CreatedAt = parseDBTime(cStr.String)
					p.Author = target
					resp.Posts = append(resp.Posts, p)
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// --- Connections Handlers ---

type ConnectionUserItem struct {
	User         User   `json:"user"`
	ConnectionID string `json:"connection_id"`
	CreatedAt    string `json:"created_at"`
}

func handleGetConnections(w http.ResponseWriter, r *http.Request, viewer *User) {
	// 1. Connected mutual friends
	connRows, err := db.Query(`
		SELECT u.id, u.username, u.display_name, u.native_name, u.avatar_url, u.bio, u.dialect, u.region, u.native_speaker, u.role, c.id, c.updated_at
		FROM connections c
		JOIN users u ON (u.id = CASE WHEN c.requester_id = ? THEN c.receiver_id ELSE c.requester_id END)
		WHERE (c.requester_id = ? OR c.receiver_id = ?) AND c.status = 'connected' AND (u.status = 'active' OR u.status = '' OR u.status IS NULL)
		ORDER BY c.updated_at DESC
	`, viewer.ID, viewer.ID, viewer.ID)

	connected := make([]ConnectionUserItem, 0)
	if err == nil {
		defer connRows.Close()
		for connRows.Next() {
			var it ConnectionUserItem
			var upStr sql.NullString
			if err := connRows.Scan(&it.User.ID, &it.User.Username, &it.User.DisplayName, &it.User.NativeName,
				&it.User.AvatarURL, &it.User.Bio, &it.User.Dialect, &it.User.Region, &it.User.NativeSpeaker, &it.User.Role,
				&it.ConnectionID, &upStr); err == nil {
				it.CreatedAt = upStr.String
				connected = append(connected, it)
			}
		}
	}

	// 2. Incoming friend requests (waiting for viewer to accept)
	incRows, err := db.Query(`
		SELECT u.id, u.username, u.display_name, u.native_name, u.avatar_url, u.bio, u.dialect, u.region, u.native_speaker, u.role, c.id, c.created_at
		FROM connections c
		JOIN users u ON u.id = c.requester_id
		WHERE c.receiver_id = ? AND c.status = 'pending' AND (u.status = 'active' OR u.status = '' OR u.status IS NULL)
		ORDER BY c.created_at DESC
	`, viewer.ID)

	incoming := make([]ConnectionUserItem, 0)
	if err == nil {
		defer incRows.Close()
		for incRows.Next() {
			var it ConnectionUserItem
			var crStr sql.NullString
			if err := incRows.Scan(&it.User.ID, &it.User.Username, &it.User.DisplayName, &it.User.NativeName,
				&it.User.AvatarURL, &it.User.Bio, &it.User.Dialect, &it.User.Region, &it.User.NativeSpeaker, &it.User.Role,
				&it.ConnectionID, &crStr); err == nil {
				it.CreatedAt = crStr.String
				incoming = append(incoming, it)
			}
		}
	}

	// 3. Outgoing friend requests (sent by viewer, pending friend's acceptance)
	outRows, err := db.Query(`
		SELECT u.id, u.username, u.display_name, u.native_name, u.avatar_url, u.bio, u.dialect, u.region, u.native_speaker, u.role, c.id, c.created_at
		FROM connections c
		JOIN users u ON u.id = c.receiver_id
		WHERE c.requester_id = ? AND c.status = 'pending' AND (u.status = 'active' OR u.status = '' OR u.status IS NULL)
		ORDER BY c.created_at DESC
	`, viewer.ID)

	outgoing := make([]ConnectionUserItem, 0)
	if err == nil {
		defer outRows.Close()
		for outRows.Next() {
			var it ConnectionUserItem
			var crStr sql.NullString
			if err := outRows.Scan(&it.User.ID, &it.User.Username, &it.User.DisplayName, &it.User.NativeName,
				&it.User.AvatarURL, &it.User.Bio, &it.User.Dialect, &it.User.Region, &it.User.NativeSpeaker, &it.User.Role,
				&it.ConnectionID, &crStr); err == nil {
				it.CreatedAt = crStr.String
				outgoing = append(outgoing, it)
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"connected": connected,
		"incoming":  incoming,
		"outgoing":  outgoing,
	})
}

func handleConnections(w http.ResponseWriter, r *http.Request) {
	viewer := currentUser(r)
	if viewer == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to manage connections.")
		return
	}

	if r.Method == http.MethodGet {
		handleGetConnections(w, r, viewer)
		return
	}

	if r.Method != http.MethodPost {
		methodNotAllowed(w, "GET, POST")
		return
	}

	var req struct {
		TargetID string `json:"target_id"`
		Action   string `json:"action"`
		// Legacy field names are accepted for the action target only. The
		// requester is always the authenticated user.
		ReceiverID string `json:"receiver_id"`
	}
	if err := decodeJSON(w, r, &req, 8<<10); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body.")
		return
	}

	targetID := strings.TrimSpace(req.TargetID)
	if targetID == "" {
		targetID = strings.TrimSpace(req.ReceiverID)
	}
	if targetID == "" || targetID == viewer.ID {
		writeError(w, http.StatusBadRequest, "Choose someone else to connect with.")
		return
	}

	target, err := getUserByID(targetID)
	if err != nil || (target.Status != "" && target.Status != "active") {
		writeError(w, http.StatusNotFound, "That user does not exist.")
		return
	}

	existing, err := findConnection(viewer.ID, targetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not check that connection.")
		return
	}

	switch req.Action {
	case "connect":
		handleConnect(w, viewer, targetID, existing)
	case "accept":
		handleAccept(w, viewer, targetID, existing)
	case "block":
		handleBlock(w, viewer, targetID, existing)
	case "unblock":
		handleUnblock(w, viewer, targetID, existing)
	case "reject", "disconnect":
		handleDisconnect(w, viewer, targetID, existing)
	default:
		writeError(w, http.StatusBadRequest, "action must be connect, accept, reject, disconnect, block or unblock.")
	}
}

type connectionRow struct {
	ID          string
	RequesterID string
	ReceiverID  string
	Status      string
}

func findConnection(userA, userB string) (*connectionRow, error) {
	var c connectionRow
	err := db.QueryRow(`
		SELECT id, requester_id, receiver_id, status FROM connections
		WHERE pair_key = ?
		ORDER BY updated_at DESC LIMIT 1
	`, pairKey(userA, userB)).Scan(&c.ID, &c.RequesterID, &c.ReceiverID, &c.Status)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func handleConnect(w http.ResponseWriter, viewer *User, targetID string, existing *connectionRow) {
	if existing != nil {
		switch existing.Status {
		case string(ConnectionBlocked):
			// Blocking is terminal until the person who blocked undoes it.
			writeError(w, http.StatusForbidden, "You cannot connect with this user.")
			return
		case string(ConnectionConnected):
			writeJSON(w, http.StatusOK, map[string]any{"status": "connected", "message": "Already connected."})
			return
		case string(ConnectionPending):
			if existing.RequesterID == targetID {
				// They already asked; this is the accept path.
				if err := setConnectionStatus(existing.ID, string(ConnectionConnected)); err != nil {
					writeError(w, http.StatusInternalServerError, "Could not accept the request.")
					return
				}
				writeJSON(w, http.StatusOK, map[string]any{"status": "connected", "message": "Connection accepted."})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"status": "pending", "message": "Request already pending."})
			return
		}
	}

	if err := insertConnection(viewer.ID, targetID, string(ConnectionPending)); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not send the request.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "pending", "message": "Connection request sent."})
}

func handleAccept(w http.ResponseWriter, viewer *User, targetID string, existing *connectionRow) {
	// Only the receiver of a pending request may accept it. This is the fix
	// for the old "insert a connected row for any pair" hole.
	if existing == nil || existing.Status != string(ConnectionPending) || existing.ReceiverID != viewer.ID {
		writeError(w, http.StatusNotFound, "There is no pending request from that user.")
		return
	}
	if err := setConnectionStatus(existing.ID, string(ConnectionConnected)); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not accept the request.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "connected", "message": "Connection accepted."})
}

func handleBlock(w http.ResponseWriter, viewer *User, targetID string, existing *connectionRow) {
	// Re-blocking replaces the row's direction so `unblock` is owned by the
	// person who blocked.
	if existing != nil {
		_, err := db.Exec(`
			UPDATE connections SET requester_id = ?, receiver_id = ?, status = 'blocked',
			                       updated_at = ? WHERE id = ?
		`, viewer.ID, targetID, time.Now(), existing.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Could not block that user.")
			return
		}
	} else if err := insertConnection(viewer.ID, targetID, string(ConnectionBlocked)); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not block that user.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "blocked", "message": "User blocked."})
}

func handleUnblock(w http.ResponseWriter, viewer *User, targetID string, existing *connectionRow) {
	if existing == nil || existing.Status != string(ConnectionBlocked) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "none", "message": "Nothing to unblock."})
		return
	}
	if existing.RequesterID != viewer.ID && viewer.Role != "admin" {
		writeError(w, http.StatusForbidden, "Only the person who blocked can undo it.")
		return
	}
	if _, err := db.Exec(`DELETE FROM connections WHERE id = ?`, existing.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not unblock that user.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "none", "message": "User unblocked."})
}

func handleDisconnect(w http.ResponseWriter, viewer *User, targetID string, existing *connectionRow) {
	if existing == nil {
		writeJSON(w, http.StatusOK, map[string]any{"status": "none", "message": "Not connected."})
		return
	}
	if existing.Status == string(ConnectionBlocked) {
		writeError(w, http.StatusForbidden, "Unblock this user first.")
		return
	}
	if existing.RequesterID != viewer.ID && existing.ReceiverID != viewer.ID {
		writeError(w, http.StatusForbidden, "You cannot change that connection.")
		return
	}
	if _, err := db.Exec(`DELETE FROM connections WHERE id = ?`, existing.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not remove the connection.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "none", "message": "Connection removed."})
}

func insertConnection(requester, receiver, status string) error {
	_, err := db.Exec(`
		INSERT INTO connections (id, requester_id, receiver_id, status, pair_key, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(pair_key) DO UPDATE SET
			status = excluded.status,
			updated_at = excluded.updated_at
	`, uuid.New().String(), requester, receiver, status, pairKey(requester, receiver), time.Now(), time.Now())
	return err
}

func setConnectionStatus(id, status string) error {
	_, err := db.Exec(`UPDATE connections SET status = ?, updated_at = ? WHERE id = ?`, status, time.Now(), id)
	return err
}

// pairKey is the canonical, order-independent key for a pair of users. It is
// what the UNIQUE index enforces, so a pair can never have two rows.
func pairKey(a, b string) string {
	if a < b {
		return a + "|" + b
	}
	return b + "|" + a
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
	if currentUser(r) == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to continue.")
		return
	}
	switch r.Method {
	case http.MethodPost:
		sendMessage(w, r)
	case http.MethodGet:
		readMessages(w, r)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func sendMessage(w http.ResponseWriter, r *http.Request) {
	sender := currentUser(r)

	var req struct {
		ReceiverID string `json:"receiver_id"`
		Body       string `json:"body"`
	}
	if err := decodeJSON(w, r, &req, 16<<10); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body.")
		return
	}

	if sender == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to send messages.")
		return
	}
	if !allowRate(w, r, "dm:"+sender.ID, 120, time.Hour) {
		return
	}

	receiverID := strings.TrimSpace(req.ReceiverID)
	body := strings.TrimSpace(req.Body)
	if receiverID == "" || receiverID == sender.ID {
		writeError(w, http.StatusBadRequest, "Choose someone else to message.")
		return
	}
	if body == "" {
		writeError(w, http.StatusBadRequest, "Write a message first.")
		return
	}
	if len(body) > 5000 {
		writeError(w, http.StatusBadRequest, "Messages must be 5000 characters or fewer.")
		return
	}

	receiver, err := getUserByID(receiverID)
	if err != nil {
		writeError(w, http.StatusNotFound, "That user does not exist.")
		return
	}

	if blocked, _ := isBlocked(sender.ID, receiverID); blocked {
		writeError(w, http.StatusForbidden, "You cannot message this user.")
		return
	}
	if receiver.DMPolicy == "nobody" {
		writeError(w, http.StatusForbidden, "This user is not accepting direct messages.")
		return
	}

	// CORE RULE 1: The DM Gateway Policy. Direct messaging is restricted to
	// active connected peers. Enforced here, before any mutation.
	connected, err := areUsersConnected(sender.ID, receiverID)
	if err != nil || !connected {
		writeError(w, http.StatusForbidden,
			"Direct messaging is restricted to active connected peers.")
		return
	}

	msgID := uuid.New().String()
	now := time.Now()
	if _, err := db.Exec(`
		INSERT INTO messages (id, sender_id, receiver_id, body, is_read, created_at)
		VALUES (?, ?, ?, ?, 0, ?)
	`, msgID, sender.ID, receiverID, body, now); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not store that message.")
		return
	}

	writeJSON(w, http.StatusCreated, DirectMessageResponse{
		ID: msgID, SenderID: sender.ID, ReceiverID: receiverID,
		Body: body, IsRead: false, CreatedAt: now,
	})
}

func readMessages(w http.ResponseWriter, r *http.Request) {
	viewer := currentUser(r)
	if viewer == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to read messages.")
		return
	}

	peerID := strings.TrimSpace(r.URL.Query().Get("peer_id"))
	if peerID == "" {
		writeError(w, http.StatusBadRequest, "peer_id is required.")
		return
	}

	if blocked, _ := isBlocked(viewer.ID, peerID); blocked {
		writeError(w, http.StatusForbidden, "Messaging history is unavailable.")
		return
	}
	connected, err := areUsersConnected(viewer.ID, peerID)
	if err != nil || !connected {
		writeError(w, http.StatusForbidden, "Messaging history is restricted to connected peers.")
		return
	}

	rows, err := db.Query(`
		SELECT id, sender_id, receiver_id, body, is_read, created_at
		FROM messages
		WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
		ORDER BY created_at ASC
	`, viewer.ID, peerID, peerID, viewer.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load messages.")
		return
	}
	defer rows.Close()

	messages := make([]DirectMessageResponse, 0)
	for rows.Next() {
		var m DirectMessageResponse
		var cStr sql.NullString
		if err := rows.Scan(&m.ID, &m.SenderID, &m.ReceiverID, &m.Body, &m.IsRead, &cStr); err == nil {
			m.CreatedAt = parseDBTime(cStr.String)
			messages = append(messages, m)
		}
	}

	writeJSON(w, http.StatusOK, messages)
}

// handleMarkMessagesRead is a mutation, so it is a POST rather than a side
// effect of GET (which also let a reader flip the sender's unread flags).
func handleMarkMessagesRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	viewer := currentUser(r)
	if viewer == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	var req struct {
		PeerID string `json:"peer_id"`
	}
	if err := decodeJSON(w, r, &req, 4<<10); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body.")
		return
	}
	peerID := strings.TrimSpace(req.PeerID)
	if peerID == "" {
		writeError(w, http.StatusBadRequest, "peer_id is required.")
		return
	}

	res, err := db.Exec(`
		UPDATE messages SET is_read = 1
		WHERE sender_id = ? AND receiver_id = ? AND is_read = 0
	`, peerID, viewer.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not update read state.")
		return
	}
	n, _ := res.RowsAffected()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "marked": n})
}

// --- Gamified Learning Tracks API ---

type CompleteTrackRequest struct {
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
		methodNotAllowed(w, http.MethodGet)
		return
	}

	user := currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to see your learning tracks.")
		return
	}

	profile, err := getLearningProfile(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load your progress.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"profile": profile,
		"tracks":  tracksWithStatus(profile.CompletedTracks),
	})
}

func tracksWithStatus(completed []string) []LearningTrack {
	completedMap := make(map[string]bool, len(completed))
	for _, id := range completed {
		completedMap[id] = true
	}

	tracks := make([]LearningTrack, len(CurriculumTracks))
	copy(tracks, CurriculumTracks)

	foundActive := false
	for i := range tracks {
		switch {
		case completedMap[tracks[i].ID]:
			tracks[i].Status = "completed"
		case !foundActive:
			tracks[i].Status = "active"
			foundActive = true
		default:
			tracks[i].Status = "locked"
		}
	}
	return tracks
}

func handleCompleteLearningTrack(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}

	var req CompleteTrackRequest
	if err := decodeJSON(w, r, &req, 4<<10); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body.")
		return
	}

	user := currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to record progress.")
		return
	}

	if req.TrackID == "" {
		writeError(w, http.StatusBadRequest, "track_id is required.")
		return
	}

	targetIndex := -1
	for i := range CurriculumTracks {
		if CurriculumTracks[i].ID == req.TrackID {
			targetIndex = i
			break
		}
	}
	if targetIndex == -1 {
		writeError(w, http.StatusNotFound, "That track does not exist.")
		return
	}
	targetTrack := CurriculumTracks[targetIndex]

	profile, err := getLearningProfile(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load your progress.")
		return
	}

	completedMap := make(map[string]bool, len(profile.CompletedTracks))
	for _, id := range profile.CompletedTracks {
		completedMap[id] = true
	}

	// CORE RULE 3: Lazy Module Progression.
	for i := 0; i < targetIndex; i++ {
		if !completedMap[CurriculumTracks[i].ID] {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error":   fmt.Sprintf("Complete '%s' before unlocking '%s'.", CurriculumTracks[i].Title, targetTrack.Title),
				"status":  400,
				"blocked": true,
			})
			return
		}
	}

	if completedMap[targetTrack.ID] {
		writeJSON(w, http.StatusOK, CompleteTrackResponse{
			Success: true, Message: "Track was already completed",
			LearningProfile: profile, XPEarned: 0, NewTier: profile.FluencyTier,
			Tracks: tracksWithStatus(profile.CompletedTracks),
		})
		return
	}

	profile.CompletedTracks = append(profile.CompletedTracks, targetTrack.ID)
	profile.XPPoints += targetTrack.XPReward
	profile.FluencyTier = calculateFluencyTier(profile.XPPoints)
	profile.UpdatedAt = time.Now()

	tracksJSON, _ := json.Marshal(profile.CompletedTracks)
	if _, err := db.Exec(`
		UPDATE learning_profiles
		SET completed_tracks = ?, xp_points = ?, fluency_tier = ?, updated_at = ?
		WHERE user_id = ?
	`, string(tracksJSON), profile.XPPoints, string(profile.FluencyTier), profile.UpdatedAt, profile.UserID); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not save your progress.")
		return
	}

	writeJSON(w, http.StatusOK, CompleteTrackResponse{
		Success:         true,
		Message:         fmt.Sprintf("Completed %s (+%d XP)", targetTrack.Title, targetTrack.XPReward),
		LearningProfile: profile,
		XPEarned:        targetTrack.XPReward,
		NewTier:         profile.FluencyTier,
		Tracks:          tracksWithStatus(profile.CompletedTracks),
	})
}

// --- Media helpers ----------------------------------------------------------

var allowedUploadExt = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
	".mp3": true, ".ogg": true, ".wav": true, ".m4a": true,
	".mp4": true, ".webm": true,
}

// storePostMedia saves an uploaded attachment under uploads/media with a
// generated name and a validated type. The client filename is never trusted and
// never used as a path.
func storePostMedia(file io.Reader, header *multipart.FileHeader) (string, error) {
	data, err := io.ReadAll(io.LimitReader(file, maxLibraryUpload+1))
	if err != nil {
		return "", fmt.Errorf("could not read that file")
	}
	if len(data) == 0 {
		return "", fmt.Errorf("that file is empty")
	}
	if len(data) > maxLibraryUpload {
		return "", fmt.Errorf("that file is too large (25 MB maximum)")
	}

	mime, ext, ok := detectMediaMime(data)
	if !ok {
		return "", fmt.Errorf("unsupported media type; use an image, audio or video file")
	}
	_ = header

	dir := filepath.Join("uploads", "media")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("could not store that file")
	}
	name := uuid.New().String() + ext
	if err := writeFileAtomic(filepath.Join(dir, name), data); err != nil {
		return "", fmt.Errorf("could not store that file")
	}
	_ = mime
	return "/uploads/media/" + name, nil
}

func detectMediaMime(data []byte) (mime, ext string, ok bool) {
	detected := http.DetectContentType(data)
	switch {
	case strings.HasPrefix(detected, "image/jpeg"):
		return "image/jpeg", ".jpg", true
	case strings.HasPrefix(detected, "image/png"):
		return "image/png", ".png", true
	case detected == "image/webp":
		return "image/webp", ".webp", true
	case detected == "audio/mpeg":
		return "audio/mpeg", ".mp3", true
	case detected == "audio/ogg", detected == "application/ogg":
		return "audio/ogg", ".ogg", true
	case detected == "audio/wave", detected == "audio/wav":
		return "audio/wav", ".wav", true
	case detected == "audio/mp4":
		return "audio/mp4", ".m4a", true
	case detected == "video/mp4":
		return "video/mp4", ".mp4", true
	case detected == "video/webm":
		return "video/webm", ".webm", true
	}
	return "", "", false
}

func safeMediaURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return true
	}
	if strings.HasPrefix(raw, "/uploads/") {
		return !strings.Contains(raw, "..")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	return (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
}
