package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	sessionCookieName = "idlang_session"
	sessionTTL        = 30 * 24 * time.Hour
	bcryptCost        = 12
	maxPasswordBytes  = 72 // bcrypt silently truncates beyond this
)

var (
	emailRe    = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)
	usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_]{3,24}$`)
)

// contextKey avoids collisions with other packages' context values.
type contextKey struct{ name string }

var userContextKey = &contextKey{"user"}

// --- Session plumbing -------------------------------------------------------

func issueSession(w http.ResponseWriter, r *http.Request, userID string) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	token := encodeBase64(raw)
	sum := sha256.Sum256([]byte(token))

	expires := time.Now().Add(sessionTTL)
	if _, err := db.Exec(`
		INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
		VALUES (?, ?, ?, ?, ?)
	`, hex.EncodeToString(sum[:]), userID, expires, clientIP(r), truncate(r.UserAgent(), 400)); err != nil {
		return err
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   cookieSecure(r),
		SameSite: cookieSameSite(r),
		Expires:  expires,
		MaxAge:   int(sessionTTL.Seconds()),
	})
	return nil
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   cookieSecure(r),
		SameSite: cookieSameSite(r),
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

// cookieSecure defaults to "true behind TLS", which is what Render gives us via
// X-Forwarded-Proto. INSECURE_COOKIES=true is the local-http escape hatch.
func cookieSecure(r *http.Request) bool {
	if envBool("INSECURE_COOKIES", false) {
		return false
	}
	if r.TLS != nil {
		return true
	}
	proto := r.Header.Get("X-Forwarded-Proto")
	return strings.EqualFold(proto, "https")
}

// cookieSameSite is Lax (same-origin, the Vite proxy and any single-domain
// deploy). A split Vercel + Render deploy needs CROSS_SITE_COOKIES=true, which
// switches to SameSite=None; Secure. CSRF is then handled by the Origin check
// in corsMiddleware.
func cookieSameSite(r *http.Request) http.SameSite {
	if envBool("CROSS_SITE_COOKIES", false) && cookieSecure(r) {
		return http.SameSiteNoneMode
	}
	return http.SameSiteLaxMode
}

func sessionToken(r *http.Request) (string, bool) {
	c, err := r.Cookie(sessionCookieName)
	if err != nil || c.Value == "" {
		return "", false
	}
	return c.Value, true
}

func sessionUser(r *http.Request) *User {
	token, ok := sessionToken(r)
	if !ok {
		return nil
	}
	sum := sha256.Sum256([]byte(token))

	row := db.QueryRow(`
		SELECT s.expires_at, s.last_seen_at,
		       u.id, u.username, u.display_name, u.native_name, u.avatar_url, u.bio, u.dialect, u.region,
		       u.native_speaker, u.role, u.dm_policy, u.visibility, u.email, u.password_hash,
		       u.status, u.created_at, u.updated_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ?
	`, hex.EncodeToString(sum[:]))

	var u User
	var createdStr, updatedStr, emailStr, hashStr, expiresStr, lastSeenStr sql.NullString
	err := row.Scan(
		&expiresStr, &lastSeenStr,
		&u.ID, &u.Username, &u.DisplayName, &u.NativeName, &u.AvatarURL, &u.Bio, &u.Dialect, &u.Region,
		&u.NativeSpeaker, &u.Role, &u.DMPolicy, &u.Visibility, &emailStr, &hashStr,
		&u.Status, &createdStr, &updatedStr,
	)
	if err != nil {
		log.Printf("sessionUser scan failed: %v", err)
		return nil
	}

	expires := parseDBTime(expiresStr.String)
	if expires.IsZero() || !time.Now().Before(expires) {
		db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, hex.EncodeToString(sum[:]))
		return nil
	}
	if u.Status != "" && u.Status != "active" {
		return nil
	}

	u.CreatedAt = parseDBTime(createdStr.String)
	u.UpdatedAt = parseDBTime(updatedStr.String)
	u.Email = emailStr.String
	u.PasswordHash = hashStr.String
	if u.Visibility == "" {
		u.Visibility = "public"
	}
	if u.DMPolicy == "" {
		u.DMPolicy = "connections"
	}
	if u.Role == "" {
		u.Role = "member"
	}

	// Slide last_seen_at at most once an hour so a busy client does not turn
	// every request into a write.
	if lastSeen := parseDBTime(lastSeenStr.String); time.Since(lastSeen) > time.Hour {
		db.Exec(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`, time.Now(), hex.EncodeToString(sum[:]))
	}

	return &u
}

