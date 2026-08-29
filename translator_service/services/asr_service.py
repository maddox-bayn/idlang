"""ASR (Automatic Speech Recognition) service for speech-to-text translation."""

import datetime
import io
from typing import Dict, Any, Tuple

try:
    import librosa
    import numpy as np
    import torch
    from transformers import (
        AutoProcessor,
        AutoModelForCTC,
        WhisperForConditionalGeneration,
    )
    import soundfile as sf
except ImportError as exc:
    raise ImportError(
        "Librosa, NumPy, PyTorch, and Transformers are required. "
        "Install with 'pip install librosa numpy torch transformers'"
    ) from exc

from config import (
    ModelIDs,
    SAMPLING_RATE,
    MAX_AUDIO_LENGTH_SECONDS,
    DEVICE,
)
from services.model_loader import ModelManager


class ASRService:
    """ASR service for Speech-to-Text using Wav2Vec2 and Whisper."""

    def __init__(self):
        """Initialize ASR models for Idoma and English."""
        self.idoma_processor: Any = None
        self.idoma_model: Any = None
        self.english_processor: Any = None
        self.english_model: Any = None
        self._models_loaded = False

    def _load_models(self):
        """Load ASR models on first use."""
        if not self._models_loaded:
            self.idoma_processor, self.idoma_model = ModelManager.load_idoma_asr()
            self.english_processor, self.english_model = ModelManager.load_english_asr()
            self._models_loaded = True

    def _load_audio(
        self, audio_data: bytes, source_sr: int = SAMPLING_RATE
    ) -> Tuple[np.ndarray, int]:
        """
        Load audio from bytes.

        Args:
            audio_data: Raw audio bytes
            source_sr: Source sampling rate

        Returns:
            Tuple of (audio_array, sampling_rate)
        """
        # Try to load from bytes using librosa
        try:
            audio, sr = librosa.load(io.BytesIO(audio_data), sr=None)
            # Resample if needed
            if sr != SAMPLING_RATE:
                audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLING_RATE)
            return audio, SAMPLING_RATE
        except Exception:
            # Fallback: try direct soundfile
            try:
                audio, sr = sf.read(io.BytesIO(audio_data), dtype="float32")
                if sr != SAMPLING_RATE:
                    audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLING_RATE)
                return audio, SAMPLING_RATE
            except Exception as e:
                raise ValueError(f"Failed to load audio: {e}")

    def _check_audio_duration(self, audio: np.ndarray) -> bool:
        """Check if audio duration is within limits."""
        duration = len(audio) / SAMPLING_RATE
        return duration <= MAX_AUDIO_LENGTH_SECONDS

    def transcribe_idoma(
        self, audio_data: bytes
    ) -> Dict[str, Any]:
        """
        Transcribe Idoma audio to text using Wav2Vec2.

        Args:
            audio_data: Raw audio bytes

        Returns:
            Dictionary with transcription and confidence
        """
        self._load_models()

        # Load and preprocess audio
        audio, sr = self._load_audio(audio_data)

        # Check duration
        if not self._check_audio_duration(audio):
            return {
                "transcription": "",
                "language": "Idoma",
                "confidence": 0.0,
                "model": "Wav2Vec2 XLS-R",
                "timestamp": datetime.datetime.now().isoformat(),
                "error": f"Audio too long (max {MAX_AUDIO_LENGTH_SECONDS} seconds)",
            }

        try:
            # Process audio
            inputs = self.idoma_processor(
                audio, sampling_rate=sr, return_tensors="pt"
            ).to(DEVICE)

            # Get logits
            with torch.no_grad():
                logits = self.idoma_model(inputs.input_values).logits

            # Get predicted IDs
            predicted_ids = torch.argmax(logits, dim=-1)
            transcription = self.idoma_processor.batch_decode(predicted_ids)[0]

            return {
                "transcription": transcription,
                "language": "Idoma",
                "confidence": 0.95,  # Placeholder - actual confidence from model
                "model": "Wav2Vec2 XLS-R",
                "timestamp": datetime.datetime.now().isoformat(),
            }

        except Exception as e:
            return {
                "transcription": "",
                "language": "Idoma",
                "confidence": 0.0,
                "model": "Wav2Vec2 XLS-R",
                "timestamp": datetime.datetime.now().isoformat(),
                "error": f"Idoma transcription failed: {e}",
            }

    def transcribe_english(
        self, audio_data: bytes
    ) -> Dict[str, Any]:
        """
        Transcribe English audio to text using Whisper.

        Args:
            audio_data: Raw audio bytes

        Returns:
            Dictionary with transcription and confidence
        """
        self._load_models()

        # Load and preprocess audio
        audio, sr = self._load_audio(audio_data)

        # Check duration
        if not self._check_audio_duration(audio):
            return {
                "transcription": "",
                "language": "English",
                "confidence": 0.0,
                "model": "Whisper Large v3",
                "timestamp": datetime.datetime.now().isoformat(),
                "error": f"Audio too long (max {MAX_AUDIO_LENGTH_SECONDS} seconds)",
            }

        try:
            # Process audio
            inputs = self.english_processor(
                audio, sampling_rate=sr, return_tensors="pt"
            ).to(DEVICE)

            # Generate transcription
            with torch.no_grad():
                outputs = self.english_model.generate(inputs.input_features)
                transcription = self.english_processor.batch_decode(
                    outputs, skip_special_tokens=True
                )[0]

            return {
                "transcription": transcription,
                "language": "English",
                "confidence": 0.95,  # Placeholder - actual confidence from model
                "model": "Whisper Large v3",
                "timestamp": datetime.datetime.now().isoformat(),
            }

        except Exception as e:
            return {
                "transcription": "",
                "language": "English",
                "confidence": 0.0,
                "model": "Whisper Large v3",
                "timestamp": datetime.datetime.now().isoformat(),
                "error": f"English transcription failed: {e}",
            }

    def transcribe(
        self, audio_data: bytes, source_lang: str
    ) -> Dict[str, Any]:
        """
        Transcribe audio to text based on source language.

        Args:
            audio_data: Raw audio bytes
            source_lang: "English" or "Idoma"

        Returns:
            Dictionary with transcription and confidence
        """
        if source_lang == "Idoma":
            return self.transcribe_idoma(audio_data)
        elif source_lang == "English":
            return self.transcribe_english(audio_data)
        else:
            return {
                "transcription": "",
                "language": source_lang,
                "confidence": 0.0,
                "model": "Unknown",
                "timestamp": datetime.datetime.now().isoformat(),
                "error": f"Unsupported language: {source_lang}",
            }


# Create singleton instance
_asr_service: Optional[ASRService] = None


def get_asr_service() -> ASRService:
    """Get or create the global ASR service instance."""
    global _asr_service
    if _asr_service is None:
        _asr_service = ASRService()
    return _asr_service


if __name__ == "__main__":
    # Test with dummy audio
    service = ASRService()
    print("ASR service initialized. Models loaded on first use.")
