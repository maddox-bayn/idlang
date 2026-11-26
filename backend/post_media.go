package main

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Keep binary parameters and individual range reads small enough for remote libSQL.
const postMediaChunk = 256 << 10

func migratePostMedia(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS post_media_chunks (
		name TEXT NOT NULL, part INTEGER NOT NULL, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
		data BLOB NOT NULL, PRIMARY KEY(name, part)
	)`)
	if err != nil {
		return err
	}
	_, err = db.Exec("CREATE INDEX IF NOT EXISTS idx_post_media_owner ON post_media_chunks(post_id)")
	return err
}

type postUpload struct {
	name string
	data []byte
}

func (u *postUpload) url() string { return "/uploads/media/" + u.name }

func readPostUpload(w http.ResponseWriter, r *http.Request, kind string) *postUpload {
	file, _, err := r.FormFile("media_file")
	if err != nil {
		writeError(w, 400, "Choose a file to upload.")
		return nil
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxLibraryUpload+1))
	if err != nil {
		writeError(w, 400, "Could not read the upload.")
		return nil
	}
	if len(data) > maxLibraryUpload {
		writeError(w, 413, "Maximum attachment size is 25 MB.")
		return nil
	}
	mime, ext, ok := detectMediaMime(data)
	if !ok || !strings.HasPrefix(mime, kind+"/") {
		writeError(w, 415, "Choose a supported file matching the post type.")
		return nil
	}
	return &postUpload{"db-" + uuid.NewString() + ext, data}
}

func (u *postUpload) save(ctx context.Context, tx *sql.Tx, id string) error {
	for offset := 0; offset < len(u.data); offset += postMediaChunk {
		end := min(offset+postMediaChunk, len(u.data))
		if _, err := tx.ExecContext(ctx, `INSERT INTO post_media_chunks(name,part,post_id,data) VALUES(?,?,?,?)`, u.name, offset/postMediaChunk, id, u.data[offset:end]); err != nil {
			return err
		}
	}
	return nil
}

const postChunkQuery = "SELECT data FROM post_media_chunks WHERE name=? AND part=?"

type chunkReader struct {
	query string
	ctx   context.Context
	name  string
	part  int64
	data  []byte
}

func (c *chunkReader) ReadAt(p []byte, off int64) (int, error) {
	n := 0
	for n < len(p) {
		part := off / postMediaChunk
		if c.part != part {
			err := db.QueryRowContext(c.ctx, c.query, c.name, part).Scan(&c.data)
			if err != nil {
				return n, err
			}
			c.part = part
		}
		start := off % postMediaChunk
		if start >= int64(len(c.data)) {
			return n, io.ErrUnexpectedEOF
		}
		count := copy(p[n:], c.data[start:])
		n += count
		off += int64(count)
	}
	return n, nil
}

func servePostMedia(w http.ResponseWriter, r *http.Request, name string) {
	var size int64
	// Only the last chunk is variable in size. The primary key supports a single reverse seek.
	err := db.QueryRowContext(r.Context(), `SELECT part * ? + length(data) FROM post_media_chunks
		WHERE name=? ORDER BY part DESC LIMIT 1`, postMediaChunk, name).Scan(&size)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "Attachment unavailable.")
		return
	}
	if err != nil {
		writeError(w, 503, "Attachment storage unavailable.")
		return
	}
	w.Header().Set("Content-Type", contentTypeForExt(filepath.Ext(name)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("ETag", `"`+name+`"`)
	// ServeContent handles HEAD and Range, so seeking a video reads only the requested chunks.
	http.ServeContent(w, r, name, time.Time{}, io.NewSectionReader(&chunkReader{query: postChunkQuery, ctx: r.Context(), name: name, part: -1}, 0, size))
}

func restorePostMedia(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	user := currentUser(r)
	if user == nil {
		writeError(w, 401, "Sign in to restore your attachment.")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/restore-post-media/")
	var old, kind string
	err := db.QueryRowContext(r.Context(), "SELECT media_url,media_type FROM posts WHERE id=? AND user_id=?", id, user.ID).Scan(&old, &kind)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "Post unavailable.")
		return
	}
	if err != nil {
		writeError(w, 503, "Storage unavailable.")
		return
	}
	if !strings.HasPrefix(old, "/uploads/media/") || strings.HasPrefix(old, "/uploads/media/db-") {
		writeError(w, 409, "Only legacy uploads can be restored.")
		return
	}
	if !allowRate(w, r, "restore:"+user.ID, 30, time.Hour) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxLibraryUpload+(1<<20))
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		writeError(w, 400, "Could not read the upload.")
		return
	}
	defer r.MultipartForm.RemoveAll()
	u := readPostUpload(w, r, kind)
	if u == nil {
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 503, "Storage unavailable.")
		return
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(r.Context(), "UPDATE posts SET media_url=? WHERE id=? AND user_id=? AND media_url=?", u.url(), id, user.ID, old)
	if err != nil {
		writeError(w, 503, "Could not update the post.")
		return
	}
	n, err := res.RowsAffected()
	if err != nil {
		writeError(w, 503, "Could not confirm the update.")
		return
	}
	if n != 1 {
		writeError(w, 409, "The post changed. Refresh the feed.")
		return
	}
	if err := u.save(r.Context(), tx, id); err != nil {
		writeError(w, 503, "Could not store the attachment.")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, 503, "Could not confirm the update.")
		return
	}
	writeJSON(w, 200, map[string]string{"media_url": u.url()})
}
