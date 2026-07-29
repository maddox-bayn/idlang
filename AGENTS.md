# Idlang: The Guardian of History

This is a Vite + React SPA with a Go backend for the Idlang Idoma language learning application.

## Project Structure
- `src/` — React frontend (Vite + TypeScript + Tailwind CSS v4)
- `backend/` — Go API server (net/http)
- `vite.config.ts` proxies `/api` to `localhost:8080`

## Running the app
- Frontend: `npm run dev` (starts Vite on :5173)
- Backend: `cd backend && go run main.go` (starts Go on :8080)

## Key conventions
- Red (#dc2626) & Black (#000) aesthetic
- Serif fonts for headings, sans-serif for UI
- Mock data in `src/data/mockData.ts` is primary; Go/OmniRoute is fallback
