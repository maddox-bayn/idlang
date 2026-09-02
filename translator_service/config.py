"""Configuration for Idlang Translator Service models and settings."""

import os
import torch

DEVICE = os.getenv("DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")


# ---------------------------------------------------------------------------
# IMPORTANT — why translation used to return English
# ---------------------------------------------------------------------------
# Stock NLLB-200 supports exactly 202 languages and Idoma is NOT one of them.
# Verified against facebook/nllb-200-distilled-600M:
#
#     eng_Latn -> 256047   (valid)
#     ibo_Latn -> 256073   (valid)
#     idu_Latn -> 3        <unk>   <-- Idoma
#     ig_Latn  -> 3        <unk>   <-- not a real NLLB code either
#
# Passing forced_bos_token_id=<unk> gives the decoder no target-language signal,
# so the model copies the source sentence and you get English back.
#
# The fix is a fine-tuned checkpoint that ADDS an `idu_Latn` token to the
# tokenizer and resizes the embedding matrix (see training/train_idoma_nllb.ipynb).
# Point MODEL_NMT at that checkpoint via the NMT_MODEL_ID env var.
# ---------------------------------------------------------------------------

# Set NMT_MODEL_ID to your fine-tuned Idoma checkpoint once trained.
NMT_MODEL_ID = os.getenv("NMT_MODEL_ID", "facebook/nllb-200-distilled-600M")

# Idoma target token. A stock NLLB checkpoint does not contain this; the
# translation service checks for it at load time and refuses to emit bogus
# output rather than silently returning English.
IDOMA_LANG_CODE = os.getenv("IDOMA_LANG_CODE", "idu_Latn")

# Closest in-vocabulary relative (Igbo, also Benue-Congo). Used to initialise the
# new idu_Latn embedding during fine-tuning, and available as an explicitly
# opt-in degraded fallback (NOT enabled by default — it produces Igbo, not Idoma).
FALLBACK_LANG_CODE = "ibo_Latn"
ALLOW_IGBO_FALLBACK = os.getenv("ALLOW_IGBO_FALLBACK", "false").lower() == "true"


# Model IDs
class ModelIDs:
    NMT = NMT_MODEL_ID
    ASR_IDOMA = os.getenv("ASR_IDOMA_MODEL", "facebook/wav2vec2-xls-r-300m")
    ASR_ENGLISH = os.getenv("ASR_ENGLISH_MODEL", "openai/whisper-small")
    TTS_IDOMA = os.getenv("TTS_IDOMA_MODEL", "microsoft/speecht5_tts")
    TTS_ENGLISH = os.getenv("TTS_ENGLISH_MODEL", "microsoft/speecht5_tts")


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
    "Idoma": IDOMA_LANG_CODE,
}

# Reverse mapping
LANG_CODE_REVERSE = {v: k for k, v in LANG_CODE_MAP.items()}
