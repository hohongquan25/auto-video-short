import { config } from "../config.js";
import { run } from "./proc.js";

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run(config.ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const sec = parseFloat(stdout.trim());
  if (!Number.isFinite(sec)) throw new Error(`Cannot read duration of ${file}`);
  return sec;
}

export async function hasVideoStream(file: string): Promise<boolean> {
  const { stdout } = await run(config.ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_type",
    "-of", "csv=p=0",
    file,
  ]);
  return stdout.trim().length > 0;
}

export interface FfmpegProgress {
  /** Expected output length, used to turn ffmpeg's out_time into a fraction. */
  totalSec: number | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Run ffmpeg with machine-readable progress on stdout (`-progress pipe:1`). */
function ffmpeg(args: string[], p: FfmpegProgress = { totalSec: null }): Promise<unknown> {
  const { totalSec, onProgress, signal } = p;
  return run(config.ffmpeg, ["-hide_banner", "-nostats", "-progress", "pipe:1", ...args], {
    signal,
    onStdoutLine: (line) => {
      if (!onProgress || !totalSec) return;
      const m = /^out_time_us=(\d+)/.exec(line);
      if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / totalSec));
    },
  });
}

/** Extract mono 16 kHz WAV — the format Whisper works on natively. */
export async function extractAudio(input: string, outWav: string, p?: FfmpegProgress): Promise<void> {
  await ffmpeg(["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outWav], p);
}

/** Concatenate audio clips with a short silence after each, re-encoded to AAC. */
export async function concatAudio(inputs: string[], gapSec: number, outFile: string, p?: FfmpegProgress): Promise<void> {
  const args = ["-y"];
  for (const f of inputs) args.push("-i", f);
  const padded = inputs.map((_, i) => `[${i}:a]aresample=44100,apad=pad_dur=${gapSec}[a${i}]`).join(";");
  const labels = inputs.map((_, i) => `[a${i}]`).join("");
  args.push(
    "-filter_complex", `${padded};${labels}concat=n=${inputs.length}:v=0:a=1[out]`,
    "-map", "[out]",
    "-c:a", "aac", "-b:a", "160k",
    outFile,
  );
  await ffmpeg(args, p);
}

/**
 * Loop the background video for as long as the narration lasts, drop the
 * background's own audio, and encode a web-friendly MP4.
 */
export async function muxOnBackground(background: string, audio: string, outFile: string, p?: FfmpegProgress): Promise<void> {
  await ffmpeg([
    "-y",
    "-stream_loop", "-1", "-i", background,
    "-i", audio,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-shortest",
    "-movflags", "+faststart",
    outFile,
  ], p);
}

export async function ffmpegVersion(): Promise<string> {
  const { stdout } = await run(config.ffmpeg, ["-version"]);
  return /ffmpeg version (\S+)/.exec(stdout)?.[1] ?? "unknown";
}
