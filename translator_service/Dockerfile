# Idlang Translator Service (FastAPI)
#
# Serves the REST API consumed by the Go backend: /health, /translate,
# /transcribe, /synthesize, /pipeline.
#
# Build from the repository root so the build context includes this directory:
#   docker build -f translator_service/Dockerfile -t idlang-translator translator_service

FROM python:3.11-slim

WORKDIR /app

# ffmpeg + libsndfile are required by librosa / soundfile / torchaudio for
# decoding the browser-recorded audio uploads.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV HOST=0.0.0.0 \
    PORT=5005 \
    CACHE_DIR=/app/model_cache

EXPOSE 5005

# backup_backend.py holds the FastAPI app (there is no main.py in this repo).
CMD ["uvicorn", "backup_backend:app", "--host", "0.0.0.0", "--port", "5005"]
