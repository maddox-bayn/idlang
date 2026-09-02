"""Neural Machine Translation (NMT) service using NLLB-200."""

import datetime
from typing import Dict, Any, Optional

try:
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
except ImportError as exc:
    raise ImportError(
        "PyTorch and Transformers are required. Install with 'pip install torch transformers'"
    ) from exc

from config import (
    ALLOW_IGBO_FALLBACK,
    DEVICE,
    FALLBACK_LANG_CODE,
    IDOMA_LANG_CODE,
    LANG_CODE_MAP,
    ModelIDs,
)
from services.model_loader import ModelManager


class TranslationService:
    """NMT service for English ↔ Idoma translation using NLLB-200."""

    def __init__(self):
        """Initialize the NMT model."""
        self.tokenizer, self.model = ModelManager.load_nmt_models()
        self._load_attempted = True
        self.lang_codes = dict(LANG_CODE_MAP)
        self.warning = self._resolve_idoma_code()

    def _resolve_idoma_code(self) -> Optional[str]:
        """Verify the checkpoint can actually emit Idoma.

        Stock NLLB-200 has no `idu_Latn` token, so convert_tokens_to_ids returns
        <unk>. Forcing <unk> as the decoder's first token gives no target-language
        signal and the model simply copies the source — the "English in, English
        out" bug. Detect that here and return a warning instead of pretending the
        output is Idoma.
        """
        unk = self.tokenizer.unk_token_id
        if self.tokenizer.convert_tokens_to_ids(IDOMA_LANG_CODE) != unk:
            return None

        detail = (
            f"model {ModelIDs.NMT!r} has no {IDOMA_LANG_CODE!r} token and cannot "
            f"generate Idoma; fine-tune a checkpoint that adds it "
            f"(training/train_idoma_nllb.ipynb) and set NMT_MODEL_ID"
        )

        if not ALLOW_IGBO_FALLBACK:
            self.unsupported = detail
            return detail

        if self.tokenizer.convert_tokens_to_ids(FALLBACK_LANG_CODE) == unk:
            self.unsupported = detail
            return detail

        # Explicit opt-in: emit Igbo (nearest in-vocab relative) and say so.
        self.lang_codes["Idoma"] = FALLBACK_LANG_CODE
        return f"Output is {FALLBACK_LANG_CODE} (Igbo), not Idoma: {detail}"

    unsupported: Optional[str] = None

    def translate(
        self, text: str, source_lang: str, target_lang: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Translate text between English and Idoma.

        Args:
            text: Input text to translate
            source_lang: Source language ("English" or "Idoma")
            target_lang: Optional target language (defaults to opposite of source)

        Returns:
            Dictionary with translation, model info, and confidence
        """
        if not text or not text.strip():
            return {
                "translation": "",
                "model": "NLLB-200",
                "confidence": 0.0,
                "timestamp": datetime.datetime.now().isoformat(),
                "error": "Empty input text",
            }

        # Set source and target language codes
        src_code = self.lang_codes.get(source_lang)
        if src_code is None:
            return {
                "translation": "",
                "model": "NLLB-200",
                "confidence": 0.0,
                "timestamp": datetime.datetime.now().isoformat(),
                "error": f"Unsupported source language: {source_lang}",
            }

        # Determine target language
        if target_lang is None:
            target_lang = "Idoma" if source_lang == "English" else "English"

        tgt_code = self.lang_codes.get(target_lang)
        if tgt_code is None:
            return {
                "translation": "",
                "model": "NLLB-200",
                "confidence": 0.0,
                "timestamp": datetime.datetime.now().isoformat(),
                "error": f"Unsupported target language: {target_lang}",
            }

        # Refuse rather than return the untranslated source sentence.
        if self.unsupported and "Idoma" in (source_lang, target_lang):
            return {
                "translation": "",
                "model": "NLLB-200",
                "confidence": 0.0,
                "timestamp": datetime.datetime.now().isoformat(),
                "error": f"Idoma is not supported by the loaded model: {self.unsupported}",
            }

        try:
            # Set source language
            self.tokenizer.src_lang = src_code

            # Encode input
            inputs = self.tokenizer(
                text, return_tensors="pt", padding=True, truncation=True, max_length=256
            ).to(DEVICE)

            # Generate translation with forced BOS token
            tgt_token_id = self.tokenizer.convert_tokens_to_ids(tgt_code)
            with torch.no_grad():
                outputs = self.model.generate(
                    **inputs,
                    forced_bos_token_id=tgt_token_id,
                    max_length=256,
                    num_beams=4,
                    early_stopping=True,
                )

            # Decode output
            translation = self.tokenizer.decode(
                outputs[0], skip_special_tokens=True
            ).strip()

            return {
                "translation": translation,
                "model": "NLLB-200",
                "confidence": 0.87,  # Placeholder - model doesn't provide per-token confidence
                "source_lang": source_lang,
                "target_lang": target_lang,
                "timestamp": datetime.datetime.now().isoformat(),
                "warning": self.warning,
            }

        except Exception as e:
            return {
                "translation": "",
                "model": "NLLB-200",
                "confidence": 0.0,
                "timestamp": datetime.datetime.now().isoformat(),
                "error": f"Translation failed: {str(e)}",
            }


# Create singleton instance
_translation_service: Optional[TranslationService] = None


def get_translation_service() -> TranslationService:
    """Get or create the global translation service instance."""
    global _translation_service
    if _translation_service is None:
        _translation_service = TranslationService()
    return _translation_service


# For direct import
if __name__ == "__main__":
    # Simple test
    service = TranslationService()
    result = service.translate("Hello, how are you?", "English", "Idoma")
    print(f"Translation: {result}")
