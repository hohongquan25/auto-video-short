"""Transcribe an audio file with faster-whisper.

Usage: python transcribe.py <input_audio> <output_txt> <model> <language>
Events are printed to stdout as JSON lines:
  {"event": "loading", "model": "medium"}
  {"event": "loaded", "seconds": 4.2}
  {"event": "info", "language": "vi", "probability": 0.99, "duration": 1800.0, "duration_after_vad": 1650.0}
  {"progress": 0.42, "t": 756.1, "text": "..."}
  {"event": "done", "segments": 512, "chars": 34567}
"""
import json
import sys
import time

from faster_whisper import WhisperModel


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def main():
    # Windows defaults stdout to the ANSI code page, which cannot encode Vietnamese.
    sys.stdout.reconfigure(encoding="utf-8")
    input_path, output_path, model_name, language = sys.argv[1:5]

    emit({"event": "loading", "model": model_name})
    started = time.monotonic()
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    emit({"event": "loaded", "seconds": round(time.monotonic() - started, 1)})

    segments, info = model.transcribe(
        input_path,
        language=language or None,
        vad_filter=True,
        beam_size=5,
    )
    total = info.duration or 0
    emit({
        "event": "info",
        "language": info.language,
        "probability": round(info.language_probability, 3),
        "duration": round(total, 1),
        "duration_after_vad": round(getattr(info, "duration_after_vad", total) or total, 1),
    })

    lines = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            lines.append(text)
        if total > 0:
            emit({"progress": min(seg.end / total, 1.0), "t": round(seg.end, 1), "text": text})

    content = " ".join(lines)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)
    emit({"event": "done", "segments": len(lines), "chars": len(content)})


if __name__ == "__main__":
    main()
