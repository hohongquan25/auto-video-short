"""
OlvRoc ONNX engine (CPU), preset voices only.
=============================================
The transformer forwards and the audio codec run in ONNX Runtime; everything
else (embeddings, the speaker anchor, output heads, sampling, prompt build) is
plain NumPy.

Model files, read from a local folder (see model_files.json for where they come from):
  <model_dir>/<backbone>/          backbone = "fp32" or "int8"
           olvroc_prefill.onnx, olvroc_decode_step.onnx, olvroc_acoustic_cached.onnx
           + olvroc_backbone_shared.data + olvroc_v3_heads.npz (tied emb/heads + xvec_proj)
           + config.json, tokenizer.json
  <model_dir>/codec/
           moss_audio_tokenizer_decode_full.onnx + moss_audio_tokenizer_decode_shared.data
"""
from __future__ import annotations

import json
import logging
import math
import os
import threading
from pathlib import Path
from typing import List, Optional

import numpy as np

from .core_utils import BABBLE_MAX_RETRIES, babble_log_line, babble_prefer, babble_suspect, max_expected_frames
from .rep_history import DEFAULT_REP_WINDOW, RepetitionHistory


def _softmax(x: np.ndarray) -> np.ndarray:
    x = x - np.max(x)
    e = np.exp(x)
    return e / np.sum(e)


