package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var db *sql.DB

// Models
type User struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	AvatarURL   string    `json:"avatar_url"`
	Bio         string    `json:"bio"`
	CreatedAt   time.Time `json:"created_at"`
}

type Post struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Author    *User     `json:"author,omitempty"`
	Content   string    `json:"content"`
	MediaType string    `json:"media_type"` // text, image, audio, video
	MediaURL  string    `json:"media_url"`
	CreatedAt time.Time `json:"created_at"`
}

type ConnectionStatus string

const (
	ConnectionPending   ConnectionStatus = "pending"
	ConnectionConnected ConnectionStatus = "connected"
	ConnectionBlocked   ConnectionStatus = "blocked"
)

type Connection struct {
	ID          string           `json:"id"`
	RequesterID string           `json:"requester_id"`
	ReceiverID  string           `json:"receiver_id"`
	Status      ConnectionStatus `json:"status"`
	CreatedAt   time.Time        `json:"created_at"`
	UpdatedAt   time.Time        `json:"updated_at"`
}

type Message struct {
	ID         string    `json:"id"`
	SenderID   string    `json:"sender_id"`
	ReceiverID string    `json:"receiver_id"`
	Body       string    `json:"body"`
	IsRead     bool      `json:"is_read"`
	CreatedAt  time.Time `json:"created_at"`
}

type Book struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Author      string    `json:"author"`
	UploadedBy  string    `json:"uploaded_by"`
	FileURL     string    `json:"file_url"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type FluencyTier string

const (
	FluencyBeginner     FluencyTier = "beginner"
	FluencyIntermediate FluencyTier = "intermediate"
	FluencyAdvanced     FluencyTier = "advanced"
)

type LearningProfile struct {
	UserID          string      `json:"user_id"`
	CompletedTracks []string    `json:"completed_tracks"`
	XPPoints        int         `json:"xp_points"`
	FluencyTier     FluencyTier `json:"fluency_tier"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
}

type LearningTrack struct {
	ID          string `json:"id"`
	Step        int    `json:"step"`
	Title       string `json:"title"`
	Description string `json:"description"`
	XPReward    int    `json:"xp_reward"`
	Category    string `json:"category"`
	Status      string `json:"status"` // completed, active, locked
}

// Fixed curriculum tracks with strict linear progression
var CurriculumTracks = []LearningTrack{
	{
		ID:          "track_1_greetings",
		Step:        1,
		Title:       "1. Daily Greetings",
		Description: "Learn traditional morning, noon, and evening salutations in Idoma.",
		XPReward:    200,
		Category:    "Beginner Foundation",
	},
	{
		ID:          "track_2_numbers",
		Step:        2,
		Title:       "2. Numerical Quantifiers",
		Description: "Master counting, trade numbers, and cardinal quantities.",
		XPReward:    250,
		Category:    "Core Vocabulary",
	},
	{
		ID:          "track_3_idioms",
		Step:        3,
		Title:       "3. Proverbial Idioms",
		Description: "Explore classical Idoma proverbs, figurative sayings, and ancestral wisdom.",
		XPReward:    300,
		Category:    "Intermediate Fluency",
	},
	{
		ID:          "track_4_folktales",
		Step:        4,
		Title:       "4. Cultural Folktales & Ancestry",
		Description: "Immerse in ancient narrative lore and oral historical heritage of the Alekwu.",
		XPReward:    350,
		Category:    "Advanced Mastery",
	},
}

func initDB(dbPath string) (*sql.DB, error) {
	if dbPath == "" {
		dbPath = "idlang.db"
	}

	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if dir != "" && dir != "." {
		os.MkdirAll(dir, 0755)
	}

	database, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool and SQLite pragmas for single-writer safety & foreign key enforcement
	database.SetMaxOpenConns(1)
	if _, err := database.Exec(`
		PRAGMA foreign_keys = ON;
		PRAGMA busy_timeout = 5000;
	`); err != nil {
		log.Printf("Warning: failed to apply SQLite pragmas: %v", err)
	}

	if err := runMigrations(database); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	if err := seedBaselineData(database); err != nil {
		log.Printf("Warning: baseline data seeding error: %v", err)
	}

	return database, nil
}

