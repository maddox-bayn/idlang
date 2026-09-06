# Repairing `emoduh/nllb-eng-idoma`'s tokenizer config

The published checkpoint cannot be loaded by `transformers` as it stands. Its
`tokenizer_config.json` declares:

```json
"extra_special_tokens": ["idu_Latn"]
```

a JSON **array**, where the library requires an **object**. From
`transformers/tokenization_utils_base.py`:

```python
def _set_model_specific_special_tokens(self, special_tokens: list[str]):
    self.SPECIAL_TOKENS_ATTRIBUTES = self.SPECIAL_TOKENS_ATTRIBUTES + list(special_tokens.keys())
    for key, value in special_tokens.items():
        ...
```

The type annotation says `list[str]`; the body calls `.keys()` and `.items()`. The body
wins. Loading the repo therefore raises:

```
AttributeError: 'list' object has no attribute 'keys'
```

Reproduced against the live repo on transformers 4.57.6, failing at exactly that line. In
the Space it appeared only as `❌ Translation Error: 'list' object has no attribute 'keys'`,
because the Gradio handler catches every exception and stringifies it.

The service works around this at load time (`translator_service/tokenizer_compat.py`), so
**this repair is not required for the deployment to run.** It is required for anyone else
who does a plain `AutoTokenizer.from_pretrained("emoduh/nllb-eng-idoma")` — which today
fails for every third-party user of the model.

## The fix

`tokenizer_config.json` in this directory is the current published file with exactly one
key changed (verified: `keys changed: {'extra_special_tokens'}`):

```json
"extra_special_tokens": {"idu_Latn": "idu_Latn"}
```

Key is the attribute name, value is the token — the shape `save_pretrained` itself emits.

Upload it with a **write** token:

```bash
huggingface-cli login          # or: export HF_TOKEN=hf_...
huggingface-cli upload emoduh/nllb-eng-idoma \
    training/checkpoint_fix/tokenizer_config.json tokenizer_config.json
```

Or paste the file into the web editor at
<https://huggingface.co/emoduh/nllb-eng-idoma/blob/main/tokenizer_config.json>.

Verify afterwards — this must print `256204 3` and not raise:

```bash
python -c "
from transformers import AutoTokenizer
t = AutoTokenizer.from_pretrained('emoduh/nllb-eng-idoma')
print(t.convert_tokens_to_ids('idu_Latn'), t.unk_token_id)"
```

Once that passes, `tokenizer_compat.load_tokenizer` stops engaging on its own: it only
retries *after* a load has already failed, so a correct checkpoint takes the library's
normal path with nothing injected.

## Where the array actually came from

Not from a mistake in the notebook. The notebook's call is correct:

```python
tokenizer.add_special_tokens(
    {"additional_special_tokens": tokenizer.additional_special_tokens + [TGT_LANG]}
)
```

The cause is that **training ran on transformers 5.x while the service pins 4.x**, and the
two majors disagree about this one config key. In v5,
`tokenization_utils_base.py`:

```python
# line 997 — V5: Convert deprecated additional_special_tokens to extra_special_tokens
if "additional_special_tokens" in kwargs and "extra_special_tokens" not in kwargs:
    kwargs["extra_special_tokens"] = kwargs.pop("additional_special_tokens")
...
elif isinstance(value, (list, tuple)):
    self._extra_special_tokens = list(value)          # line 1036 — stored as a list
...
if self._extra_special_tokens:
    tokenizer_config["extra_special_tokens"] = self.extra_special_tokens   # line 2055
```

So v5 renamed the notebook's key, kept it as a list, and `save_pretrained` wrote that list
out. v4 reads the *same key name* but requires a mapping (`.keys()`, line 1472). The key
is shared; the type is not.

Verified by loading the live `tokenizer.json` against both majors with each config shape:

| config value | transformers 4.57.6 | transformers 5.16.1 |
|---|---|---|
| `["idu_Latn"]` | ❌ `'list' object has no attribute 'keys'` | ✅ loads |
| `{"idu_Latn": "idu_Latn"}` | ✅ loads | ✅ loads |

Both loading cells give identical results — `idu_Latn`=256204, `eng_Latn`=256047,
`<unk>`=3, `"water"` → `[256047, 21682, 2]` — so **the mapping form is strictly safer**: it
is the only shape that works on both majors, which is why it is the fix above rather than
deleting the key.

The remedy in the notebook is therefore a version cap, not a code change. Its install cell
now reads `"transformers>=4.40,<5"`, matching `translator_service/requirements.txt`, so
train and serve are on the same major. (`>=4.40` alone resolves to 5.x today.) The
published config also carries `backend`, `is_local` and `local_files_only` keys that do not
exist anywhere in 4.x — corroborating the same origin.

Whatever the version, re-check `tokenizer_config.json` after `save_pretrained`: it writes
back whatever shape it holds, so a value the *serving* runtime rejects round-trips silently
into the published repo.

## Also worth pushing, though nothing here needs it

`sentencepiece.bpe.model` and `special_tokens_map.json` are absent from the repo. Our code
is unaffected because `tokenizer.json` is self-contained for the fast tokenizer, but a
consumer forcing `use_fast=False` will fail. Add them if you still have the training
output.
