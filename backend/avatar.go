package main

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
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
	_ = mime

	dir := filepath.Join("uploads", "avatars")
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not store that image.")
		return
	}
	name := uuid.New().String() + ext
	if err := writeFileAtomic(filepath.Join(dir, name), encoded.Bytes()); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not store that image.")
		return
	}

	avatarURL := "/uploads/avatars/" + name
	if _, err := db.Exec(`UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?`,
		avatarURL, time.Now(), u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not save your avatar.")
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
