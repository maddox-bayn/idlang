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
the Gradio UI underneath the FastAPI app from `backup_backend.py`, so one free Space
serves both. The sibling `README.space-docker.md` is for a Docker Space, which now
requires billing on the account.

## Hardware

Pick **ZeroGPU** — on the free tier that is what a Gradio Space is offered, and it is
genuinely free (a free personal account may host up to 2 ZeroGPU Spaces, provided the
email is verified and the account is more than 30 days old). `cpu-basic` now wants a
PRO subscription, and Docker Spaces want billing, so this is the free route.

**This Space then runs its models on the CPU anyway, and that is deliberate.** ZeroGPU
does not give a Space a GPU it holds; it lends one for the duration of an
`@spaces.GPU`-decorated call, driven by Gradio's event loop. Two consequences:

- A FastAPI route is not a Gradio event, so `/api/translate` can never hold an
  allocation. Autodetecting `cuda` there would put the model on a GPU that is not
  there.
- A free account gets **5 minutes of GPU time per day** (2 minutes for unauthenticated
  visitors). A few dozen sentences would exhaust it.

So `space_app.py` sets `DEVICE=cpu` for the whole process before anything reads it. No
Space variable is needed, no GPU quota is consumed, and both the UI and the API work.
Expect a few seconds per sentence rather than under one — the 600M model is small
enough that this is fine.

If you later move this to real GPU hardware, set `DEVICE=cuda` and the `@gpu` decorator
in `app.py` starts applying `spaces.GPU` to the two translate functions.

ZeroGPU still requires a `@spaces.GPU` function to *exist* at startup (the runtime
aborts the Space otherwise), so `space_app.py` defines one that is **never called** —
`_zerogpu_probe`. Defining it satisfies the startup check while consuming no quota, since
GPU time is only charged when a wrapped function actually runs.

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

Note the Gradio UI and the API hold independent copies of the model — roughly 5GB
resident if both are exercised. If the Space restarts under memory pressure, use only
one of the two interfaces.

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
