"""Configuration for Idlang Translator Service models and settings."""

import os
import torch

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Model IDs
class ModelIDs:
    # Public Baseline Model Fallbacks
    NMT = "facebook/nllb-200-distilled-600M"
    ASR_IDOMA = "facebook/wav2vec2-xls-r-300m"
    ASR_ENGLISH = "openai/whisper-large-v3"
    TTS_IDOMA = "microsoft/speecht5_tts"
    TTS_ENGLISH = "microsoft/speecht5_tts"

# Audio configuration
SAMPLING_RATE = 16000
MAX_AUDIO_LENGTH_SECONDS = 30

# Cache directory
CACHE_DIR = os.getenv("CACHE_DIR", "./model_cache")

# Service configuration
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 5005))

# Translation service URL for Go backend integration
TRANSLATOR_URL = os.getenv("TRANSLATOR_URL", f"http://{HOST}:{PORT}")

# Language codes for NLLB
LANG_CODE_MAP = {
    "English": "eng_Latn",
    "Idoma": "idu_Latn",
}

# Reverse mapping
LANG_CODE_REVERSE = {v: k for k, v in LANG_CODE_MAP.items()}
