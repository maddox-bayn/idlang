# System and UX audit — 2026-11-06

## 1. Executive summary and architecture health

**Assessment before correction: 5/10 — functional prototype, with significant reliability and accessibility defects.** This is an engineering judgment, not a Lighthouse score. Public translation and sign-in UI were inspected on the deployed site; implementation and local automated tests cover additional flows. Authenticated production administration and translation accuracy were not certified.

The application is a React/Vite SPA on Vercel, a Go API on Render, Turso for durable relational data, and a separate translation service. Same-origin API rewrites and server-side sessions are appropriate. The critical defects were lifecycle and error semantics rather than the framework choices:

- The translation failure fallback could write two JSON documents and report a fabricated archive message as HTTP 200. This also incorrectly consumed the guest trial.
- Browser fetches had no bounded lifetime. Translation direction and mode could change during an active operation, creating ambiguous results.
- Community screens were eagerly included in the translator entry bundle; navigation state did not survive browser navigation.
- Media recording had timer/cleanup and container-labeling problems.
- The sign-in overlay lacked reliable modal focus behavior and associated form labels.

Initial production JavaScript decreased from **316.41 kB (88.25 kB gzip)** to approximately **253.66 kB (77.83 kB gzip)**, about **20% raw / 12% compressed**. These are Vite bundle measurements, not measured user-perceived latency or Core Web Vitals.

## 2. UI/UX deep dive

### Visual hierarchy and layout

**Problem:** Low-emphasis dark red/gray helper text competed with decorative branding; controls and long text needed narrow-screen safeguards.

**Correction:** Preserved the red/black identity while using neutral text for instructional content, a distinct input label, a character counter, clearer primary actions, wrapping direction controls, and a viewport-constrained dialog. The dialog header has clearance for its close button. The 320px viewport regression checks horizontal overflow with long input and an open registration dialog.

### Interaction design

**Problem:** A spinner alone did not explain a cold backend or translation work. Enter unexpectedly submitted multiline text; changing modes while processing could mislabel results. “Full Pipeline” exposed implementation terminology. Failed/malformed translations could appear successful. Recording could continue past its intended duration or deliver a cancelled result.

**Correction:** Explicit connection/processing statuses, operation locking, Enter for newline and Ctrl/Cmd+Enter to translate, “Voice translation” naming, validated responses, and errors with retry paths. Microphone capture stops at 30 seconds, releases tracks, discards cancelled captures, and preserves the real audio MIME/container. Recorded input and synthesized output have separate URLs.

### Accessibility

**Problem:** Unassociated labels, missing pressed states/status announcements, no skip link or reduced-motion treatment, and unreliable keyboard containment in authentication.

**Correction:** Associated labels, `aria-pressed`, `role="status"`, error alerts, a skip link, visible keyboard outlines that override component outline suppression, reduced-motion CSS, and native `<dialog>` semantics with explicit Tab/Shift+Tab wrapping, Escape dismissal, scroll locking, and focus restoration. Authentication controls are disabled while a request is pending.

These changes are not a claim of complete WCAG conformance. Manual assistive-technology and cross-browser audits remain necessary.

## 3. Direct corrections and code refactoring

All paths below refer to implemented code, not proposed pseudocode. Snippets are excerpts; the files contain the complete implementation.

### A. Stop false-success translation responses

**Problem:** The deferred gateway fallback always wrote a placeholder, including after writing a successful gateway result; it also ignored the requested translation direction.

**Correction — `backend/main.go`:** Keep dictionary/model success paths; return a single structured 503 when inference fails. The existing guest-access middleware refunds failed requests.

```go
writeError(w, http.StatusServiceUnavailable,
    "Translation service is unavailable. Please try again.")
```

`src/api/translationClient.ts` additionally rejects absent, empty, and incorrectly typed translation fields, instead of manufacturing a translation. This deliberately removes the unreliable gateway fallback from the translation request path.

### B. Bound requests and propagate cancellation

**Problem:** Stalled headers/body streams could leave the interface busy indefinitely; navigation did not reliably stop obsolete work.

**Correction — `src/api/request.ts`, both API clients, `TranslateView.tsx`, `backend/main.go`:** AbortController deadlines cover fetch and body consumption. Caller cancellation propagates into fetch; Go inference requests use the incoming context. Defaults: ordinary API 20 seconds, text 100 seconds, audio 125 seconds; upstream text/audio limits remain 90/120 seconds. The two-stage speech path has a deadline for each stage, not a single overall deadline. No automatic mutation retries are introduced.

```ts
const response = await fetch(url, { ...init, signal: controller.signal });
const body = await response.arrayBuffer();
```

```go
request, err := http.NewRequestWithContext(ctx, http.MethodPost,
    fmt.Sprintf("%s/translate", translatorURL), bytes.NewBuffer(b))
```

A synchronous ref guard prevents overlapping translation submissions. Mode, direction, clear, and relevant inputs are disabled during processing. Unmount aborts work and prevents late results from updating the view. A missing guest cookie rechecks access rather than claiming the free trial was consumed.

### C. Reject oversized and ambiguous input

**Problem:** Translation input lacked consistent limits; JSON decoding accepted concatenated documents; audio proxies accepted unbounded incoming bodies.

