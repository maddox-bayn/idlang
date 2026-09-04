---
title: Idoma Translator API
emoji: 🗣️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Idoma Translator API

FastAPI service behind the Idlang frontend: `/health`, `/translate`, `/transcribe`,
`/synthesize`, `/pipeline`, each also registered under `/api/*` for browsers.

**Use this file as the `README.md` of a Docker Space.** The sibling `README.md` in
this directory is the card for the *Gradio* Space that runs `app.py`; Spaces reads
`sdk:` from `README.md` alone, so pushing that one to a Docker Space makes Spaces
ignore the `Dockerfile` and try to launch Gradio instead.

## Required Space variables

| Name | Value | Why |
|---|---|---|
| `NMT_MODEL_ID` | `emoduh/nllb-eng-idoma` | Stock NLLB has no `idu_Latn` and returns English. |
| `PORT` | `7860` | What Spaces routes to. `app_port` above must match. |
| `CORS_ORIGINS` | `https://<your-project>.vercel.app` | Defaults to `*`, which browsers reject for credentialed requests. |

No secret is needed: the checkpoint is public and ungated. Add `HF_TOKEN` as a
*Secret* only if you later point at a gated model.

`DICTIONARY_FIRST` is **not** used here — the fabricated `idoma_dictionary_v2.json`
is read only by the optional Go backend. This service always answers from the model.

## Cold start

The checkpoint is ~2.46 GB and downloads on first request, not at boot, so the
first `/api/translate` takes a few minutes while `/health` already answers. Without
the persistent-storage add-on the download repeats after every restart; with it,
set `CACHE_DIR=/data/model_cache` to keep the weights.

## Verifying

```bash
curl https://<user>-<space>.hf.space/health
curl -s https://<user>-<space>.hf.space/api/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"water","source_lang":"English","target_lang":"Idoma"}'
```

The response must not contain `water`. Expect `Ennkpo` (central) or `Enyi` (western).

Translations come from a model fine-tuned on vocabulary published by
[idomaland.org](https://www.idomaland.org/dictionary).
