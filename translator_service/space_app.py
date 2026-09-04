"""Entry point for a **free Hugging Face Gradio Space**.

Why this file exists
--------------------
Docker Spaces now require billing on the account, so the free tier offers only the
Gradio SDK. But the React frontend on Vercel talks REST — `/api/translate`,
`/api/transcribe`, `/api/synthesize`, `/api/pipeline` — and a plain Gradio app
exposes none of those under those paths.

Gradio is itself a FastAPI application, so the two compose rather than compete:
take the FastAPI app that `backup_backend` already fully defines (every route
registered bare and under `/api`, CORS middleware attached) and mount the Gradio UI
underneath it. One process, one port, both interfaces.

Route precedence is registration order in Starlette, and `backup_backend` registers
its routers at import time — before the mount below — so `/api/*` and the bare
paths keep winning, and only unmatched paths fall through to the Gradio UI at `/`.

Configure the Space with:

    sdk: gradio
    app_file: space_app.py

Nothing here is Space-specific beyond the port default, so it also runs locally:

    python space_app.py            # or: uvicorn space_app:app --port 7860
"""

import os

# CPU unless the host explicitly says otherwise — set before importing anything that
# reads it, since config.py and app.py both resolve DEVICE at import time.
#
# The free Space tier runs on ZeroGPU, which grants a real GPU only inside an
# @spaces.GPU call and only 5 minutes a day on a free account. A FastAPI route is not a
# Gradio event and so can never hold that allocation. CPU for the whole process is what
# serves both interfaces correctly, and it consumes no GPU quota. See app.py for the
# longer version.
#
# setdefault, not assignment: a real GPU host can still pass DEVICE=cuda.
os.environ.setdefault("DEVICE", "cpu")

import gradio as gr
import uvicorn

# The FastAPI app: /health, /translate, /transcribe, /synthesize, /pipeline, each
# registered both bare and under /api, with CORSMiddleware already applied from
# CORS_ORIGINS. Imported first so its routes are matched ahead of the mount.
from backup_backend import app as api

# The existing Gradio UI. Kept as the Space's front page so the Space is usable on
# its own, not just as an invisible backend for Vercel.
from app import demo as gradio_ui

# Mounting at "/" makes the UI the Space's landing page. The API routes above are
# already registered, so this only catches what they do not.
app = gr.mount_gradio_app(api, gradio_ui, path="/")


if __name__ == "__main__":
    # Spaces routes to 7860 whatever the SDK. HOST/PORT stay overridable so this
    # file is not a Spaces-only entry point.
    uvicorn.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "7860")),
    )
