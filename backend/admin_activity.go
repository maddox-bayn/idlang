package main

import (
	"database/sql"
	"net/http"
	"strconv"
)

func migrateAdminActivity(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS admin_library_events(
		id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, target TEXT NOT NULL,
		previous TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
	if err != nil {
		return err
	}
	// A review and its history entry commit or roll back together, including
	// decisions made through the existing curator endpoint.
	_, err = db.Exec(`CREATE TRIGGER IF NOT EXISTS log_library_review AFTER UPDATE OF status ON library_items
		WHEN OLD.status <> NEW.status AND NEW.reviewed_by IS NOT NULL BEGIN
		INSERT INTO admin_library_events(actor,target,previous,status)
		VALUES(NEW.reviewed_by,NEW.id,OLD.status,NEW.status); END`)
	return err
}

func handleAdminActivity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	query := "SELECT id,actor,target,previous,status,at FROM admin_library_events"
	var args []any
	if raw := r.URL.Query().Get("before"); raw != "" {
		before, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || before < 0 {
			writeError(w, 400, "Invalid activity cursor.")
			return
		}
		if before > 0 {
			query += " WHERE id < ?"
			args = append(args, before)
		}
	}
	rows, err := db.QueryContext(r.Context(), query+" ORDER BY id DESC LIMIT 26", args...)
	if err != nil {
		writeError(w, 503, "Could not load review activity.")
		return
	}
	defer rows.Close()
	type event struct {
		ID       int64  `json:"id"`
		Actor    string `json:"actor"`
		Target   string `json:"target"`
		Previous string `json:"previous"`
		Status   string `json:"status"`
		At       string `json:"at"`
	}
	events := []event{}
	for rows.Next() {
		var e event
		if err := rows.Scan(&e.ID, &e.Actor, &e.Target, &e.Previous, &e.Status, &e.At); err != nil {
			writeError(w, 503, "Could not read review activity.")
			return
		}
		events = append(events, e)
	}
	if rows.Err() != nil {
		writeError(w, 503, "Could not read review activity.")
		return
	}
	more := len(events) > 25
	if more {
		events = events[:25]
	}
	writeJSON(w, 200, map[string]any{"events": events, "more": more})
}
