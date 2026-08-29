"""Main FastAPI application for Idlang Translator Service."""

import base64
import io
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import HOST, PORT
from services.nmt_service import get_translation_service
from services.asr_service import get_asr_service
from services.tts_service import get_tts_service

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


class TranslateRequest(BaseModel):
    """Request model for text translation."""

    text: str = Field(..., min_length=1, description="Text to translate")
    source_lang: str = Field(
        default="English", description="Source language ('English' or 'Idoma')"
    )
    target_lang: Optional[str] = Field(
        default=None, description="Target language (default: opposite of source)"
    )


class TranslateResponse(BaseModel):
    """Response model for translation."""

    translation: str
    model: str
    confidence: float
    source_lang: str
    target_lang: str
    timestamp: str
    explanation: Optional[str] = None


class TranscribeRequest(BaseModel):
    """Request model for speech-to-text."""

    source_lang: str = Field(..., description="Source language ('English' or 'Idoma')")


class TranscribeResponse(BaseModel):
    """Response model for transcription."""

    transcription: str
    language: str
    confidence: float
    model: str
    timestamp: str


class SynthesizeRequest(BaseModel):
    """Request model for text-to-speech."""

    text: str = Field(..., min_length=1, description="Text to synthesize")
    target_lang: str = Field(..., description="Target language ('English' or 'Idoma')")


class PipelineRequest(BaseModel):
    """Request model for full pipeline."""

    source_lang: str = Field(..., description="Source language ('English' or 'Idoma')")


# Initialize services
translation_service = get_translation_service()
asr_service = get_asr_service()
tts_service = get_tts_service()


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "Idlang Translator"}


@app.post("/translate", response_model=TranslateResponse)
async def translate_text(request: TranslateRequest):
    """
    Translate text between English and Idoma using NLLB-200.

    Args:
        text: Text to translate
        source_lang: Source language ("English" or "Idoma")

    Returns:
        Translation result with model info and confidence
    """
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    result = translation_service.translate(
        request.text, request.source_lang, request.target_lang
    )

    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])

    return TranslateResponse(**result)


@app.post("/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(..., description="Audio file to transcribe"),
    source_lang: str = Form(..., description="Source language ('English' or 'Idoma')"),
):
    """
    Transcribe audio to text using ASR (Wav2Vec2 or Whisper).

    Args:
        audio: Audio file (WAV, MP3, or other common formats)
        source_lang: Source language ("English" or "Idoma")

    Returns:
        Transcription result with confidence and model info
    """
    try:
        audio_data = await audio.read()

        # Validate audio size (max 20MB)
        if len(audio_data) > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Audio file too large (max 20MB)")

        result = asr_service.transcribe(audio_data, source_lang)

        if result.get("error"):
            raise HTTPException(status_code=400, detail=result["error"])

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")


@app.post("/synthesize")
async def synthesize_audio(request: SynthesizeRequest):
    """
    Synthesize text to speech using TTS (VITS or SpeechT5).

    Args:
        text: Text to synthesize
        target_lang: Target language ("English" or "Idoma")

    Returns:
        WAV audio file as streaming response
    """
    try:
        audio_bytes = tts_service.synthesize(request.text, request.target_lang)

        return StreamingResponse(
            audio_bytes,
            media_type="audio/wav",
            headers={
                "Content-Disposition": f"attachment; filename={request.target_lang}_speech.wav"
            },
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}")


@app.post("/pipeline")
async def full_pipeline(
    audio: UploadFile = File(
        ..., description="Audio file to process through full pipeline"
    ),
    source_lang: str = Form(..., description="Source language ('English' or 'Idoma')"),
):
    """
    Full pipeline: Audio → Transcription → Translation → Synthesis.

    Args:
        audio: Audio file to process
        source_lang: Source language ("English" or "Idoma")

    Returns:
        Complete pipeline result with transcription, translation, and synthesized audio
    """
    try:
        # Step 1: Transcribe audio
        audio_data = await audio.read()
        transcribe_result = asr_service.transcribe(audio_data, source_lang)

        if transcribe_result.get("error"):
            raise HTTPException(status_code=400, detail=transcribe_result["error"])

        transcription = transcribe_result["transcription"]
        if not transcription:
            raise HTTPException(status_code=400, detail="No speech detected in audio")

        # Step 2: Translate transcription
        target_lang = "Idoma" if source_lang == "English" else "English"
        translate_result = translation_service.translate(
            transcription, source_lang, target_lang
        )

        if translate_result.get("error"):
            raise HTTPException(status_code=500, detail=translate_result["error"])

        translation = translate_result["translation"]

        # Step 3: Synthesize translated text
        audio_bytes = tts_service.synthesize(translation, target_lang)

        # Encode audio as base64 for JSON response
        audio_base64 = base64.b64encode(audio_bytes.read()).decode()

        return {
            "transcription": transcribe_result,
            "translation": {
                **translate_result,
                "transcribed_text": transcription,
            },
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
