import { config } from "../config.js";
import { formatDuration } from "../lib/format.js";
import { run } from "../lib/proc.js";
import type { StepReporter } from "./run-job.js";

type WhisperEvent =
  | { event: "loading"; model: string }
  | { event: "loaded"; seconds: number }
  | { event: "info"; language: string; probability: number; duration: number; duration_after_vad: number }
  | { event: "batch"; start: number; end: number; speech: number }
  | { event: "done"; segments: number; chars: number }
  | { event?: undefined; progress: number; t?: number; text?: string };

/**
 * Seconds of speech decoded per wall-clock second in the last run, used to
 * pace the progress bar through the first batch. Starts from what batched
 * large-v3-turbo did on an i5-13400F.
 */
let lastSpeechRate = 1.5;

export async function transcribe(audioWav: string, outTxt: string, r: StepReporter): Promise<void> {
  let totalSec = 0;
  let startedAt = 0;
  let nextMilestone = 0.2;
  /** Speech in finished batches and when the first batch started, to measure this run's rate. */
  let batchSpeech = 0;
  let batchesStartedAt = 0;
  let currentBatchSpeech = 0;

  const onEvent = (msg: WhisperEvent) => {
    switch (msg.event) {
      case "loading":
        r.log(`Nạp model Whisper "${msg.model}", batch ${config.whisperBatchSize}, beam ${config.whisperBeamSize} (lần đầu sẽ tải model về, có thể mất vài phút)`);
        r.detail(`Đang nạp model ${msg.model}…`);
        return;
      case "loaded":
        r.log(`Đã nạp model sau ${msg.seconds}s`);
        r.detail("Đang dò giọng nói trong audio…");
        startedAt = Date.now();
        return;
      case "info": {
        totalSec = msg.duration;
        const speech = msg.duration_after_vad < msg.duration
          ? `, có tiếng nói ${formatDuration(msg.duration_after_vad)}`
          : "";
        r.log(`Audio dài ${formatDuration(msg.duration)}${speech} · ngôn ngữ "${msg.language}" (${Math.round(msg.probability * 100)}%)`);
        return;
      }
      case "batch": {
        if (!totalSec) return;
        const now = Date.now();
        if (batchesStartedAt) batchSpeech += currentBatchSpeech;
        else batchesStartedAt = now;
        if (batchSpeech > 0) lastSpeechRate = batchSpeech / ((now - batchesStartedAt) / 1000);
        currentBatchSpeech = msg.speech;
        r.expect(msg.end / totalSec, msg.speech / lastSpeechRate);
        r.detail(`Đang nhận dạng ${formatDuration(msg.start)}–${formatDuration(msg.end)} / ${formatDuration(totalSec)}…`);
        return;
      }
      case "done":
        if (batchesStartedAt) lastSpeechRate = (batchSpeech + currentBatchSpeech) / ((Date.now() - batchesStartedAt) / 1000);
        r.progress(1);
        r.detail(null);
        return;
      default: {
        r.progress(msg.progress);
        if (msg.t !== undefined) {
          const snippet = msg.text && msg.text.length > 90 ? `${msg.text.slice(0, 90)}…` : msg.text;
          r.detail(`[${formatDuration(msg.t)} / ${formatDuration(totalSec)}] ${snippet ?? ""}`);
        }
        if (msg.progress >= nextMilestone && msg.progress < 1) {
          const wall = (Date.now() - startedAt) / 1000;
          const speed = wall > 0 && msg.t ? ` · tốc độ ${(msg.t / wall).toFixed(1)}x thời gian thực` : "";
          r.log(`Đã nhận dạng ${Math.round(msg.progress * 100)}%${speed}`);
          while (nextMilestone <= msg.progress) nextMilestone += 0.2;
        }
      }
    }
  };

  await run(
    config.whisperPython,
    [
      config.whisperScript, audioWav, outTxt, config.whisperModel, config.whisperLanguage,
      config.whisperBeamSize, config.whisperBatchSize, config.whisperThreads,
    ],
    {
      signal: r.signal,
      onStdoutLine: (line) => {
        let msg: WhisperEvent;
        try {
          msg = JSON.parse(line) as WhisperEvent;
        } catch {
          return; // non-JSON output from libraries is ignored
        }
        onEvent(msg);
      },
    },
  );
}
