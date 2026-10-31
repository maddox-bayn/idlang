package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	maxLibraryUpload = 25 << 20 // 25 MB
	maxContentText   = 400_000  // cap on extracted text returned to the client
)

var (
	libraryFTSAvailable bool
	htmlTagRe           = regexp.MustCompile(`(?s)<[^>]*>`)
	whitespaceRe        = regexp.MustCompile(`\s+`)
)

func libraryDir() string {
	if v := strings.TrimSpace(os.Getenv("LIBRARY_DIR")); v != "" {
		return v
	}
	return "library"
}

var allowedLicenses = map[string]bool{
	"CC-BY-4.0":           true,
	"CC-BY-SA-4.0":        true,
	"CC-BY-NC-4.0":        true,
	"public-domain":       true,
	"all-rights-reserved": true,
	"consent-granted":     true,
	"sample":              true,
}

var allowedKinds = map[string]bool{
	"book": true, "manuscript": true, "audio": true, "dictionary": true, "lesson": true,
}

// --- Full-text search -------------------------------------------------------

func initLibraryFTS(database *sql.DB) (bool, error) {
	_, err := database.Exec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS library_fts USING fts5(
			item_id UNINDEXED,
			title,
			author,
			description,
			content_text,
			tokenize='unicode61 remove_diacritics 0'
		)
	`)
	if err != nil {
		// A SQLite build without FTS5 is not fatal; LIKE queries still work.
		libraryFTSAvailable = false
		return false, nil
	}
	libraryFTSAvailable = true
	return true, nil
}

func indexLibraryItem(database *sql.DB, id, title, author, description, content string) error {
	if !libraryFTSAvailable {
		return nil
	}
	_, err := database.Exec(`
		INSERT INTO library_fts (item_id, title, author, description, content_text)
		VALUES (?, ?, ?, ?, ?)
	`, id, title, author, description, content)
	return err
}

func unindexLibraryItem(database *sql.DB, id string) {
	if libraryFTSAvailable {
		database.Exec(`DELETE FROM library_fts WHERE item_id = ?`, id)
	}
}

// --- Handlers ---------------------------------------------------------------

func handleLibrary(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		listLibrary(w, r)
	case http.MethodPost:
		createLibraryItem(w, r)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

func listLibrary(w http.ResponseWriter, r *http.Request) {
	page, _ := parseIntParam(r.URL.Query().Get("page"), 1)
	if page < 1 {
		page = 1
	}
	limit, _ := parseIntParam(r.URL.Query().Get("limit"), 24)
	if limit < 1 || limit > 100 {
		limit = 24
	}
	offset := (page - 1) * limit

	viewer := currentUser(r)
	wantStatus := r.URL.Query().Get("status")
	includeDrafts := wantStatus == "draft" && canCurate(viewer)

	var (
		where []string
		args  []any
	)

	if includeDrafts {
		where = append(where, "status = 'draft'")
	} else if canCurate(viewer) && wantStatus != "" {
		where = append(where, "status = ?")
		args = append(args, wantStatus)
	} else {
		where = append(where, "status = 'published'")
	}

	if kind := r.URL.Query().Get("kind"); kind != "" {
		if allowedKinds[kind] {
			where = append(where, "kind = ?")
			args = append(args, kind)
		}
	}
	if dialect := strings.TrimSpace(r.URL.Query().Get("dialect")); dialect != "" {
		where = append(where, "dialect = ?")
		args = append(args, dialect)
	}
	if lang := strings.TrimSpace(r.URL.Query().Get("language")); lang != "" {
		where = append(where, "language = ?")
		args = append(args, lang)
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q != "" && libraryFTSAvailable {
		ids, err := searchLibraryFTS(q, limit*4)
		if err != nil {
			log.Printf("library FTS query failed: %v", err)
		}
		if len(ids) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{
				"items": []LibraryItem{}, "total": 0, "page": page, "limit": limit,
			})
			return
		}
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
		where = append(where, "id IN ("+placeholders+")")
		for _, id := range ids {
			args = append(args, id)
		}
	} else if q != "" {
		like := "%" + escapeLike(q) + "%"
		where = append(where, `(title LIKE ? ESCAPE '\' COLLATE NOCASE
			OR author LIKE ? ESCAPE '\' COLLATE NOCASE
			OR description LIKE ? ESCAPE '\' COLLATE NOCASE)`)
		args = append(args, like, like, like)
	}

	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM library_items "+whereSQL, args...).Scan(&total); err != nil {
		log.Printf("library count failed: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not load the library.")
		return
	}

	query := `
		SELECT id, title, author, uploaded_by, description, kind, language, dialect,
		       license, source_url, consent_note, mime, size_bytes, status,
		       file_key != '', created_at, updated_at
		FROM library_items ` + whereSQL + `
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?`
	args = append(args, limit, offset)

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("library list failed: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not load the library.")
		return
	}
	defer rows.Close()

	items := make([]LibraryItem, 0)
	for rows.Next() {
		item, err := scanLibraryItem(rows)
		if err != nil {
			log.Printf("library row scan failed: %v", err)
			continue
		}
		items = append(items, *item)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": page, "limit": limit,
	})
}

