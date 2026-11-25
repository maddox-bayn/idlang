package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"time"
)

const guestCookieName = "idlang_guest"

var guestTokenPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func guestToken(w http.ResponseWriter, r *http.Request, create bool) (string, error) {
	if cookie, err := r.Cookie(guestCookieName); err == nil && guestTokenPattern.MatchString(cookie.Value) {
		return cookie.Value, nil
	}
	if !create {
		return "", nil
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := hex.EncodeToString(raw)
	http.SetCookie(w, &http.Cookie{Name: guestCookieName, Value: token, Path: "/", HttpOnly: true, Secure: cookieSecure(r), SameSite: cookieSameSite(r), MaxAge: 365 * 24 * 3600, Expires: time.Now().Add(365 * 24 * time.Hour)})
	return token, nil
}

func guestHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func handleTranslationAccess(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	if user := currentUser(r); user != nil {
		writeJSON(w, 200, map[string]any{"authenticated": true, "trial_remaining": false})
		return
	}
	token, err := guestToken(w, r, true)
	if err != nil {
		writeError(w, 503, "Could not start your translation trial.")
		return
	}
	var used int
	if err := db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM guest_translation_trials WHERE token_hash=?`, guestHash(token)).Scan(&used); err != nil {
		writeError(w, 503, "Could not check translation access. Please try again.")
		return
	}
	writeJSON(w, 200, map[string]any{"authenticated": false, "trial_remaining": used == 0})
}

// The unique token_hash makes the allowance atomic across tabs and API instances.
// The cookie identifies a browser, not a person: clearing cookies resets identity.
func translationAccess(consume bool, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodPost {
			methodNotAllowed(w, "POST")
			return
		}
		if currentUser(r) != nil {
			next(w, r)
			return
		}
		token, _ := guestToken(w, r, false)
		if token == "" {
			writeJSON(w, 401, map[string]string{"code": "TRIAL_SESSION_REQUIRED", "error": "Reload the page to start your free translation, or sign in."})
			return
		}
		hash := guestHash(token)
		if !consume {
			var used int
			if err := db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM guest_translation_trials WHERE token_hash=?`, hash).Scan(&used); err != nil {
				writeError(w, 503, "Could not check translation access.")
				return
			}
			if used > 0 {
				translationSignIn(w)
				return
			}
			next(w, r)
			return
		}
		result, err := db.ExecContext(r.Context(), `INSERT INTO guest_translation_trials(token_hash) VALUES (?) ON CONFLICT(token_hash) DO NOTHING`, hash)
		if err != nil {
			writeError(w, 503, "Could not start translation. Please try again.")
			return
		}
		affected, err := result.RowsAffected()
		if err != nil {
			writeError(w, 503, "Could not check translation access.")
			return
		}
		if affected == 0 {
			translationSignIn(w)
			return
		}
		recorder := &translationStatusWriter{ResponseWriter: w, status: http.StatusOK}
		completed := false
		defer func() {
			// Failed requests do not use the trial. Use a fresh timeout: the request
			// context may already be cancelled when the upstream call fails.
			if !completed || recorder.status >= 400 {
				releaseGuestTrial(hash)
			}
		}()
		next(recorder, r)
		completed = true
	}
}

func translationSignIn(w http.ResponseWriter) {
	writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "SIGN_IN_REQUIRED", "error": "Your free translation is complete. Sign in or create an account to continue."})
}

type translationStatusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *translationStatusWriter) WriteHeader(status int) {
	if !w.wrote {
		w.status = status
		w.wrote = true
		w.ResponseWriter.WriteHeader(status)
	}
}
func (w *translationStatusWriter) Write(data []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func releaseGuestTrial(hash string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	db.ExecContext(ctx, `DELETE FROM guest_translation_trials WHERE token_hash=?`, hash)
}
