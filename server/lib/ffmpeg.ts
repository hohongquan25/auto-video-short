import { rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { config } from "../config.js";
import type { FitMode } from "../types.js";
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

/** Displayed frame size, with phone-style rotation metadata applied. */
export async function probeVideoSize(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run(config.ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height:stream_side_data=rotation",
    "-of", "json",
    file,
  ]);
  const stream = (JSON.parse(stdout) as { streams?: { width?: number; height?: number; side_data_list?: { rotation?: number }[] }[] }).streams?.[0];
  if (!stream?.width || !stream.height) throw new Error(`Cannot read video size of ${file}`);
  const rotation = stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0;
  return Math.abs(rotation) % 180 === 90
    ? { width: stream.height, height: stream.width }
    : { width: stream.width, height: stream.height };
}

export interface FfmpegProgress {
  /** Expected output length, used to turn ffmpeg's out_time into a fraction. */
  totalSec: number | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Run ffmpeg with machine-readable progress on stdout (`-progress pipe:1`). */
function ffmpeg(args: string[], p: FfmpegProgress = { totalSec: null }, cwd?: string): Promise<unknown> {
  const { totalSec, onProgress, signal } = p;
  return run(config.ffmpeg, ["-hide_banner", "-nostats", "-progress", "pipe:1", ...args], {
    signal,
    cwd,
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

export interface OutputFrame {
  width: number;
  height: number;
  fit: FitMode;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
/** Scale up until the frame is covered, then cut the overflow from the middle. */
const cover = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;

/**
 * Filter that turns any background into a `frame`-sized picture. "crop"
 * fills the frame and loses the edges; "blur" keeps the whole background in
 * the middle over a blurred, zoomed copy of itself, as TikTok does with
 * landscape clips. The blur runs on a quarter-size copy: the same look at a
 * fraction of the cost on a 1080p frame.
 */
export function frameFilter(f: OutputFrame): string {
  const { width: w, height: h } = f;
  if (f.fit === "crop") return `${cover(w, h)},setsar=1`;
  return [
    "split=2[bg][fg]",
    `[bg]${cover(even(w / 4), even(h / 4))},boxblur=8:2,scale=${w}:${h}[blur]`,
    `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2[fit]`,
    "[blur][fit]overlay=(W-w)/2:(H-h)/2,setsar=1",
  ].join(";");
}

/**
 * Loop the background video for as long as the narration lasts, drop the
 * background's own audio, and encode a web-friendly MP4. With `frame` the
 * picture is resized for the target platform; with `subtitles` (an .ass
 * file) the text is burned in on top.
 */
export async function muxOnBackground(
  background: string, audio: string, outFile: string,
  opts: { frame?: OutputFrame; subtitles?: string } = {}, p?: FfmpegProgress,
): Promise<void> {
  const { frame, subtitles } = opts;
  // The filter graph treats colons and backslashes as syntax, which Windows paths are full of,
  // so ffmpeg runs in the subtitle's folder and gets just the file name.
  const sub = subtitles ? { dir: dirname(subtitles), name: basename(subtitles) } : null;
  if (sub && !/^[\w.-]+$/.test(sub.name)) throw new Error(`Unsafe subtitle file name: ${sub.name}`);
  const filters = [frame && frameFilter(frame), sub && `ass=${sub.name}`].filter(Boolean).join(",");
  await ffmpeg([
    "-y",
    "-stream_loop", "-1", "-i", resolve(background),
    "-i", resolve(audio),
    "-map", "0:v:0", "-map", "1:a:0",
    ...(filters ? ["-vf", filters] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-shortest",
    "-movflags", "+faststart",
    resolve(outFile),
  ], p, sub?.dir);
}

/**
 * Join MP4s that share one encoding (the rendered parts) without re-encoding.
 * Inputs are file names inside `dir`, where ffmpeg runs and the list is written.
 */
export async function concatVideos(dir: string, inputs: string[], outFile: string, p?: FfmpegProgress): Promise<void> {
  for (const f of inputs) if (!/^[\w.-]+$/.test(f)) throw new Error(`Unsafe file name: ${f}`);
  const list = "concat-list.txt";
  writeFileSync(join(dir, list), inputs.map((f) => `file '${f}'`).join("\n"));
  try {
    await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", resolve(outFile)], p, dir);
  } finally {
    rmSync(join(dir, list), { force: true });
  }
}

export async function ffmpegVersion(): Promise<string> {
  const { stdout } = await run(config.ffmpeg, ["-version"]);
  return /ffmpeg version (\S+)/.exec(stdout)?.[1] ?? "unknown";
}
