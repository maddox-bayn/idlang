"""
Idlang Translator - Gradio App with Direct Model Integration
Runs on Hugging Face Spaces (ZeroGPU or CPU).

-------------------------------------------------------------------------------
WHY THIS APP USED TO RETURN ENGLISH
-------------------------------------------------------------------------------
Stock NLLB-200 covers 202 languages and Idoma is NOT one of them. Verified
against facebook/nllb-200-distilled-600M's tokenizer:

    eng_Latn -> 256047   valid
    ibo_Latn -> 256073   valid  (Igbo)
    idu_Latn -> 3        <unk>  (Idoma -- absent)
    ig_Latn  -> 3        <unk>  (not a real NLLB code at all)

The previous code did `tgt_lang_code = "idu_Latn" if is_fine_tuned else "ig_Latn"`,
so BOTH branches resolved to <unk>. Forcing <unk> as forced_bos_token_id gives the
decoder no target-language signal, so it copies the source sentence -- which is
exactly the "English in, English out" bug.

THE FIX: use a checkpoint whose tokenizer actually contains an `idu_Latn` token
(see training/train_idoma_nllb.ipynb, which adds the token, resizes the embedding
matrix, and initialises the new row from ibo_Latn before fine-tuning). This app now
validates that token at load time and reports a clear error instead of silently
emitting untranslated text.
-------------------------------------------------------------------------------
"""

import os

# ---------------------------------------------------------------------------
# Device, resolved before anything else imports torch.
# ---------------------------------------------------------------------------
# Same contract as config.py, so the Gradio UI and the FastAPI service agree.
#
# On the free Hugging Face tier a Space runs on ZeroGPU, where this matters a lot.
# ZeroGPU hands out a real GPU only for the duration of an @spaces.GPU call, driven by
# Gradio's event loop, and a free account gets 5 minutes of GPU time per day. Both
# facts point the same way for this service:
#
#   * the REST API in backup_backend.py is not a Gradio event, so it can never hold an
#     allocation — autodetecting "cuda" there yields a model on a GPU that isn't there;
#   * 5 min/day would be spent by a few dozen sentences anyway.
#
# So space_app.py sets DEVICE=cpu and the whole process stays on CPU: slower per
# sentence, but correct, and it consumes no quota at all.
_DEVICE_ENV = os.getenv("DEVICE")

# `spaces` only exists on ZeroGPU hardware, and it patches torch on import — so import
# it before torch, and only when a GPU is actually going to be used. On the CPU path it
# is dead weight whose import can fail for reasons an ImportError guard would not catch
# (it supports torch 2.8+ only).
if _DEVICE_ENV == "cuda":
    try:
        import spaces
        HAS_ZEROGPU = True
        print("✅ ZeroGPU available")
    except ImportError:
        spaces = None
        HAS_ZEROGPU = False
        print("⚠️ ZeroGPU not present — running without the GPU decorator")
else:
    spaces = None
    HAS_ZEROGPU = False

import gradio as gr
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

# The API-schema scanner is wrapped, not replaced.
#
# This used to be `return {}` — a hard override of gr.Blocks.get_api_info, guarding
# against the schema scanner raising on some component's JSON schema. That guard broke
# the UI, and did it silently, which is worth recording because the symptom pointed
# nowhere near the cause: the buttons did nothing and the console said
# `Submit function encountered an error: Error: No API found`.
#
# The empty dict is the whole problem. Gradio's browser client does, in view_api:
#
#     api_info = await response.json()          # our {}
#     if (api_info.named_endpoints["/predict"]  // TypeError: undefined["/predict"]
#         && !api_info.unnamed_endpoints["0"])
#     ...
#     } catch (e) {
#         "Could not get API info. " + e.message;   // an expression statement.
#     }                                            // Not logged. Not rethrown.
#
# So the client crashes on the missing key, the catch block computes a string and throws
# it away, view_api returns undefined, and submit() hits `if (!api_info) throw new
# Error("No API found")`. One absent key, two swallowed errors, and a dead UI.
#
# `{"named_endpoints": {}, "unnamed_endpoints": {}}` — the shape gradio's own
# get_api_info starts from — costs nothing and keeps the client on its normal path. The
# UI submits by fn_index, and every consumer of a missing endpoint_info already handles
# it (`endpoint_info?.parameters[index]?.component` in walk_and_store_blobs, and an
# explicit undefined branch in map_data_to_params), so an empty-but-shaped result serves
# the UI correctly; only the API-docs panel goes quiet.
#
# Preferring the real scanner is the other half. Returning empty unconditionally throws
# away working schema information on the assumption it will fail. Two Textboxes in and
# two out is the simplest case gradio has, so it is expected to succeed here; the
# fallback only pays out if it genuinely raises.
_real_get_api_info = getattr(
    gr.Blocks.get_api_info, "__wrapped_by_idlang__", None
) or gr.Blocks.get_api_info