func searchLibraryFTS(q string, limit int) ([]string, error) {
	// Quote each token so user input cannot inject FTS operators.
	tokens := strings.Fields(q)
	for i, t := range tokens {
		tokens[i] = `"` + strings.ReplaceAll(t, `"`, `""`) + `"`
	}
	match := strings.Join(tokens, " ")

	rows, err := db.Query(`
		SELECT item_id FROM library_fts
		WHERE library_fts MATCH ?
		ORDER BY bm25(library_fts)
		LIMIT ?
	`, match, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := make([]string, 0, limit)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	return ids, rows.Err()
}

func createLibraryItem(w http.ResponseWriter, r *http.Request) {
	viewer := currentUser(r)
	if viewer == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to add to the library.")
		return
	}
	if !allowRate(w, r, "library-upload:"+viewer.ID, 10, time.Hour) {
		return
	}

	if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		writeError(w, http.StatusBadRequest, "Upload the document as multipart/form-data.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxLibraryUpload+1<<20)
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "That file is too large (25 MB maximum).")
		return
	}

	title := truncate(strings.TrimSpace(r.FormValue("title")), 200)
	author := truncate(strings.TrimSpace(r.FormValue("author")), 200)
	description := truncate(strings.TrimSpace(r.FormValue("description")), 2000)
	kind := strings.TrimSpace(r.FormValue("kind"))
	language := strings.TrimSpace(r.FormValue("language"))
	dialect := truncate(strings.TrimSpace(r.FormValue("dialect")), 40)
	license := strings.TrimSpace(r.FormValue("license"))
	sourceURL := truncate(strings.TrimSpace(r.FormValue("source_url")), 500)
	consentNote := truncate(strings.TrimSpace(r.FormValue("consent_note")), 500)

	if title == "" || author == "" {
		writeError(w, http.StatusBadRequest, "Title and author are required.")
		return
	}
	if kind == "" {
		kind = "manuscript"
	}
	if !allowedKinds[kind] {
		writeError(w, http.StatusBadRequest, "Unknown kind. Use book, manuscript, audio, dictionary or lesson.")
		return
	}
	if language == "" {
		language = "idoma"
	}
	if !allowedLicenses[license] {
		writeError(w, http.StatusBadRequest, "Choose a licence for this item.")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "Attach a file.")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxLibraryUpload+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Could not read that file.")
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "That file is empty.")
		return
	}
	if len(data) > maxLibraryUpload {
		writeError(w, http.StatusRequestEntityTooLarge, "That file is too large (25 MB maximum).")
		return
	}

	mime, ext, ok := detectLibraryMime(data, header.Filename)
	if !ok {
		writeError(w, http.StatusUnsupportedMediaType,
			"Unsupported file type. Allowed: PDF, EPUB, plain text, audio (mp3/ogg/wav) and images.")
		return
	}

	id := uuid.New().String()
	key := id + ext
	dir := libraryDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not store the file.")
		return
	}
	if err := writeFileAtomic(filepath.Join(dir, key), data); err != nil {
		log.Printf("library write failed: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not store the file.")
		return
	}

	contentText, err := extractText(data, mime)
	if err != nil {
		log.Printf("library text extraction failed for %s: %v", key, err)
		contentText = ""
	}

	status := "draft"
	if canCurate(viewer) {
		status = "published"
	}

	if _, err := db.Exec(`
		INSERT INTO library_items
			(id, title, author, uploaded_by, file_url, description, kind, language, dialect,
			 license, source_url, consent_note, file_key, mime, size_bytes, sha256,
			 content_text, status, reviewed_by, updated_at)
		VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, id, title, author, viewer.ID, description, kind, language, dialect,
		license, sourceURL, consentNote, key, mime, len(data), sha256Hex(data),
		contentText, status, nullableReviewer(viewer, status), time.Now()); err != nil {
		os.Remove(filepath.Join(dir, key))
		log.Printf("library insert failed: %v", err)
		writeError(w, http.StatusInternalServerError, "Could not save the record.")
		return
	}

	if err := indexLibraryItem(db, id, title, author, description, contentText); err != nil {
		log.Printf("library index failed: %v", err)
	}

	item, err := getLibraryItem(id, viewer)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Saved, but could not reload the record.")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func nullableReviewer(u *User, status string) any {
	if status == "published" && canCurate(u) {
		return u.ID
	}
	return nil
}

// handleLibraryByID routes /api/library/{id}, /api/library/{id}/file and
// /api/library/{id}/status.
func handleLibraryByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/library/"), "/")
	if rest == "" {
		handleLibrary(w, r)
		return
	}
	parts := strings.Split(rest, "/")
	id := parts[0]

	switch {
	case len(parts) == 1:
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		item, err := getLibraryItem(id, currentUser(r))
		if err != nil {
			writeError(w, http.StatusNotFound, "That record does not exist.")
			return
		}
		writeJSON(w, http.StatusOK, item)

	case len(parts) == 2 && parts[1] == "file":
		serveLibraryFile(w, r, id)

	case len(parts) == 2 && parts[1] == "status":
		updateLibraryStatus(w, r, id)

	default:
		writeError(w, http.StatusNotFound, "Not found.")
	}
}

func getLibraryItem(id string, viewer *User) (*LibraryItem, error) {
	row := db.QueryRow(`
		SELECT id, title, author, uploaded_by, description, kind, language, dialect,
		       license, source_url, consent_note, mime, size_bytes, status,
		       file_key != '', content_text, created_at, updated_at
		FROM library_items WHERE id = ?
	`, id)

	var (
		item                            LibraryItem
		createdStr, updatedStr          sql.NullString
		contentText                     sql.NullString
	)
	if err := row.Scan(
		&item.ID, &item.Title, &item.Author, &item.UploadedBy, &item.Description,
		&item.Kind, &item.Language, &item.Dialect, &item.License, &item.SourceURL,
		&item.ConsentNote, &item.Mime, &item.SizeBytes, &item.Status, &item.HasFile,
		&contentText, &createdStr, &updatedStr,
	); err != nil {
		return nil, err
	}

	if item.Status != "published" {
		if viewer == nil || (viewer.ID != item.UploadedBy && !canCurate(viewer)) {
			return nil, sql.ErrNoRows
		}
	}

	item.ContentText = truncate(contentText.String, maxContentText)
	item.CreatedAt = parseDBTime(createdStr.String)
	item.UpdatedAt = parseDBTime(updatedStr.String)
	return &item, nil
}

func scanLibraryItem(rows *sql.Rows) (*LibraryItem, error) {
	var (
		item                   LibraryItem
		createdStr, updatedStr sql.NullString
	)
	err := rows.Scan(
		&item.ID, &item.Title, &item.Author, &item.UploadedBy, &item.Description,
		&item.Kind, &item.Language, &item.Dialect, &item.License, &item.SourceURL,
		&item.ConsentNote, &item.Mime, &item.SizeBytes, &item.Status, &item.HasFile,
		&createdStr, &updatedStr,
	)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = parseDBTime(createdStr.String)
	item.UpdatedAt = parseDBTime(updatedStr.String)
	return &item, nil
}

func serveLibraryFile(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	viewer := currentUser(r)

	item, err := getLibraryItem(id, viewer)
	if err != nil {
		writeError(w, http.StatusNotFound, "That record does not exist.")
		return
	}

	var key string
	if err := db.QueryRow(`SELECT file_key FROM library_items WHERE id = ?`, id).Scan(&key); err != nil || key == "" {
		writeError(w, http.StatusNotFound, "No file is attached to this record.")
		return
	}

	// file_key is always server-generated (uuid + validated extension). Reject
	// anything that is not a clean base name anyway.
	if key != filepath.Base(key) || strings.ContainsAny(key, `/\`) {
		writeError(w, http.StatusNotFound, "No file is attached to this record.")
		return
	}

	full := filepath.Join(libraryDir(), key)
	f, err := os.Open(full)
	if err != nil {
		writeError(w, http.StatusNotFound, "That file is missing from storage.")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		writeError(w, http.StatusNotFound, "That file is missing from storage.")
		return
	}

	disposition := "attachment"
	if r.URL.Query().Get("inline") == "1" {
		disposition = "inline"
	}

	w.Header().Set("Content-Type", item.Mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`%s; filename=%q`, disposition, safeFilename(item.Title)+extensionFor(item.Mime)))
	w.Header().Set("Cache-Control", "private, max-age=300")
	http.ServeContent(w, r, key, info.ModTime(), f)
}

func updateLibraryStatus(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPatch && r.Method != http.MethodPost {
		methodNotAllowed(w, "PATCH")
		return
	}
	viewer := currentUser(r)
	if !canCurate(viewer) {
		writeError(w, http.StatusForbidden, "Only curators can review library submissions.")
		return
	}

	var req struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(w, r, &req, 4<<10); err != nil {
		writeError(w, http.StatusBadRequest, "Could not read that request.")
		return
	}
	switch req.Status {
	case "published", "rejected", "removed":
	default:
		writeError(w, http.StatusBadRequest, "status must be published, rejected or removed.")
		return
	}

	res, err := db.Exec(`
		UPDATE library_items SET status = ?, reviewed_by = ?, updated_at = ? WHERE id = ?
	`, req.Status, viewer.ID, time.Now(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not update the record.")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "That record does not exist.")
		return
	}

	item, err := getLibraryItem(id, viewer)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Updated, but could not reload the record.")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func canCurate(u *User) bool {
	return u != nil && (u.Role == "curator" || u.Role == "admin")
}

// --- File validation + extraction -------------------------------------------

func detectLibraryMime(data []byte, filename string) (mime, ext string, ok bool) {
	if bytes.HasPrefix(data, []byte("%PDF-")) {
		return "application/pdf", ".pdf", true
	}
	if isEPUB(data) {
		return "application/epub+zip", ".epub", true
	}

	detected := http.DetectContentType(data)
	switch {
	case strings.HasPrefix(detected, "text/plain"):
		if utf8.Valid(data) {
			return "text/plain; charset=utf-8", ".txt", true
		}
	case detected == "audio/mpeg", detected == "audio/wave", detected == "audio/wav",
		detected == "audio/ogg", detected == "application/ogg",
		detected == "audio/flac", detected == "audio/mp4":
		return detected, extensionFor(detected), true
	case strings.HasPrefix(detected, "image/jpeg"):
		return "image/jpeg", ".jpg", true
	case strings.HasPrefix(detected, "image/png"):
		return "image/png", ".png", true
	case detected == "image/webp":
		return "image/webp", ".webp", true
	}

	_ = filename // the client filename is never trusted for type or path
	return "", "", false
}

func isEPUB(data []byte) bool {
	if len(data) < 4 || data[0] != 'P' || data[1] != 'K' {
		return false
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return false
	}
	for _, f := range zr.File {
		if f.Name != "mimetype" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return false
		}
		buf, err := io.ReadAll(io.LimitReader(rc, 64))
		rc.Close()
		return err == nil && strings.TrimSpace(string(buf)) == "application/epub+zip"
	}
	return false
}

func extensionFor(mime string) string {
	switch {
	case strings.Contains(mime, "pdf"):
		return ".pdf"
	case strings.Contains(mime, "epub"):
		return ".epub"
	case strings.Contains(mime, "plain"):
		return ".txt"
	case strings.Contains(mime, "mpeg"):
		return ".mp3"
	case strings.Contains(mime, "ogg"):
		return ".ogg"
	case strings.Contains(mime, "wav"), strings.Contains(mime, "wave"):
		return ".wav"
	case strings.Contains(mime, "jpeg"):
		return ".jpg"
	case strings.Contains(mime, "png"):
		return ".png"
	case strings.Contains(mime, "webp"):
		return ".webp"
	}
	return ".bin"
}

func safeFilename(title string) string {
	replacer := strings.NewReplacer(`"`, "", `\`, "", "/", "-", "\n", " ", "\r", " ", "\t", " ")
	name := strings.TrimSpace(replacer.Replace(title))
	if name == "" {
		name = "idlang-record"
	}
	return truncate(name, 80)
}

