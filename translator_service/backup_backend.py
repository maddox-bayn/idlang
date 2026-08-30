"""Main FastAPI application for Idlang Translator Service."""

import base64
import os
import io
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import HOST, PORT

app = FastAPI(
    title="Idlang Translator Service",
    description="Idoma-English bidirectional translation with STT and TTS",
    version="1.0.0",
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Globals for lazy loading inside request contexts
_translation_service = None
_asr_service = None
_tts_service = None

def get_lazy_translation_service():
    global _translation_service
    if _translation_service is None:
        from services.nmt_service import get_translation_service
        import spaces
        # Wrap the function dynamically if running on ZeroGPU
        get_service_gpu = spaces.GPU(get_translation_service)
        _translation_service = get_service_gpu()
    return _translation_service

def get_lazy_asr_service():
    global _asr_service
    if _asr_service is None:
        from services.asr_service import get_asr_service
        import spaces
        get_service_gpu = spaces.GPU(get_asr_service)
        _asr_service = get_service_gpu()
    return _asr_service

def get_lazy_tts_service():
    global _tts_service
    if _tts_service is None:
        from services.tts_service import get_tts_service
        import spaces
        get_service_gpu = spaces.GPU(get_tts_service)
        _tts_service = get_service_gpu()
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

class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Text to synthesize")
    target_lang: str = Field(..., description="Target language ('English' or 'Idoma')")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "Idlang Translator"}

@app.post("/translate", response_model=TranslateResponse)
async def translate_text(request: TranslateRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")
    
    # Initialize only when someone hits the route
    service = get_lazy_translation_service()
    result = service.translate(request.text, request.source_lang, request.target_lang)
    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])
    return TranslateResponse(**result)

@app.post("/transcribe")
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

@app.post("/synthesize")
async def synthesize_audio(request: SynthesizeRequest):
    try:
        service = get_lazy_tts_service()
        audio_bytes = service.synthesize(request.text, request.target_lang)
        return StreamingResponse(
            audio_bytes,
            media_type="audio/wav",
            headers={"Content-Disposition": f"attachment; filename={request.target_lang}_speech.wav"}
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}")

@app.post("/pipeline")
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, reload=False)

# ==========================================
# 💎 EMBEDDED PRODUCTION STATIC MOUNT
# ==========================================
import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

frontend_dir = os.path.abspath("./dist")

if os.path.exists(frontend_dir):
    print("✅ Direct mounting Vite production distribution directory to root endpoints...")
    
    @app.get("/")
    async def serve_root_index():
        return FileResponse(os.path.join(frontend_dir, "index.html"))

    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dir, "assets")), name="assets")