func runMigrations(db *sql.DB) error {
	schema := `
	-- Users Table
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		display_name TEXT NOT NULL,
		avatar_url TEXT DEFAULT '',
		bio TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Posts Table
	CREATE TABLE IF NOT EXISTS posts (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		content TEXT NOT NULL,
		media_type TEXT NOT NULL CHECK(media_type IN ('text', 'image', 'audio', 'video')),
		media_url TEXT NOT NULL DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY(user_id) REFERENCES users(id)
	);
	CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);

	-- Connections Table
	CREATE TABLE IF NOT EXISTS connections (
		id TEXT PRIMARY KEY,
		requester_id TEXT NOT NULL,
		receiver_id TEXT NOT NULL,
		status TEXT NOT NULL CHECK(status IN ('pending', 'connected', 'blocked')),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(requester_id, receiver_id),
		FOREIGN KEY(requester_id) REFERENCES users(id),
		FOREIGN KEY(receiver_id) REFERENCES users(id)
	);
	CREATE INDEX IF NOT EXISTS idx_connections_users ON connections(requester_id, receiver_id);
	CREATE INDEX IF NOT EXISTS idx_connections_receiver ON connections(receiver_id, status);

	-- Messages Table
	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		sender_id TEXT NOT NULL,
		receiver_id TEXT NOT NULL,
		body TEXT NOT NULL,
		is_read BOOLEAN NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY(sender_id) REFERENCES users(id),
		FOREIGN KEY(receiver_id) REFERENCES users(id)
	);
	CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender_id, receiver_id, created_at);
	CREATE INDEX IF NOT EXISTS idx_messages_receiver_read ON messages(receiver_id, is_read);

	-- Books Table (E-Library)
	CREATE TABLE IF NOT EXISTS books (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		author TEXT NOT NULL,
		uploaded_by TEXT NOT NULL,
		file_url TEXT NOT NULL,
		description TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_books_created_at ON books(created_at DESC);

	-- Learning Profiles Table
	CREATE TABLE IF NOT EXISTS learning_profiles (
		user_id TEXT PRIMARY KEY,
		completed_tracks TEXT NOT NULL DEFAULT '[]',
		xp_points INTEGER NOT NULL DEFAULT 0,
		fluency_tier TEXT NOT NULL DEFAULT 'beginner' CHECK(fluency_tier IN ('beginner', 'intermediate', 'advanced')),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY(user_id) REFERENCES users(id)
	);
	`

	_, err := db.Exec(schema)
	return err
}

