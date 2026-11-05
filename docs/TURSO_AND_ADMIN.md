# Turso, the free translation, and administration

## What changes

- `/` opens Translate. Guests see no feed, learning, library, or admin navigation.
  Signed-in members can use the community navigation; Translate remains the landing page.
- Each browser gets one successful text or full audio translation. Speech mode
  transcribes first and uses its allowance when translating the transcript.
  A sign-in/create-account prompt appears after the result; closing it keeps the
  result visible. Further translations require an account. Failed API requests
  do not consume the allowance.
- The Go API checks a shared database record, so reloading, opening another tab,
  or calling a different translation endpoint does not reset the trial. It uses
  an HttpOnly guest cookie. Clearing cookies, a new browser, or the cookie's
  one-year expiry creates a new browser identity; this is an onboarding trial,
  not an abuse-proof per-person quota. A server crash during a reserved request
  can consume that browser's trial; the visitor can still register/sign in.
- `/admin` is a separate page, never linked in the member navigation. Its API
  requires a valid session whose database role is `admin`. Ordinary accounts
  receive HTTP 403 and anonymous callers HTTP 401. Administrators can see account
  counts, paginated account listings, and publish/reject library submissions.

## 1. Create a Turso libSQL database

Use a **libSQL / SQLite** database for this integration, not the separate Turso
Database engine (`turso://`). It uses the remote Go libSQL driver documented in
[Turso's Go quickstart](https://docs.turso.tech/sdk/go/quickstart), with TLS and
an authentication token passed through the driver's connector option.
The driver is pinned in `backend/go.mod`; the remote path works without CGO or
local replica files, matching the existing Alpine backend image.

With the Turso CLI installed and authenticated:

```sh
turso db create idlang
turso db show --url idlang
turso db tokens create idlang
```

The database token must permit writes and schema migrations. Store it as a secret
in the backend hosting dashboard. Never put it in a GitHub file, browser code,
or any `VITE_*` variable.

### Preserve existing SQLite accounts

Changing the URL does not copy existing SQLite data. If there are existing users,
stop writes to the old deployment and make a consistent SQLite backup first:

```sh
sqlite3 /path/to/idlang.db ".backup '/path/to/idlang-backup.db'"
turso db create idlang --from-file /path/to/idlang-backup.db
```

Use this import **instead of** creating an empty `idlang` database above. If that
name already exists, choose a new name and update the connection configuration.
Verify account counts and sign-in before redirecting production traffic. Keep the
original backup for rollback. Back up and retain `uploads/` and `LIBRARY_DIR`
separately: Turso stores their database metadata, not uploaded media bytes.

## 2. Configure the Go backend

Add these variables to the Go backend service (for example, Render):

```dotenv
TURSO_DATABASE_URL=libsql://YOUR-DATABASE-YOUR-ORGANIZATION.turso.io
TURSO_AUTH_TOKEN=YOUR_DATABASE_WRITE_TOKEN
ALLOWED_ORIGINS=https://YOUR-FRONTEND-HOST
CROSS_SITE_COOKIES=true
INSECURE_COOKIES=false
DEMO_MODE=false
```

Use `CROSS_SITE_COOKIES=true` when the frontend and API are on different sites.
For same-origin routing, keep it `false`. The HTTPS proxy must forward
`X-Forwarded-Proto`. Browsers that block third-party cookies may block cross-site
sessions/trials; same-origin API routing avoids that dependency.

Redeploy the Go backend. Startup checks connectivity, applies the versioned
schema migrations (tracked in `idlang_schema_migrations` for Turso), and stores
users, password hashes, sessions, and guest trial
records in Turso. It logs `Connected to Turso libSQL` after success. A partial or
invalid Turso configuration fails startup instead of silently creating a second
set of users in a local SQLite file.

The Go service reads process environment variables; it does not automatically
load `.env` files. For local development, export the variables in your shell or
use your environment loader. Leave both Turso variables unset to use SQLite.

## 3. Configure and deploy the frontend

Set this build-time environment variable on the frontend host:

```dotenv
VITE_API_URL=https://YOUR-GO-BACKEND-HOST
```

Rebuild/redeploy after changing it. All text, transcription, and pipeline calls
include cookies and go through the Go access checks. Do not point this at the
Python model service: it does not implement accounts or guest limits. Likewise,
the combined Python/frontend Docker image needs `VITE_API_URL` pointing to the
Go service for these features. Keep direct model access private or protected if
you need to prevent bypassing the Go service outside this application.

`vercel.json` already rewrites `/admin` to the SPA. Other frontend hosts must also
serve `index.html` for `/admin` and `/admin/` when visited directly.

## 4. Create your administrator

1. Create your own account through the ordinary website registration form.
2. Confirm you can sign in to that account.
3. From a trusted shell with the **same Turso variables as production**, run:

   ```sh
   cd backend
   go run . promote-admin YOUR_ACCOUNT_EMAIL
   ```

   Or, inside the backend container/service shell:

   ```sh
   ./idlang-backend promote-admin YOUR_ACCOUNT_EMAIL
   ```

4. Open **`https://YOUR-FRONTEND-HOST/admin`** and sign in. Reload if you were
   already signed in before promotion. The session resolves the current role
   from the database on every protected request.

There is no default administrator password and no public promotion endpoint.
Registration always creates a member and rejects a supplied `role` field.
The promotion command only upgrades an existing active account with a password.

## 5. Verify the deployment

- In a fresh browser session, open `/`: only translation and account controls show.
- Translate once, confirm the result appears, and close the account prompt.
- Try again and reload: further translations require sign-in.
- Create an account, sign in, and confirm repeated translations work.
- Restart the backend and sign in again: the account must still exist in Turso.
- Visit `/admin` as a member: access must be denied. Visit as your administrator:
  account listings and library review controls must load.

Local regression commands:

```sh
npm ci
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
cd backend
go test ./...
go vet ./...
CGO_ENABLED=0 go build ./...
```

Browser tests use mocked API responses to verify page interactions; Go tests
verify the actual access controls, atomic allowance, expiry and migrations. The
remote transport test verifies TLS, bearer-token handling and redacted errors
against a protocol fixture; it does not replace verification against your real
Turso database. No production URL/token is bundled with this change.

References: [create/import database](https://docs.turso.tech/cli/db/create),
[database tokens](https://docs.turso.tech/cli/db/tokens/create), and
[authentication flow](AUTHENTICATION.md).