def block_api_schema(self, *args, **kwargs):
    try:
        info = _real_get_api_info(self, *args, **kwargs)
    except Exception as exc:  # the scanner this shim originally existed to contain
        print(f"⚠️ API schema scan failed ({exc!r}) — serving empty schema")
        info = None

    if not isinstance(info, dict) or "named_endpoints" not in info:
        return {"named_endpoints": {}, "unnamed_endpoints": {}}
    return info


# Remember the original on the shim, so re-importing this module (a reload, or a second
# entry point importing it) rebinds to gradio's implementation rather than to the
# previous shim — which would capture itself and recurse until the stack blew.
block_api_schema.__wrapped_by_idlang__ = _real_get_api_info
gr.Blocks.get_api_info = block_api_schema

DEVICE = _DEVICE_ENV or ("cuda" if torch.cuda.is_available() else "cpu")


def gpu(fn):
    """Claim a ZeroGPU allocation for `fn`, but only when CUDA is actually in use.

    An @spaces.GPU decorator reserves (and consumes daily quota for) a GPU even when
    the wrapped work runs on CPU, so it is worse than useless once DEVICE is cpu.
    """
    if HAS_ZEROGPU and DEVICE == "cuda":
        return spaces.GPU(fn)
    return fn


# Point this at your fine-tuned Idoma checkpoint. It must be a public, ungated
# repo, or the Space needs an HF_TOKEN secret with access.
MODEL_ID = os.getenv("NMT_MODEL_ID", "facebook/nllb-200-distilled-600M")
HF_TOKEN = os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")

IDOMA_LANG_CODE = os.getenv("IDOMA_LANG_CODE", "idu_Latn")
ENGLISH_LANG_CODE = "eng_Latn"

# Igbo is the nearest in-vocabulary Benue-Congo relative. It is NOT Idoma, so it
# is opt-in only: set ALLOW_IGBO_FALLBACK=true to accept degraded Igbo output
# from a stock checkpoint rather than an error.
FALLBACK_LANG_CODE = "ibo_Latn"
ALLOW_IGBO_FALLBACK = os.getenv("ALLOW_IGBO_FALLBACK", "false").lower() == "true"

print("=" * 60)
print("🚀 IDLANG TRANSLATOR - STARTUP")
print("=" * 60)
print(f"🖥️  Device: {DEVICE}")
print(f"📦 Model:  {MODEL_ID}")
print(f"🏷️  Idoma token: {IDOMA_LANG_CODE}")
print("=" * 60)

# ==========================================
# GLOBAL MODEL CACHE
# ==========================================
nmt_tokenizer = None
nmt_model = None
# Resolved once at load time: the language code actually used for Idoma, plus a
# warning when the checkpoint cannot represent Idoma.
idoma_code = None
idoma_warning = None


class ModelUnsupportedLanguage(RuntimeError):
    """The loaded checkpoint has no usable Idoma language token."""


def _resolve_idoma_code(tokenizer):
    """Pick the Idoma target token, or explain why none is usable.

    Returns (code, warning). Raises ModelUnsupportedLanguage when the checkpoint
    cannot represent Idoma and the Igbo fallback has not been opted into --
    failing loudly beats returning the input sentence unchanged.
    """
    unk = tokenizer.unk_token_id
    if tokenizer.convert_tokens_to_ids(IDOMA_LANG_CODE) != unk:
        return IDOMA_LANG_CODE, None

    detail = (
        f"Checkpoint '{MODEL_ID}' has no '{IDOMA_LANG_CODE}' token, so it cannot "
        f"generate Idoma. Fine-tune a checkpoint that adds this token "
        f"(training/train_idoma_nllb.ipynb) and set NMT_MODEL_ID to it."
    )

    if not ALLOW_IGBO_FALLBACK:
        raise ModelUnsupportedLanguage(detail)

    if tokenizer.convert_tokens_to_ids(FALLBACK_LANG_CODE) == unk:
        raise ModelUnsupportedLanguage(
            detail + f" The '{FALLBACK_LANG_CODE}' fallback is also missing."
        )

    return FALLBACK_LANG_CODE, (
        f"⚠️ Output is **{FALLBACK_LANG_CODE} (Igbo)**, not Idoma — "
        f"ALLOW_IGBO_FALLBACK is enabled and {detail}"
    )


