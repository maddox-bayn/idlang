package main

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
)

// Promotion is an operator-only command, never a public registration option.
// First create the account normally; then run with the same database environment.
func runAdminCommand() bool {
	if len(os.Args) < 2 || os.Args[1] != "promote-admin" {
		return false
	}
	if len(os.Args) != 3 {
		log.Fatal("Usage: idlang-backend promote-admin ACCOUNT_EMAIL")
	}
	database, err := openConfiguredDB()
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()
	if err := promoteAdmin(database, os.Args[2]); err != nil {
		log.Fatal(err)
	}
	log.Print("Administrator role granted to the existing account.")
	return true
}

func promoteAdmin(database *sql.DB, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return errors.New("an existing account email is required")
	}
	result, err := database.Exec(`UPDATE users SET role='admin', updated_at=CURRENT_TIMESTAMP
 WHERE lower(email)=? AND status='active' AND password_hash IS NOT NULL AND password_hash!=''`, email)
	if err != nil {
		return errors.New("could not promote administrator")
	}
	count, err := result.RowsAffected()
	if err != nil || count != 1 {
		return errors.New("no active registered account found for that email")
	}
	return nil
}

func handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	var users, posts, drafts int
	if err := db.QueryRowContext(r.Context(), `SELECT (SELECT COUNT(*) FROM users WHERE status!='deleted'),
 (SELECT COUNT(*) FROM posts),(SELECT COUNT(*) FROM library_items WHERE status='draft')`).Scan(&users, &posts, &drafts); err != nil {
		writeError(w, 503, "Could not load the administration overview.")
		return
	}
	backend := "sqlite"
	if os.Getenv("TURSO_DATABASE_URL") != "" {
		backend = "turso"
	}
	writeJSON(w, 200, map[string]any{"users": users, "posts": posts, "drafts": drafts, "database": backend})
}

func handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 1000000 {
		writeError(w, 400, "Invalid page.")
		return
	}
	var total int
	if err := db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM users WHERE status!='deleted'`).Scan(&total); err != nil {
		writeError(w, 503, "Could not load accounts.")
		return
	}
	rows, err := db.QueryContext(r.Context(), `SELECT id,username,display_name,role,status,created_at FROM users WHERE status!='deleted' ORDER BY created_at DESC,id LIMIT 25 OFFSET ?`, (page-1)*25)
	if err != nil {
		writeError(w, 503, "Could not load accounts.")
		return
	}
	defer rows.Close()
	type account struct {
		ID          string `json:"id"`
		Username    string `json:"username"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
		Status      string `json:"status"`
		CreatedAt   string `json:"created_at"`
	}
	accounts := make([]account, 0)
	for rows.Next() {
		var user account
		if err := rows.Scan(&user.ID, &user.Username, &user.DisplayName, &user.Role, &user.Status, &user.CreatedAt); err != nil {
			writeError(w, 503, "Could not read account data.")
			return
		}
		accounts = append(accounts, user)
	}
	if rows.Err() != nil {
		writeError(w, 503, "Could not load accounts.")
		return
	}
	writeJSON(w, 200, map[string]any{"users": accounts, "total": total, "page": page, "limit": 25})
}

func handleAdminLibrary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	query := r.URL.Query()
	query.Set("status", "draft")
	r.URL.RawQuery = query.Encode()
	listLibrary(w, r)
}
