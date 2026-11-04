# Authentication and social deployment

The React UI (`AuthModal`, `App`, `ProfileModal`) calls `src/api/socialClient.ts`.
Requests go to `VITE_API_URL` when configured, or the same origin otherwise.
Vite proxies `/api` and `/uploads` to the Go server in development. Uploaded
avatar, post and library URLs resolve against the same backend base.

## Request flow and credentials

1. Signup sends JSON to `/api/auth/signup`. `backend/auth.go` validates fields,
   hashes the password with bcrypt (cost 12), and stores the hash in SQLite.
   Login verifies that hash at `/api/auth/login`. Passwords are not stored in
   localStorage or returned in API responses. Use HTTPS in production.
2. A successful login/signup creates a random 32-byte session token. Only its
   SHA-256 hash is stored in `sessions`; the raw token goes into the
   `idlang_session` HttpOnly cookie with a 30-day expiry. This is a session cookie
   scheme, not JWT or a frontend bearer-token scheme.
3. The browser sends the cookie with `credentials: "include"`. `withUser` and
   `requireAuth` resolve the hashed token, reject invalid/expired sessions and
   inactive users, and establish the user in request context. Request-supplied
   user IDs and `X-Viewer-ID` do not authenticate anyone. Profile data cached in
   localStorage is display data only; `/api/auth/me` determines sign-in state.
4. `backend/social_handlers.go` enforces connected-peer messaging and connection
   ownership. `backend/library.go` checks ownership/curator permissions for draft
   documents and file downloads. Password hashes and email are excluded from the
   public `User` JSON; auth responses separately include the account's own email.
5. Logout revokes the database session and clears the cookie. The UI reports a
   failure if the server cannot confirm logout. Failed profile changes, uploads,
   posts or messages never become locally fabricated successes. Private reads
   never substitute demo identities or conversations. Public feed/library preview
   fallback data and the guest curriculum remain available.

## Local run

Run `npm ci && npm run dev` from the root, and `go run .` from `backend/`.
Set `VITE_API_URL=` to use Vite's same-origin proxy, or use the backend URL.
The Go origin allowlist defaults to localhost/127.0.0.1 on port 5173.
`DEMO_MODE=false` is the production default; demo users are opt-in.

## Split deployment: frontend and Go backend

On the frontend, set `VITE_API_URL=https://YOUR-BACKEND-HOST` and rebuild/redeploy.
On the **Go backend**, set:

```dotenv
ALLOWED_ORIGINS=https://YOUR-FRONTEND-HOST
CROSS_SITE_COOKIES=true
INSECURE_COOKIES=false
DEMO_MODE=false
```

`ALLOWED_ORIGINS` accepts comma-separated exact frontend origins. It controls
credentialed CORS and rejects mutations from other browser origins before the
handler runs. `CORS_ORIGINS` belongs to the Python translator; it does not configure
the Go authentication server. The HTTPS proxy must forward `X-Forwarded-Proto`.
Cross-site cookies use `SameSite=None; Secure`; browsers that block third-party
cookies may still reject them. Prefer same-origin API routing when possible;
then keep `CROSS_SITE_COOKIES=false` and use the default `SameSite=Lax`.

Persist `DATABASE_PATH`, `LIBRARY_DIR`, and the backend's `uploads/` directory.
Back up the database before deployment. Startup migrations preserve legacy users
and books, add nullable timestamp columns (SQLite cannot add a nonconstant default
to populated tables), then backfill timestamps. New databases use the same path.

## Checks

```sh
npm test
npm run lint
npm run build
cd backend
go test ./...
go vet ./...
go build ./...
```

Regression tests cover backend URL routing, cookie-bearing requests, real API
errors, existing-database upgrades, session expiry, origin checks, authenticated
social operations and library uploads. Training data and the Colab notebook are
independent of these authentication changes; this code does not alter GPU quota.
