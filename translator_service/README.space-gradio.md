---
title: Idoma Translator
emoji: 🗣️
colorFrom: indigo
colorTo: purple
sdk: gradio
sdk_version: 5.16.0
app_file: space_app.py
pinned: false
---

# Idoma Translator

English ↔ Idoma translation. A Gradio UI at `/`, and the REST API the Idlang React
frontend consumes: `/health`, `/translate`, `/transcribe`, `/synthesize`,
`/pipeline`, each also under `/api/*` for browsers.

**Use this file as the `README.md` of a free Gradio Space.** `space_app.py` mounts
the Gradio UI underneath the FastAPI app from `backup_backend.py`, so one free CPU
Space serves both. The sibling `README.space-docker.md` is for a Docker Space, which
now requires billing on the account.

## Hardware

**CPU basic** (free, 2 vCPU / 16GB) is enough — the 600M model answers in a few
seconds per sentence. Do not request ZeroGPU: it is Gradio-only, so it is *offered*
here, but a Space that requests paid hardware cannot be downgraded to `cpu-basic`
again without a PRO subscription. Choose CPU basic at creation.

## Space variables

| Name | Value | Why |
|---|---|---|
| `NMT_MODEL_ID` | `emoduh/nllb-eng-idoma` | Stock NLLB has no `idu_Latn` and returns English. |
| `CORS_ORIGINS` | `https://<your-project>.vercel.app` | Defaults to `*`, which browsers reject for credentialed requests. |

`PORT` is unnecessary — Spaces routes to 7860 and `space_app.py` defaults to it.
`DICTIONARY_FIRST` does nothing here: only the Go backend reads the dictionary.

No secret is needed — the checkpoint is public and ungated. Add `HF_TOKEN` as a
*Secret* only to point at a gated model.

## Cold start

The build installs torch, so expect ~10 minutes the first time. The checkpoint
(~2.46 GB) downloads on the first *translation*, not at boot, so `/health` answers
long before `/api/translate` does. Without persistent storage that download repeats
after each restart; with it, set `CACHE_DIR=/data/model_cache`.

Note the Gradio UI and the API load the model independently — roughly 5GB resident
if both are exercised, which the 16GB tier absorbs comfortably.

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
