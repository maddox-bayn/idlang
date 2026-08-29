# Idlang Translator Service

Python-based translation service providing bidirectional English ↔ Idoma translation with speech-to-text (STT) and text-to-speech (TTS) capabilities.

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
            └─────────────────┘              └─────────────────┘    │   Whisper)      │
                                                                     └─────────────────┘
                                                                              │
                                                                     ┌─────────────────┐
                                                                     │  TTS Service    │
                                                                     │  (VITS +        │
                                                                     │   SpeechT5)     │
                                                                     └─────────────────┘
```

## Services

| Service | Endpoint | Description |
|---------|----------|-------------|
| NMT | `/translate` | Neural Machine Translation (English ↔ Idoma) |
| ASR | `/transcribe` | Speech-to-Text (Wav2Vec2 for Idoma, Whisper for English) |
| TTS | `/synthesize` | Text-to-Speech (VITS for Idoma, SpeechT5 for English) |
| Pipeline | `/pipeline` | Full STT → NMT → TTS flow |

## Models

### Neural Machine Translation (NMT)
- **Model**: NLLB-200 (No Language Left Behind)
- **Fine-tuned**: `mrheartng/idu-eng-translator`
- **BLEU Score**: 31.42

### Speech-to-Text (ASR)
- **Idoma**: Wav2Vec2 XLS-R (`mrheartng/wav2vec2-xls-r-1b-finetuned-idoma`), WER: 11.43%
- **English**: Whisper Large v3 (`openai/whisper-large-v3`)

### Text-to-Speech (TTS)
- **Idoma**: VITS MMS-TTS (`mrheartng/idoma-mms-tts-eng`), MOS: 4.36/5.0
- **English**: SpeechT5 (`microsoft/speecht5_tts`)

## Installation

### Prerequisites
- Python 3.8+
- pip
- (Optional) CUDA-enabled GPU for faster inference

### Setup

```bash
cd translator_service

# Install dependencies
pip install -r requirements.txt

# (Optional) Set environment variables
export CACHE_DIR=./model_cache
export DEVICE=cuda  # Use GPU if available

# Run the service
python main.py
# or
uvicorn main:app --host 0.0.0.0 --port 5005
```

The service will be available at `http://localhost:5005`.

## API Endpoints

### Translate Text

```bash
curl -X POST http://localhost:5005/translate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello",
    "source_lang": "English"
  }'
```

Response:
```json
{
  "translation": "Ekpuoye",
  "model": "NLLB-200",
  "confidence": 0.87,
  "source_lang": "English",
  "target_lang": "Idoma",
  "timestamp": "2026-08-28T13:00:00"
}
```

### Transcribe Audio

```bash
curl -X POST http://localhost:5005/transcribe \
  -F "audio=@recording.wav" \
  -F "source_lang=English"
```

### Synthesize Speech

```bash
curl -X POST http://localhost:5005/synthesize \
  -F "text=Hello" \
  -F "target_lang=English" \
  -o output.wav
```

### Full Pipeline

```bash
curl -X POST http://localhost:5005/pipeline \
  -F "audio=@recording.wav" \
  -F "source_lang=English"
```

Response includes transcription, translation, and synthesized audio.

## Configuration

Edit `config.py` to customize:

```python
# Model IDs
MODEL_NMT = "mrheartng/idu-eng-translator"
MODEL_ASR_IDOMA = "mrheartng/wav2vec2-xls-r-1b-finetuned-idoma"
MODEL_ASR_ENG = "openai/whisper-large-v3"
MODEL_TTS_IDOMA = "mrheartng/idoma-mms-tts-eng"
MODEL_TTS_ENG = "microsoft/speecht5_tts"

# Audio settings
SAMPLING_RATE = 16000
MAX_AUDIO_LENGTH = 30  # seconds

# Service settings
HOST = "0.0.0.0"
PORT = 5005
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TRANSLATOR_URL` | Python service URL (for Go backend) | `http://localhost:5005` |
| `CACHE_DIR` | Model cache directory | `./model_cache` |
| `DEVICE` | Compute device (`cpu` or `cuda`) | `cuda` if available |
| `HOST` | Service host | `0.0.0.0` |
| `PORT` | Service port | `5005` |

## Docker

```bash
cd translator_service

# Build image
docker build -t idlang-translator .

# Run container
docker run -p 5005:5005 --gpus all idlang-translator
```

## Usage from Go Backend

Set the `TRANSLATOR_URL` environment variable in your Go backend:

```bash
export TRANSLATOR_URL=http://localhost:5005
go run main.go
```

The Go backend will automatically call the Python service for NMT translations.

## Error Handling

The service returns appropriate HTTP status codes:

- `400 Bad Request`: Invalid input (empty text, audio too long, unsupported language)
- `500 Internal Server Error`: Model loading failure, processing error
- `503 Service Unavailable`: Service temporarily unavailable

Error response format:
```json
{
  "detail": "Error message describing what went wrong"
}
```

## Performance

| Operation | Target Latency |
|-----------|---------------|
| Text translation | <500ms |
| Audio transcription (10s) | <2s |
| TTS synthesis | <3s |
| Full pipeline (10s audio) | <10s |

## Testing

```bash
# Run unit tests
python -m pytest tests/

# Test specific service
python -m pytest tests/test_nmt_service.py
```

## Troubleshooting

### Model Loading Fails
- Check internet connection (models download on first run)
- Verify CUDA availability if using GPU: `nvidia-smi`
- Increase timeout in `config.py`

### High Memory Usage
- Use CPU mode: `export DEVICE=cuda`
- Clear cache: Call `ModelManager.clear_cache()`

### Slow Inference
- Use GPU: `export DEVICE=cuda`
- Reduce audio length
- Use smaller models (if available)

## License

MIT
