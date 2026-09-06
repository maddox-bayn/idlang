# Running `train_idoma_nllb.ipynb` on Google Colab

Start to finish, ~45 minutes, of which ~25 is unattended training. Free tier is enough.

The notebook is 30 cells. You run them **in order, top to bottom**. Only three need
anything from you: cell 6 (paste a token), cell 8 (upload three files), cell 28 (confirm the
push). Everything else is `Shift+Enter` and read the output.

> **The one rule:** cell 22 must print `GUARD 3 ok` before you run cell 28. That guard is
> what stops an untrained model reaching the Hub, which is exactly what happened last time.

## Before you start

Have these ready:

1. **A Hugging Face token with write access** — <https://huggingface.co/settings/tokens> →
   *New token* → type **Write** → copy it. A Read token cannot upload.
2. **The three corpus files** from this machine:
   - `data_pipeline/out/train.jsonl` (989 rows)
   - `data_pipeline/out/dev.jsonl` (125 rows)
   - `data_pipeline/out/test.jsonl` (137 rows)

   Download them to whatever computer your browser is on, since you upload them through the
   browser in step 4.

---

## Step 1 — Open the notebook and turn on the GPU

Go to <https://colab.research.google.com> → **File ▸ Upload notebook** → select
`training/train_idoma_nllb.ipynb`.

Then, **before running anything**: **Runtime ▸ Change runtime type** → Hardware accelerator
**T4 GPU** → *Save*.

Do this first. Cell 2 asserts a GPU is present and will stop you otherwise, and switching
runtime type later restarts the session and clears everything you have run.

## Step 2 — Cell 2: install

`Shift+Enter`. Takes 1–2 minutes.

Expect:

```
torch 2.x.x | cuda True
transformers 4.57.x
```

Two things can go wrong:

- `AssertionError: transformers 5.x.x will save a checkpoint the 4.x service cannot load` —
  pip resolved a version Colab had already imported. **Runtime ▸ Restart session**, then run
  cell 2 again. Do not skip past this: transformers 5 saves the language token in a shape the
  deployed service cannot read.
- `AssertionError: Enable the GPU` — you missed step 1.

## Step 3 — Cells 4 and 6: configure and log in

**Cell 4** just sets variables and prints nothing. It is already pointed at
`emoduh/nllb-eng-idoma`, so the retrained model **replaces the untrained one at the same
address** and the Space picks it up with no config change.

**Cell 6** shows a login box. Paste your **write** token and press Login.

Expect `logged in as: emoduh`.

## Step 4 — Cell 8: upload the corpus

A **Choose Files** button appears. Select all three `.jsonl` files at once.

Expect:

```
train.jsonl: 989 rows
dev.jsonl: 125 rows
test.jsonl: 137 rows
```

If a count is 0, the file did not upload — re-run the cell.

## Step 5 — Cell 10: check the data

Nothing to do; read it.

```
train=989 dev=125 test=137
train/test English overlap: 0 OK
  Water -> Ennkpo (central)
  ...
```

`overlap: 0` matters — it means the test score at the end is honest. The cell also asserts
there are no `ụụ` placeholder rows and no rows where English and Idoma are identical.

## Step 6 — Cells 12 and 13: watch the original bug

Cell 12 downloads base NLLB (~2.5 GB, 1–2 min) and prints:

```
idu_Latn   -> 3        <unk> MISSING
```

That `<unk>` is the whole reason this project exists. Cell 13 then demonstrates it —
`idu_Latn` returns the English sentence unchanged, while `ibo_Latn` returns real Igbo.

## Step 7 — Cell 15: the fix

Adds `idu_Latn` as a real token, grows the embedding matrix, and copies Igbo's embedding row
into the new one as a starting point.

```
idu_Latn -> 256204
embeddings: 256206 -> 256205
fix applied
```

