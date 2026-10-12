"""OlvRoc: Vietnamese text-to-speech with 25 preset voices, on CPU (ONNX Runtime).

  tts.py         OlvRoc (load + infer + save), list_voices, missing_model_files
  engine.py      ONNX engine: prompt build, sampling, codec decode
  phonemize_text.py, core_utils.py, rep_history.py
                 text normalization and chunking, pauses, repetition guard
  voices.json    the preset voices
  model_files.json
                 model files (~650 MB), kept in models/olvroc outside git and
                 fetched by `pnpm setup:olvroc`

Needs: numpy, onnxruntime, tokenizers, sea-g2p. Licensed under Apache 2.0:
see LICENSE and NOTICE in this folder.
"""
