# Deploying Idlang

## Read this first

**One environment variable decides whether this app works: `NMT_MODEL_ID`.**

Stock NLLB-200 has no Idoma. Its tokenizer holds 202 language codes and `idu_Latn`
is not one of them, so it resolves to `<unk>` and the decoder, given no
target-language signal, copies the input. That is the "English in, English out"
bug — not a serving bug, a missing-language bug:

```
eng_Latn -> 256047  ok
ibo_Latn -> 256073  ok
idu_Latn -> 3       <unk>   <-- Idoma
```

So before deploying:

1. Train a checkpoint with `training/train_idoma_nllb.ipynb` (Colab, free T4). It
   adds `idu_Latn`, resizes the embeddings, seeds the new row from `ibo_Latn`, and
   pushes to **your own public, ungated** repo.
2. Set `NMT_MODEL_ID=<your-username>/nllb-eng-idoma` everywhere the Python service
   runs.

If you skip this, the service now returns a clear configuration error for Idoma
instead of silently handing back English. That is deliberate.

**Do not deploy a gated model.** The original failure chain was exactly this:
`mrheartng/idu-eng-translator` is `gated: manual`, its `resolve/` endpoints return
401, so the code fell through to stock NLLB. Verify yours is reachable without a
token:

```bash
curl -sI https://huggingface.co/<user>/nllb-eng-idoma/resolve/main/config.json | head -1
# expect: HTTP/2 200      (401 means gated — the deploy will silently degrade)
```

---

## Topologies

| | Frontend | API | When to use |
|---|---|---|---|
| **A. Single container** | served by FastAPI | same origin | Simplest. One Hugging Face Docker Space, no CORS, no second host. |
| **B. Split** | Vercel | separate backend host | What you asked for. Frontend on Vercel's CDN, model on a box with real RAM. |

Both are supported by the code: every Python endpoint is registered twice, bare
(`/translate`, for the Go backend) and under `/api` (`/api/translate`, for
browsers). The frontend always calls `/api/*`.

---

## Path A — single container (simplest)

Builds the React assets and serves them from the same FastAPI process that answers
`/api/*`. No CORS configuration, nothing to keep in sync.

```bash
docker build -f Dockerfile.frontend -t idlang .
docker run -p 7860:7860 -e NMT_MODEL_ID=<user>/nllb-eng-idoma idlang
# open http://localhost:7860
```

`VITE_API_URL` defaults to empty in this image, which means same-origin. Do not set
it here.

### As a Hugging Face Docker Space

1. Create a Space → SDK **Docker**.
2. Push this repo to it.
3. Rename `Dockerfile.frontend` to `Dockerfile` (Spaces looks for that name), or
   add one line: `FROM idlang` is not enough — copy the file instead.
4. Space **Settings → Variables**: `NMT_MODEL_ID=<user>/nllb-eng-idoma`.
5. Space **Settings → Secrets**: `HF_TOKEN` — only if your model is private.

Spaces requires port 7860, which the image already exposes.

> The existing Space in `translator_service/README.md` is a **Gradio** Space
> (`sdk: gradio`) running `app.py`. That serves the Gradio UI, not the React app,
> and does not expose `/api/*`. It is fine on its own, but a Vercel frontend
> cannot call it — use a Docker Space for Path B.

---

## Path B — Vercel frontend + hosted backend

### B1. Deploy the Python translator service

It needs ~2.5GB of RAM for the 600M model, so free tiers with 512MB will OOM. The
Hugging Face free CPU tier (16GB) is comfortable; Fly and Render need resizing.

**Hugging Face Gradio Space** (free — start here):

Docker Spaces now require billing on the account, and `cpu-basic` requires PRO, so the
free route is a **Gradio Space on ZeroGPU**. That is not a limitation: Gradio is a
FastAPI app underneath, and `space_app.py` mounts the Gradio UI beneath the FastAPI app
from `backup_backend.py`, so one free Space serves the UI *and* `/api/*`.

1. Create a Space → SDK **Gradio** → hardware **ZeroGPU**. It is free for a personal
   account in good standing (verified email, older than 30 days), up to 2 such Spaces.
   Requesting ZeroGPU on a *Docker* Space instead fails with
   `CONFIG_ERROR: ZeroGPU is only available on Gradio SDK`.
2. Push the *contents of* `translator_service/` to the Space root.
3. Use `README.space-gradio.md` as the Space's `README.md`. It sets
   `app_file: space_app.py`, which is what makes Spaces run the composed
   FastAPI+Gradio entry point instead of the UI alone.
