"""Model Loader with Singleton pattern and LRU caching for ML models."""

import os
import threading
from typing import Optional, Tuple, Dict, Any
from loguru import logger

try:
    import torch
    from transformers import (
        AutoConfig,
        AutoModelForSeq2SeqLM,
        AutoTokenizer,
        AutoProcessor,
        Wav2Vec2ForCTC,
        WhisperForConditionalGeneration,
        SpeechT5ForTextToSpeech,
        SpeechT5HifiGan,
        SpeechT5Tokenizer,
        VitsModel,
    )
    from transformers.pipelines import pipeline as hf_pipeline
except ImportError as exc:
    raise ImportError(
        "Transformers and PyTorch are required. Install with 'pip install transformers torch'"
    ) from exc

from config import ModelIDs, DEVICE, CACHE_DIR

# Global model cache
_model_cache: Dict[str, Any] = {}
_cache_lock = threading.Lock()


def get_cache_dir() -> str:
    """Get or create cache directory for models."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    return CACHE_DIR


class ModelManager:
    """Singleton model manager with LRU caching."""

    @staticmethod
    def load_nmt_models() -> Tuple[AutoTokenizer, AutoModelForSeq2SeqLM]:
        """Load NMT model (NLLB-200) for translation."""
        cache_key = "nmt"
        with _cache_lock:
            if cache_key in _model_cache:
                logger.debug("Returning cached NMT model")
                return _model_cache[cache_key]

            logger.info(f"Loading NMT model: {ModelIDs.NMT} on {DEVICE}")
            tokenizer = AutoTokenizer.from_pretrained(
                ModelIDs.NMT,
                cache_dir=get_cache_dir(),
                local_files_only=False,
            )
            model = AutoModelForSeq2SeqLM.from_pretrained(
                ModelIDs.NMT,
                cache_dir=get_cache_dir(),
                torch_dtype=torch.float32 if DEVICE == "cpu" else torch.float16,
                device_map="auto" if DEVICE != "cpu" else None,
            )
            model.eval()

            _model_cache[cache_key] = (tokenizer, model)
            logger.info("NMT model loaded successfully")
            return (tokenizer, model)

    @staticmethod
    def load_idoma_asr() -> Tuple[AutoProcessor, Wav2Vec2ForCTC]:
        """Load Wav2Vec2 model for Idoma speech recognition."""
        cache_key = "asr_idoma"
        with _cache_lock:
            if cache_key in _model_cache:
                logger.debug("Returning cached Idoma ASR model")
                return _model_cache[cache_key]

            logger.info(f"Loading Idoma ASR model: {ModelIDs.ASR_IDOMA} on {DEVICE}")
            processor = AutoProcessor.from_pretrained(
                ModelIDs.ASR_IDOMA,
                cache_dir=get_cache_dir(),
                local_files_only=False,
            )
            model = Wav2Vec2ForCTC.from_pretrained(
                ModelIDs.ASR_IDOMA,
                cache_dir=get_cache_dir(),
                torch_dtype=torch.float32 if DEVICE == "cpu" else torch.float16,
                device_map="auto" if DEVICE != "cpu" else None,
            )
            model.eval()

            _model_cache[cache_key] = (processor, model)
            logger.info("Idoma ASR model loaded successfully")
            return (processor, model)

    @staticmethod
    def load_english_asr() -> Tuple[AutoProcessor, WhisperForConditionalGeneration]:
        """Load Whisper model for English speech recognition."""
        cache_key = "asr_english"
        with _cache_lock:
            if cache_key in _model_cache:
                logger.debug("Returning cached English ASR model")
                return _model_cache[cache_key]

            logger.info(f"Loading English ASR model: {ModelIDs.ASR_ENGLISH} on {DEVICE}")
            processor = AutoProcessor.from_pretrained(
                ModelIDs.ASR_ENGLISH,
                cache_dir=get_cache_dir(),
                local_files_only=False,
            )
            model = WhisperForConditionalGeneration.from_pretrained(
                ModelIDs.ASR_ENGLISH,
                cache_dir=get_cache_dir(),
                torch_dtype=torch.float32 if DEVICE == "cpu" else torch.float16,
                device_map="auto" if DEVICE != "cpu" else None,
            )
            model.eval()

            _model_cache[cache_key] = (processor, model)
            logger.info("English ASR model loaded successfully")
            return (processor, model)

    @staticmethod
    def load_idoma_tts() -> Tuple[AutoTokenizer, Any]:
        """Load the VITS/MMS-TTS model used for Idoma text-to-speech.

        This must be VitsModel, not AutoModelForSeq2SeqLM. VITS is not registered
        in the Seq2SeqLM mapping, so the previous AutoModelForSeq2SeqLM call raised
        at load time for every checkpoint it was ever pointed at — including the
        SpeechT5 default. tts_service.synthesize_idoma() then reads
        `model(**inputs).waveform`, which is the VITS output signature and does not
        exist on SpeechT5, so a non-VITS checkpoint cannot work here at all. It is
        rejected up front with an actionable message rather than failing later
        inside inference.
        """
        cache_key = "tts_idoma"
        with _cache_lock:
            if cache_key in _model_cache:
                logger.debug("Returning cached Idoma TTS model")
                return _model_cache[cache_key]

            logger.info(f"Loading Idoma TTS model: {ModelIDs.TTS_IDOMA} on {DEVICE}")

            config = AutoConfig.from_pretrained(
                ModelIDs.TTS_IDOMA, cache_dir=get_cache_dir()
            )
            architecture = getattr(config, "model_type", "") or ""
            if architecture.lower() != "vits":
                raise RuntimeError(
                    f"TTS_IDOMA_MODEL={ModelIDs.TTS_IDOMA!r} is a {architecture!r} "
                    "checkpoint, but Idoma synthesis needs a VITS/MMS-TTS model "
                    "(it reads `.waveform` from the model output). Set "
                    "TTS_IDOMA_MODEL to a VITS checkpoint, or leave Idoma audio "
                    "disabled — there is no public Idoma TTS model, so English "
                    "synthesis is used as a clearly-labelled stand-in."
                )

            tokenizer = AutoTokenizer.from_pretrained(
                ModelIDs.TTS_IDOMA,
                cache_dir=get_cache_dir(),
                local_files_only=False,
            )
            model = VitsModel.from_pretrained(
                ModelIDs.TTS_IDOMA,
                cache_dir=get_cache_dir(),
                # VITS vocoding is numerically sensitive; float16 produces noise on
                # some checkpoints, so keep it in float32 and move the module.
                torch_dtype=torch.float32,
            )
            model.to(DEVICE)
            model.eval()

            _model_cache[cache_key] = (tokenizer, model)
            logger.info("Idoma TTS model loaded successfully")
            return (tokenizer, model)

    @staticmethod
    def load_english_tts_pipeline() -> Tuple[Any, Any]:
        """Load SpeechT5 pipeline for English text-to-speech."""
        cache_key = "tts_english"
        with _cache_lock:
            if cache_key in _model_cache:
                logger.debug("Returning cached English TTS pipeline")
                return _model_cache[cache_key]

            logger.info(f"Loading English TTS model: {ModelIDs.TTS_ENGLISH} on {DEVICE}")

            # Load tokenizer
            tokenizer = SpeechT5Tokenizer.from_pretrained(
                ModelIDs.TTS_ENGLISH,
                cache_dir=get_cache_dir(),
                local_files_only=False,
            )

            # Load model
            model = SpeechT5ForTextToSpeech.from_pretrained(
                ModelIDs.TTS_ENGLISH,
                cache_dir=get_cache_dir(),
                torch_dtype=torch.float32 if DEVICE == "cpu" else torch.float16,
                device_map="auto" if DEVICE != "cpu" else None,
            )

            # Load vocoder
            vocoder = SpeechT5HifiGan.from_pretrained(
                "microsoft/speecht5_hifigan",
                cache_dir=get_cache_dir(),
                torch_dtype=torch.float32 if DEVICE == "cpu" else torch.float16,
                device_map="auto" if DEVICE != "cpu" else None,
            )

            # Load speaker embeddings
            embeddings_dataset = hf_pipeline(
                "text-to-speech",
                model=ModelIDs.TTS_ENGLISH,
                pipeline_kwargs={"vocoder": vocoder},
            )

            _model_cache[cache_key] = (embeddings_dataset, vocoder)
            logger.info("English TTS pipeline loaded successfully")
            return (embeddings_dataset, vocoder)

    @staticmethod
    def clear_cache() -> None:
        """Clear the model cache."""
        with _cache_lock:
            _model_cache.clear()
            logger.info("Model cache cleared")

    @staticmethod
    def get_cache_stats() -> Dict[str, int]:
        """Get cache statistics."""
        return {"size": len(_model_cache)}


# Initialize cache directory on module load
get_cache_dir()
