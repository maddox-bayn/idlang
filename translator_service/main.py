# translator_service/main.py
try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
except ImportError as exc:
    raise ImportError(
        "FastAPI and Pydantic are required. Install with 'pip install fastapi pydantic'"
    ) from exc
import os

# Import the repository's translation service. Adjust import path if you copy code.
from src.services.nmt_service import TranslationService

app = FastAPI(title="Idoma Translator Service", version="1.0")

# Optional CORS (if you call JS directly) - not required if Go backend proxies requests.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

# Use mock if environment requests it (DEV / CI)
USE_MOCK = os.getenv("USE_MOCK_TRANSLATOR", "false").lower() in ("1","true","yes")

if USE_MOCK:
    # Very small deterministic mock to avoid model download
    class MockTranslationService:
        def translate(self, text: str, source_lang: str) -> str:
            if not text:
                return ""
            return f"[MOCK {source_lang} -> {'Idoma' if source_lang!='Idoma' else 'English'}] {text[::-1][:64]}"
    translator = MockTranslationService()
else:
    # Load real model once
    translator = TranslationService()

class TranslateRequest(BaseModel):
    text: str
    source_lang: str  # "English" or "Idoma"

class TranslateResponse(BaseModel):
    translation: str

@app.post("/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    try:
        out = translator.translate(req.text, req.source_lang)
        return TranslateResponse(translation=out)
    except Exception as e:
        # Return 500 with helpful message for debugging
        raise HTTPException(status_code=500, detail=str(e))