4. Space **Settings → Variables**:

```
NMT_MODEL_ID=emoduh/nllb-eng-idoma
CORS_ORIGINS=https://<your-project>.vercel.app
```

`PORT` is unnecessary — Spaces routes to 7860 and `space_app.py` defaults to it.

**The models run on CPU on this tier, by design.** ZeroGPU lends a GPU only for the
duration of an `@spaces.GPU` call, driven by Gradio's event loop — a FastAPI route can
never hold that allocation — and a free account gets 5 minutes of GPU time per day,
which a few dozen sentences would spend. So `space_app.py` sets `DEVICE=cpu` for the
whole process before anything reads it: no variable to set, no quota consumed, both
interfaces working, a few seconds per sentence.

Route precedence is registration order in Starlette: `backup_backend` registers its
routers at import, before the mount at `/`, so `/api/*` and the bare paths always
win and only unmatched paths reach the Gradio UI.

**Hugging Face Docker Space** (needs billing; use if you have it):

1. Create a Space → SDK **Docker** → CPU basic.
2. Push the *contents of* `translator_service/` to the Space root, so its
   `Dockerfile` lands at the top level where Spaces looks for it.
3. Use `README.space-docker.md` as the Space's `README.md`. The `README.md` already
   in that directory declares `sdk: gradio` — Spaces reads `sdk:` from `README.md`
   alone, so pushing that one makes Spaces ignore the `Dockerfile` and try to launch
   Gradio. The Docker card also sets `app_port: 7860`.
4. Space **Settings → Variables**:

```
NMT_MODEL_ID=emoduh/nllb-eng-idoma
CORS_ORIGINS=https://<your-project>.vercel.app
PORT=7860
```

`CORS_ORIGINS` matters: it defaults to `*`, and a wildcard origin cannot be
combined with credentialed requests, so name your real origin in production.

`DICTIONARY_FIRST` has no effect here — only the Go backend reads the dictionary.
This service always answers from the model.

No secret is required — `emoduh/nllb-eng-idoma` is public and ungated. Add `HF_TOKEN`
as a Secret only for a gated or private checkpoint.

The model loads lazily, on the first translation rather than at boot, so `/health`
turns green minutes before `/api/translate` will answer. Without the
persistent-storage add-on the 2.46GB download repeats after every restart; with it,
add `CACHE_DIR=/data/model_cache`.

To check the image locally first:

```bash
docker build -f translator_service/Dockerfile -t idlang-translator translator_service
docker run -p 7860:7860 -e PORT=7860 \
  -e NMT_MODEL_ID=emoduh/nllb-eng-idoma idlang-translator
```

**Fly.io:**

```bash
fly launch --dockerfile translator_service/Dockerfile --no-deploy
fly scale memory 4096
fly secrets set NMT_MODEL_ID=emoduh/nllb-eng-idoma
fly secrets set CORS_ORIGINS=https://<your-project>.vercel.app
fly deploy
```

**Render:** New → Web Service → Docker, `translator_service/Dockerfile`, instance
with ≥2GB RAM, same environment variables. Render assigns the port through `PORT`,
which the image now honours.

Verify before moving on:

```bash
curl https://<backend-host>/health
curl -s https://<backend-host>/api/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"water","source_lang":"English","target_lang":"Idoma"}'
```

The response must not contain `"water"`. If it does, `NMT_MODEL_ID` is wrong or
the checkpoint has no `idu_Latn` token.

### B2. Optional: the Go backend

The Go service adds exact dictionary lookup ahead of the model, plus
`/api/generate-lesson`. It is optional — the frontend works against the Python
service directly. If you deploy it, point the browser at Go and Go at Python:

```bash
docker build -f backend/Dockerfile -t idlang-backend .   # context is the repo root
docker run -p 8080:8080 -e TRANSLATOR_URL=https://<backend-host> idlang-backend
```

Note the bundled dictionary is not trustworthy: 109 of its 218 entries are the
placeholder `ụụ` (now skipped, and reported at startup), and among the rest `òdò`
is given for *black, day, evening, morning, night* and *red* alike. Because
dictionary hits short-circuit the model, once your trained checkpoint is live
either replace the file with `DICTIONARY_PATH` or turn the shortcut off:

```bash
DICTIONARY_FIRST=false
```