// extractText pulls readable text out of plain text and EPUB. PDF extraction
// needs a dedicated library, so PDFs are download-only rather than served as
// empty pages that look broken.
func extractText(data []byte, mime string) (string, error) {
	switch {
	case strings.HasPrefix(mime, "text/plain"):
		return truncate(string(data), maxContentText), nil
	case strings.Contains(mime, "epub"):
		return extractEPUBText(data)
	}
	return "", nil
}

func extractEPUBText(data []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}

	var docs []*zip.File
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		switch strings.ToLower(filepath.Ext(f.Name)) {
		case ".xhtml", ".html", ".htm":
			docs = append(docs, f)
		}
	}
	if len(docs) == 0 {
		return "", nil
	}
	sort.Slice(docs, func(i, j int) bool { return docs[i].Name < docs[j].Name })

	var sb strings.Builder
	for _, doc := range docs {
		if sb.Len() >= maxContentText {
			break
		}
		rc, err := doc.Open()
		if err != nil {
			continue
		}
		body, err := io.ReadAll(io.LimitReader(rc, 512<<10))
		rc.Close()
		if err != nil {
			continue
		}
		text := htmlTagRe.ReplaceAllString(string(body), " ")
		text = html.UnescapeString(text)
		text = whitespaceRe.ReplaceAllString(text, " ")
		sb.WriteString(strings.TrimSpace(text))
		sb.WriteString("\n\n")
	}
	return truncate(sb.String(), maxContentText), nil
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".upload-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