**Understand this step, because it is why the last checkpoint failed silently.** After cell
15 the model has a valid `idu_Latn` that produces *fluent Igbo*, because that row still **is**
Igbo's row. Training is what pulls it apart. A model uploaded at this point looks completely
healthy and translates English to Igbo — `water` → `mmiri`.

## Step 8 — Cell 17: tokenise

Fast. Confirms labels start with the Idoma token:

```
train examples: 1978 | dev examples: 125
first label token: ['idu_Latn']
```

1978 is 989 × 2 — the notebook trains both directions so the encoder sees Idoma text too.

## Step 9 — Cell 19: train ⏳

**This is the cell that failed last time.** ~20–30 minutes for 12 epochs on a T4.

```
patched: model.prepare_decoder_input_ids_from_labels (M2M100 lacks it)
collator ok: decoder_input_ids start with 2 (decoder_start_token_id), no -100 present
starting from scratch
{'loss': 6.2431, 'learning_rate': ..., 'epoch': 0.2}
{'loss': 3.8817, ...}
...
loss 6.2431 -> 0.9412 over 148 logged steps
```

**Keep the browser tab open and visible.** Colab disconnects idle sessions, and a disconnect
here is the most likely reason the first upload was untrained weights. Don't close the laptop.

The two lines before `starting from scratch` are a fix, not a warning. NLLB is an M2M100
model, and M2M100 is one of the few seq2seq architectures that does not define
`prepare_decoder_input_ids_from_labels` — the method `DataCollatorForSeq2Seq` looks for when
deciding whether to pre-shift labels into `decoder_input_ids`. That is normally harmless,
because the model builds them itself from `labels`. But `label_smoothing_factor` makes the
Trainer *remove* `labels` before calling the model, so nothing builds them and the decoder
gets no input at all. The cell supplies the missing method so the collator pre-shifts, then
asserts the batch really contains `decoder_input_ids`. Without it the cell dies on step 1
with a message that names the opposite problem:

```
ValueError: You cannot specify both decoder_input_ids and decoder_inputs_embeds
            at the same time
```

Nothing was specified twice — both were absent. The check that raises is
`if (input_ids is None) ^ (inputs_embeds is not None)`, which is also true when both are
missing, but the message only describes the collision case.

Two protections are now in place:

- The cell saves a checkpoint every epoch. **If you do get disconnected, reconnect and re-run
  cell 19** — it prints `resuming from /content/nllb-eng-idoma/checkpoint-N` and continues
  instead of starting over. If the runtime was fully recycled (files gone), re-run from cell 2.
- It asserts the loss actually decreased, so a run that did not learn cannot proceed.

## Step 10 — Cells 21 and 22: the guards 🚦

**Cell 21** — checks the token resolves and the model isn't echoing its input:

```
GUARD 1 ok: idu_Latn -> 256204
  [ok] 'water' -> 'Ennkpo'
GUARD 2 ok: 5/5 probes produced new text
```

Read the actual words here, don't just look for `ok`. **If you see `'water' -> 'mmiri'`, the
model is emitting Igbo** — GUARD 2 passes it, because `mmiri` is not an echo of `water`.
That is precisely how the broken checkpoint slipped through.

**Cell 22 — GUARD 3, the one that matters.** Reloads base NLLB and compares weights:

```
tensors changed by training: 508 / 510
idu_Latn vs ibo_Latn seed: cosine=0.98421327  max|delta|=4.812e-02

GUARD 3 ok: weights moved and the Idoma token diverged from its seed
```

If it fails, it says so plainly and tells you not to upload:

```
AssertionError: FAIL: the idu_Latn embedding is byte-identical to the ibo_Latn seed...
```

That means training didn't run — go back to cell 19. **Do not continue past a failing
GUARD 3.**

## Step 11 — Cell 24: score it

```
chrF++       : 41.83
exact match  : 38/126 (30.2%)
echoed input : 0/126  <-- must be near zero
```

Don't be alarmed by the numbers. On ~1,000 mostly single-word pairs, chrF++ in the 30–50
range is what a working dictionary-level model looks like. `echoed input` near zero is the
real pass/fail. Below it are sample translations with their reference answers — skim them and
sanity-check a few against words you know.

