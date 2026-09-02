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
- **Dictionary**: JSON-based with 200+ word pairs

### ML Models
- **NMT**: NLLB-200 (mrheartng/idu-eng-translator)
- **ASR (Idoma)**: Wav2Vec2 XLS-R (mrheartng/wav2vec2-xls-r-1b-finetuned-idoma)
- **ASR (English)**: Whisper Large v3 (openai/whisper-large-v3)
- **TTS (Idoma)**: VITS MMS-TTS (mrheartng/idoma-mms-tts-eng)
- **TTS (English)**: SpeechT5 (microsoft/speecht5_tts)

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
| `/api/translate` | POST | Translate text or process audio |
| `/api/generate-lesson` | POST | Generate quiz questions |

### Python Service (`http://localhost:5005`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/translate` | POST | Text translation (NMT) |
| `/transcribe` | POST | Audio transcription (ASR) |
| `/synthesize` | POST | Text-to-speech (TTS) |
| `/pipeline` | POST | Full STT → NMT → TTS flow |

See `translator_service/README.md` for detailed API specs.

## Directory Structure

```
idlang/
├── backend/
│   ├── main.go              # Go HTTP server
│   ├── client.go            # Python service client
│   ├── idoma_dictionary_v2.json  # 200+ word dictionary
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
│   └── Dockerfile
├── data_pipeline/             # Idoma corpus scraper + builder
├── training/                  # Colab fine-tuning notebook
└── package.json
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Go backend port | `8080` |
| `TRANSLATOR_URL` | Python service URL | `http://localhost:5005` |
| `VITE_API_URL` | Frontend API URL | `http://localhost:8080` |
| `CACHE_DIR` | Model cache directory | `./model_cache` |
| `DEVICE` | Compute device | `cuda` if available |
| `NMT_MODEL_ID` | Translation checkpoint. **Must contain an `idu_Latn` token** to produce Idoma | `facebook/nllb-200-distilled-600M` |
| `IDOMA_LANG_CODE` | Idoma target token | `idu_Latn` |
| `ALLOW_IGBO_FALLBACK` | Accept degraded `ibo_Latn` (Igbo) output when the checkpoint has no Idoma token, instead of erroring | `false` |
| `HF_TOKEN` | Hugging Face token, only needed for gated/private checkpoints | unset |

### Model Configuration

Edit `translator_service/config.py` to customize models:

```python
MODEL_NMT = "mrheartng/idu-eng-translator"
MODEL_ASR_IDOMA = "mrheartng/wav2vec2-xls-r-1b-finetuned-idoma"
MODEL_ASR_ENG = "openai/whisper-large-v3"
MODEL_TTS_IDOMA = "mrheartng/idoma-mms-tts-eng"
MODEL_TTS_ENG = "microsoft/speecht5_tts"
```

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
# Frontend tests
npm run test

# Python service tests
cd translator_service
python -m pytest tests/
```

## Deployment

### Docker

```bash
# Build Python service
cd translator_service
docker build -t idlang-translator .

# Run container
docker run -p 5005:5005 --gpus all idlang-translator
```

### Production

1. Build frontend: `npm run build`
2. Deploy static files to CDN/Vercel
3. Deploy Go backend to server
4. Deploy Python service with Docker
5. Configure environment variables

## Resources

- [Idoma Language](https://en.wikipedia.org/wiki/Idoma_language)
- [NLLB Documentation](https://huggingface.co/docs/transformers/model_doc/nllb)
- [Wav2Vec2](https://huggingface.co/docs/transformers/model_doc/wav2vec2)
- [Whisper](https://github.com/openai/whisper)
- [VITS](https://github.com/jaywalnut310/vits)

## License

MIT