**Correction — `backend/auth.go`, `backend/main.go`, `TranslateView.tsx`:** Require exactly one JSON value, reject unknown fields, cap translation JSON at 32 KiB and text at 4,000 Unicode code points, allow only opposite English/Idoma directions, and cap audio requests at 10 MiB. The browser caps input at 4,000 UTF-16 code units (slightly stricter for astral characters).

```go
if err := dec.Decode(dst); err != nil { return err }
var extra any
if err := dec.Decode(&extra); err != io.EOF {
    if err != nil { return err }
    return fmt.Errorf("request must contain exactly one JSON value")
}
```

The Go HTTP server now sets header/read/write/idle deadlines of 5/30/150/60 seconds and a 1 MiB header limit. These protect resource occupancy; they do not replace upstream capacity planning.

### D. Reduce entry cost and restore navigation semantics

**Problem:** Opening the translator loaded unrelated community UI, and tab state was disconnected from the URL.

**Correction — `src/App.tsx`:** Lazy-load Feed, Library, Learn, Profile, and Connections with Suspense status fallbacks. Store the selected community section in `?view=...`; use `pushState` and `popstate` for deep links and Back navigation. Guests still see only the translator; backend authorization remains the authority.

```tsx
const LibraryView = lazy(() => import("./components/LibraryView"));
```

### E. Make authentication predictable and keyboard accessible

**Problem:** A custom overlay did not implement robust dialog focus; nested error overlays and heuristic account-not-found handling obscured errors.

**Correction — `src/components/AuthModal.tsx`:** Use a labelled native dialog, explicit focus wrapping/restoration, inline error alerts, disabled pending controls, input autocomplete metadata, and frontend username/password-byte validation consistent with registration API limits. No credential storage or session-token policy was changed.

### F. Make recording lifecycle deterministic

**Problem:** Stale timer state, microphone cleanup, cancellation callbacks, and incorrect `.wav` filenames could produce broken audio submissions.

**Correction — `src/components/AudioRecorder.tsx`, `translationClient.ts`, `TranslateView.tsx`:** Use monotonic elapsed time and refs for recorder/stream/timer; stop tracks on completion, failure, and unmount; stop late permission-granted streams after unmount; select a supported recording type; derive the upload filename from the Blob MIME type. Cancelled recordings do not become translation input. Input object URLs are revoked separately from generated output.

### G. Improve form and action semantics

**Problem:** Placeholder-only identification, hidden keyboard focus, weak status feedback, and unfamiliar action wording.

**Correction — `TranslateView.tsx`, `AuthModal.tsx`, `App.tsx`, `index.css`:** Labelled input, character count, live statuses/results, inline alerts, pressed states, skip link, global visible focus and reduced-motion preferences. Keep Enter for editing and Ctrl/Cmd+Enter for submission. These changes are covered by keyboard and viewport regressions.

## 4. Edge cases and stress tests

| Failure scenario | Implemented architectural correction | Verification |
| --- | --- | --- |
| Backend accepts request but stalls response body | Abort deadline covers body; clear error; no unsafe automatic retry | Frontend deadline/body tests |
| Repeated clicks or direction changes while translating | Synchronous operation guard and disabled dependent controls | Browser delayed-response test |
| Model unavailable | Structured 503, no archive placeholder or concatenated JSON; existing failed-request quota refund remains applicable | Go inference-failure test and existing guest-access tests |
| Malformed/oversized input | Strict single-document decoder, body/text/audio limits, language whitelist | Go request-limit tests |
| Microphone left running or capture cancelled | Elapsed-time auto-stop, stopped tracks, discarded cancelled callbacks | Browser mocked-media test |
| Missing guest cookie | Recheck access; do not claim successful trial consumption | Browser 401 regression |
| Long text at 320px width | Wrapped controls, constrained layout/dialog, bounded input | Browser overflow regression |
| Keyboard-only sign-in | Focus wrap, Escape dismissal, focus restoration | Browser dialog regression |
| Member refreshes/deep-links/navigates Back | URL-driven section state with popstate listener | Browser navigation regression |

## Validation and remaining limits

- TypeScript production build and ESLint pass.
- 20 frontend unit tests pass.
- 12 Chromium end-to-end tests pass; API and microphone responses are mocked. They do not prove live model or database availability.
- Go test suite passes, including `-race`; `go vet` passes.
- No production load was generated. This is a bounded-input/lifecycle regression suite, not a throughput benchmark.

Operational follow-up: measure cold/warm translation latency and error rate before choosing always-on inference/Render capacity. If requests routinely exceed the synchronous timeout budget, use a durable job queue with job IDs, status polling, cancellation, and explicit quota settlement rather than simply extending timeouts. Profile Turso query latency and connection contention under representative concurrency before changing connection limits. A cookie-based anonymous trial is a product gate, not strong abuse prevention; independent rate limiting remains necessary. Model quality needs held-out bidirectional evaluation and native-speaker review; UI changes cannot establish translation accuracy. Production admin-account status and private UI were not verified with a real signed-in account. Full screen-reader, Safari, and Firefox coverage remains outstanding.