### B3. Deploy the frontend to Vercel

`vercel.json` is already in the repo (Vite preset, `dist` output, SPA rewrite that
excludes `/api/*`, immutable caching for hashed assets).

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # production
```

Or import the repo at <https://vercel.com/new> — the framework is detected.

Set **one** environment variable in Vercel → Settings → Environment Variables:

```
VITE_API_URL = https://<backend-host>
```

It is a build-time variable — Vite inlines `VITE_*` into the bundle — so
**redeploy after changing it**. Changing it in the dashboard alone does nothing to
an already-built deployment.

Values it accepts:

| Value | Meaning |
|---|---|
| `https://api.example.com` | send `/api/*` there |
| *(empty string)* | same origin — for Path A |
| *(unset)* | same origin in a production build, `http://localhost:8080` in `vite dev` |

---

## Local development

```bash
# terminal 1 — Python translator
cd translator_service
pip install -r requirements.txt
NMT_MODEL_ID=<user>/nllb-eng-idoma uvicorn backup_backend:app --host 0.0.0.0 --port 5005

# terminal 2 — Go backend (optional)
cd backend && go run .

# terminal 3 — frontend
npm install && npm run dev     # http://localhost:5173, proxies /api to :8080
```

Or the whole stack:

```bash
cp .env.example .env     # then set NMT_MODEL_ID
docker compose up --build
# frontend  http://localhost:7860
# backend   http://localhost:8080
# translator http://localhost:5005
```

Compose runs on CPU by default. For a GPU, set `DEVICE=cuda` and uncomment the
`deploy:` block under `translator` — it needs the NVIDIA container toolkit, and
leaving it enabled on a CPU-only host makes `up` fail outright.

---

## Environment variables

### Python translator service

| Variable | Default | Notes |
|---|---|---|
| `NMT_MODEL_ID` | `facebook/nllb-200-distilled-600M` | **Set this** to `emoduh/nllb-eng-idoma`. The stock default cannot produce Idoma. |
| `IDOMA_LANG_CODE` | `idu_Latn` | Change only if your checkpoint uses another code. |
| `ALLOW_IGBO_FALLBACK` | `false` | Emit Igbo with a warning instead of erroring. Igbo is not Idoma. |
| `HF_TOKEN` | — | Gated/private repos only. Never commit it. |
| `CORS_ORIGINS` | `*` | Comma-separated browser origins. Set it in production. |
| `DEVICE` | autodetect (`cpu` under `space_app.py`) | `cuda` or `cpu`. Do not force `cuda` without a GPU — and note ZeroGPU has one only inside a Gradio event, so the Space entry point pins `cpu`. |
| `CACHE_DIR` | `./model_cache` | Mount a volume here to avoid re-downloading ~2.5GB. |
| `PORT` | `5005` | Hugging Face Spaces requires `7860`. |
| `FRONTEND_DIR` | `./dist` beside the module | Static build to serve, if present. |

### Go backend

| Variable | Default | Notes |
|---|---|---|
| `TRANSLATOR_URL` | `http://localhost:5005` | Where the Python service lives. |
| `PORT` | `8080` | |
| `DICTIONARY_PATH` | `idoma_dictionary_v2.json` | Point at a dictionary you trust. |
| `DICTIONARY_FIRST` | `true` | `false` sends every request to the model. |

### Frontend (build time)

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | same origin in prod | Must be reachable from the **browser**, not from inside Docker. |

---

## Verifying a deployment

```bash
# 1. the service is up
curl https://<backend-host>/health

# 2. it actually translates — this is the test that matters
curl -s https://<backend-host>/api/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"water","source_lang":"English","target_lang":"Idoma"}'
```

Expect Idoma (`Ennkpo` central, `Enyi` western). Three failure signatures:

| Response | Cause |
|---|---|
| `"translation": "water"` | Echoing the input. `NMT_MODEL_ID` points at a checkpoint with no `idu_Latn`. |
| HTTP 500, *"has no 'idu_Latn' token"* | The guard working as intended. Set `NMT_MODEL_ID`. |
| `"warning": "...Igbo..."` | `ALLOW_IGBO_FALLBACK=true` is on and you are getting Igbo. |

Then in the browser: open the Vercel URL, translate a word, and check the Network
tab shows requests going to your backend and not to `localhost:8080` (that means
`VITE_API_URL` was missing at build time — redeploy).

---

## Troubleshooting