// withUser always attaches the session user (or nil). requireAuth rejects nil.
func withUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if u := sessionUser(r); u != nil {
			r = r.WithContext(context.WithValue(r.Context(), userContextKey, u))
		}
		next(w, r)
	}
}

func currentUser(r *http.Request) *User {
	if u, ok := r.Context().Value(userContextKey).(*User); ok && u != nil {
		return u
	}
	return sessionUser(r)
}

func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return withUser(func(w http.ResponseWriter, r *http.Request) {
		if currentUser(r) == nil {
			writeError(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		next(w, r)
	})
}

func requireRole(role string, next http.HandlerFunc) http.HandlerFunc {
	return requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if !hasRole(currentUser(r), role) {
			writeError(w, http.StatusForbidden, "You do not have permission to do that.")
			return
		}
		next(w, r)
	})
}

func hasRole(u *User, role string) bool {
	if u == nil {
		return false
	}
	if u.Role == "admin" {
		return true
	}
	return u.Role == role
}

// --- Handlers ---------------------------------------------------------------

type credentialsResponse struct {
	User            *User            `json:"user"`
	Email           string           `json:"email"`
	LearningProfile *LearningProfile `json:"learning_profile"`
}

func handleSignup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if !allowRate(w, r, "signup", 5, 10*time.Minute) {
		return
	}

	var req struct {
		Email         string `json:"email"`
		Username      string `json:"username"`
		DisplayName   string `json:"display_name"`
		NativeName    string `json:"native_name"`
		Password      string `json:"password"`
		NativeSpeaker bool   `json:"native_speaker"`
		Dialect       string `json:"dialect"`
	}
	if err := decodeJSON(w, r, &req, 8<<10); err != nil {
		writeError(w, http.StatusBadRequest, "Could not read that request.")
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	username := strings.TrimSpace(req.Username)
	displayName := strings.TrimSpace(req.DisplayName)
	nativeName := strings.TrimSpace(req.NativeName)
	if displayName == "" {
		displayName = username
	}

	switch {
	case !emailRe.MatchString(email):
		writeError(w, http.StatusBadRequest, "Enter a valid email address.")
		return
	case !usernameRe.MatchString(username):
		writeError(w, http.StatusBadRequest, "Username must be 3–24 letters, numbers or underscores.")
		return
	case len([]byte(req.Password)) < 6:
		writeError(w, http.StatusBadRequest, "Password must be at least 6 characters.")
		return
	case len([]byte(req.Password)) > maxPasswordBytes:
		writeError(w, http.StatusBadRequest, "Password must be 72 bytes or fewer.")
		return
	case len(displayName) > 60:
		writeError(w, http.StatusBadRequest, "Display name must be 60 characters or fewer.")
		return
	case len(nativeName) > 60:
		writeError(w, http.StatusBadRequest, "Native name must be 60 characters or fewer.")
		return
	}

	// Generic message: never reveal which of the two collided.
	if _, err := getUserByEmailOrUsername(email); err == nil {
		writeError(w, http.StatusConflict, "That username or email is already in use.")
		return
	} else if err != sql.ErrNoRows {
		writeError(w, http.StatusInternalServerError, "Could not check account availability. Please try again.")
		return
	}
	if _, err := getUserByEmailOrUsername(username); err == nil {
		writeError(w, http.StatusConflict, "That username or email is already in use.")
		return
	} else if err != sql.ErrNoRows {
		writeError(w, http.StatusInternalServerError, "Could not check account availability. Please try again.")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not create the account.")
		return
	}

	u := &User{
		ID:            uuid.New().String(),
		Username:      username,
		DisplayName:   displayName,
		NativeName:    nativeName,
		Email:         email,
		PasswordHash:  string(hash),
		Role:          "member",
		Status:        "active",
		NativeSpeaker: req.NativeSpeaker,
		Dialect:       truncate(strings.TrimSpace(req.Dialect), 40),
		Visibility:    "public",
		DMPolicy:      "connections",
		CreatedAt:     time.Now(),
	}

	if _, err := db.Exec(`
		INSERT INTO users (id, username, display_name, native_name, email, password_hash, role, status,
		                   native_speaker, dialect, visibility, dm_policy)
		VALUES (?, ?, ?, ?, ?, ?, 'member', 'active', ?, ?, 'public', 'connections')
	`, u.ID, u.Username, u.DisplayName, u.NativeName, u.Email, u.PasswordHash, u.NativeSpeaker, u.Dialect); err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "That username or email is already in use.")
			return
		}
		log.Printf("signup insert failed: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not create the account.")
		return
	}

	profile, err := createLearningProfile(u.ID)
	if err != nil {
		log.Printf("signup profile failed: %v", err)
		profile = &LearningProfile{UserID: u.ID, CompletedTracks: []string{}, FluencyTier: FluencyBeginner}
	}

	if err := issueSession(w, r, u.ID); err != nil {
		log.Printf("signup session failed: %v", err)
		writeError(w, http.StatusInternalServerError, "Account created but sign-in failed. Try logging in.")
		return
	}

	writeJSON(w, http.StatusCreated, credentialsResponse{User: u, Email: u.Email, LearningProfile: profile})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if !allowRate(w, r, "login", 10, 15*time.Minute) {
		return
	}

	var req struct {
		Identifier string `json:"identifier"`
		Password   string `json:"password"`
	}
	if err := decodeJSON(w, r, &req, 8<<10); err != nil {
		writeError(w, http.StatusBadRequest, "Could not read that request.")
		return
	}

	identifier := strings.TrimSpace(req.Identifier)
	if identifier == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "Enter your email or username and password.")
		return
	}
	if !allowRate(w, r, "login:"+strings.ToLower(identifier), 5, 15*time.Minute) {
		return
	}

	u, err := getUserByEmailOrUsername(identifier)
	if err != nil {
		if err != sql.ErrNoRows {
			writeError(w, http.StatusInternalServerError, "Sign-in service is unavailable. Please try again.")
			return
		}
		// Equalise timing so a missing account is not distinguishable by brute timing
		bcrypt.CompareHashAndPassword([]byte("$2a$12$abcdefghijklmnopqrstuuJ0Y1r5M5wC0M3z3z3z3z3z3z3z3z3z"), []byte(req.Password))
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": "Account does not exist. Please create an account first.",
			"code":  "USER_NOT_FOUND",
		})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "Incorrect password. Please verify your password.",
			"code":  "INVALID_PASSWORD",
		})
		return
	}

	if u.Status != "" && u.Status != "active" {
		writeError(w, http.StatusForbidden, "This account is not available.")
		return
	}

	// Opportunistic cleanup; cheap and keeps the table from growing forever.
	db.Exec(`DELETE FROM sessions WHERE expires_at <= ?`, time.Now())

	if err := issueSession(w, r, u.ID); err != nil {
		log.Printf("login session failed: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not start a session.")
		return
	}

	profile, _ := getLearningProfile(u.ID)
	writeJSON(w, http.StatusOK, credentialsResponse{User: u, Email: u.Email, LearningProfile: profile})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if token, ok := sessionToken(r); ok {
		sum := sha256.Sum256([]byte(token))
		if _, err := db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, hex.EncodeToString(sum[:])); err != nil {
			writeError(w, http.StatusInternalServerError, "Could not sign out. Please try again.")
			return
		}
	}
	clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	u := currentUser(r)
	if u == nil {
		writeJSON(w, http.StatusOK, map[string]any{"user": nil})
		return
	}
	profile, err := getLearningProfile(u.ID)
	if err != nil {
		profile = &LearningProfile{UserID: u.ID, CompletedTracks: []string{}, FluencyTier: FluencyBeginner}
	}
	writeJSON(w, http.StatusOK, credentialsResponse{User: u, Email: u.Email, LearningProfile: profile})
}

func handleChangePassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	u := currentUser(r)
	if u == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to continue.")
		return
	}
	if !allowRate(w, r, "password:"+u.ID, 5, 15*time.Minute) {
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := decodeJSON(w, r, &req, 8<<10); err != nil {
		writeError(w, http.StatusBadRequest, "Could not read that request.")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		writeError(w, http.StatusForbidden, "Current password is incorrect.")
		return
	}
	if len([]byte(req.NewPassword)) < 12 || len([]byte(req.NewPassword)) > maxPasswordBytes {
		writeError(w, http.StatusBadRequest, "New password must be between 12 and 72 characters.")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcryptCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not update the password.")
		return
	}
	if _, err := db.Exec(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
		string(hash), time.Now(), u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not update the password.")
		return
	}

	// Sign out every other device; keep the current session.
	if token, ok := sessionToken(r); ok {
		sum := sha256.Sum256([]byte(token))
		db.Exec(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`,
			u.ID, hex.EncodeToString(sum[:]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- Profile + directory ----------------------------------------------------

func handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch && r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPatch)
		return
	}
	u := currentUser(r)
	if u == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	var req struct {
		DisplayName   *string `json:"display_name"`
		NativeName    *string `json:"native_name"`
		Bio           *string `json:"bio"`
		Dialect       *string `json:"dialect"`
		Region        *string `json:"region"`
		NativeSpeaker *bool   `json:"native_speaker"`
		DMPolicy      *string `json:"dm_policy"`
		Visibility    *string `json:"visibility"`
	}
	if err := decodeJSON(w, r, &req, 16<<10); err != nil {
		writeError(w, http.StatusBadRequest, "Could not read that request.")
		return
	}

	if req.DisplayName != nil {
		name := strings.TrimSpace(*req.DisplayName)
		if name == "" || len(name) > 60 {
			writeError(w, http.StatusBadRequest, "Display name must be 1–60 characters.")
			return
		}
		u.DisplayName = name
	}
	if req.NativeName != nil {
		u.NativeName = truncate(strings.TrimSpace(*req.NativeName), 60)
	}
	if req.Bio != nil {
		bio := strings.TrimSpace(*req.Bio)
		if len(bio) > 500 {
			writeError(w, http.StatusBadRequest, "Bio must be 500 characters or fewer.")
			return
		}
		u.Bio = bio
	}
	if req.Dialect != nil {
		u.Dialect = truncate(strings.TrimSpace(*req.Dialect), 40)
	}
	if req.Region != nil {
		u.Region = truncate(strings.TrimSpace(*req.Region), 60)
	}
	if req.NativeSpeaker != nil {
		u.NativeSpeaker = *req.NativeSpeaker
	}
	if req.DMPolicy != nil {
		if *req.DMPolicy != "connections" && *req.DMPolicy != "nobody" {
			writeError(w, http.StatusBadRequest, "dm_policy must be 'connections' or 'nobody'.")
			return
		}
		u.DMPolicy = *req.DMPolicy
	}
	if req.Visibility != nil {
		switch *req.Visibility {
		case "public", "connections", "private":
			u.Visibility = *req.Visibility
		default:
			writeError(w, http.StatusBadRequest, "visibility must be public, connections or private.")
			return
		}
	}

	if _, err := db.Exec(`
		UPDATE users SET display_name = ?, native_name = ?, bio = ?, dialect = ?, region = ?,
		                 native_speaker = ?, dm_policy = ?, visibility = ?, updated_at = ?
		WHERE id = ?
	`, u.DisplayName, u.NativeName, u.Bio, u.Dialect, u.Region, u.NativeSpeaker, u.DMPolicy,
		u.Visibility, time.Now(), u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not save your profile.")
		return
	}

	profile, _ := getLearningProfile(u.ID)
	writeJSON(w, http.StatusOK, credentialsResponse{User: u, Email: u.Email, LearningProfile: profile})
}

// handleSearchUsers replaces the old "list every account" endpoint. It returns
// public fields only and requires a session.
func handleSearchUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	viewer := currentUser(r)
	if viewer == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to search for people.")
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := 20
	if n, err := parseIntParam(r.URL.Query().Get("limit"), 20); err == nil && n > 0 && n <= 50 {
		limit = n
	}

	var rows *sql.Rows
	var err error
	if q == "" {
		rows, err = db.Query(`
			SELECT id, username, display_name, native_name, avatar_url, bio, dialect, region, native_speaker, role
			FROM users
			WHERE status = 'active' AND id != ?
			ORDER BY created_at DESC
			LIMIT ?
		`, viewer.ID, limit)
	} else {
		like := "%" + escapeLike(q) + "%"
		rows, err = db.Query(`
			SELECT id, username, display_name, native_name, avatar_url, bio, dialect, region, native_speaker, role
			FROM users
			WHERE status = 'active' AND id != ?
			  AND (username LIKE ? ESCAPE '\' COLLATE NOCASE
			       OR display_name LIKE ? ESCAPE '\' COLLATE NOCASE
			       OR native_name LIKE ? ESCAPE '\' COLLATE NOCASE)
			ORDER BY native_speaker DESC, username ASC
			LIMIT ?
		`, viewer.ID, like, like, like, limit)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not search right now.")
		return
	}
	defer rows.Close()

	users := make([]User, 0)
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.NativeName, &u.AvatarURL, &u.Bio,
			&u.Dialect, &u.Region, &u.NativeSpeaker, &u.Role); err == nil {
			users = append(users, u)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

// --- helpers ---------------------------------------------------------------

func encodeBase64(b []byte) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	out := make([]byte, 0, (len(b)*8+5)/6)
	var acc uint32
	var bits uint
	for _, by := range b {
		acc = acc<<8 | uint32(by)
		bits += 8
		for bits >= 6 {
			bits -= 6
			out = append(out, alphabet[(acc>>bits)&0x3f])
		}
	}
	if bits > 0 {
		out = append(out, alphabet[(acc<<(6-bits))&0x3f])
	}
	return string(out)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i > 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "%", `\%`)
	s = strings.ReplaceAll(s, "_", `\_`)
	return s
}

// --- rate limiting (in-process, per instance) -------------------------------

type rateEntry struct {
	count   int
	resetAt time.Time
}

var (
	rateMu      sync.Mutex
	rateBuckets = map[string]*rateEntry{}
)

// allowRate is a fixed-window limiter. It is per-process, so it resets on
// deploy and does not coordinate across instances; good enough to stop
// credential stuffing and signup floods on a single Render service.
func allowRate(w http.ResponseWriter, r *http.Request, key string, limit int, window time.Duration) bool {
	now := time.Now()
	bucketKey := fmt.Sprintf("%s|%s", key, clientIP(r))

	rateMu.Lock()
	if len(rateBuckets) > 10000 {
		for k, v := range rateBuckets {
			if now.After(v.resetAt) {
				delete(rateBuckets, k)
			}
		}
	}
	entry, ok := rateBuckets[bucketKey]
	if !ok || now.After(entry.resetAt) {
		entry = &rateEntry{count: 0, resetAt: now.Add(window)}
		rateBuckets[bucketKey] = entry
	}
	entry.count++
	exceeded := entry.count > limit
	rateMu.Unlock()

	if exceeded {
		w.Header().Set("Retry-After", fmt.Sprintf("%d", int(window.Seconds())))
		writeError(w, http.StatusTooManyRequests, "Too many attempts. Wait a moment and try again.")
		return false
	}
	return true
}
