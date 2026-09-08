What this is
Idlang is a bidirectional English ↔ Idoma language learning application built with a modern three-tier stack: React frontend (Vite), Go backend, and Python translation microservice. It provides text translation, speech-to-text transcription, neural machine translation, and text-to-speech synthesis capabilities for the Idoma language spoken in Benue State, Nigeria.

Stack
Languages: TypeScript (frontend), Go (backend), Python (ML service)
Framework/runtime: Vite 6 + React 19 | Go 1.21 net/http | Python 3.8+ FastAPI
Notable libraries: Tailwind CSS v4, Zustand (state), torch + transformers + torchaudio (ML), librosa + soundfile (audio I/O)
How it's organized
Code
idlang/
├── src/                         React SPA (Vite + TypeScript + Tailwind CSS v4)
│   ├── components/
│   │   ├── TranslateView.tsx    Main translation UI (text/speech modes)
│   │   ├── LearnView.tsx        Learning/lesson UI
│   │   ├── DuolingoLesson.tsx   Quiz component
│   │   ├── AudioRecorder.tsx    Microphone input
│   │   ├── AudioPlayer.tsx      Audio playback
│   │   └── AudioVisualizer.tsx  Waveform display
│   ├── api/
│   │   └── translationClient.ts TypeScript fetch client to Go backend
│   ├── data/
│   │   └── mockData.ts          Hardcoded lesson/quiz fallbacks
│   ├── types.ts                 Shared TypeScript interfaces
│   ├── App.tsx                  Two-tab layout (Translate | Learn)
│   └── main.tsx                 Entry point
│
├── backend/                     Go HTTP server (net/http, no framework)
│   ├── main.go                  Router + translation handlers
│   │   ├── /api/translate       Dictionary-first, then Python NMT, then OmniRoute
│   │   ├── /api/transcribe      Proxy audio to Python ASR
│   │   ├── /api/pipeline        Proxy audio through STT→NMT→TTS
│   │   └── /api/generate-lesson Mock lesson generator
│   ├── idoma_dictionary_v3.json Primary dictionary (226 curated tone-marked entries, committed)
│   ├── idoma_dictionary.json    v1 fallback, bare-string schema (now a subset of v3)
│   ├── Dockerfile               Multi-stage build
│   └── go.mod                   Module definition
│
├── translator_service/          Python FastAPI microservice (ML models)
│   ├── backup_backend.py        REST API server
│   │   ├── /translate           NMT (facebook/nllb-200 or fine-tuned)
│   │   ├── /transcribe          ASR (Whisper for English, Wav2Vec2 for Idoma)
│   │   ├── /synthesize          TTS (SpeechT5 or VITS)
│   │   ├── /pipeline            Combined STT→NMT→TTS
│   │   └── /health              Service readiness
│   ├── services/
│   │   ├── nmt_service.py       Translation via NLLB-200
│   │   ├── asr_service.py       Speech-to-text
│   │   ├── tts_service.py       Text-to-speech
│   │   └── model_loader.py      Singleton model cache (CUDA-aware)
│   ├── config.py                Environment variable parsing
│   ├── requirements.txt         PyTorch, transformers, FastAPI, Gradio
│   ├── app.py                   Gradio UI (Hugging Face Spaces fallback)
│   └── Dockerfile               FastAPI entrypoint
│
├── data_pipeline/               Corpus scraper + builder (Python)
│   ├── scrape_idomaland.py      Crawls idomaland.org/dictionary
│   ├── build_corpus.py          Cleans + dedupes + splits train/dev/test
│   ├── test_parser.py           50 parser tests (offline)
│   ├── test_build_corpus.py     24 cleaning/split tests (offline)
│   └── eval_seed.tsv            Hand-verified pairs for holdout testing
│
├── training/
│   └── train_idoma_nllb.ipynb   Colab notebook: adds idu_Latn token to NLLB
│
├── docker-compose.yml           Local dev stack (frontend :7860, backend :8080, translator :5005)
├── Dockerfile.frontend          Single-container image: React + FastAPI
├── vite.config.ts               Proxies /api to :8080 during dev
├── package.json                 npm scripts + dependencies
└── vercel.json                  SPA rewrite config for Vercel
How it fits together:

Frontend (React on :5173 locally, or built assets on :7860): User types or records audio, calls Go backend at /api/*.
Go Backend (net/http on :8080):
Loads dictionary (v3 → v2 fallback) at startup
Text translation: tries dict lookup first (if DICTIONARY_FIRST=true), then calls Python /translate, then falls back to OmniRoute LLM
Audio: proxies /transcribe and /pipeline requests to Python service (multipart streaming)
Python Service (FastAPI on :5005):
Lazy-loads ML models on first request (CUDA-aware via spaces package for Hugging Face ZeroGPU)
NMT: stock facebook/nllb-200-distilled-600M (cannot produce Idoma tokens—needs fine-tuned checkpoint)
ASR: Whisper (English), Wav2Vec2-XLS-R (Idoma base, never seen real Idoma data)
TTS: SpeechT5 English voice (no Idoma model available; returns X-Voice-Warning header)
Reports warnings when checkpoint cannot emit authentic Idoma
Data flow: Browser → vite proxy (dev) or frontend assets (prod) → Go backend → Python service → HuggingFace models (cached on disk).

How to run it
Prerequisites:

Node.js 18+, Go 1.21+, Python 3.8+
Three terminal windows:

bash
# Terminal 1: Python translator service
cd translator_service
pip install -r requirements.txt
uvicorn backup_backend:app --host 0.0.0.0 --port 5005

# Terminal 2: Go backend
cd backend
go run main.go
# or: go build -o idlang-backend && ./idlang-backend

# Terminal 3: React frontend (dev server with Vite proxy)
npm run dev
Visit http://localhost:5173 (frontend) → autocalls http://localhost:8080/api/* (backend) → backend proxies to http://localhost:5005/* (Python).

Alternatively, run all three in one container:

bash
docker-compose up
# Frontend: http://localhost:7860
Build & deploy:

bash
# Build React for production
npm run build  # outputs dist/

# Single-container Docker image (React + FastAPI)
docker build -f Dockerfile.frontend -t idlang .
docker run -p 7860:7860 -e NMT_MODEL_ID=your/checkpoint idlang
Try asking
"Where does the corpus come from and why was the old v2 dictionary unreliable?" — The deleted v2 dictionary was 50% placeholders (ụụ); the served `idoma_dictionary_v3.json` is 226 curated tone-marked entries (the earlier curated set merged with `idoma_dictionary.json` by `data_pipeline/merge_dictionary.py`). Separately, `data_pipeline/` scrapes 1,251 pairs from idomaland.org into `data_pipeline/out/` (gitignored); `build_dictionary.py` can shape those into a 1,117-entry dictionary, which is **not** currently what ships.
"Why does Idoma transcription/synthesis not work with stock models?" — The gated mrheartng checkpoints are inaccessible; ungated fallbacks (Wav2Vec2-base, SpeechT5) were never trained on Idoma, so output is degraded.
"What happens when the Python service is down or the NMT model fails?" — Go backend falls back to OmniRoute (an LLM gateway), then returns "Missing from Idlang archives." if all fail.
Single-paragraph project summary for new sessions:
Idlang is a Vite + React SPA with a Go backend and Python FastAPI microservice for bidirectional English↔Idoma translation with speech-to-text and text-to-speech. The frontend runs on :5173 (dev) or serves built assets; the Go backend (:8080) uses dictionary-first lookup followed by neural translation via NLLB-200, with a three-fallback chain (dictionary → Python NMT → OmniRoute LLM). The Python service (:5005) loads ML models lazily (Whisper + Wav2Vec2 ASR, SpeechT5 TTS, transformers NMT) and is CUDA-aware for Hugging Face Spaces. The served dictionary is `backend/idoma_dictionary_v3.json` — 226 curated tone-marked entries, committed so Render builds get it; a scraped 1,251-pair corpus sits gitignored in `data_pipeline/out/` and could be shaped into a ~1,117-entry dictionary by `build_dictionary.py` for roughly 5x the lookup coverage. A fine-tuned NLLB checkpoint with an added idu_Latn token is required for authentic Idoma output—the defaults are ungated but degrade to English. Deployed as: frontend on Vercel (must set `VITE_API_URL` to the Render backend, not the HF Space, or dictionary-first routing is bypassed), Go backend on Render, model on a Hugging Face Space. Red/black aesthetic, Tailwind CSS v4, Docker Compose local stack.