**Everything returns English.** The one bug this whole change set exists to fix.
Check `NMT_MODEL_ID`, then verify the checkpoint directly:

```python
from transformers import AutoTokenizer
tok = AutoTokenizer.from_pretrained("<user>/nllb-eng-idoma")
print(tok.convert_tokens_to_ids("idu_Latn"), tok.unk_token_id)  # must differ
```

**CORS errors in the browser console.** Set `CORS_ORIGINS` to your exact Vercel
origin, scheme included, no trailing slash.

**Vercel build fails on TypeScript.** `npm run build` runs `tsc -b` first. Run it
locally to see the same errors.

**404 on `/api/translate` in the single container.** You are running an old image;
the `/api` aliases were added in `backup_backend.py`. Rebuild.

**Space restarts / OOM.** The 600M model needs ~2.5GB. Use a larger instance, or
`facebook/nllb-200-distilled-600M` is already the small one — there is no lighter
option that supports the added token.

**Model re-downloads on every restart.** Mount a volume at `CACHE_DIR`.

**Audio routes fail with "python-multipart required".** `pip install -r
translator_service/requirements.txt` — it is listed there; an older image may
predate it.

**Space dies with "No @spaces.GPU function detected during startup".** The message names
the wrong cause, and the log looks healthy right up to `Uvicorn running on
http://0.0.0.0:7860` followed by `Shutting down`. `spaces` POSTs its readiness report from
inside `gr.Blocks.launch`, which it monkey-patches at import
(`gradio.one_launch(startup)`). `space_app.py` never calls `launch()` — it serves the
composed FastAPI+Gradio app with uvicorn — so the report must be sent by hand, which
`_zerogpu_startup_report()` does immediately before binding. If you replace that entry
point with something that also bypasses `launch()`, carry that call across. Note the probe
function alone is not enough: `startup()` early-returns when no `@spaces.GPU` function is
registered, so you need both the probe *and* the report.

**UI loads but the translate buttons do nothing; `/_app/immutable/*` all 404.** The
container log shows `Invalid port: '7861_appimmutableassets0.D0c57pBM.css'` — the request
path with every slash removed, appended to a port. Hugging Face sets `GRADIO_SSR_MODE=true`
(Gradio's own default is `False`), which starts a Node SSR server and installs a middleware
proxying non-internal paths to it. That proxy does
`full_path.replace(mounted_path, "")`, and with the app mounted at `path="/"` this strips
*all* slashes, producing `http://0.0.0.0:7861_appimmutable...`. httpx rejects the port and
the handler's bare `print(e)` swallows the traceback. `space_app.py` therefore passes
`ssr_mode=False`, which skips that middleware entirely and serves Gradio's client-rendered
bundle. Keep it off, or mount at a real subpath instead of `/`.

Related: **do not trust `PORT` on a Space.** Gradio's `start_node_server` does
`env = os.environ; env["PORT"] = str(port)` — an alias, not a copy — so starting the SSR
Node server rewrites `PORT` to `7861` inside the Python process. Hugging Face routes
external traffic to 7860 regardless, so `_choose_port()` prefers 7860 whenever `SPACE_ID`
is set and only falls back to `PORT`. On Render and Fly, where the assigned `PORT` really
is the routed one, that precedence flips.

**Idoma audio sounds like English.** It is English. Idoma synthesis requires a
VITS/MMS-TTS checkpoint (the code reads `.waveform`, which only VITS returns). One
exists — `mrheartng/idoma-mms-tts-eng` — but it is `gated: manual`, so an
unattended deploy cannot download it, and defaulting to it would repeat the
original failure: a gated model that 401s and falls through. The default
`TTS_IDOMA_MODEL` is therefore SpeechT5, so the service loads the English voice
instead and sets an `X-Voice-Warning` header on `/synthesize`. Once you have been
granted access, set `TTS_IDOMA_MODEL=mrheartng/idoma-mms-tts-eng` and supply
`HF_TOKEN`. English TTS keeps working either way — the two models are loaded
independently, so a bad `TTS_IDOMA_MODEL` no longer takes all synthesis down.

---

## What not to publish

The scraped corpus in `data_pipeline/out/` stays local. It is derived from
idomaland.org and is not ours to redistribute; `.gitignore` and `.dockerignore`
both exclude it. Only the trained model ships, crediting idomaland.org in its
model card.

Also: `.clauderc` contains a bearer token. It is gitignored, but it has existed on
disk in plaintext — rotate it.
