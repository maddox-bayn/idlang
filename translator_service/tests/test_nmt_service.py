"""Tests for the NMT service."""

import pytest

# Skip tests if dependencies not available
try:
    from services.nmt_service import TranslationService
except ImportError:
    pytestmark = pytest.mark.skip(reason="Transformers not installed")


class TestTranslationService:
    """Test cases for the Translation service."""

    @pytest.fixture
    def service(self):
        """Create a translation service instance."""
        return TranslationService()

    def test_translate_english_to_idoma(self, service):
        """Test translating English to Idoma."""
        result = service.translate("Hello", "English", "Idoma")

        assert "translation" in result
        assert result["model"] == "NLLB-200"
        assert result["source_lang"] == "English"
        assert result["target_lang"] == "Idoma"
        assert result["confidence"] > 0

    def test_translate_idoma_to_english(self, service):
        """Test translating Idoma to English."""
        # Use a known translation from the dictionary
        result = service.translate("Ekpuoye", "Idoma", "English")

        assert "translation" in result
        assert result["model"] == "NLLB-200"

    def test_empty_text_returns_error(self, service):
        """Test that empty text returns an error."""
        result = service.translate("", "English", "Idoma")

        assert "error" in result
        assert "Empty input text" in result["error"]

    def test_whitespace_only_text_returns_error(self, service):
        """Test that whitespace-only text returns an error."""
        result = service.translate("   ", "English", "Idoma")

        assert "error" in result

    def test_unsupported_source_language(self, service):
        """Test that unsupported source language returns error."""
        result = service.translate("Hello", "Spanish", "Idoma")

        assert "error" in result
        assert "Unsupported source language" in result["error"]

    def test_unsupported_target_language(self, service):
        """Test that unsupported target language returns error."""
        result = service.translate("Hello", "English", "Spanish")

        assert "error" in result
        assert "Unsupported target language" in result["error"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
