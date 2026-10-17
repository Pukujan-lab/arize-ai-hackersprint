"""Tiny local Kokoro TTS service (kokoro-onnx), OpenAI-compatible: POST /v1/audio/speech -> audio/mpeg.

Runs in its own python>=3.10 venv (~/kokoro/.venv) so the main app stays light; the app calls it over HTTP (KOKORO_URL).
Model files expected next to this file: kokoro-v1.0.onnx, voices-v1.0.bin. Response header X-Audio-Duration (seconds)."""

import os, threading, time
import lameenc, numpy as np
from fastapi import Body, FastAPI
from fastapi.responses import JSONResponse, Response
from kokoro_onnx import Kokoro

D = os.environ.get("KOKORO_DIR") or os.path.dirname(os.path.abspath(__file__))
K = Kokoro(os.path.join(D, "kokoro-v1.0.onnx"), os.path.join(D, "voices-v1.0.bin"))
VOICE = os.environ.get("KOKORO_VOICE", "af_heart")
VOICES = set(K.get_voices())
_lock = threading.Lock()  # one synthesis at a time; onnxruntime already uses all cores
app = FastAPI(title="kokoro-local")


def _mp3(samples, sr):
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(64)
    enc.set_in_sample_rate(sr)
    enc.set_channels(1)
    enc.set_quality(2)
    return bytes(enc.encode(pcm) + enc.flush())


@app.get("/health")
def health():
    return {"ok": True, "voice": VOICE}


@app.get("/v1/audio/voices")
def voices():
    return {"voices": sorted(VOICES)}


@app.post("/v1/audio/speech")
def speech(q: dict = Body(...)):
    text = str(q.get("input") or "").strip()[:2000]
    if not text:
        return JSONResponse({"error": "empty input"}, 400)
    voice = q.get("voice") if q.get("voice") in VOICES else VOICE
    speed = min(max(float(q.get("speed") or 1.0), 0.5), 2.0)
    t0 = time.time()
    with _lock:
        samples, sr = K.create(text, voice=voice, speed=speed, lang="en-us")
    audio = _mp3(samples, sr)
    return Response(
        audio,
        media_type="audio/mpeg",
        headers={"X-Audio-Duration": "%.3f" % (len(samples) / sr), "X-Synth-Ms": str(round((time.time() - t0) * 1000)), "X-Voice": voice},
    )


with _lock:
    K.create("Ready.", voice=VOICE, lang="en-us")  # warm up so the first real line is fast
