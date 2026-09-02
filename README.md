# Idlang

Idlang is a bidirectional English ↔ Idoma language learning application with speech-to-text (STT), neural machine translation (NMT), and text-to-speech (TTS) capabilities.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   React Frontend│────▶│   Go Backend     │────▶│ Python Service  │
│ (Vite + React)  │     │ (net/http)       │     │ (FastAPI)       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                         │
                    ┌────────────────────────────────────┼────────────────────┐
                    ▼                                    ▼                    ▼
            ┌─────────────────┐              ┌─────────────────┐    ┌─────────────────┐
            │  Dictionary     │              │  NMT Service    │    │  ASR Service    │
            │  Lookup         │              │  (NLLB-200)     │    │  (Wav2Vec2 +    │
            └─────────────────┘              └─��───────────────┘    │   Whisper)      │
                                                                     └─────────────────┘
                                                                              │
                                                                     ┌─────────────────┐
                                                                     │  TTS Service    │
                                                                     │  (VITS +        │
                                                                     │   SpeechT5)     │
                                                                     └─────────────────┘
```

## Features

- **Text Translation**: English ↔ Idoma via dictionary lookup or NMT
- **Speech-to-Text Translation**: Record audio, get transcription + translation
- **Full Pipeline**: Record audio, get transcription + translation + synthesized speech
- **Interactive Learning**: Duolingo-style lessons with questions
- **Red/Black Aesthetic**: Modern UI with Idoma cultural theme

## Tech Stack

### Frontend
- **Framework**: Vite + React 19 + TypeScript
- **Styling**: Tailwind CSS v4
- **API Client**: Fetch API with TypeScript

### Backend
- **Main Server**: Go (net/http)
- **Translation Service**: Python 3.8+ with FastAPI
- **Dictionary**: JSON lookup, served ahead of the model — but see the warning
  under [Configuration](#environment-variables): the bundled file is not
  trustworthy

### ML Models

Every Idoma-specific checkpoint this project was written against is
**`gated: manual`** on Hugging Face — its page loads, but `resolve/main/*` returns
401, so an unattended deploy cannot download it. Naming a gated repo as the default
is what produced the original "English in, English out" bug: the download failed and
the code fell through to a broken fallback. So the defaults in
`translator_service/config.py` are all ungated, and each one names what to switch to
once you have access.

| Role | Default (ungated) | Idoma checkpoint (gated) | Status without access |
|---|---|---|---|
| NMT | `facebook/nllb-200-distilled-600M` | `mrheartng/idu-eng-translator` | **Cannot produce Idoma** — stock NLLB has no `idu_Latn` token. Train your own: `training/train_idoma_nllb.ipynb` |
| ASR (Idoma) | `facebook/wav2vec2-xls-r-300m` | `mrheartng/wav2vec2-xls-r-1b-finetuned-idoma` | Multilingual base, never trained on Idoma — approximate at best |
| ASR (English) | `openai/whisper-small` | — | Works |
| TTS (Idoma) | `microsoft/speecht5_tts` | `mrheartng/idoma-mms-tts-eng` (VITS) | English voice, flagged by an `X-Voice-Warning` header |
| TTS (English) | `microsoft/speecht5_tts` | — | Works |

Override any of them with `NMT_MODEL_ID`, `ASR_IDOMA_MODEL`, `ASR_ENGLISH_MODEL`,
`TTS_IDOMA_MODEL`, `TTS_ENGLISH_MODEL`, and set `HF_TOKEN` for gated repos.

### Training data

The bundled `backend/idoma_dictionary_v2.json` is fabricated and is not used for
training. A real corpus is scraped from idomaland.org by `data_pipeline/`:

```
1,119 dictionary pages crawled -> 1,117 parsed (99.82%) -> 1,251 pairs
989 train / 125 dev / 137 test    1,117 distinct English, 1,068 distinct Idoma
0 placeholder rows, 0 rejected, 0 English keys shared across splits
```

Mostly word-level, so it trains a dictionary-augmented translator rather than a
fluent sentence translator. **The scraped text stays local** (`data_pipeline/out/`
and `cache/` are gitignored); only the trained model is published, crediting
idomaland.org. See [`data_pipeline/README.md`](data_pipeline/README.md) for the
source survey and the parse rules.

## Getting Started

### Prerequisites

- Node.js 18+ (for frontend)
- Go 1.21+ (for backend)
- Python 3.8+ (for translation service)
- npm, pip

### Installation

#### 1. Start Python Translation Service

```bash
# Terminal 1
cd translator_service
pip install -r requirements.txt
uvicorn backup_backend:app --host 0.0.0.0 --port 5005
```

The service will be available at `http://localhost:5005`.

#### 2. Start Go Backend

```bash
# Terminal 2
cd backend
go run main.go
# or
go build -o idlang-backend && ./idlang-backend
```

The backend will be available at `http://localhost:8080`.

#### 3. Start React Frontend

```bash
# Terminal 3
npm run dev
```

The frontend will be available at `http://localhost:5173`.

### Running All Services

```bash
# Terminal 1: Python service
cd translator_service && uvicorn backup_backend:app --port 5005

# Terminal 2: Go backend
cd backend && go run main.go

# Terminal 3: React frontend
npm run dev
```

## Usage

### Translation Modes

1. **Text Mode**: Type English or Idoma text for instant translation
2. **Speech Mode**: Record audio, get transcription + translation
3. **Full Pipeline**: Record audio, get transcription + translation + synthesized speech

### Translation Direction

Toggle between:
- English → Idoma
- Idoma → English

### Learning Mode

Select from pre-built lessons or generate new ones with the `/api/generate-lesson` endpoint.

## API Documentation

### Go Backend (`http://localhost:8080`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/translate` | POST | Translate text (dictionary first, then the model) |
| `/api/transcribe` | POST | Proxy multipart audio to the Python service |
| `/api/pipeline` | POST | Proxy multipart audio through STT → NMT → TTS |
| `/api/generate-lesson` | POST | Generate quiz questions |

### Python Service (`http://localhost:5005`)

Every endpoint is registered twice: bare for the Go backend, and under `/api` for
browsers talking to the service directly (which is what the single-container deploy
needs, since the frontend always calls `/api/*`).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health`, `/api/health` | GET | Health check |
| `/translate`, `/api/translate` | POST | Text translation (NMT) |
| `/transcribe`, `/api/transcribe` | POST | Audio transcription (ASR) |
| `/synthesize`, `/api/synthesize` | POST | Text-to-speech (TTS) |
| `/pipeline`, `/api/pipeline` | POST | Full STT → NMT → TTS flow |

See `translator_service/README.md` for detailed API specs.

## Directory Structure

```
idlang/
├── backend/
│   ├── main.go              # Go HTTP server (dictionary-first, then the model)
│   ├── main_test.go
│   ├── idoma_dictionary_v2.json  # 218 entries, half of them placeholders — see below
│   ├── idoma_dictionary.json     # v1 fallback, bare-string schema
│   ├── Dockerfile           # build with the REPO ROOT as context
│   └── go.mod
├── src/
│   ├── components/
│   │   ├── TranslateView.tsx    # Main translation UI
│   │   ├── LearnView.tsx        # Learning mode UI
│   │   ├── DuolingoLesson.tsx   # Lesson component
│   │   ├── AudioRecorder.tsx    # Audio recording
│   │   ├── AudioPlayer.tsx      # Audio playback
│   │   └── AudioVisualizer.tsx  # Waveform visualization
│   ├── api/
│   │   └── translationClient.ts  # TypeScript API client
│   ├── data/
│   │   └── mockData.ts         # Sample lesson data
│   ├── types.ts               # TypeScript types
│   ├── App.tsx                # Main app component
│   └── main.tsx
├── translator_service/
│   ├── backup_backend.py      # FastAPI application (the REST entrypoint)
│   ├── app.py                 # Gradio app (Hugging Face Space entrypoint)
│   ├── config.py              # Model configuration
│   ├── services/
│   │   ├── nmt_service.py     # NMT service
│   │   ├── asr_service.py     # ASR service
│   │   ├── tts_service.py     # TTS service
│   │   └── model_loader.py    # Model singleton
│   ├── requirements.txt       # Python dependencies
│   ├── README.md              # Hugging Face Space card (Gradio SDK)
│   └── Dockerfile             # API-only image
├── data_pipeline/             # Idoma corpus scraper + builder (see its README)
│   ├── scrape_idomaland.py
│   ├── build_corpus.py
│   ├── test_parser.py         # 50 offline parser tests
│   ├── test_build_corpus.py   # 24 offline cleaning/splitting tests
│   └── eval_seed.tsv          # hand-verified held-out pairs
├── training/
│   └── train_idoma_nllb.ipynb # Colab notebook: adds the idu_Latn token, fine-tunes
├── Dockerfile.frontend        # single-container image: React assets + FastAPI
├── docker-compose.yml         # local three-service stack
├── vercel.json                # Vercel config (SPA rewrite, asset caching)
├── .env.example
└── package.json
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Go backend port | `8080` |
| `TRANSLATOR_URL` | Python service URL | `http://localhost:5005` |
| `VITE_API_URL` | Frontend API URL. **Build-time** — Vite inlines it, so rebuild after changing it. Empty string means same-origin | same origin in a production build, `http://localhost:8080` in `vite dev` |
| `CACHE_DIR` | Model cache directory | `./model_cache` |
| `DEVICE` | Compute device | `cuda` if available |
| `NMT_MODEL_ID` | Translation checkpoint. **Must contain an `idu_Latn` token** to produce Idoma | `facebook/nllb-200-distilled-600M` |
| `IDOMA_LANG_CODE` | Idoma target token | `idu_Latn` |
| `ALLOW_IGBO_FALLBACK` | Accept degraded `ibo_Latn` (Igbo) output when the checkpoint has no Idoma token, instead of erroring | `false` |
| `HF_TOKEN` | Hugging Face token, only needed for gated/private checkpoints | unset |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the Python service directly. A wildcard disables credentialed requests | `*` |
| `FRONTEND_DIR` | Built frontend the Python service should serve, when present | `dist/` beside `backup_backend.py` |
| `DICTIONARY_PATH` | Dictionary file the Go backend loads | `idoma_dictionary_v2.json` |
| `DICTIONARY_FIRST` | Let exact dictionary hits short-circuit the model. Set `false` to always use the model — see the warning below | `true` |

Copy `.env.example` to `.env` for a documented starting point.

> **The bundled dictionary is not trustworthy.** 109 of the 218 entries in
> `backend/idoma_dictionary_v2.json` are the placeholder `ụụ` (now skipped, and
> counted in the startup log), and among the rest `òdò` is given as the
> translation of *black, day, evening, morning, night* and *red* alike. Because
> dictionary hits are served ahead of the model, set `DICTIONARY_FIRST=false` or
> point `DICTIONARY_PATH` at a dictionary you trust once a trained checkpoint is
> deployed. The evidence is in `data_pipeline/README.md`.

### Model Configuration

Models are read from environment variables in `translator_service/config.py`, so
you normally do not need to edit code:

```python
class ModelIDs:
    NMT = NMT_MODEL_ID                                    # $NMT_MODEL_ID
    ASR_IDOMA = os.getenv("ASR_IDOMA_MODEL", "facebook/wav2vec2-xls-r-300m")
    ASR_ENGLISH = os.getenv("ASR_ENGLISH_MODEL", "openai/whisper-small")
    TTS_IDOMA = os.getenv("TTS_IDOMA_MODEL", "microsoft/speecht5_tts")
    TTS_ENGLISH = os.getenv("TTS_ENGLISH_MODEL", "microsoft/speecht5_tts")
```

Two caveats worth knowing:

- `mrheartng/idu-eng-translator`, the checkpoint this project originally pointed
  at, is **gated** (`gated: manual`): its page loads but `resolve/main/*` returns
  401, so the weights cannot be downloaded. Train your own with
  `training/train_idoma_nllb.ipynb` and set `NMT_MODEL_ID` to it.
- The Idoma ASR and TTS checkpoints are gated the same way, so the defaults above
  are ungated stand-ins — Idoma transcription runs on a base model that has never
  seen Idoma, and Idoma synthesis needs a **VITS/MMS-TTS** checkpoint specifically
  (`synthesize_idoma` reads `.waveform` from the model output, which only VITS
  provides). SpeechT5 is not VITS, so Idoma audio is synthesized with the
  **English voice** and the `/synthesize` response carries an `X-Voice-Warning`
  header saying so. See the table under [ML Models](#ml-models) for what to set
  each variable to once access is granted.

## Error Handling

The application handles errors gracefully:

- **Service Unavailable**: Shows fallback message
- **Model Loading Failure**: Logs and displays error
- **Audio Too Long**: Rejects files >30 seconds
- **Dictionary Miss**: Returns "Missing from Idlang archives"

## Performance

| Operation | Target Latency |
|-----------|---------------|
| Text translation | <500ms |
| Audio transcription (10s) | <2s |
| TTS synthesis | <3s |
| Full pipeline (10s audio) | <10s |

## Development

### Adding Dictionary Words

Edit `backend/idoma_dictionary_v2.json`:

```json
{
  "category_name": {
    "english_word": {
      "idoma": "ìdómá",
      "tone": "high-low-high",
      "pos": "noun",
      "example": "example usage"
    }
  }
}
```

### Running Tests

```bash
# Go backend
cd backend && go test ./...

# Corpus pipeline (offline, no network needed)
python3 data_pipeline/test_parser.py
python3 data_pipeline/test_build_corpus.py

# Python service tests
cd translator_service && python -m pytest tests/

# Frontend: there is no test runner configured yet; `npm run lint` and
# `npm run build` (which type-checks via `tsc -b`) are the current gate.
npm run lint && npm run build
```

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full guide. The short version:

1. **Train a model first.** Run `training/train_idoma_nllb.ipynb` on Colab. Stock
   NLLB-200 has no `idu_Latn` token and cannot produce Idoma — that was the
   original "English in, English out" bug.
2. **Set `NMT_MODEL_ID`** to the resulting checkpoint wherever the Python service
   runs, and confirm the repo is public and ungated:
   `curl -sI https://huggingface.co/<user>/<repo>/resolve/main/config.json` → 200.
3. **Frontend → Vercel.** `vercel --prod`, with `VITE_API_URL` set to the backend
   URL. It is inlined at build time, so redeploy after changing it.
4. **Backend → a host with ~2.5GB RAM** (Hugging Face Docker Space, Fly.io, or
   Render), with `CORS_ORIGINS` set to your Vercel origin.

Or run everything in one container:

```bash
docker build -f Dockerfile.frontend -t idlang .
docker run -p 7860:7860 -e NMT_MODEL_ID=<user>/nllb-eng-idoma idlang
```

Verify any deployment with the test that actually matters:

```bash
curl -s <host>/api/translate -H 'Content-Type: application/json' \
  -d '{"text":"water","source_lang":"English","target_lang":"Idoma"}'
# expect Ennkpo (central) or Enyi (western) — NOT "water"
```

## Resources

- [Idoma Language](https://en.wikipedia.org/wiki/Idoma_language)
- [NLLB Documentation](https://huggingface.co/docs/transformers/model_doc/nllb)
- [Wav2Vec2](https://huggingface.co/docs/transformers/model_doc/wav2vec2)
- [Whisper](https://github.com/openai/whisper)
- [VITS](https://github.com/jaywalnut310/vits)

## License

MIT
