package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var db *sql.DB

// demoMode gates seeded users, posts and direct messages. Sample library items
// are always seeded because an empty archive looks like a broken archive, but
// they are explicitly labelled as samples.
var demoMode = envBool("DEMO_MODE", false)

// Models
type User struct {
	ID            string    `json:"id"`
	Username      string    `json:"username"`
	DisplayName   string    `json:"display_name"`
	NativeName    string    `json:"native_name,omitempty"`
	AvatarURL     string    `json:"avatar_url"`
	Bio           string    `json:"bio"`
	Dialect       string    `json:"dialect,omitempty"`
	Region        string    `json:"region,omitempty"`
	NativeSpeaker bool      `json:"native_speaker"`
	Role          string    `json:"role,omitempty"`
	CreatedAt     time.Time `json:"created_at"`

	// Never serialised by accident.
	Email        string    `json:"-"`
	PasswordHash string    `json:"-"`
	Status       string    `json:"-"`
	UpdatedAt    time.Time `json:"-"`

	// Privacy preferences. Safe to expose; they only describe the owner's rules.
	DMPolicy   string `json:"dm_policy,omitempty"`
	Visibility string `json:"visibility,omitempty"`
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

// LibraryItem is a curated archive record. It replaces the old `books` table;
// migration 3 renames the table and adds the provenance columns a heritage
// archive actually needs.
type LibraryItem struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Author      string    `json:"author"`
	UploadedBy  string    `json:"uploaded_by"`
	Description string    `json:"description"`
	Kind        string    `json:"kind"` // book, manuscript, audio, dictionary, lesson
	Language    string    `json:"language"`
	Dialect     string    `json:"dialect,omitempty"`
	License     string    `json:"license"`
	SourceURL   string    `json:"source_url,omitempty"`
	ConsentNote string    `json:"consent_note,omitempty"`
	Mime        string    `json:"mime"`
	SizeBytes   int64     `json:"size_bytes"`
	FileURL     string    `json:"file_url,omitempty"`
	Status      string    `json:"status"` // draft, published, rejected, removed
	HasFile     bool      `json:"has_file"`
	ContentText string    `json:"content_text,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
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

// --- Migrations -------------------------------------------------------------
//
// Migrations are versioned with `PRAGMA user_version` and applied in order.
// The first migration is the original schema and is idempotent, so databases
// created before versioning existed (user_version = 0) upgrade cleanly.
// ALTERs go through addColumnIfMissing so a half-applied migration can be
// retried without manual repair.

func initDB(dbPath string) (*sql.DB, error) {
	if dbPath == "" {
		dbPath = "idlang.db"
	}

	dir := filepath.Dir(dbPath)
	if dir != "" && dir != "." {
		os.MkdirAll(dir, 0755)
	}

	database, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Single writer: SQLite serialises writes anyway, and this keeps the
	// in-process connection from fighting itself under the FastAPI-style
	// threadpool that net/http gives us.
	database.SetMaxOpenConns(1)
	if _, err := database.Exec(`
		PRAGMA foreign_keys = ON;
		PRAGMA busy_timeout = 5000;
		PRAGMA journal_mode = WAL;
	`); err != nil {
		log.Printf("Warning: failed to apply SQLite pragmas: %v", err)
	}

	if err := initializeSchema(database); err != nil {
		database.Close()
		return nil, err
	}
	return database, nil
}

func initializeSchema(database *sql.DB) error {
	return initializeSchemaWithLedger(database, false)
}

func initializeSchemaWithLedger(database *sql.DB, remote bool) error {
	if err := runMigrationsWithLedger(database, remote); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}
	if err := seedBaselineData(database); err != nil {
		return fmt.Errorf("failed to seed database: %w", err)
	}
	return nil
}

type migrationFunc func(*sql.DB) error

var migrations = []migrationFunc{
	baselineSchema,     // v1 — original tables
	migrateAuth,        // v2 — accounts, sessions, profile fields
	migrateLibrary,     // v3 — books -> library_items with provenance
	migrateConnections, // v4 — canonical pair key, one row per pair
	migrateNativeName,  // v5 — native name for user cultural identity
	migrateGuestTrials, // v6 — shared guest translation allowance
}

func runMigrations(database *sql.DB) error {
	return runMigrationsWithLedger(database, false)
}

// Track remote upgrades without writing PRAGMA user_version. Read the legacy value
// for imported databases, then record remote upgrades in an ordinary SQL table.
func runMigrationsWithLedger(database *sql.DB, remote bool) error {
	var version int
	if err := database.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}

	if remote {
		if _, err := database.Exec("CREATE TABLE IF NOT EXISTS idlang_schema_migrations (version INTEGER PRIMARY KEY)"); err != nil {
			return fmt.Errorf("create migration ledger: %w", err)
		}
		var ledgerVersion int
		if err := database.QueryRow("SELECT COALESCE(MAX(version), 0) FROM idlang_schema_migrations").Scan(&ledgerVersion); err != nil {
			return fmt.Errorf("read migration ledger: %w", err)
		}
		if ledgerVersion > version {
			version = ledgerVersion
		}
	}
	if version > len(migrations) {
		return fmt.Errorf("database schema is newer than this application")
	}
	for i := version; i < len(migrations); i++ {
		if err := migrations[i](database); err != nil {
			return fmt.Errorf("migration %d: %w", i+1, err)
		}
		var err error
		if remote {
			_, err = database.Exec("INSERT INTO idlang_schema_migrations (version) VALUES (?) ON CONFLICT(version) DO NOTHING", i+1)
		} else {
			_, err = database.Exec(fmt.Sprintf("PRAGMA user_version = %d", i+1))
		}
		if err != nil {
			return fmt.Errorf("set user_version %d: %w", i+1, err)
		}
		log.Printf("Applied migration %d", i+1)
	}
	return nil
}

const baselineSQL = `
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		display_name TEXT NOT NULL,
		native_name TEXT DEFAULT '',
		avatar_url TEXT DEFAULT '',
		bio TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

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

func baselineSchema(database *sql.DB) error {
	_, err := database.Exec(baselineSQL)
	return err
}

func migrateAuth(database *sql.DB) error {
	columns := []struct{ name, ddl string }{
		{"email", "ALTER TABLE users ADD COLUMN email TEXT"},
		{"password_hash", "ALTER TABLE users ADD COLUMN password_hash TEXT"},
		{"email_verified_at", "ALTER TABLE users ADD COLUMN email_verified_at DATETIME"},
		{"role", "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'"},
		{"status", "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"},
		{"native_speaker", "ALTER TABLE users ADD COLUMN native_speaker INTEGER NOT NULL DEFAULT 0"},
		{"dialect", "ALTER TABLE users ADD COLUMN dialect TEXT NOT NULL DEFAULT ''"},
		{"region", "ALTER TABLE users ADD COLUMN region TEXT NOT NULL DEFAULT ''"},
		{"dm_policy", "ALTER TABLE users ADD COLUMN dm_policy TEXT NOT NULL DEFAULT 'connections'"},
		{"visibility", "ALTER TABLE users ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'"},
		{"updated_at", "ALTER TABLE users ADD COLUMN updated_at DATETIME"},
	}
	for _, c := range columns {
		if err := addColumnIfMissing(database, "users", c.name, c.ddl); err != nil {
			return err
		}
	}

	if _, err := database.Exec(`UPDATE users SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL`); err != nil {
		return err
	}

	_, err := database.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase
			ON users(lower(email))
			WHERE email IS NOT NULL AND status != 'deleted';
		CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase
			ON users(username COLLATE NOCASE);

		CREATE TABLE IF NOT EXISTS sessions (
			token_hash   TEXT PRIMARY KEY,
			user_id      TEXT NOT NULL,
			created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			expires_at   DATETIME NOT NULL,
			ip           TEXT NOT NULL DEFAULT '',
			user_agent   TEXT NOT NULL DEFAULT '',
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
		CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
	`)
	return err
}

func migrateLibrary(database *sql.DB) error {
	var hasBooks, hasLibrary int
	if err := database.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='books'`).Scan(&hasBooks); err != nil {
		return err
	}
	if err := database.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='library_items'`).Scan(&hasLibrary); err != nil {
		return err
	}

	if hasBooks > 0 && hasLibrary == 0 {
		if _, err := database.Exec(`ALTER TABLE books RENAME TO library_items`); err != nil {
			return err
		}
	} else {
		// Fresh installs that already have the renamed table, or a retry.
		if _, err := database.Exec(`
			CREATE TABLE IF NOT EXISTS library_items (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				author TEXT NOT NULL,
				uploaded_by TEXT NOT NULL,
				file_url TEXT NOT NULL DEFAULT '',
				description TEXT DEFAULT '',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)`); err != nil {
			return err
		}
	}

	columns := []struct{ name, ddl string }{
		{"kind", "ALTER TABLE library_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'book'"},
		{"language", "ALTER TABLE library_items ADD COLUMN language TEXT NOT NULL DEFAULT 'idoma'"},
		{"dialect", "ALTER TABLE library_items ADD COLUMN dialect TEXT NOT NULL DEFAULT ''"},
		{"license", "ALTER TABLE library_items ADD COLUMN license TEXT NOT NULL DEFAULT 'all-rights-reserved'"},
		{"source_url", "ALTER TABLE library_items ADD COLUMN source_url TEXT NOT NULL DEFAULT ''"},
		{"consent_note", "ALTER TABLE library_items ADD COLUMN consent_note TEXT NOT NULL DEFAULT ''"},
		{"file_key", "ALTER TABLE library_items ADD COLUMN file_key TEXT NOT NULL DEFAULT ''"},
		{"mime", "ALTER TABLE library_items ADD COLUMN mime TEXT NOT NULL DEFAULT ''"},
		{"size_bytes", "ALTER TABLE library_items ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0"},
		{"sha256", "ALTER TABLE library_items ADD COLUMN sha256 TEXT NOT NULL DEFAULT ''"},
		{"content_text", "ALTER TABLE library_items ADD COLUMN content_text TEXT NOT NULL DEFAULT ''"},
		{"status", "ALTER TABLE library_items ADD COLUMN status TEXT NOT NULL DEFAULT 'published'"},
		{"reviewed_by", "ALTER TABLE library_items ADD COLUMN reviewed_by TEXT REFERENCES users(id)"},
		{"updated_at", "ALTER TABLE library_items ADD COLUMN updated_at DATETIME"},
	}
	for _, c := range columns {
		if err := addColumnIfMissing(database, "library_items", c.name, c.ddl); err != nil {
			return err
		}
	}

	if _, err := database.Exec(`UPDATE library_items SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL`); err != nil {
		return err
	}

	if _, err := database.Exec(`
		CREATE INDEX IF NOT EXISTS idx_library_status ON library_items(status, created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_library_uploader ON library_items(uploaded_by);
	`); err != nil {
		return err
	}

	// FTS5 keeps diacritics (remove_diacritics 0) so tone marks stay
	// searchable. If the SQLite build lacks FTS5 we degrade to LIKE queries.
	if ftsEnabled, err := initLibraryFTS(database); err != nil {
		return err
	} else if ftsEnabled {
		log.Printf("Library full-text search: FTS5 enabled")
	} else {
		log.Printf("Library full-text search: FTS5 unavailable, using LIKE fallback")
	}

	return nil
}

// migrateConnections adds a canonical, order-independent pair key so a pair of
// users can only ever have one connection row. Before this, `UNIQUE(requester,
// receiver)` allowed A->B and B->A to coexist and `getConnectionStatus` picked
// whichever the planner returned first.
func migrateConnections(database *sql.DB) error {
	if err := addColumnIfMissing(database, "connections", "pair_key",
		"ALTER TABLE connections ADD COLUMN pair_key TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}

	if _, err := database.Exec(`
		UPDATE connections
		SET pair_key = CASE WHEN requester_id < receiver_id
			THEN requester_id || '|' || receiver_id
			ELSE receiver_id || '|' || requester_id END
		WHERE pair_key = ''
	`); err != nil {
		return err
	}

	// Collapse duplicates, keeping the strongest relationship: connected beats
	// blocked beats pending, then most recently updated.
	if _, err := database.Exec(`
		DELETE FROM connections WHERE rowid NOT IN (
			SELECT rowid FROM (
				SELECT rowid, ROW_NUMBER() OVER (
					PARTITION BY pair_key
					ORDER BY CASE status
						WHEN 'connected' THEN 0
						WHEN 'blocked' THEN 1
						ELSE 2 END,
						updated_at DESC
				) AS rn
				FROM connections
			) WHERE rn = 1
		)
	`); err != nil {
		return err
	}

	_, err := database.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_pair ON connections(pair_key)`)
	return err
}

func migrateNativeName(database *sql.DB) error {
	return addColumnIfMissing(database, "users", "native_name",
		"ALTER TABLE users ADD COLUMN native_name TEXT NOT NULL DEFAULT ''")
}

// addColumnIfMissing makes ALTER TABLE retry-safe.
func addColumnIfMissing(database *sql.DB, table, column, ddl string) error {
	rows, err := database.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return err
	}

	found := false
	for rows.Next() {
		var (
			cid     int
			name    string
			ctype   string
			notnull int
			dflt    sql.NullString
			pk      int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			rows.Close()
			return err
		}
		if name == column {
			found = true
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	// Close before Exec: the pool is capped at one connection, so an open
	// Rows would deadlock the ALTER.
	rows.Close()

	if found {
		return nil
	}
	_, err = database.Exec(ddl)
	return err
}

// --- Seeding ----------------------------------------------------------------

func seedBaselineData(database *sql.DB) error {
	if demoMode {
		if err := seedDemoSocial(database); err != nil {
			return err
		}
	}
	return seedSampleLibrary(database)
}

// seedDemoSocial is the old baseline data, now strictly opt-in via DEMO_MODE.
func seedDemoSocial(database *sql.DB) error {
	var count int
	if err := database.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	users := []struct {
		User
		XP     int
		Tracks []string
		Tier   FluencyTier
	}{
		{
			User: User{
				ID: "user_oche", Username: "oche", DisplayName: "Oche Adole",
				NativeName: "Onyilo",
				AvatarURL:  "", Bio: "Native Idoma linguist and custodian of Otukpo ancestral traditions.",
				Dialect: "Otukpo", NativeSpeaker: true,
			},
			XP: 950, Tracks: []string{"track_1_greetings", "track_2_numbers", "track_3_idioms"}, Tier: FluencyAdvanced,
		},
		{
			User: User{
				ID: "user_ada", Username: "ada", DisplayName: "Ada Owoicho",
				NativeName: "Onyeche",
				Bio:        "Passionate about digitizing Idoma folklore, music, and oral dialects.",
				Dialect:    "Otukpo", NativeSpeaker: true,
			},
			XP: 520, Tracks: []string{"track_1_greetings", "track_2_numbers"}, Tier: FluencyIntermediate,
		},
		{
			User: User{
				ID: "user_idoko", Username: "idoko", DisplayName: "Idoko Ejembi",
				NativeName: "Agbo",
				Bio:        "Language learner tracking my path to intermediate Idoma speaker status.",
			},
			XP: 200, Tracks: []string{"track_1_greetings"}, Tier: FluencyBeginner,
		},
	}

	for _, u := range users {
		if _, err := tx.Exec(`
			INSERT INTO users (id, username, display_name, native_name, avatar_url, bio, dialect, native_speaker)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, u.ID, u.Username, u.DisplayName, u.NativeName, u.AvatarURL, u.Bio, u.Dialect, u.NativeSpeaker); err != nil {
			return err
		}

		tracksJSON, _ := json.Marshal(u.Tracks)
		if _, err := tx.Exec(`
			INSERT INTO learning_profiles (user_id, completed_tracks, xp_points, fluency_tier)
			VALUES (?, ?, ?, ?)
		`, u.ID, string(tracksJSON), u.XP, string(u.Tier)); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(`
		INSERT INTO connections (id, requester_id, receiver_id, status, pair_key)
		VALUES (?, ?, ?, ?, ?)
	`, uuid.New().String(), "user_oche", "user_ada", string(ConnectionConnected), pairKey("user_oche", "user_ada")); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO connections (id, requester_id, receiver_id, status, pair_key)
		VALUES (?, ?, ?, ?, ?)
	`, uuid.New().String(), "user_idoko", "user_oche", string(ConnectionPending), pairKey("user_idoko", "user_oche")); err != nil {
		return err
	}

	messages := []struct {
		Sender, Receiver, Body string
		Minutes                int
	}{
		{"user_oche", "user_ada", "Aôlô! Have you recorded the pronunciation for the wedding proverbs?", 30},
		{"user_ada", "user_oche", "Ee, Oche. I just uploaded the native audio clip to the cultural feed!", 25},
		{"user_oche", "user_ada", "Nmaochi! The elders will be proud of this work.", 10},
	}
	for _, m := range messages {
		if _, err := tx.Exec(`
			INSERT INTO messages (id, sender_id, receiver_id, body, is_read, created_at)
			VALUES (?, ?, ?, ?, 1, ?)
		`, uuid.New().String(), m.Sender, m.Receiver, m.Body,
			time.Now().Add(-time.Duration(m.Minutes)*time.Minute)); err != nil {
			return err
		}
	}

	posts := []struct {
		UserID, Content, MediaType, MediaURL string
		Minutes                              int
	}{
		{
			"user_oche",
			"Tone marking is not decoration in Idoma: it is meaning. Compare *ikpéyí* (head) with *éyì* (face).",
			"text", "", 45,
		},
		{
			"user_ada",
			"Counting practice with the dictionary: *òyé* (one), *èpà* (two), *ɛ́mā* (three). Say them aloud, tone first.",
			"text", "", 120,
		},
		{
			"user_idoko",
			"Just crossed 200 XP on the Daily Greetings module. The audio repetition exercises make tone variations much clearer.",
			"text", "", 180,
		},
	}
	for _, p := range posts {
		if _, err := tx.Exec(`
			INSERT INTO posts (id, user_id, content, media_type, media_url, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, uuid.New().String(), p.UserID, p.Content, p.MediaType, p.MediaURL,
			time.Now().Add(-time.Duration(p.Minutes)*time.Minute)); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// seedSampleLibrary installs three clearly-labelled sample records whose text
// is drawn verbatim from idoma_dictionary_v3.json. Attribution is honest: these
// are samples, not the works of real scholars.
func seedSampleLibrary(database *sql.DB) error {
	var count int
	if err := database.QueryRow("SELECT COUNT(*) FROM library_items").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	// Skip seeding if there is nobody to attribute the upload to and demo mode
	// is off — the FK requires a real uploader.
	var uploader string
	err := database.QueryRow(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`).Scan(&uploader)
	if err != nil {
		return nil
	}

	dir := libraryDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	samples := []struct {
		Title, Description, Body, Kind, License string
	}{
		{
			Title:       "Counting in Idoma: One to Three",
			Description: "Sample record. Short counting drill built from the Idlang dictionary: òyé (one), èpà (two), ɛ́mā (three).",
			Kind:        "lesson",
			License:     "CC-BY-SA-4.0",
			Body: "COUNTING IN IDOMA — SAMPLE RECORD\n\n" +
				"Source: idlang dictionary (idoma_dictionary_v3.json)\n" +
				"License: CC-BY-SA-4.0\n\n" +
				"òyé  — one\n" +
				"èpà  — two\n" +
				"ɛ́mā — three\n\n" +
				"Tone is part of the word, not an accent on top of it. Practise each\n" +
				"form aloud, then count a real object three times: òyé, èpà, ɛ́mā.\n\n" +
				"This is a sample record installed with the application so the archive\n" +
				"is not empty on first run. It is not a scholarly publication.\n",
		},
		{
			Title:       "Everyday Greetings and Courtesies",
			Description: "Sample record. Greetings and courtesy phrases drawn from the Idlang dictionary, with the context each one carries.",
			Kind:        "manuscript",
			License:     "CC-BY-SA-4.0",
			Body: "EVERYDAY GREETINGS — SAMPLE RECORD\n\n" +
				"Source: idlang dictionary (idoma_dictionary_v3.json)\n" +
				"License: CC-BY-SA-4.0\n\n" +
				"A Yo Lohi      — Are you doing well?\n" +
				"Aa Yo Ya Lohi? — Are you doing OK?\n" +
				"A gbe hii      — Are You OK?\n" +
				"Nma            — Sorry\n" +
				"Ebo ko yo      — Let there be peace\n\n" +
				"Greeting is a social act before it is a vocabulary item: the question\n" +
				"expects an answer, and the answer is the point.\n\n" +
				"This is a sample record installed with the application. It is not a\n" +
				"scholarly publication.\n",
		},
		{
			Title:       "Core Nouns: House, Book, Friend, Father, Mother",
			Description: "Sample record. Five high-frequency nouns with their tone patterns, from the Idlang dictionary.",
			Kind:        "book",
			License:     "CC-BY-SA-4.0",
			Body: "CORE NOUNS — SAMPLE RECORD\n\n" +
				"Source: idlang dictionary (idoma_dictionary_v3.json)\n" +
				"License: CC-BY-SA-4.0\n\n" +
				"Olé   — house    (low tone)\n" +
				"ukpá  — book     (high tone)\n" +
				"Òyá   — friend\n" +
				"ádah  — father   (high tone)\n" +
				"ēnē   — mother   (high tone)\n\n" +
				"Note that all five begin with a vowel sound, in line with the initial\n" +
				"vowel rule that governs native Idoma nouns.\n\n" +
				"This is a sample record installed with the application. It is not a\n" +
				"scholarly publication.\n",
		},
	}

	for i, s := range samples {
		id := uuid.New().String()
		key := fmt.Sprintf("sample-%d.txt", i+1)
		body := []byte(s.Body)

		if err := os.WriteFile(filepath.Join(dir, key), body, 0644); err != nil {
			return err
		}

		if _, err := database.Exec(`
			INSERT INTO library_items
				(id, title, author, uploaded_by, file_url, description, kind, language,
				 license, file_key, mime, size_bytes, sha256, content_text, status)
			VALUES (?, ?, ?, ?, '', ?, ?, 'idoma', ?, ?, 'text/plain', ?, ?, ?, 'published')
		`, id, s.Title, "Idlang sample corpus", uploader, s.Description, s.Kind,
			s.License, key, len(body), sha256Hex(body), s.Body); err != nil {
			return err
		}

		if err := indexLibraryItem(database, id, s.Title, "Idlang sample corpus", s.Description, s.Body); err != nil {
			return err
		}
	}

	return nil
}

// --- Helpers ----------------------------------------------------------------

// parseDBTime safely parses database timestamps across SQLite and RFC3339
// formats. It returns the zero time on failure so callers can decide what to
// display instead of silently claiming "now".
func parseDBTime(str string) time.Time {
	if str == "" {
		return time.Time{}
	}
	formats := []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, str); err == nil {
			return t
		}
	}
	return time.Time{}
}

const userColumns = `id, username, display_name, native_name, avatar_url, bio, dialect, region,
	native_speaker, role, dm_policy, visibility, email, password_hash, status,
	created_at, updated_at`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var u User
	var email, passwordHash, createdStr, updatedStr sql.NullString
	err := row.Scan(
		&u.ID, &u.Username, &u.DisplayName, &u.NativeName, &u.AvatarURL, &u.Bio, &u.Dialect, &u.Region,
		&u.NativeSpeaker, &u.Role, &u.DMPolicy, &u.Visibility, &email, &passwordHash,
		&u.Status, &createdStr, &updatedStr,
	)
	if err != nil {
		return nil, err
	}
	u.Email = email.String
	u.PasswordHash = passwordHash.String
	u.CreatedAt = parseDBTime(createdStr.String)
	u.UpdatedAt = parseDBTime(updatedStr.String)
	if u.Visibility == "" {
		u.Visibility = "public"
	}
	if u.DMPolicy == "" {
		u.DMPolicy = "connections"
	}
	if u.Role == "" {
		u.Role = "member"
	}
	return &u, nil
}

func getUserByID(userID string) (*User, error) {
	row := db.QueryRow(`SELECT `+userColumns+` FROM users WHERE id = ?`, userID)
	return scanUser(row)
}

func getUserByEmailOrUsername(identifier string) (*User, error) {
	row := db.QueryRow(`
		SELECT `+userColumns+` FROM users
		WHERE lower(email) = lower(?) OR username = ? COLLATE NOCASE
		LIMIT 1
	`, identifier, identifier)
	return scanUser(row)
}

func getLearningProfile(userID string) (*LearningProfile, error) {
	var p LearningProfile
	var tracksJSON string
	var tierStr string
	var createdStr, updatedStr sql.NullString

	err := db.QueryRow(`
		SELECT user_id, completed_tracks, xp_points, fluency_tier, created_at, updated_at
		FROM learning_profiles WHERE user_id = ?
	`, userID).Scan(&p.UserID, &tracksJSON, &p.XPPoints, &tierStr, &createdStr, &updatedStr)

	if err == sql.ErrNoRows {
		return createLearningProfile(userID)
	} else if err != nil {
		return nil, err
	}

	if err := json.Unmarshal([]byte(tracksJSON), &p.CompletedTracks); err != nil {
		p.CompletedTracks = []string{}
	}
	if p.CompletedTracks == nil {
		p.CompletedTracks = []string{}
	}
	p.FluencyTier = FluencyTier(tierStr)
	p.CreatedAt = parseDBTime(createdStr.String)
	p.UpdatedAt = parseDBTime(updatedStr.String)
	return &p, nil
}

func createLearningProfile(userID string) (*LearningProfile, error) {
	now := time.Now()
	if _, err := db.Exec(`
		INSERT INTO learning_profiles (user_id, completed_tracks, xp_points, fluency_tier)
		VALUES (?, '[]', 0, 'beginner')
		ON CONFLICT(user_id) DO NOTHING
	`, userID); err != nil {
		return nil, err
	}
	return &LearningProfile{
		UserID:          userID,
		CompletedTracks: []string{},
		XPPoints:        0,
		FluencyTier:     FluencyBeginner,
		CreatedAt:       now,
		UpdatedAt:       now,
	}, nil
}

func calculateFluencyTier(xp int) FluencyTier {
	if xp >= 800 {
		return FluencyAdvanced
	}
	if xp >= 400 {
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

func isBlocked(viewerID, targetID string) (bool, error) {
	if viewerID == "" || targetID == "" {
		return false, nil
	}
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM connections
		WHERE status = 'blocked'
		AND ((requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?))
	`, viewerID, targetID, targetID, viewerID).Scan(&count)
	return count > 0, err
}

func getConnectionStatus(viewerID, targetID string) (status string, direction string, err error) {
	if viewerID == "" || targetID == "" || viewerID == targetID {
		return "none", "", nil
	}
	var requesterID, receiverID, rawStatus string
	err = db.QueryRow(`
		SELECT requester_id, receiver_id, status FROM connections
		WHERE (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)
		ORDER BY updated_at DESC
		LIMIT 1
	`, viewerID, targetID, targetID, viewerID).Scan(&requesterID, &receiverID, &rawStatus)
	if err == sql.ErrNoRows {
		return "none", "", nil
	} else if err != nil {
		return "none", "", err
	}

	if rawStatus == string(ConnectionConnected) {
		return "connected", "mutual", nil
	}
	if rawStatus == string(ConnectionBlocked) {
		if requesterID == viewerID {
			return "blocked", "outgoing", nil
		}
		return "blocked", "incoming", nil
	}
	if requesterID == viewerID {
		return rawStatus, "outgoing", nil
	}
	return rawStatus, "incoming", nil
}

// visibleTo reports whether viewer may see the target's profile body.
func visibleTo(target *User, viewerID string) bool {
	if viewerID != "" && viewerID == target.ID {
		return true
	}
	switch target.Visibility {
	case "private":
		return false
	case "connections":
		connected, _ := areUsersConnected(viewerID, target.ID)
		return connected
	default:
		return true
	}
}

func envBool(key string, fallback bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return fallback
}

func migrateGuestTrials(database *sql.DB) error {
	_, err := database.Exec(`CREATE TABLE IF NOT EXISTS guest_translation_trials (
 token_hash TEXT PRIMARY KEY,
 used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`)
	return err
}
