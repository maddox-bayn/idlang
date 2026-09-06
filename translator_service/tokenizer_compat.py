"""Load a tokenizer whose checkpoint declares `extra_special_tokens` as a list.

The problem
-----------
`emoduh/nllb-eng-idoma` ships a `tokenizer_config.json` containing:

    "extra_special_tokens": ["idu_Latn"]

a JSON *array*. transformers requires a mapping. From
`transformers/tokenization_utils_base.py`:

    def _set_model_specific_special_tokens(self, special_tokens: list[str]):
        self.SPECIAL_TOKENS_ATTRIBUTES = self.SPECIAL_TOKENS_ATTRIBUTES + list(special_tokens.keys())
        for key, value in special_tokens.items():
            ...

The annotation says `list[str]`; the body calls `.keys()` and `.items()`. The body wins,
so loading the checkpoint dies with:

    AttributeError: 'list' object has no attribute 'keys'

Reproduced against the live repo on transformers 4.57.6, failing at the exact line above.
In the Space that surfaced only as `❌ Translation Error: 'list' object has no attribute
'keys'`, because the UI handler catches every exception and stringifies it.

Why the checkpoint looks like that
----------------------------------
It is a transformers 4/5 disagreement about one key, not a mistake in the training code.
v5 renames the 4.x `additional_special_tokens` kwarg to `extra_special_tokens`
(`tokenization_utils_base.py:997`), stores it as a *list* (`:1036`), and writes that list
back out in `save_pretrained` (`:2055`). v4 reads the same key name and requires a mapping.
Training ran on v5 because the notebook's pin was `transformers>=4.40` with no upper bound;
this service pins `<5`. Verified on both majors against the live `tokenizer.json`:

    ["idu_Latn"]                  ->  4.57.6 AttributeError   |  5.16.1 loads
    {"idu_Latn": "idu_Latn"}      ->  4.57.6 loads            |  5.16.1 loads

The notebook now pins `<5` and asserts the major, so new checkpoints will not repeat it.

The repair
----------
`init_kwargs.update(kwargs)` in `_from_pretrained` means a keyword argument beats the
value read from the file, so the malformed entry can be corrected at the call site
without touching the Hub. `["idu_Latn"]` becomes `{"idu_Latn": "idu_Latn"}` — the shape
transformers wants, mapping the attribute name to the token.

Converting rather than discarding is deliberate. `{}` also loads and behaves identically
on every path this service uses, because `idu_Latn` is a real entry in `tokenizer.json`'s
added-tokens table (id 256204) and that, not the special-tokens map, is what
`convert_tokens_to_ids` reads. But the dict form preserves what the training notebook
meant to record, it is the only shape that loads under *both* majors (see the table
above), and it is what `save_pretrained` then writes back — so anyone who re-saves this
tokenizer emits a *correct* config instead of propagating the broken one.

Both forms were checked against the live checkpoint: identical ids (`idu_Latn`=256204,
`eng_Latn`=256047, `<unk>`=3), identical encoding of "water"
(`[256047, 21682, 2]`), and identical `decode(..., skip_special_tokens=True)` -> `'water'`
— the language tag is stripped either way, since `tokenizer.json` already marks it
special.

This is a workaround for a malformed checkpoint, not a fix for one. The real fix is to
correct `tokenizer_config.json` in the model repo; see DEPLOYMENT.md. This module then
does nothing, because it only engages after a load has actually failed.
"""

import json
import os

_MARKER = "has no attribute 'keys'"


def _declared_extra_special_tokens(model_id, token=None, cache_dir=None):
    """The checkpoint's raw `extra_special_tokens` value, or None if unreadable."""
    try:
        if os.path.isdir(model_id):
            path = os.path.join(model_id, "tokenizer_config.json")
            if not os.path.isfile(path):
                return None
        else:
            from huggingface_hub import hf_hub_download

            path = hf_hub_download(
                repo_id=model_id,
                filename="tokenizer_config.json",
                token=token,
                cache_dir=cache_dir,
            )
        with open(path, encoding="utf-8") as handle:
            return json.load(handle).get("extra_special_tokens")
    except Exception as exc:
        print(f"⚠️ could not read tokenizer_config.json for {model_id}: {exc!r}")
        return None


def _as_mapping(declared):
    """Coerce a declared `extra_special_tokens` value into the mapping transformers wants."""
    if isinstance(declared, dict):
        return declared
    if isinstance(declared, (list, tuple)):
        # ["idu_Latn"] -> {"idu_Latn": "idu_Latn"}; skip anything that is not a plain
        # token string, since a non-str value would only trip the TypeError branch of
        # _set_model_specific_special_tokens.
        return {t: t for t in declared if isinstance(t, str)}
    # Unreadable or an unexpected type. {} is the library default and always loads; the
    # language tokens live in tokenizer.json regardless, so nothing is lost.
    return {}


def load_tokenizer(auto_tokenizer_cls, model_id, **kwargs):
    """`AutoTokenizer.from_pretrained`, repairing a list-shaped `extra_special_tokens`.

    The normal load is attempted untouched, so a well-formed checkpoint takes exactly the
    library's own path and pays nothing — no extra request, no altered kwargs. Only after
    the specific AttributeError does this re-read the config and retry. Any other failure
    propagates unchanged: a missing repo, a gated 401, or a corrupt download must still be
    loud, since silently substituting a different model is the original bug this whole
    project exists to fix.
    """
    try:
        return auto_tokenizer_cls.from_pretrained(model_id, **kwargs)
    except AttributeError as exc:
        if _MARKER not in str(exc) or "extra_special_tokens" in kwargs:
            raise

        declared = _declared_extra_special_tokens(
            model_id, token=kwargs.get("token"), cache_dir=kwargs.get("cache_dir")
        )
        repaired = _as_mapping(declared)
        print(
            f"⚠️ {model_id} declares extra_special_tokens as "
            f"{type(declared).__name__} {declared!r}; transformers requires a mapping. "
            f"Retrying with {repaired!r}."
        )
        return auto_tokenizer_cls.from_pretrained(
            model_id, extra_special_tokens=repaired, **kwargs
        )
