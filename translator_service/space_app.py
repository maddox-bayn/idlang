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
import socket

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


def _port_in_use(port, host="127.0.0.1"):
    """True if something is already listening on `port`."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.3)
        return probe.connect_ex((host, port)) == 0


def _choose_port():
    """Pick the first *free* port from the candidates, and say why. Returns (port, reason).

    Order matters, and so does probing every one of them:

      1. PORT — Render and Fly assign it and route to it, so it must be tried first.
      2. 7860 — what Spaces forwards external traffic to, whatever the SDK.
      3. GRADIO_SERVER_PORT — last resort.

    Nothing is bound unprobed. A Gradio Space sets `PORT=7861` and something in the
    container is *already listening* on 7861, so trusting PORT unconditionally gave
    `[Errno 98] address already in use` on every boot while 7860 sat free. Probing turns
    that into a fallback instead of a crash, without breaking a host like Render where
    the assigned PORT is free and is the only correct choice.
    """
    candidates = []

    def add(port):
        if port is not None and port not in candidates:
            candidates.append(port)

    def env_port(name):
        raw = os.getenv(name)
        return int(raw) if raw and raw.isdigit() else None

    add(env_port("PORT"))
    add(7860)
    add(env_port("GRADIO_SERVER_PORT"))

    for candidate in candidates:
        if not _port_in_use(candidate):
            return candidate, f"first free of {candidates}"

    # Bind anyway rather than exiting silently — uvicorn's error names the port.
    return candidates[0], f"all of {candidates} busy; binding to surface the error"


if __name__ == "__main__":
    # Spaces runs the app_file as a script, so this block is the real entry point on
    # the Space — uvicorn serves the composed app instead of demo.launch().
    host = os.getenv("HOST") or "0.0.0.0"
    port, reason = _choose_port()

    # A port collision is otherwise opaque, and on a Space each guess costs a rebuild.
    print("--- space_app: binding ---")
    for name in ("SPACE_ID", "PORT", "GRADIO_SERVER_PORT", "GRADIO_SERVER_NAME"):
        print(f"  {name}={os.getenv(name)!r}")
    for candidate in (7860, 7861):
        print(f"  port {candidate}: {'IN USE' if _port_in_use(candidate) else 'free'}")
    print(f"  -> serving on {host}:{port}  ({reason})")

    uvicorn.run(app, host=host, port=port)
