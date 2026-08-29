"""Tests for the TTS service."""

import pytest

# Skip tests if dependencies not available
try:
    from services.tts_service import TTSService
except ImportError:
    pytestmark = pytest.mark.skip(reason="TTS dependencies not installed")


class TestTTSService:
    """Test cases for the TTS service."""

    @pytest.fixture
    def service(self):
        """Create a TTS service instance."""
        return TTSService()

    def test_synthesize_idoma_text(self, service):
        """Test synthesizing Idoma text to speech."""
        text = "Ekpuoye"
        audio_bytes = service.synthesize(text, "Idoma")

        assert audio_bytes is not None
        assert isinstance(audio_bytes.read(), bytes)

    def test_synthesize_english_text(self, service):
        """Test synthesizing English text to speech."""
        text = "Hello"
        audio_bytes = service.synthesize(text, "English")

        assert audio_bytes is not None
        assert isinstance(audio_bytes.read(), bytes)

    def test_empty_text_raises_error(self, service):
        """Test that empty text raises an error."""
        with pytest.raises(ValueError, match="Empty input text"):
            service.synthesize("", "Idoma")

    def test_whitespace_only_text_raises_error(self, service):
        """Test that whitespace-only text raises an error."""
        with pytest.raises(ValueError, match="Empty input text"):
            service.synthesize("   ", "English")

    def test_unsupported_language_raises_error(self, service):
        """Test that unsupported language raises an error."""
        with pytest.raises(ValueError, match="Unsupported language"):
            service.synthesize("Hello", "Spanish")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
