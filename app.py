import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template
from openai import OpenAI

load_dotenv()

app = Flask(__name__)

client = OpenAI(
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    api_key=os.environ["GEMINI_API_KEY"],
)

MODEL = "gemini-3.8-flash"  # use the model name that worked in test.py


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Message is empty"}), 400

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": message},
            ],
        )
        return jsonify({"reply": response.choices[0].message.content})
    except Exception as e:
        print("LLM error:", e)
        return jsonify({"error": "The model is busy or the limit was reached. Try again shortly."}), 503


if __name__ == "__main__":
    app.run(debug=True)