class OnnxEngine:
    SAMPLE_RATE = 48_000

    def __init__(
        self,
        model_dir: str,
        backbone: str = "fp32",   # "fp32" (default) or "int8"
        threads: int = 0,
    ):
        import onnxruntime as ort

        self._lock = threading.RLock()
        self.babble_retries = BABBLE_MAX_RETRIES
        vd = Path(model_dir) / backbone
        cd = Path(model_dir) / "codec"

        # ── Config (token ids, arch sizes) ─────────────────────────────────────
        c = json.loads((vd / "config.json").read_text(encoding="utf-8"))
        self.cfg = c
        self.n_vq = int(c["n_vq"])
        self.hidden = int(c["hidden_size"])
        self.L = int(c["num_hidden_layers"])
        self.L_loc = int(c.get("local_num_hidden_layers", 1))
        self.nH_loc = int(c.get("local_num_attention_heads", 8))
        self.hd_loc = self.hidden // self.nH_loc
        self.audio_pad = int(c["audio_pad_token_id"])
        self.tps = int(c["text_prompt_start_token_id"])
        self.tpe = int(c["text_prompt_end_token_id"])
        self.sgs = int(c["speech_generation_start_token_id"])
        self.eos_speech = int(c["speech_generation_end_token_id"])
        self.ref_slot = int(c["audio_ref_slot_token_id"])
        self.text_vocab = int(c["text_vocab_size"])
        self.default_style_id = int(c.get("default_style_token_id", 16))
        self.use_speaker_embedding = bool(c.get("use_speaker_embedding", False))

        # ── Tied embeddings/heads + xvec_proj (numpy) ──────────────────────────
        z = np.load(vd / "olvroc_v3_heads.npz")
        self.text_emb = z["text_emb"].astype(np.float32)            # (Vt, H)
        self.audio_emb = z["audio_emb"].astype(np.float32)          # (n_vq, Va, H)
        if self.use_speaker_embedding and "xvec_w" in z:
            self.xvec_w = z["xvec_w"].astype(np.float32)            # (H, spk_dim)
            self.xvec_b = z["xvec_b"].astype(np.float32)            # (H,)
            self.xvec_ln_w = z["xvec_ln_w"].astype(np.float32)      # (H,)
            self.xvec_ln_b = z["xvec_ln_b"].astype(np.float32)      # (H,)
            self.xvec_ln_eps = float(z["xvec_ln_eps"])
        else:
            self.xvec_w = None

        # ── Tokenizer (tokenizers lib, torch-free) ─────────────────────────────
        from tokenizers import Tokenizer
        self.tokenizer = Tokenizer.from_file(str(vd / "tokenizer.json"))

        # ── ONNX sessions ──────────────────────────────────────────────────────
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.inter_op_num_threads = 1
        so.add_session_config_entry("session.intra_op.allow_spinning", "0")
        if threads and threads > 0:
            intra = int(threads)
        else:
            intra = min(max((os.cpu_count() or 8) // 2, 1), 8)
        so.intra_op_num_threads = intra
        self.ort_intra_op_threads = intra
        prov = ["CPUExecutionProvider"]
        self.sess_pre = ort.InferenceSession(str(vd / "olvroc_prefill.onnx"), so, providers=prov)
        self.sess_dec = ort.InferenceSession(str(vd / "olvroc_decode_step.onnx"), so, providers=prov)
        self.sess_ac = ort.InferenceSession(str(vd / "olvroc_acoustic_cached.onnx"), so, providers=prov)
        self.sess_codec_dec = ort.InferenceSession(
            str(cd / "moss_audio_tokenizer_decode_full.onnx"), so, providers=prov)

    # ── numpy embedding / speaker anchor / heads / sampling ────────────────────
    def _speaker_anchor(self, speaker_emb: Optional[np.ndarray]) -> Optional[np.ndarray]:
        """192-d x-vector → (H,) anchor (mirror xvec_proj: Linear + LayerNorm)."""
        if not self.use_speaker_embedding:
            return None
        if speaker_emb is None:
            raise ValueError("This model needs a speaker anchor: pass `speaker_emb`.")
        if self.xvec_w is None:
            raise RuntimeError("heads.npz has no xvec_proj weights — re-export with the update model.")
        v = np.asarray(speaker_emb, dtype=np.float32).reshape(-1)
        if not v.any():
            raise ValueError("speaker_emb is all-zero — not a valid speaker anchor.")
        v = v @ self.xvec_w.T + self.xvec_b                         # (H,)
        v = (v - v.mean()) / np.sqrt(v.var() + self.xvec_ln_eps)
        return (v * self.xvec_ln_w + self.xvec_ln_b).astype(np.float32)

    def _embed_rows(self, rows: np.ndarray, anchor: Optional[np.ndarray] = None) -> np.ndarray:
        """rows: (T, n_vq+1) int → (1, T, H) float32 (mirror _build_inputs_embeds)."""
        emb = self.text_emb[rows[:, 0]]                             # (T, H)
        for ch in range(self.n_vq):
            ids = rows[:, ch + 1]
            valid = ids != self.audio_pad
            safe = np.where(valid, ids, 0)
            emb = emb + self.audio_emb[ch][safe] * valid[:, None]
        if anchor is not None:
            emb = emb + anchor[None]
        return emb[None].astype(np.float32)

    def _sample(self, logits, temperature, top_k, top_p, rep_pen, prev):
        logits = logits.astype(np.float32)
        if not math.isclose(rep_pen, 1.0) and prev:
            idx = np.fromiter(prev, dtype=np.int64, count=len(prev))
            sel = logits[idx]
            logits = logits.copy()
            logits[idx] = np.where(sel < 0, sel * rep_pen, sel / rep_pen)
        if not (temperature and temperature > 0):
            return int(logits.argmax())
        logits = logits / temperature
        V = logits.shape[-1]
        # top_k FIRST → sort/softmax/choice run over just the k candidates, not the full
        # vocab. Identical distribution, ~1.5x faster sampling.
        if top_k and 0 < int(top_k) < V:
            k = int(top_k)
            cand = np.argpartition(logits, -k)[-k:]
        else:
            cand = np.arange(V)
        cs = logits[cand]
        order = np.argsort(cs)[::-1]
        cand = cand[order]
        p = _softmax(cs[order])
        if top_p and top_p < 1.0:
            keep = (np.cumsum(p) - p) < top_p                   # nucleus over the candidates
            p = p * keep
            p = p / p.sum()
        return int(cand[np.random.choice(cand.shape[-1], p=p)])

    # ── prompt build (numpy, mirror build_prompt_2d) ───────────────────────────
    def _build_rows(self, phonemes: str, ref_codes: Optional[np.ndarray], style_id: int) -> np.ndarray:
        phone_ids = self.tokenizer.encode(phonemes, add_special_tokens=False).ids
        text_ids = [style_id, self.tps] + list(phone_ids) + [self.tpe]
        T = len(text_ids)
        rows = np.full((T, self.n_vq + 1), self.audio_pad, dtype=np.int64)
        rows[:, 0] = text_ids
        if ref_codes is None:
            return rows
        rc = np.asarray(ref_codes, dtype=np.int64)
        ref = np.full((rc.shape[0], self.n_vq + 1), self.audio_pad, dtype=np.int64)
        ref[:, 0] = self.ref_slot
        ref[:, 1:] = rc
        return np.concatenate([rows, ref], axis=0)

    # ── acoustic frame: L_loc-layer cached ONNX steps + numpy heads/sampling ───
    def _empty_past(self):
        empty = np.zeros((1, self.nH_loc, 0, self.hd_loc), dtype=np.float32)
        feed = {}
        for i in range(self.L_loc):
            feed[f"past_k_{i}"] = empty
            feed[f"past_v_{i}"] = empty
        return feed

    @staticmethod
    def _split_past(out, L):
        # out = [hidden, present_k_0..L-1, present_v_0..L-1]
        pk = out[1:1 + L]
        pv = out[1 + L:1 + 2 * L]
        return pk, pv

    def _past_feed(self, pk, pv):
        feed = {}
        for i in range(self.L_loc):
            feed[f"past_k_{i}"] = pk[i]
            feed[f"past_v_{i}"] = pv[i]
        return feed

    def _acoustic_frame(self, h, temperature, top_k, top_p, rep_pen, hist):
        H = self.hidden
        cond = h[0].astype(np.float32)
        txt = self.text_emb[self.sgs].astype(np.float32)
        tok = np.stack([cond, txt])[None].astype(np.float32)        # (1,2,H)
        feed = {"token_emb": tok, "position_ids": np.array([[0, 1]], np.int64)}
        feed.update(self._empty_past())
        out = self.sess_ac.run(None, feed)
        hidden = out[0]
        pk, pv = self._split_past(out, self.L_loc)
        slot0 = hidden[0, 0]

        def samp(ch, vec):
            logits = vec.astype(np.float32) @ self.audio_emb[ch].T   # (Va,)
            prev = hist[ch] if hist is not None else None
            code = self._sample(logits, temperature, top_k, top_p, rep_pen, prev)
            if hist is not None:
                hist[ch].add(code)
            return code

        codes = [samp(0, hidden[0, 1])]
        for ch in range(1, self.n_vq):
            emb = self.audio_emb[ch - 1][codes[-1]].astype(np.float32)
            feed = {"token_emb": emb.reshape(1, 1, H),
                    "position_ids": np.array([[ch + 1]], np.int64)}
            feed.update(self._past_feed(pk, pv))
            out = self.sess_ac.run(None, feed)
            hidden = out[0]
            pk, pv = self._split_past(out, self.L_loc)
            codes.append(samp(ch, hidden[0, 0]))
        text_logits = slot0.astype(np.float32) @ self.text_emb.T
        eos = int(text_logits.argmax()) == self.eos_speech
        return codes, eos

    # ── Public synthesis ───────────────────────────────────────────────────────
    def infer(self, phonemes: str, ref_codes=None, speaker_emb=None,
              temperature: float = 0.8, top_k: int = 25, top_p: float = 0.95,
              max_new_frames: int = 300, repetition_penalty: float = 1.2,
              repetition_window: int = DEFAULT_REP_WINDOW) -> np.ndarray:
        # Frame cap from the phoneme length (stops short chunks "talking on").
        max_new_frames = min(max_new_frames, max_expected_frames(phonemes))
        anchor = self._speaker_anchor(speaker_emb)
        rows = self._build_rows(phonemes, ref_codes, self.default_style_id)
        prompt_embeds = self._embed_rows(rows, anchor)              # (1, T, H)

        def _gen_once() -> List[np.ndarray]:
            with self._lock:
                pre = self.sess_pre.run(None, {"inputs_embeds": prompt_embeds})
                past_k = [pre[1 + i] for i in range(self.L)]
                past_v = [pre[1 + self.L + i] for i in range(self.L)]
                h = pre[0][:, -1]
                Tprompt = prompt_embeds.shape[1]
                hist = RepetitionHistory(self.n_vq, repetition_window) if not math.isclose(repetition_penalty, 1.0) else None
                frames: List[np.ndarray] = []
                for t in range(max_new_frames):
                    codes, eos = self._acoustic_frame(h, temperature, top_k, top_p, repetition_penalty, hist)
                    frames.append(np.asarray(codes, dtype=np.int64))
                    if eos:
                        break
                    slot = np.full((1, 1, self.n_vq + 1), self.audio_pad, dtype=np.int64)
                    slot[:, :, 0] = self.sgs
                    slot[0, 0, 1:] = codes
                    se = self._embed_rows(slot[0], anchor)              # (1,1,H)
                    feed = {"inputs_embeds": se, "position_ids": np.array([[Tprompt + t]], np.int64)}
                    for i in range(self.L):
                        feed[f"past_k_{i}"] = past_k[i]
                        feed[f"past_v_{i}"] = past_v[i]
                    out = self.sess_dec.run(None, feed)
                    h = out[0][:, 0]
                    past_k = [out[1 + i] for i in range(self.L)]
                    past_v = [out[1 + self.L + i] for i in range(self.L)]
            return frames

        frames = _gen_once()
        if not frames:
            return np.zeros(0, dtype=np.float32)
        wav = self._decode_codes(np.stack(frames))                 # (T, n_vq) → wav
        # Babble guard: a chunk of <= 3 syllables that "says more" is regenerated.
        retries = int(self.babble_retries)
        if retries > 0:
            sr = self.SAMPLE_RATE
            best = babble_suspect(wav, sr, phonemes, max_new_frames, len(frames))
            tries = 0
            while best[0] and tries < retries:
                f2 = _gen_once()
                tries += 1
                if not f2:
                    continue
                w2 = self._decode_codes(np.stack(f2))
                cand = babble_suspect(w2, sr, phonemes, max_new_frames, len(f2))
                if babble_prefer(cand, best):
                    frames, wav, best = f2, w2, cand
            if tries:
                logging.getLogger("OlvRoc.Engine").info("🔁 " + babble_log_line(best, tries, max_new_frames))
        return wav

    # ── codec (MOSS ONNX) ──────────────────────────────────────────────────────
    def _decode_codes(self, codes: np.ndarray) -> np.ndarray:
        c = np.asarray(codes, dtype=np.int32)[None]                # (1, T, n_vq) — codec wants int32
        lens = np.array([c.shape[1]], dtype=np.int32)
        out = self.sess_codec_dec.run(None, {"audio_codes": c, "audio_code_lengths": lens})
        return out[0][0].mean(0).astype(np.float32)
