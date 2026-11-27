package main

import (
	"bytes"
	"database/sql"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"

	"time"

	"github.com/google/uuid"
)

const maxAvatarUpload = 5 << 20 // 5 MB

// handleUploadAvatar accepts an image, re-encodes it (which strips EXIF and any
// polyglot payload), downscales to 256px and stores it under a generated name.
func handleUploadAvatar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	u := currentUser(r)
	if u == nil {
		writeError(w, http.StatusUnauthorized, "Sign in to continue.")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarUpload+1<<20)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "That image is too large (5 MB maximum).")
		return
	}

	file, _, err := r.FormFile("avatar")
	if err != nil {
		writeError(w, http.StatusBadRequest, "Attach an image in the 'avatar' field.")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxAvatarUpload+1))
	if err != nil || len(data) == 0 {
		writeError(w, http.StatusBadRequest, "Could not read that image.")
		return
	}
	if len(data) > maxAvatarUpload {
		writeError(w, http.StatusRequestEntityTooLarge, "That image is too large (5 MB maximum).")
		return
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > 24_000_000/cfg.Height {
		writeError(w, http.StatusBadRequest, "Choose a readable image up to 24 megapixels.")
		return
	}
	src, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		writeError(w, http.StatusUnsupportedMediaType, "That file is not a readable image.")
		return
	}
	if format != "jpeg" && format != "png" {
		writeError(w, http.StatusUnsupportedMediaType, "Use a JPEG or PNG image.")
		return
	}

	resized := fitSquare(src, 256)

	var (
		encoded bytes.Buffer
		ext     string
		mime    string
	)
	if hasTransparency(resized) {
		if err := png.Encode(&encoded, resized); err != nil {
			writeError(w, http.StatusInternalServerError, "Could not process that image.")
			return
		}
		ext, mime = ".png", "image/png"
	} else {
		if err := jpeg.Encode(&encoded, resized, &jpeg.Options{Quality: 88}); err != nil {
			writeError(w, http.StatusInternalServerError, "Could not process that image.")
			return
		}
		ext, mime = ".jpg", "image/jpeg"
	}
	// Publish the URL and its bytes together. A replacement gets a fresh cache key.
	name := "db-" + uuid.NewString() + ext
	avatarURL := "/uploads/avatars/" + name
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 503, "Profile storage unavailable.")
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO user_avatars(user_id,name,mime,data) VALUES(?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,mime=excluded.mime,data=excluded.data`,
		u.ID, name, mime, encoded.Bytes()); err == nil {
		_, err = tx.ExecContext(r.Context(), `UPDATE users SET avatar_url=?, updated_at=? WHERE id=?`, avatarURL, time.Now(), u.ID)
	}
	if err != nil || tx.Commit() != nil {
		writeError(w, 503, "Could not save your avatar. Try again.")
		return
	}
	u.AvatarURL = avatarURL

	profile, _ := getLearningProfile(u.ID)
	writeJSON(w, http.StatusOK, credentialsResponse{User: u, Email: u.Email, LearningProfile: profile})
}

// fitSquare scales the image down so its longest side is at most maxDim. It
// never upscales.
func fitSquare(src image.Image, maxDim int) *image.RGBA {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return image.NewRGBA(image.Rect(0, 0, 1, 1))
	}

	if w <= maxDim && h <= maxDim {
		return toRGBA(src)
	}

	nw, nh := w, h
	if w >= h {
		nw = maxDim
		nh = h * maxDim / w
	} else {
		nh = maxDim
		nw = w * maxDim / h
	}
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	for y := 0; y < nh; y++ {
		sy0 := b.Min.Y + y*h/nh
		sy1 := b.Min.Y + (y+1)*h/nh
		if sy1 <= sy0 {
			sy1 = sy0 + 1
		}
		for x := 0; x < nw; x++ {
			sx0 := b.Min.X + x*w/nw
			sx1 := b.Min.X + (x+1)*w/nw
			if sx1 <= sx0 {
				sx1 = sx0 + 1
			}

			var r, g, bl, a, n uint64
			for sy := sy0; sy < sy1; sy++ {
				for sx := sx0; sx < sx1; sx++ {
					cr, cg, cb, ca := src.At(sx, sy).RGBA()
					r += uint64(cr)
					g += uint64(cg)
					bl += uint64(cb)
					a += uint64(ca)
					n++
				}
			}
			if n == 0 {
				continue
			}
			dst.SetRGBA(x, y, color.RGBA{
				R: uint8(r / n >> 8),
				G: uint8(g / n >> 8),
				B: uint8(bl / n >> 8),
				A: uint8(a / n >> 8),
			})
		}
	}
	return dst
}

func toRGBA(src image.Image) *image.RGBA {
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			dst.Set(x, y, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

func hasTransparency(img *image.RGBA) bool {
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if _, _, _, a := img.At(x, y).RGBA(); a < 65535 {
				return true
			}
		}
	}
	return false
}

func migrateUserAvatars(database *sql.DB) error {
	_, err := database.Exec(`CREATE TABLE IF NOT EXISTS user_avatars (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, data BLOB NOT NULL)`)
	return err
}

func serveAvatar(w http.ResponseWriter, r *http.Request, name string) {
	var mime string
	var data []byte
	err := db.QueryRowContext(r.Context(), "SELECT mime,data FROM user_avatars WHERE name=?", name).Scan(&mime, &data)
	if err == sql.ErrNoRows {
		writeError(w, 404, "Profile photo unavailable.")
		return
	}
	if err != nil {
		writeError(w, 503, "Profile storage unavailable.")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("ETag", `"`+name+`"`)
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}
