"""Integration tests for the full STT → NMT → TTS pipeline."""

import pytest
import sys
import io
import base64
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    import numpy as np
    from fastapi.testclient import TestClient
    from main import app
except ImportError as exc:
    pytestmark = pytest.mark.skip(reason="Integration test dependencies not installed")

# Create test client
client = TestClient(app)


class TestFullPipelineIntegration:
    """Integration tests for the complete translation pipeline."""

    def test_health_check(self):
        """Test that the service is healthy."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "Idlang Translator"

    def test_translate_text_english_to_idoma(self):
        """Test translating English text to Idoma."""
        response = client.post(
            "/translate",
            json={
                "text": "Hello",
                "source_lang": "English",
                "target_lang": "Idoma"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "translation" in data
        assert data["model"] == "NLLB-200"
        assert data["source_lang"] == "English"
        assert data["target_lang"] == "Idoma"

    def test_translate_text_idoma_to_english(self):
        """Test translating Idoma text to English."""
        response = client.post(
            "/translate",
            json={
                "text": "Ekpuoye",
                "source_lang": "Idoma",
                "target_lang": "English"
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert "translation" in data

    def test_translate_empty_text_fails(self):
        """Test that empty text returns an error."""
        response = client.post(
            "/translate",
            json={
                "text": "",
                "source_lang": "English",
                "target_lang": "Idoma"
            }
        )
        assert response.status_code == 400

    def test_translate_unsupported_language_fails(self):
        """Test that unsupported language returns an error."""
        response = client.post(
            "/translate",
            json={
                "text": "Hello",
                "source_lang": "Spanish",
                "target_lang": "Idoma"
            }
        )
        assert response.status_code == 400

    def test_transcribe_idoma_with_silent_audio(self):
        """Test transcribing silent Idoma audio."""
        # Create 1 second of silent audio
        duration = 1
        sampling_rate = 16000
        audio = np.zeros(int(duration * sampling_rate), dtype=np.float32)

        # Convert to WAV bytes
        wav_buffer = io.BytesIO()
        import soundfile as sf
        sf.write(wav_buffer, audio, sampling_rate, format="WAV")
        wav_buffer.seek(0)

        files = {"audio": ("silent.wav", wav_buffer, "audio/wav")}
        response = client.post(
            "/transcribe",
            data={"source_lang": "Idoma"},
            files=files
        )
        assert response.status_code == 200
        data = response.json()
        assert "transcription" in data
        assert data["language"] == "Idoma"

    def test_transcribe_english_with_silent_audio(self):
        """Test transcribing silent English audio."""
        duration = 1
        sampling_rate = 16000
        audio = np.zeros(int(duration * sampling_rate), dtype=np.float32)

        wav_buffer = io.BytesIO()
        import soundfile as sf
        sf.write(wav_buffer, audio, sampling_rate, format="WAV")
        wav_buffer.seek(0)

        files = {"audio": ("silent.wav", wav_buffer, "audio/wav")}
        response = client.post(
            "/transcribe",
            data={"source_lang": "English"},
            files=files
        )
        assert response.status_code == 200
        data = response.json()
        assert "transcription" in data

    def test_synthesize_idoma_text(self):
        """Test synthesizing Idoma text to speech."""
        response = client.post(
            "/synthesize",
            data={
                "text": "Ekpuoye",
                "target_lang": "Idoma"
            }
        )
        assert response.status_code == 200
        # Response should be streaming audio
        assert response.headers["content-type"] == "audio/wav"

    def test_synthesize_english_text(self):
        """Test synthesizing English text to speech."""
        response = client.post(
            "/synthesize",
            data={
                "text": "Hello",
                "target_lang": "English"
            }
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"

    def test_synthesize_empty_text_fails(self):
        """Test that empty text returns an error."""
        response = client.post(
            "/synthesize",
            data={
                "text": "",
                "target_lang": "Idoma"
            }
        )
        assert response.status_code == 400

    def test_full_pipeline_integration(self):
        """Test the complete STT → NMT → TTS pipeline."""
        # Create 1 second of silent audio
        duration = 1
        sampling_rate = 16000
        audio = np.zeros(int(duration * sampling_rate), dtype=np.float32)

        wav_buffer = io.BytesIO()
        import soundfile as sf
        sf.write(wav_buffer, audio, sampling_rate, format="WAV")
        wav_buffer.seek(0)

        files = {"audio": ("silent.wav", wav_buffer, "audio/wav")}
        response = client.post(
            "/pipeline",
            data={"source_lang": "English"},
            files=files
        )
        # Note: This may fail with silent audio, but should handle gracefully
        if response.status_code == 200:
            data = response.json()
            assert "transcription" in data
            assert "translation" in data
            assert "audio" in data
        elif response.status_code == 400:
            # Expected if no speech detected
            data = response.json()
            assert "detail" in data


class TestDictionaryFallbackIntegration:
    """Integration tests for dictionary lookup fallback chain."""

    def test_dictionary_lookup_hit(self):
        """Test that dictionary lookup works for known words."""
        response = client.post(
            "/translate",
            json={
                "text": "head",
                "source_lang": "English",
                "target_lang": "Idoma"
            }
        )
        assert response.status_code == 200
        data = response.json()
        # Should have a translation from dictionary
        assert data["translation"] == "ikpéyí"

    def test_dictionary_lookup_miss_fallback(self):
        """Test fallback when word not in dictionary."""
        response = client.post(
            "/translate",
            json={
                "text": "supercalifragilistic",
                "source_lang": "English",
                "target_lang": "Idoma"
            }
        )
        assert response.status_code == 200
        data = response.json()
        # Should either have translation or fallback message
        assert "translation" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