## Step 12 — Cells 26, 27, 28: save and push

**Cell 26** saves locally and reload-checks the token survived: `reload ok: idu_Latn -> 256204`.

**Cell 27** writes the model card. It credits idomaland.org and states the limitations
honestly. Your scraped corpus is **not** uploaded — only the trained model.

**Cell 28** uploads (~2.5 GB, 3–5 min):

```
pushed -> https://huggingface.co/emoduh/nllb-eng-idoma
```

## Step 13 — Verify from outside Colab

In a terminal on any machine:

```bash
python -c "
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
tok = AutoTokenizer.from_pretrained('emoduh/nllb-eng-idoma')
model = AutoModelForSeq2SeqLM.from_pretrained('emoduh/nllb-eng-idoma')
tgt = tok.convert_tokens_to_ids('idu_Latn'); assert tgt != tok.unk_token_id
tok.src_lang = 'eng_Latn'
out = model.generate(**tok('water', return_tensors='pt'), forced_bos_token_id=tgt, num_beams=4)
print(tok.decode(out[0], skip_special_tokens=True))"
```

Expect **`Ennkpo`** or **`Enyi`**. If it prints `mmiri`, it is still Igbo — the upload did not
contain the trained weights.

## Step 14 — Restart the Space

The Space caches the model on disk, so it will keep serving the old weights until it
re-downloads. On <https://huggingface.co/spaces/emoduh/idoma-translator>:
**Settings ▸ Factory reboot** (a plain restart may reuse the cache).

On the next boot the log should show:

```
✅ Idoma token 'idu_Latn' present in tokenizer
✅ 'idu_Latn' embedding has diverged from its 'ibo_Latn' seed (max|delta|=...)
```

That second line is the load-time version of GUARD 3. If instead you see
`⚠️ Output will be **Igbo, not Idoma**`, the Space is still on the untrained checkpoint.

---

## If something goes wrong

| symptom | cause | fix |
|---|---|---|
| `transformers 5.x.x will save a checkpoint...` | pip resolved v5 | Runtime ▸ Restart session, re-run cell 2 |
| `AssertionError: Enable the GPU` | no accelerator | Runtime ▸ Change runtime type ▸ T4 GPU |
| `idu_Latn already exists` (cell 12) | not starting from stock NLLB | check `BASE_MODEL` in cell 4 |
| `cannot specify both decoder_input_ids and decoder_inputs_embeds` | M2M100 lacks `prepare_decoder_input_ids_from_labels`, so label smoothing left the decoder with no input | already fixed in cell 19; if you see it, you are on an older copy of the notebook |
| disconnected during cell 19 | Colab idle timeout | reconnect, re-run cell 19 — it resumes from the last epoch |
| `loss did not decrease` | run did not learn | restart runtime, run from cell 2 |
| GUARD 3 fails | training didn't run | re-run cell 19; do not upload |
| `'water' -> 'mmiri'` in cell 21 | Igbo, not Idoma | GUARD 3 will catch it; re-run cell 19 |
| `401` on push | Read token, not Write | new **Write** token, re-run cell 6 |
| Space still wrong after push | cached weights | Space Settings ▸ **Factory reboot** |

## Why cells 21 and 22 both exist

Cell 21 catches the *original* bug — a model that echoes its input, which is what happens
when `idu_Latn` is `<unk>`. Cell 22 catches the *second* bug — a model that translates
fluently into the wrong language, which is what happens when `idu_Latn` is a verbatim copy of
Igbo and training never moved it.

The second is harder to see and passes every check the first one makes. The published
checkpoint was bit-identical to `facebook/nllb-200-distilled-600M` on every tensor sampled,
with `idu_Latn` at cosine `1.00000000` to `ibo_Latn`. It loaded fine, resolved the token
fine, generated fluent text — in Igbo. Only comparing against the base weights reveals it,
which is what cell 22 does.
