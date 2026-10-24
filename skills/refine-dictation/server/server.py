"""OpenAI-compatible transcription server: Parakeet TDT 0.6b v3 in Moondream Photon.

Vowen's "Custom Server" setting is http://127.0.0.1:52625. Run it with start.cmd.

Benchmarked 2026-10-22 on this machine (24 of your recordings, RTX 4050 6GB,
Windows power mode Performance):

    engine                         WER    <15s   15-60s   1-3min   VRAM peak   RAM peak
    Photon 2.6.1, lean, bf16     3.39%   58ms    125ms    355ms     1476 MB    2205 MB

In Turbo mode (2026-10-21) the same setup took 85 / 223 / 659 ms.

"Lean" is single_pass_batch_capacity=1 plus expandable CUDA segments; both cut
VRAM with no speed cost for one request at a time. Photon cuts long audio into
segments at pauses itself, so there is no chunking here.

It loads ~/.stt/models/parakeet-tdt-0.6b-v3-bf16, a bf16 copy of the original
weights. Photon computes in bf16 either way, so the copy only saves the fp32
file's staging RAM while loading (peak 2191 MB vs 3347 MB). On the 24
recordings it changed one word in one transcript ("the decision" -> "a
decision", which matched your label). The fp32 original was deleted from the
Hugging Face cache on 2026-10-21; nothing here downloads it again.

The Python env is C:\\stt-bench\\.venv (moondream 2.6.1, kestrel 0.9.1, torch
2.14 cu130), which also holds fastapi/uvicorn/python-multipart for this file.

Every transcript is logged to ~/.stt/dictations.jsonl (dictlog.py) and the
report page is at /report (report.py).
"""

import argparse
import io
import os
import threading
import time
import warnings
from datetime import date

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
# Photon has no native kernels for this GPU generation (sm_89) in four conformer
# layers and says so on first use. Known and benchmarked; keep it out of the window.
warnings.filterwarnings("ignore", message="kestrel-kernels: no native")

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

import corrections
import dictlog
import report
from home import HOME

MODEL = "nvidia/parakeet-tdt-0.6b-v3"
BF16_DIR = HOME / "models/parakeet-tdt-0.6b-v3-bf16"

app = FastAPI(title="parakeet-tdt-v3-photon")
app.include_router(report.router)
_state: dict = {"housekept": None}
# One request on the GPU at a time: the lean config has a batch capacity of 1,
# and parallel requests would only queue inside Photon anyway.
_lock = threading.Lock()


def transcribe(samples: np.ndarray, sr: int) -> tuple[str, float]:
    t0 = time.perf_counter()
    with _lock:
        text = _state["speech"].transcribe(audio=samples, sample_rate=sr, timestamps="none")["text"]
    return text.strip(), time.perf_counter() - t0


def housekeep() -> None:
    """Once a day: drop log lines past 90 days and rules unused for 60."""
    if _state["housekept"] == date.today():
        return
    _state["housekept"] = date.today()
    dictlog.prune()
    corrections.remove_unused(dictlog.entries())


@app.get("/health")
def health():
    return {"status": "ok", "engine": _state.get("label")}


@app.get("/v1/models")
def models():
    return {
        "object": "list",
        "data": [{"id": "parakeet-tdt-0.6b-v3", "object": "model", "owned_by": "local"}],
    }


# A plain def, so FastAPI runs it on a worker thread: Photon's client drives its
# own event loop and must not be called from inside the server's loop.
@app.post("/v1/audio/transcriptions")
def transcriptions(
    file: UploadFile = File(...),
    model: str = Form(default="parakeet-tdt-0.6b-v3"),
    response_format: str = Form(default="json"),
    language: str = Form(default=""),
    prompt: str = Form(default=""),
    temperature: float = Form(default=0.0),
    debug: int = 0,
):
    raw = file.file.read()
    try:
        data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            status_code=400,
            content={"error": {"message": f"could not decode audio: {exc}"}},
        )

    samples = np.ascontiguousarray(data.mean(axis=1) if data.shape[1] > 1 else data[:, 0])
    duration = len(samples) / sr
    raw_text, elapsed = transcribe(samples, sr) if len(samples) else ("", 0.0)
    text, fixes = corrections.apply_traced(raw_text)
    if raw_text:
        dictlog.append(raw_text, text, fixes, duration)
        housekeep()
    print(
        f"{duration:6.2f}s -> {elapsed*1000:6.0f}ms  "
        f"({duration/max(elapsed, 1e-6):.0f}x, {_state['label']})"
        f"{'  [corrected]' if text != raw_text else ''}",
        flush=True,
    )

    if response_format == "text":
        return JSONResponse(content=text, media_type="text/plain")
    if debug:
        return {"text": text, "raw": raw_text}
    return {"text": text}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=52625)
    args = ap.parse_args()

    housekeep()
    if not BF16_DIR.is_dir():
        raise SystemExit(f"no model weights at {BF16_DIR}")

    import moondream as md
    import torch

    config = {"single_pass_batch_capacity": 1, "model_path": str(BF16_DIR)}

    t0 = time.perf_counter()
    _state["speech"] = md.photon(MODEL, device="cuda", **config).__enter__()
    _state["label"] = "photon/bf16/cuda"
    alloc = torch.cuda.memory_allocated() / 2**20
    print(
        f"engine: {_state['label']} (loaded in {time.perf_counter()-t0:.1f}s, "
        f"{alloc:.0f} MiB on {torch.cuda.get_device_name(0)})",
        flush=True,
    )
    if alloc < 500:
        raise SystemExit("the model is not on the GPU; check the CUDA install")

    # The first calls pay for kernel setup; burn that here so the first real
    # dictation is not the slow one.
    t0 = time.perf_counter()
    for seconds in (2, 8, 30):
        transcribe(np.zeros(16000 * seconds, dtype=np.float32), 16000)
    print(f"warm-up: {(time.perf_counter()-t0)*1000:.0f}ms", flush=True)

    import uvicorn

    print(f"\n  Vowen -> Custom Server -> http://{args.host}:{args.port}", flush=True)
    print(f"  Report -> http://{args.host}:{args.port}/report\n", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    # Skip interpreter teardown, as bench.py does after a Photon run.
    os._exit(0)


if __name__ == "__main__":
    main()