def load_translation_model():
    """Load the tokenizer/model once and validate the Idoma language token."""
    global nmt_tokenizer, nmt_model, idoma_code, idoma_warning

    if nmt_tokenizer is None:
        print(f"📦 Loading {MODEL_ID} ...")
        kwargs = {"token": HF_TOKEN} if HF_TOKEN else {}
        # No silent fallback to a different repo here: substituting a stock NLLB
        # checkpoint for a gated Idoma one is what produced untranslated output.
        # Configuration errors must surface, not be papered over.
        tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, **kwargs)
        model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID, **kwargs)
        model.eval()

        idoma_code, idoma_warning = _resolve_idoma_code(tokenizer)
        if idoma_warning:
            print(idoma_warning)
        else:
            print(f"✅ Idoma token '{idoma_code}' present in tokenizer")

        nmt_tokenizer, nmt_model = tokenizer, model
        print("✅ Model ready")

    return nmt_tokenizer, nmt_model


def _generate(text, src_code, tgt_code):
    tokenizer, model = load_translation_model()
    model = model.to(DEVICE)

    tokenizer.src_lang = src_code
    inputs = tokenizer(str(text), return_tensors="pt").to(DEVICE)

    tgt_token_id = tokenizer.convert_tokens_to_ids(tgt_code)
    if tgt_token_id == tokenizer.unk_token_id:
        raise ModelUnsupportedLanguage(
            f"Target language token '{tgt_code}' is not in this tokenizer."
        )

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            forced_bos_token_id=tgt_token_id,
            max_length=256,
            num_beams=4,
        )

    result = str(tokenizer.decode(outputs[0], skip_special_tokens=True))
    if idoma_warning:
        result = f"{result}\n\n{idoma_warning}"
    return result


# ==========================================
# CORE TRANSLATION FUNCTIONS (ZeroGPU Compliant)
# ==========================================


@gpu
def translate_english_to_idoma(text):
    if not text or not str(text).strip():
        return "Error: Input string cannot be empty."

    try:
        print("🔄 English ➡️ Idoma")
        return _generate(text, ENGLISH_LANG_CODE, idoma_code or IDOMA_LANG_CODE)
    except ModelUnsupportedLanguage as e:
        return f"❌ Model misconfigured: {e}"
    except Exception as e:
        return f"❌ Translation Error: {e}"


@gpu
def translate_idoma_to_english(text):
    if not text or not str(text).strip():
        return "Error: Input string cannot be empty."

    try:
        print("🔄 Idoma ➡️ English")
        # Load first so idoma_code is resolved before it is used as the source.
        load_translation_model()
        return _generate(text, idoma_code or IDOMA_LANG_CODE, ENGLISH_LANG_CODE)
    except ModelUnsupportedLanguage as e:
        return f"❌ Model misconfigured: {e}"
    except Exception as e:
        return f"❌ Translation Error: {e}"


# ==========================================
# PRODUCTION USER INTERFACE DESIGN LAYOUT
# ==========================================
with gr.Blocks(title="Idlang Translator", theme=gr.themes.Soft()) as demo:
    gr.Markdown("# 🗣️ Idoma-English Translation Service")
    gr.Markdown(
        f"Model: `{MODEL_ID}` · Device: `{DEVICE}` · "
        f"{'ZeroGPU' if HAS_ZEROGPU else 'standard hardware'}"
    )

    with gr.Group():
        gr.Markdown("### 📝 English ➡️ Idoma")
        en_input = gr.Textbox(label="English Input Text", placeholder="Type English sentences here...", lines=3)
        en_btn = gr.Button("🚀 Translate to Idoma", variant="primary")
        en_output = gr.Textbox(label="Idoma Translation Result Output", interactive=False, lines=3)

        en_btn.click(fn=translate_english_to_idoma, inputs=en_input, outputs=en_output)

    gr.Markdown("---")

    with gr.Group():
        gr.Markdown("### 📝 Idoma ➡️ English")
        idu_input = gr.Textbox(label="Idoma Input Text", placeholder="Type Idoma sentences here...", lines=3)
        idu_btn = gr.Button("🚀 Translate to English", variant="primary")
        idu_output = gr.Textbox(label="English Translation Result Output", interactive=False, lines=3)

        idu_btn.click(fn=translate_idoma_to_english, inputs=idu_input, outputs=idu_output)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860, quiet=True, show_api=False)
