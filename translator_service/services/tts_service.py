"""TTS (Text-to-Speech) service for speech synthesis."""

import datetime
import io
from typing import Dict, Any, Optional

try:
    import torch
    import numpy as np
    import torchaudio
    from transformers import (
        AutoTokenizer,
        
        SpeechT5ForTextToSpeech,
        SpeechT5HifiGan,
        SpeechT5Tokenizer,
    )
    from transformers.pipelines import pipeline as hf_pipeline
except ImportError as exc:
    raise ImportError(
        "PyTorch, Torchaudio, and Transformers are required. "
        "Install with 'pip install torch torchaudio transformers'"
    ) from exc

from config import ModelIDs, SAMPLING_RATE, DEVICE
from services.model_loader import ModelManager


class TTSService:
    """TTS service for Text-to-Speech using VITS and SpeechT5."""

    def __init__(self):
        """Initialize TTS models for Idoma and English."""
        self.idoma_tokenizer: Any = None
        self.idoma_model: Any = None
        self.english_pipeline: Any = None
        self.english_vocoder: Any = None
        self._models_loaded = False

    def _load_models(self):
        """Load TTS models on first use."""
        if not self._models_loaded:
            self.idoma_tokenizer, self.idoma_model = ModelManager.load_idoma_tts()
            self.english_pipeline, self.english_vocoder = (
                ModelManager.load_english_tts_pipeline()
            )
            self._models_loaded = True

    def synthesize_idoma(
        self, text: str, speaker_id: int = 0
    ) -> io.BytesIO:
        """
        Synthesize Idoma text to speech using VITS MMS-TTS.

        Args:
            text: Text to synthesize
            speaker_id: Speaker ID for voice selection

        Returns:
            BytesIO containing WAV audio
        """
        self._load_models()

        if not text or not text.strip():
            raise ValueError("Empty input text")

        try:
            # Tokenize input
            inputs = self.idoma_tokenizer(
                text, return_tensors="pt"
            ).to(DEVICE)

            # Generate speech
            with torch.no_grad():
                outputs = self.idoma_model(**inputs).waveform

            # Convert to WAV bytes
            audio_bytes = io.BytesIO()
            torchaudio.save(
                audio_bytes,
                outputs.squeeze().unsqueeze(0),
                SAMPLING_RATE,
                format="wav",
            )
            audio_bytes.seek(0)

            return audio_bytes

        except Exception as e:
            raise RuntimeError(f"Idoma TTS failed: {e}")

    def synthesize_english(
        self, text: str, speaker_id: int = 0
    ) -> io.BytesIO:
        """
        Synthesize English text to speech using SpeechT5.

        Args:
            text: Text to synthesize
            speaker_id: Speaker ID for voice selection

        Returns:
            BytesIO containing WAV audio
        """
        self._load_models()

        if not text or not text.strip():
            raise ValueError("Empty input text")

        try:
            # Use the pipeline for English TTS
            # Note: SpeechT5 requires speaker embeddings for best quality
            # For simplicity, we use a default voice

            # Generate speech using the pipeline
            outputs = self.english_pipeline(
                text,
                forward_params={
                    "vocoder": self.english_vocoder,
                },
            )

            # Extract audio data
            audio_data = outputs.get("audio", outputs)

            # Convert to WAV bytes
            audio_bytes = io.BytesIO()
            if isinstance(audio_data, torch.Tensor):
                torchaudio.save(
                    audio_bytes,
                    audio_data.squeeze().unsqueeze(0),
                    SAMPLING_RATE,
                    format="wav",
                )
            else:
                # If numpy array
                import soundfile as sf

                sf.write(audio_bytes, audio_data, SAMPLING_RATE, format="WAV")

            audio_bytes.seek(0)
            return audio_bytes

        except Exception as e:
            raise RuntimeError(f"English TTS failed: {e}")

    def synthesize(
        self, text: str, target_lang: str
    ) -> io.BytesIO:
        """
        Synthesize text to speech based on target language.

        Args:
            text: Text to synthesize
            target_lang: "English" or "Idoma"

        Returns:
            BytesIO containing WAV audio
        """
        if target_lang == "Idoma":
            return self.synthesize_idoma(text)
        elif target_lang == "English":
            return self.synthesize_english(text)
        else:
            raise ValueError(f"Unsupported language: {target_lang}")


# Create singleton instance
_tts_service: Optional[TTSService] = None


def get_tts_service() -> TTSService:
    """Get or create the global TTS service instance."""
    global _tts_service
    if _tts_service is None:
        _tts_service = TTSService()
    return _tts_service


if __name__ == "__main__":
    # Test basic initialization
    service = TTSService()
    print("TTS service initialized. Models loaded on first use.")
