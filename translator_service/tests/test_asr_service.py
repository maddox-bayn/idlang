"""Tests for the ASR service."""

import pytest

# Skip tests if dependencies not available
try:
    import numpy as np
    from services.asr_service import ASRService
except ImportError:
    pytestmark = pytest.mark.skip(reason="ASR dependencies not installed")


class TestASRService:
    """Test cases for the ASR service."""

    @pytest.fixture
    def service(self):
        """Create an ASR service instance."""
        return ASRService()

    def test_transcribe_idoma_with_silent_audio(self, service):
        """Test transcribing silent Idoma audio."""
        # Create 1 second of silent audio
        duration = 1  # seconds
        sampling_rate = 16000
        audio = np.zeros(int(duration * sampling_rate), dtype=np.float32)
        audio_bytes = audio.tobytes()

        result = service.transcribe(audio_bytes, "Idoma")

        assert "transcription" in result
        assert result["language"] == "Idoma"
        assert result["model"] == "Wav2Vec2 XLS-R"

    def test_transcribe_english_with_silent_audio(self, service):
        """Test transcribing silent English audio."""
        duration = 1  # seconds
        sampling_rate = 16000
        audio = np.zeros(int(duration * sampling_rate), dtype=np.float32)
        audio_bytes = audio.tobytes()

        result = service.transcribe(audio_bytes, "English")

        assert "transcription" in result
        assert result["language"] == "English"
        assert result["model"] == "Whisper Large v3"

    def test_transcribe_unsupported_language(self, service):
        """Test transcribing unsupported language."""
        duration = 1  # seconds
        sampling_rate = 16000
        audio = np.zeros(int(duration * sampling_rate), dtype=np.float32)
        audio_bytes = audio.tobytes()

        result = service.transcribe(audio_bytes, "Spanish")

        assert "error" in result
        assert "Unsupported language" in result["error"]

    def test_transcribe_audio_too_long(self, service):
        """Test transcribing audio longer than max duration."""
        max_duration = 30  # seconds
        sampling_rate = 16000
        audio = np.zeros(int(max_duration * sampling_rate + 1), dtype=np.float32)
        audio_bytes = audio.tobytes()

        result = service.transcribe(audio_bytes, "English")

        assert "error" in result
        assert "Audio too long" in result["error"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