func seedBaselineData(db *sql.DB) error {
	// Seed demo users if not present
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil || count > 0 {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	users := []User{
		{
			ID:          "user_oche",
			Username:    "oche",
			DisplayName: "Oche Adole",
			AvatarURL:   "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150",
			Bio:         "Native Idoma linguist and custodian of Otukpo ancestral traditions.",
		},
		{
			ID:          "user_ada",
			Username:    "ada",
			DisplayName: "Ada Owoicho",
			AvatarURL:   "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
			Bio:         "Passionate about digitizing Idoma folklore, music, and oral dialects.",
		},
		{
			ID:          "user_idoko",
			Username:    "idoko",
			DisplayName: "Idoko Ejembi",
			AvatarURL:   "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150",
			Bio:         "Language learner tracking my path to intermediate Idoma speaker status.",
		},
	}

	for _, u := range users {
		_, err := tx.Exec(`
			INSERT INTO users (id, username, display_name, avatar_url, bio)
			VALUES (?, ?, ?, ?, ?)
		`, u.ID, u.Username, u.DisplayName, u.AvatarURL, u.Bio)
		if err != nil {
			return err
		}

		// Initial learning profiles
		var initialXP int
		var completed []string
		var tier FluencyTier = FluencyBeginner

		if u.ID == "user_oche" {
			initialXP = 950
			completed = []string{"track_1_greetings", "track_2_numbers", "track_3_idioms"}
			tier = FluencyAdvanced
		} else if u.ID == "user_ada" {
			initialXP = 520
			completed = []string{"track_1_greetings", "track_2_numbers"}
			tier = FluencyIntermediate
		} else {
			initialXP = 200
			completed = []string{"track_1_greetings"}
			tier = FluencyBeginner
		}

		tracksJSON, _ := json.Marshal(completed)
		_, err = tx.Exec(`
			INSERT INTO learning_profiles (user_id, completed_tracks, xp_points, fluency_tier)
			VALUES (?, ?, ?, ?)
		`, u.ID, string(tracksJSON), initialXP, string(tier))
		if err != nil {
			return err
		}
	}

	// Baseline seed connection: Oche <-> Ada connected
	_, err = tx.Exec(`
		INSERT INTO connections (id, requester_id, receiver_id, status)
		VALUES (?, ?, ?, ?)
	`, uuid.New().String(), "user_oche", "user_ada", string(ConnectionConnected))
	if err != nil {
		return err
	}

	// Seed connection: Idoko -> Oche is pending
	_, err = tx.Exec(`
		INSERT INTO connections (id, requester_id, receiver_id, status)
		VALUES (?, ?, ?, ?)
	`, uuid.New().String(), "user_idoko", "user_oche", string(ConnectionPending))
	if err != nil {
		return err
	}

	// Baseline seed messages between Oche & Ada
	messages := []struct {
		Sender   string
		Receiver string
		Body     string
		Minutes  int
	}{
		{"user_oche", "user_ada", "Aôlô! Have you recorded the pronunciation for the wedding proverbs?", 30},
		{"user_ada", "user_oche", "Ee, Oche. I just uploaded the native audio clip to the cultural feed!", 25},
		{"user_oche", "user_ada", "Nmaochi! The elders will be proud of this work.", 10},
	}
	for _, m := range messages {
		created := time.Now().Add(-time.Duration(m.Minutes) * time.Minute)
		_, err = tx.Exec(`
			INSERT INTO messages (id, sender_id, receiver_id, body, is_read, created_at)
			VALUES (?, ?, ?, ?, 1, ?)
		`, uuid.New().String(), m.Sender, m.Receiver, m.Body, created)
		if err != nil {
			return err
		}
	}

	// Baseline seed posts (including native audio with pronunciation)
	posts := []struct {
		UserID    string
		Content   string
		MediaType string
		MediaURL  string
		Minutes   int
	}{
		{
			UserID:    "user_oche",
			Content:   "Listen to my native pronunciation of the sacred greeting: *'Aôlô l'ohe o!'* (May your dawn bring peace). Tone marking is paramount in our dialect.",
			MediaType: "audio",
			MediaURL:  "https://actions.google.com/sounds/v1/speech/voice_greeting.ogg",
			Minutes:   45,
		},
		{
			UserID:    "user_ada",
			Content:   "Traditional Idoma textiles: The **Apa** (black and red fabric) symbolizes the strength and warrior history of our forebears. Black represents sovereignty, Red represents the vital spirit.",
			MediaType: "image",
			MediaURL:  "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=800",
			Minutes:   120,
		},
		{
			UserID:    "user_idoko",
			Content:   "Just crossed 200 XP on the Daily Greetings module! *'Ékwù n'wà guide our path'*. The audio repetition exercises make tone variations so much clearer.",
			MediaType: "text",
			MediaURL:  "",
			Minutes:   180,
		},
	}
	for _, p := range posts {
		created := time.Now().Add(-time.Duration(p.Minutes) * time.Minute)
		_, err = tx.Exec(`
			INSERT INTO posts (id, user_id, content, media_type, media_url, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, uuid.New().String(), p.UserID, p.Content, p.MediaType, p.MediaURL, created)
		if err != nil {
			return err
		}
	}

	// Baseline seed books in the E-Library
	books := []Book{
		{
			ID:          uuid.New().String(),
			Title:       "Idoma Grammar and Orthography Standard Guide",
			Author:      "Prof. E. O. Armstrong & Benue Language Committee",
			UploadedBy:  "user_oche",
			FileURL:     "/api/books/sample/idoma_orthography.txt",
			Description: "Comprehensive morphological analysis of Central and Western Idoma phonetics, tones, and noun classes.",
		},
		{
			ID:          uuid.New().String(),
			Title:       "Alekwu Oral Poetry & The Songs of Ancestors",
			Author:      "Elder Ada Agada",
			UploadedBy:  "user_ada",
			FileURL:     "/api/books/sample/alekwu_chants.txt",
			Description: "Transcriptions and English annotations of historical funeral and coronation dirges in Otukpo.",
		},
		{
			ID:          uuid.New().String(),
			Title:       "Proverbs and Idiomatic Sayings of Idomaland",
			Author:      "Idoma Cultural Heritage Foundation",
			UploadedBy:  "user_oche",
			FileURL:     "/api/books/sample/idoma_proverbs.txt",
			Description: "Over 300 proverbial phrases with tonal diacritics, literal translations, and contextual meanings.",
		},
	}
	for _, b := range books {
		_, err = tx.Exec(`
			INSERT INTO books (id, title, author, uploaded_by, file_url, description)
			VALUES (?, ?, ?, ?, ?, ?)
		`, b.ID, b.Title, b.Author, b.UploadedBy, b.FileURL, b.Description)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

// parseDBTime safely parses database timestamps across SQLite and RFC3339 formats
func parseDBTime(str string) time.Time {
	if str == "" {
		return time.Now()
	}
	formats := []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02 15:04:05",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02T15:04:05",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, str); err == nil {
			return t
		}
	}
	return time.Now()
}

// Helper query functions
func getUserByID(userID string) (*User, error) {
	var u User
	var createdAtStr string
	err := db.QueryRow(`
		SELECT id, username, display_name, avatar_url, bio, created_at
		FROM users WHERE id = ?
	`, userID).Scan(&u.ID, &u.Username, &u.DisplayName, &u.AvatarURL, &u.Bio, &createdAtStr)
	if err != nil {
		return nil, err
	}
	u.CreatedAt = parseDBTime(createdAtStr)
	return &u, nil
}

func getLearningProfile(userID string) (*LearningProfile, error) {
	var p LearningProfile
	var tracksJSON string
	var tierStr string
	var createdStr, updatedStr string

	err := db.QueryRow(`
		SELECT user_id, completed_tracks, xp_points, fluency_tier, created_at, updated_at
		FROM learning_profiles WHERE user_id = ?
	`, userID).Scan(&p.UserID, &tracksJSON, &p.XPPoints, &tierStr, &createdStr, &updatedStr)
	if err == sql.ErrNoRows {
		// Create default profile
		p = LearningProfile{
			UserID:          userID,
			CompletedTracks: []string{},
			XPPoints:        0,
			FluencyTier:     FluencyBeginner,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		}
		emptyJSON := "[]"
		_, _ = db.Exec(`
			INSERT INTO learning_profiles (user_id, completed_tracks, xp_points, fluency_tier)
			VALUES (?, ?, ?, ?)
		`, userID, emptyJSON, 0, string(FluencyBeginner))
		return &p, nil
	} else if err != nil {
		return nil, err
	}

	json.Unmarshal([]byte(tracksJSON), &p.CompletedTracks)
	p.FluencyTier = FluencyTier(tierStr)
	p.CreatedAt = parseDBTime(createdStr)
	p.UpdatedAt = parseDBTime(updatedStr)
	return &p, nil
}

func calculateFluencyTier(xp int) FluencyTier {
	if xp >= 800 {
		return FluencyAdvanced
	} else if xp >= 400 {
		return FluencyIntermediate
	}
	return FluencyBeginner
}

func areUsersConnected(userA, userB string) (bool, error) {
	if userA == "" || userB == "" || userA == userB {
		return false, nil
	}
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM connections
		WHERE ((requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?))
		AND status = 'connected'
	`, userA, userB, userB, userA).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func getConnectionStatus(viewerID, targetID string) (status string, direction string, err error) {
	if viewerID == "" || targetID == "" || viewerID == targetID {
		return "none", "", nil
	}
	var requesterID, receiverID, rawStatus string
	err = db.QueryRow(`
		SELECT requester_id, receiver_id, status FROM connections
		WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)
	`, viewerID, targetID, targetID, viewerID).Scan(&requesterID, &receiverID, &rawStatus)
	if err == sql.ErrNoRows {
		return "none", "", nil
	} else if err != nil {
		return "none", "", err
	}

	if rawStatus == string(ConnectionConnected) {
		return "connected", "mutual", nil
	}
	if requesterID == viewerID {
		return rawStatus, "outgoing", nil
	}
	return rawStatus, "incoming", nil
}
