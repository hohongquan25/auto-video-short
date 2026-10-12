"""Read text aloud with OlvRoc (local, free, 25 preset Vietnamese voices).

The model code lives in olvroc/ next to this script; see its __init__.py.
Model files are read from OLVROC_MODEL_DIR (default: models/olvroc in the project).

Usage:
  python olvroc_tts.py --voices   Print the preset voices as one JSON array, without loading the model.
  python olvroc_tts.py            Worker: load the model once, then answer one request per stdin line.

Worker protocol (one JSON object per line):
  stdout  {"event": "loading"}
  stdout  {"event": "ready", "seconds": 8.1}
  stdin   {"id": 1, "text": "...", "voice": "Hải Đăng", "out": "C:/.../seg.wav"}
  stdout  {"id": 1, "ok": true, "seconds": 3.2, "duration": 4.1}
  stdout  {"id": 1, "ok": false, "error": "ValueError: ..."}
Library output goes to stderr, so stdout carries only these lines.
OLVROC_PRECISION=int8 trades some quality for ~1.6x speed on CPUs with VNNI.
"""
import json
import os
import sys
import time
from importlib.util import find_spec
from pathlib import Path

MODEL_DIR = os.environ.get("OLVROC_MODEL_DIR") or str(Path(__file__).resolve().parent.parent / "models" / "olvroc")
PRECISION = os.environ.get("OLVROC_PRECISION") or "fp32"


def main():
    # Windows defaults the standard streams to the ANSI code page, which cannot encode Vietnamese.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    out = sys.stdout
    out.reconfigure(encoding="utf-8")
    sys.stdout = sys.stderr

    def emit(obj):
        out.write(json.dumps(obj, ensure_ascii=False) + "\n")
        out.flush()

    if sys.argv[1:] == ["--voices"]:
        # These are imported only when synthesizing, so check here that they are installed.
        for mod in ("onnxruntime", "tokenizers"):
            if find_spec(mod) is None:
                raise SystemExit(f"Chưa cài {mod} trong {sys.executable}")
        from olvroc.tts import list_voices, missing_model_files

        missing = missing_model_files(MODEL_DIR, PRECISION)
        if missing:
            flag = " --int8" if PRECISION.lower() == "int8" else ""
            raise SystemExit(f"Thiếu {len(missing)} file model trong {MODEL_DIR}, chạy pnpm setup:olvroc{flag}")
        emit(list_voices())
        return

    emit({"event": "loading"})
    started = time.monotonic()
    from olvroc.tts import OlvRoc

    tts = OlvRoc(MODEL_DIR, precision=PRECISION)
    emit({"event": "ready", "seconds": round(time.monotonic() - started, 1)})

    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            t0 = time.monotonic()
            audio = tts.infer(req["text"], voice=req["voice"])
            if len(audio) == 0:
                raise ValueError("OlvRoc trả về audio rỗng")
            tts.save(audio, req["out"])
            emit({
                "id": req["id"], "ok": True,
                "seconds": round(time.monotonic() - t0, 1),
                "duration": round(len(audio) / tts.sample_rate, 2),
            })
        except Exception as e:  # report and keep serving: one bad text must not kill the loaded model
            emit({"id": req["id"], "ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()
