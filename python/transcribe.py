"""Transcribe an audio file with faster-whisper.

Usage: python transcribe.py <input_audio> <output_txt> <model> <language> [beam_size] [batch_size] [cpu_threads] [lines_json]
An empty language lets Whisper detect it.
batch_size > 1 decodes several speech chunks at once (BatchedInferencePipeline), several times faster on CPU.
cpu_threads 0 lets CTranslate2 pick (it uses only 4).
lines_json, when given, also gets every sentence (split by word timings) with its times, and the language:
  {"language": "en", "lines": [{"startSec": 0.0, "endSec": 3.2, "text": "..."}]}
Events are printed to stdout as JSON lines:
  {"event": "loading", "model": "medium"}
  {"event": "loaded", "seconds": 4.2}
  {"event": "info", "language": "vi", "probability": 0.99, "duration": 1800.0, "duration_after_vad": 1650.0}
  {"event": "batch", "start": 720.0, "end": 960.0, "speech": 236.5}   (batch_size > 1, before each batch)
  {"progress": 0.42, "t": 756.1, "text": "..."}
  {"event": "done", "segments": 512, "chars": 34567}
"""
import json
import sys
import time

from faster_whisper import BatchedInferencePipeline, WhisperModel

SAMPLE_RATE = 16000  # faster-whisper decodes every input to 16 kHz
SENTENCE_ENDS = (".", "?", "!", "…", "。", "？", "！")
CLAUSE_ENDS = (",", ";", ":", "，", "、", "；")
PAUSE_SEC = 0.8  # a silence this long between two words ends a line
CLAUSE_LINE_SEC = 6.0  # past this a line ends at the next comma
MAX_LINE_SEC = 12.0  # and past this at the next word


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def timed_lines(seg):
    """Split a segment into sentences by its word timings: batched decoding
    returns segments as long as a whole speech chunk (up to 30 s), too coarse
    to cut a video between. Yields (start, end, text)."""
    words = seg.words or []
    if not words:
        yield seg.start, seg.end, seg.text.strip()
        return
    current = []
    for i, word in enumerate(words):
        current.append(word)
        following = words[i + 1] if i + 1 < len(words) else None
        text = word.word.strip()
        length = word.end - current[0].start
        if (
            following is None
            or text.endswith(SENTENCE_ENDS)
            or following.start - word.end > PAUSE_SEC
            or (length > CLAUSE_LINE_SEC and text.endswith(CLAUSE_ENDS))
            or length > MAX_LINE_SEC
        ):
            # Words carry their own leading space where the language uses spaces.
            line = "".join(w.word for w in current).strip()
            if line:
                yield current[0].start, current[-1].end, line
            current = []


def main():
    # Windows defaults stdout to the ANSI code page, which cannot encode Vietnamese.
    sys.stdout.reconfigure(encoding="utf-8")
    input_path, output_path, model_name, language = sys.argv[1:5]
    tuning = [int(a) for a in sys.argv[5:8]]
    beam_size, batch_size, cpu_threads = tuning + [5, 1, 0][len(tuning):]
    lines_path = sys.argv[8] if len(sys.argv) > 8 else ""

    emit({"event": "loading", "model": model_name})
    started = time.monotonic()
    model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=cpu_threads)
    emit({"event": "loaded", "seconds": round(time.monotonic() - started, 1)})

    # Word timings are only needed to split lines_json into sentences.
    options = dict(language=language or None, vad_filter=True, beam_size=beam_size, word_timestamps=bool(lines_path))
    if batch_size > 1:
        pipeline = BatchedInferencePipeline(model=model)
        forward = pipeline.forward

        def forward_with_progress(features, tokenizer, chunks_metadata, opts):
            # A batch yields no segment until all of it is decoded, which can be
            # minutes of audio, so announce the span it covers before starting.
            try:
                emit({
                    "event": "batch",
                    "start": round(chunks_metadata[0]["segments"][0]["start"] / SAMPLE_RATE, 1),
                    "end": round(chunks_metadata[-1]["segments"][-1]["end"] / SAMPLE_RATE, 1),
                    "speech": round(sum(c["duration"] for c in chunks_metadata), 1),
                })
            except (IndexError, KeyError, TypeError):
                pass  # metadata layout changed in a newer faster-whisper; progress just gets coarser
            return forward(features, tokenizer, chunks_metadata, opts)

        pipeline.forward = forward_with_progress
        segments, info = pipeline.transcribe(input_path, batch_size=batch_size, **options)
    else:
        segments, info = model.transcribe(input_path, **options)
    total = info.duration or 0
    emit({
        "event": "info",
        "language": info.language,
        "probability": round(info.language_probability, 3),
        "duration": round(total, 1),
        "duration_after_vad": round(getattr(info, "duration_after_vad", total) or total, 1),
    })

    lines = []
    timed = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            lines.append(text)
            if lines_path:
                timed.extend({"startSec": round(a, 2), "endSec": round(b, 2), "text": t} for a, b, t in timed_lines(seg))
        if total > 0:
            emit({"progress": min(seg.end / total, 1.0), "t": round(seg.end, 1), "text": text})

    content = " ".join(lines)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)
    if lines_path:
        with open(lines_path, "w", encoding="utf-8") as f:
            json.dump({"language": info.language, "lines": timed}, f, ensure_ascii=False)
    emit({"event": "done", "segments": len(lines), "chars": len(content)})


if __name__ == "__main__":
    main()