// Book is a backward-compatible alias for LibraryItem
type Book = LibraryItem

func handleBooks(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		rows, err := db.Query(`
			SELECT id, title, author, uploaded_by, COALESCE(file_url, ''), COALESCE(description, ''), created_at
			FROM library_items
			ORDER BY created_at DESC
		`)
		if err != nil {
			writeJSON(w, http.StatusOK, []LibraryItem{})
			return
		}
		defer rows.Close()

		items := make([]LibraryItem, 0)
		for rows.Next() {
			var it LibraryItem
			var fileURL, desc, crStr sql.NullString
			if err := rows.Scan(&it.ID, &it.Title, &it.Author, &it.UploadedBy, &fileURL, &desc, &crStr); err == nil {
				it.Description = desc.String
				it.CreatedAt = parseDBTime(crStr.String)
				items = append(items, it)
			}
		}
		writeJSON(w, http.StatusOK, items)
		return
	}
	if r.Method == http.MethodPost && strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		var req struct {
			Title       string `json:"title"`
			Author      string `json:"author"`
			UploadedBy  string `json:"uploaded_by"`
			Description string `json:"description"`
			FileURL     string `json:"file_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.Title != "" {
			uploader := req.UploadedBy
			if uploader == "" {
				if u := currentUser(r); u != nil {
					uploader = u.ID
				} else {
					uploader = "user_oche"
				}
			}
			id := uuid.New().String()
			now := time.Now()
			db.Exec(`
				INSERT INTO library_items (id, title, author, uploaded_by, file_url, description, kind, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, 'book', 'published', ?)
			`, id, req.Title, req.Author, uploader, req.FileURL, req.Description, now)

			writeJSON(w, http.StatusCreated, LibraryItem{
				ID: id, Title: req.Title, Author: req.Author, UploadedBy: uploader,
				Description: req.Description, CreatedAt: now,
			})
			return
		}
	}
	createLibraryItem(w, r)
}
