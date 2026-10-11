import { config } from "../config.js";
import { formatDuration } from "../lib/format.js";
import { run } from "../lib/proc.js";
import type { StepReporter } from "./run-job.js";

type WhisperEvent =
  | { event: "loading"; model: string }
  | { event: "loaded"; seconds: number }
  | { event: "info"; language: string; probability: number; duration: number; duration_after_vad: number }
  | { event: "done"; segments: number; chars: number }
  | { event?: undefined; progress: number; t?: number; text?: string };

export async function transcribe(audioWav: string, outTxt: string, r: StepReporter): Promise<void> {
  let totalSec = 0;
  let startedAt = 0;
  let nextMilestone = 0.2;

  const onEvent = (msg: WhisperEvent) => {
    switch (msg.event) {
      case "loading":
        r.log(`Nạp model Whisper "${msg.model}" (lần đầu sẽ tải model về, có thể mất vài phút)`);
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
      case "done":
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
    [config.whisperScript, audioWav, outTxt, config.whisperModel, config.whisperLanguage],
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
