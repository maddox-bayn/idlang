"""Main FastAPI application for Idlang Translator Service.

Route prefixes
--------------
Every endpoint is registered twice: bare (`/translate`) and under `/api`
(`/api/translate`).

That is not decoration. There are two supported topologies:

  browser -> Go backend (/api/*) -> this service (/*)          split deployment
  browser -> this service (/api/*), which also serves dist/     single container

The frontend always calls `/api/*`. Without the alias the single-container image
built by `Dockerfile.frontend` (the Hugging Face Space) serves the UI correctly and
then 404s on every request the UI makes.
"""

import base64
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import CORS_ORIGINS, HOST, PORT

app = FastAPI(
    title="Idlang Translator Service",
    description="Idoma-English bidirectional translation with STT and TTS",
    version="1.0.0",
)

# A wildcard origin and credentialed requests are mutually exclusive per the CORS
# spec — browsers reject the combination outright. Only allow credentials once
# CORS_ORIGINS names real origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=CORS_ORIGINS != ["*"],
)

router = APIRouter()

# Globals for lazy loading inside request contexts
_translation_service = None
_asr_service = None
_tts_service = None


def _gpu_wrap(fn):
    """Wrap a loader in spaces.GPU when running on ZeroGPU, else return it as-is.

    `spaces` only exists on Hugging Face ZeroGPU hardware. Importing it
    unconditionally crashes every other environment (local, Docker, Vercel-backed
    hosts), so fall back to calling the function directly.
    """
    try:
        import spaces
    except ImportError:
        return fn
    return spaces.GPU(fn)


def get_lazy_translation_service():
    global _translation_service
    if _translation_service is None:
        from services.nmt_service import get_translation_service
        _translation_service = _gpu_wrap(get_translation_service)()
    return _translation_service

def get_lazy_asr_service():
    global _asr_service
    if _asr_service is None:
        from services.asr_service import get_asr_service
        _asr_service = _gpu_wrap(get_asr_service)()
    return _asr_service

def get_lazy_tts_service():
    global _tts_service
    if _tts_service is None:
        from services.tts_service import get_tts_service
        _tts_service = _gpu_wrap(get_tts_service)()
    return _tts_service

class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Text to translate")
    source_lang: str = Field(default="English", description="Source language ('English' or 'Idoma')")
    target_lang: Optional[str] = Field(default=None, description="Target language (default: opposite of source)")

class TranslateResponse(BaseModel):
    translation: str
    model: str
    confidence: float
    source_lang: str
    target_lang: str
    timestamp: str
    explanation: Optional[str] = None
    # Set when the loaded checkpoint cannot truly emit Idoma (see nmt_service).
    warning: Optional[str] = None

class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Text to synthesize")
    target_lang: str = Field(..., description="Target language ('English' or 'Idoma')")

@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "Idlang Translator"}

@router.post("/translate", response_model=TranslateResponse)
async def translate_text(request: TranslateRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    # Initialize only when someone hits the route
    service = get_lazy_translation_service()
    result = service.translate(request.text, request.source_lang, request.target_lang)
    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])
    return TranslateResponse(**result)

@router.post("/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(..., description="Audio file to transcribe"),
    source_lang: str = Form(..., description="Source language ('English' or 'Idoma')"),
):
    try:
        audio_data = await audio.read()
        if len(audio_data) > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Audio file too large (max 20MB)")

        service = get_lazy_asr_service()
        result = service.transcribe(audio_data, source_lang)
        if result.get("error"):
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")

@router.post("/synthesize")
async def synthesize_audio(request: SynthesizeRequest):
    try:
        service = get_lazy_tts_service()
        audio_bytes = service.synthesize(request.text, request.target_lang)
        headers = {
            "Content-Disposition": f"attachment; filename={request.target_lang}_speech.wav"
        }
        # There is no Idoma TTS model, so Idoma audio is the English voice. Say so
        # in a header rather than letting the listener assume it is Idoma speech.
        warning = service.voice_warning(request.target_lang)
        if warning:
            headers["X-Voice-Warning"] = warning
            headers["Access-Control-Expose-Headers"] = "X-Voice-Warning"
        return StreamingResponse(
            audio_bytes,
            media_type="audio/wav",
            headers=headers,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}")

@router.post("/pipeline")
async def full_pipeline(
    audio: UploadFile = File(..., description="Audio file to process through full pipeline"),
    source_lang: str = Form(..., description="Source language ('English' or 'Idoma')"),
):
    try:
        audio_data = await audio.read()
        asr = get_lazy_asr_service()
        transcribe_result = asr.transcribe(audio_data, source_lang)
        if transcribe_result.get("error"):
            raise HTTPException(status_code=400, detail=transcribe_result["error"])

        transcription = transcribe_result["transcription"]
        if not transcription:
            raise HTTPException(status_code=400, detail="No speech detected in audio")

        target_lang = "Idoma" if source_lang == "English" else "English"
        nmt = get_lazy_translation_service()
        translate_result = nmt.translate(transcription, source_lang, target_lang)
        if translate_result.get("error"):
            raise HTTPException(status_code=500, detail=translate_result["error"])

        translation = translate_result["translation"]
        tts = get_lazy_tts_service()
        audio_bytes = tts.synthesize(translation, target_lang)
        audio_base64 = base64.b64encode(audio_bytes.read()).decode()

        return {
            "transcription": transcribe_result,
            "translation": {**translate_result, "transcribed_text": transcription},
            "audio": audio_base64,
            "audio_format": "wav",
            "timestamp": transcribe_result["timestamp"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {e}")


# Bare paths for the Go backend, /api/* for browsers talking to this service
# directly. Registered before the static mount so API routes always win.
app.include_router(router)
app.include_router(router, prefix="/api")


# ==========================================
# Static frontend (single-container deploys)
# ==========================================
# Resolved against this file, not the process CWD: uvicorn is not always launched
# from translator_service/, and os.path.abspath("./dist") silently finds nothing
# when it is not.
FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR", Path(__file__).resolve().parent / "dist")).resolve()

if FRONTEND_DIR.is_dir():
    print(f"Serving built frontend from {FRONTEND_DIR}")

    assets_dir = FRONTEND_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        """Serve a built file if it exists, else index.html (SPA entry point)."""
        index = FRONTEND_DIR / "index.html"
        if full_path:
            candidate = (FRONTEND_DIR / full_path).resolve()
            # Never serve outside the build directory: `full_path` is attacker
            # controlled, so "../../etc/passwd" must not escape.
            if FRONTEND_DIR in candidate.parents and candidate.is_file():
                return FileResponse(candidate)
        if index.is_file():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Not found")
else:
    print(f"No built frontend at {FRONTEND_DIR}; serving API only")


# Kept last so everything above is registered before the server starts. When this
# block sat mid-file, `python backup_backend.py` blocked in uvicorn.run() and the
# static-mount code below it never ran, so the UI was never served.
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, reload=False)
