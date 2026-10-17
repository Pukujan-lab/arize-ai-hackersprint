#!/bin/sh
# Install the local Kokoro TTS service on macOS: ~/kokoro venv (python 3.12 via uv), model files, launchd agent on 127.0.0.1:8880.
set -e
K="$HOME/kokoro"; HERE="$(cd "$(dirname "$0")" && pwd)"; mkdir -p "$K"; cd "$K"
[ -x .venv/bin/python ] || uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python kokoro-onnx fastapi uvicorn lameenc
R=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -s kokoro-v1.0.onnx ] || curl -fL -o kokoro-v1.0.onnx "$R/kokoro-v1.0.onnx"
[ -s voices-v1.0.bin ] || curl -fL -o voices-v1.0.bin "$R/voices-v1.0.bin"
cp "$HERE/kokoro_server.py" "$K/"
P="$HOME/Library/LaunchAgents/com.precedent.kokoro.plist"
sed "s#__HOME__#$HOME#g" "$HERE/com.precedent.kokoro.plist" > "$P"
launchctl bootout "gui/$(id -u)/com.precedent.kokoro" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$P"
echo "kokoro: launchd agent loaded; curl http://127.0.0.1:8880/health"
