import os
import subprocess
import time
import gradio as gr

print("🚀 Booting FastAPI Translation Backend Engine...")
backend_process = subprocess.Popen(["python", "main.py"], env=dict(os.environ, PORT="5005", HOST="127.0.0.1"))

# Give the backend models time to warm up
time.sleep(3)

frontend_dir = os.path.abspath("./dist")

if not os.path.exists(frontend_dir):
    with gr.Blocks() as demo:
        gr.Markdown("# Idoma Translation Service Backend\nFrontend asset compilation directory ('./dist') was not found.")
else:
    print(f"✅ Serving compiled web interface from: {frontend_dir}")
    demo = gr.MountToGradioApp(frontend_dir)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
