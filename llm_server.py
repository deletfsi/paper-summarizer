#!/usr/bin/env python3
"""
Simple LLM server using llama-cpp-python
Serves a local model with OpenAI-compatible API
"""

import os
import sys
from flask import Flask, request, jsonify
from llama_cpp import Llama

app = Flask(__name__)

# Configuration
MODEL_PATH = os.environ.get(
    "MODEL_PATH",
    "/mnt/d/0VibeCoding/000000model/Qwen3-8B/Qwen3-8B-Q4_K_M.gguf"
)

# Global model instance
llm = None


def load_model():
    """Load the model"""
    global llm
    print(f"Loading model from: {MODEL_PATH}")

    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Model not found: {MODEL_PATH}")

    llm = Llama(
        model_path=MODEL_PATH,
        n_ctx=4096,  # Context size (smaller for CPU)
        n_gpu_layers=0,  # CPU only
        verbose=False
    )

    print("Model loaded successfully!")


@app.route("/pletions", methods=["POST"])
def completions():
    """OpenAI-compatible completions endpoint"""
    if not llm:
        return jsonify({"error": "Model not loaded"}), 500

    data = request.get_json()
    prompt = data.get("prompt", "")
    max_tokens = data.get("max_tokens", 512)
    temperature = data.get("temperature", 0.7)
    stream = data.get("stream", False)

    # Generate
    output = llm(
        prompt,
        max_tokens=max_tokens,
        temperature=temperature,
        stop=[],
        echo=False
    )

    return jsonify({
        "choices": [{
            "text": output["choices"][0]["text"]
        }]
    })


@app.route("/v1/chat/completions", methods=["POST"])
def chat_completions():
    """OpenAI-compatible chat completions endpoint"""
    if not llm:
        return jsonify({"error": "Model not loaded"}), 500

    data = request.get_json()
    messages = data.get("messages", [])

    # Build prompt from messages
    prompt = ""
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            prompt += f"System: {content}\n"
        elif role == "user":
            prompt += f"User: {content}\n"
        elif role == "assistant":
            prompt += f"Assistant: {content}\n"

    prompt += "Assistant:"

    max_tokens = data.get("max_tokens", 1024)
    temperature = data.get("temperature", 0.7)

    # Generate
    output = llm(
        prompt,
        max_tokens=max_tokens,
        temperature=temperature,
        stop=["User:", "System:"],
        echo=False
    )

    return jsonify({
        "choices": [{
            "message": {
                "role": "assistant",
                "content": output["choices"][0]["text"]
            }
        }]
    })


@app.route("/health", methods=["GET"])
def health():
    """Health check"""
    return jsonify({
        "status": "ok",
        "model_loaded": llm is not None,
        "model_path": MODEL_PATH
    })


if __name__ == "__main__":
    # Load model first
    load_model()

    # Run server
    port = int(os.environ.get("PORT", 8083))
    print(f"Starting server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=False)
