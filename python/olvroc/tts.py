"""Text → 48 kHz speech with a preset voice, on CPU.

Splits the text into chunks, reads each with the ONNX engine and joins them with
pauses that depend on the boundary (paragraph, sentence, within a sentence).
"""
from __future__ import annotations

import json
import wave
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

from .core_utils import gaps_to_silence, join_audio_chunks, strip_encoder_pad_frame
from .engine import OnnxEngine
from .phonemize_text import normalize_to_chunks_v3_with_gaps, phonemize_text_with_emotions

VOICES_FILE = Path(__file__).parent / "voices.json"
MODEL_FILES = Path(__file__).parent / "model_files.json"


def backbone_folder(precision: str) -> str:
    """Model subfolder for ``precision``: "fp32" (best quality) or "int8" (~1.6x faster, needs a CPU with VNNI)."""
    return "int8" if precision.lower() == "int8" else "fp32"


def missing_model_files(model_dir: str, precision: str = "fp32") -> List[str]:
    """Model files the chosen precision needs that are absent or the wrong size (hashing ~500 MB on every start is too slow)."""
    needed = (backbone_folder(precision), "codec")
    files = json.loads(MODEL_FILES.read_text(encoding="utf-8"))["files"]
    return [
        f"{f['source']}/{f['name']}" for f in files
        if f["source"] in needed
        and not ((p := Path(model_dir) / f["source"] / f["name"]).is_file() and p.stat().st_size == f["size"])
    ]


def featured_rank(v: dict) -> Optional[int]:
    """``featured`` from a voices JSON entry as a positive int, else ``None``."""
    try:
        r = int(v.get("featured"))
    except (TypeError, ValueError):
        return None
    return r if r > 0 else None


def list_voices() -> List[dict]:
    """Preset voices, editors' picks first, without loading the model."""
    data = json.loads(VOICES_FILE.read_text(encoding="utf-8"))
    voices = [
        {"name": name, "description": v.get("description", ""), "gender": v.get("gender") or None,
         "featured": featured_rank(v)}
        for name, v in data.get("presets", {}).items()
    ]
    voices.sort(key=lambda v: (v["featured"] is None, v["featured"] or 0))
    return voices


class OlvRoc:
    sample_rate = OnnxEngine.SAMPLE_RATE

    def __init__(self, model_dir: str, precision: str = "fp32", threads: int = 0):
        missing = missing_model_files(model_dir, precision)
        if missing:
            raise FileNotFoundError(f"Thiếu model OlvRoc trong {model_dir}: {', '.join(missing)}")
        self.engine = OnnxEngine(model_dir, backbone=backbone_folder(precision), threads=threads)
        data = json.loads(VOICES_FILE.read_text(encoding="utf-8"))
        self.voices: Dict[str, dict] = {}
        aliases: Dict[str, str] = {}
        for name, v in data.get("presets", {}).items():
            codes = v.get("codes")
            self.voices[name] = {
                "speaker_emb": np.asarray(v["speaker_emb"], dtype=np.float32),
                "codes": strip_encoder_pad_frame(np.asarray(codes, dtype=np.int64)) if codes is not None else None,
            }
            for a in v.get("aliases") or []:
                aliases[str(a)] = name
        # Old names of renamed voices keep working; a real name always wins.
        for a, name in aliases.items():
            self.voices.setdefault(a, self.voices[name])

    def infer(self, text: str, voice: str, max_chars: int = 256) -> np.ndarray:
        preset = self.voices.get(voice)
        if preset is None:
            raise ValueError(f"Voice '{voice}' not found. Available: {list(self.voices)}")
        chunks, gaps = normalize_to_chunks_v3_with_gaps(text, max_chars=max_chars)
        if not chunks:
            return np.array([], dtype=np.float32)
        wavs = [
            self.engine.infer(phonemize_text_with_emotions(c), ref_codes=preset["codes"], speaker_emb=preset["speaker_emb"])
            for c in chunks
        ]
        # Silence by boundary type: paragraph > sentence end > within a sentence.
        return join_audio_chunks(wavs, self.sample_rate, silence_ps=gaps_to_silence(gaps))

    def save(self, audio: np.ndarray, path: str) -> None:
        """16-bit mono WAV."""
        pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.sample_rate)
            w.writeframes(pcm.tobytes())
