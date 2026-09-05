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
    """Pick the port to bind, and say why. Returns (port, reason).

    7860 first: that is the port Spaces forwards external traffic to, whatever the SDK.

    GRADIO_SERVER_PORT is only a *fallback*, never the first choice. On a Gradio Space
    it is 7861 — not 7860 — and something in the container already holds it, so
    honouring it first produced `[Errno 98] address already in use` and would have taken
    the server off the one port Spaces actually routes to.

    An explicit PORT wins outright and is not probed: Render and Fly assign it, and
    binding anything else there is simply wrong.
    """
    explicit = os.getenv("PORT")
    if explicit:
        return int(explicit), "PORT is set (host-assigned)"

    candidates = [7860]
    gradio_port = os.getenv("GRADIO_SERVER_PORT")
    if gradio_port and gradio_port.isdigit() and int(gradio_port) not in candidates:
        candidates.append(int(gradio_port))

    for candidate in candidates:
        if not _port_in_use(candidate):
            return candidate, "first free candidate"

    # Bind anyway rather than exiting silently — uvicorn's error names the port.
    return candidates[0], "every candidate busy; binding to surface the error"


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
