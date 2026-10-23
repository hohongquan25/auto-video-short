import { rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { config } from "../config.js";
import { RECOLOR, type BackgroundLook, type FitMode } from "../types.js";
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

/**
 * Encode a WAV to MP3, sped up or slowed down by `tempo` (1 = unchanged) without
 * changing the pitch. The output is always MP3, whatever its file extension.
 */
export async function encodeMp3(inWav: string, outFile: string, tempo = 1, signal?: AbortSignal): Promise<void> {
  const filter = tempo === 1 ? [] : ["-filter:a", `atempo=${tempo}`];
  await ffmpeg(["-y", "-i", inWav, ...filter, "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", outFile], { totalSec: null, signal });
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
 * fraction of the cost on a 1080p frame. `id` keeps the inner labels apart
 * when one graph frames several inputs.
 */
export function frameFilter(f: OutputFrame, id = ""): string {
  const { width: w, height: h } = f;
  if (f.fit === "crop") return `${cover(w, h)},setsar=1`;
  return [
    `split=2[bg${id}][fg${id}]`,
    `[bg${id}]${cover(even(w / 4), even(h / 4))},boxblur=8:2,scale=${w}:${h}[blur${id}]`,
    `[fg${id}]scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2[fit${id}]`,
    `[blur${id}][fit${id}]overlay=(W-w)/2:(H-h)/2,setsar=1`,
  ].join(";");
}

/** Filters for a background's speed, mirror and colour shift, or "" when it has none of them. */
export function lookFilter(look: BackgroundLook = {}): string {
  const { hueDeg, saturation, contrast } = RECOLOR;
  return [
    look.speed && look.speed !== 1 && `setpts=PTS/${look.speed}`,
    look.mirror && "hflip",
    look.recolor && `hue=h=${hueDeg}:s=${saturation},eq=contrast=${contrast}`,
  ].filter(Boolean).join(",");
}

/** Frame rate of every rendered video, so clips of any rate join and the parts concat without re-encoding. */
export const OUTPUT_FPS = 30;

/**
 * An .ass file goes into the filter graph, which treats colons and
 * backslashes as syntax and Windows paths are full of both, so ffmpeg must
 * run in the subtitle's folder (`cwd`) and gets just the file name.
 */
function subtitleFilter(subtitles?: string): { filter: string | null; cwd?: string } {
  if (!subtitles) return { filter: null };
  const name = basename(subtitles);
  if (!/^[\w.-]+$/.test(name)) throw new Error(`Unsafe subtitle file name: ${name}`);
  return { filter: `ass=${name}`, cwd: dirname(subtitles) };
}

/** A stretch of one background file, in the file's own seconds, and how it is altered. */
export interface BackgroundShot {
  file: string;
  startSec: number;
  lengthSec: number;
  look: BackgroundLook;
}

/**
 * Filter graph that alters and frames every shot (input i), joins them in
 * order, and burns in the subtitles. The result is labelled [out].
 */
export function shotsGraph(looks: BackgroundLook[], frame: OutputFrame, subtitles: string | null): string {
  const chains = looks.map((look, i) => {
    const filters = ["setpts=PTS-STARTPTS", lookFilter(look), frameFilter(frame, String(i)), `fps=${OUTPUT_FPS}`, "format=yuv420p"];
    return `[${i}:v]${filters.filter(Boolean).join(",")}[v${i}]`;
  });
  // Holding the last frame keeps the picture from ending before the narration if cuts round short.
  const joined = `${looks.map((_, i) => `[v${i}]`).join("")}concat=n=${looks.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=${HOLD_SEC}`;
  return [...chains, `${joined}${subtitles ? `,${subtitles}` : ""}[out]`].join(";");
}

/** Each cut rounds to whole frames and can lose one or two; this much extra per shot covers that. */
const SHOT_PAD_SEC = 0.1;
const HOLD_SEC = 2;

/** Past this a graph goes to ffmpeg in a file, clear of the Windows command-line limit. */
const INLINE_GRAPH_CHARS = 8000;

/**
 * Play `shots` one after another under the narration, drop the backgrounds'
 * own audio, and encode a web-friendly MP4 of `frame` size. Each shot gets
 * its background's speed, mirror and colour shift; with `subtitles` (an
 * .ass file) the text is burned in on top. The shots should last at least
 * as long as the audio, which sets the length.
 */
export async function muxOnBackgrounds(
  shots: BackgroundShot[], audio: string, outFile: string,
  opts: { frame: OutputFrame; subtitles?: string }, p?: FfmpegProgress,
): Promise<void> {
  if (shots.length === 0) throw new Error("No background footage to render");
  const sub = subtitleFilter(opts.subtitles);
  const graph = shotsGraph(shots.map((s) => s.look), opts.frame, sub.filter);
  const graphFile = `${resolve(outFile)}.graph.txt`;
  const inline = graph.length <= INLINE_GRAPH_CHARS;
  if (!inline) writeFileSync(graphFile, graph);
  try {
    await ffmpeg([
      "-y",
      ...shots.flatMap((s) => ["-ss", s.startSec.toFixed(3), "-t", (s.lengthSec + SHOT_PAD_SEC).toFixed(3), "-i", resolve(s.file)]),
      "-i", resolve(audio),
      ...(inline ? ["-filter_complex", graph] : ["-/filter_complex", graphFile]),
      "-map", "[out]", "-map", `${shots.length}:a:0`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-shortest",
      "-movflags", "+faststart",
      resolve(outFile),
    ], p, sub.cwd);
  } finally {
    if (!inline) rmSync(graphFile, { force: true });
  }
}

/** One JPG from `atSec` into the background, altered, framed and overlaid like the videos. */
export async function stillFrame(
  background: string, atSec: number, outFile: string,
  opts: { look: BackgroundLook; frame: OutputFrame; subtitles?: string }, signal?: AbortSignal,
): Promise<void> {
  const { filter: subtitles, cwd } = subtitleFilter(opts.subtitles);
  // Speed changes nothing in a single frame.
  const filters = [lookFilter({ ...opts.look, speed: 1 }), frameFilter(opts.frame), subtitles].filter(Boolean).join(",");
  await ffmpeg([
    "-y",
    "-ss", atSec.toFixed(2), "-i", resolve(background),
    "-vf", filters,
    "-frames:v", "1", "-q:v", "2",
    resolve(outFile),
  ], { totalSec: null, signal }, cwd);
}

/** Subtitle codecs that hold text; picture subtitles (DVD, Blu-ray) cannot be read as words. */
const TEXT_SUBTITLE_CODECS = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);

/** The text subtitle tracks inside a video file, by stream index, with their language tags. */
export async function probeSubtitleTracks(file: string): Promise<{ index: number; language: string | null }[]> {
  const { stdout } = await run(config.ffprobe, [
    "-v", "error",
    "-select_streams", "s",
    "-show_entries", "stream=index,codec_name:stream_tags=language",
    "-of", "json",
    file,
  ]);
  const streams = (JSON.parse(stdout) as { streams?: { index: number; codec_name?: string; tags?: { language?: string } }[] }).streams ?? [];
  return streams.filter((s) => TEXT_SUBTITLE_CODECS.has(s.codec_name ?? "")).map((s) => ({ index: s.index, language: s.tags?.language ?? null }));
}

/** Write subtitle stream `index` of `file` as SRT. */
export async function extractSubtitleTrack(file: string, index: number, outSrt: string, signal?: AbortSignal): Promise<void> {
  await ffmpeg(["-y", "-i", resolve(file), "-map", `0:${index}`, "-c:s", "srt", resolve(outSrt)], { totalSec: null, signal });
}

/** A stretch of a source in its own seconds, played at a speed (above 1 faster). */
export interface SourceSpan {
  startSec: number;
  lengthSec: number;
  speed: number;
}

/**
 * One passage of a narrated summary, `lengthSec` long: `span` of `source`
 * played from `leadSec` in (the seconds that dissolved in at the end of the
 * passage before) under `narration`, padded with silence to the length. The
 * source's own sound is dropped, and footage that runs short holds its last
 * frame. With `next`, the last `transitionSec` dissolve into the start of
 * the next passage's footage. The picture is framed like the rendered
 * videos, or kept as it is (even-sized) when `frame` is null, with
 * `subtitles` (an .ass file timed from the passage's start) burned in.
 * Passages made from one source with the same options share one encoding,
 * so concatVideos joins them without re-encoding.
 */
export async function narratedPassage(
  source: string,
  opts: {
    span: SourceSpan; leadSec: number; lengthSec: number; next: SourceSpan | null; transitionSec: number;
    narration: string; frame: OutputFrame | null; subtitles?: string;
  },
  outFile: string, p?: FfmpegProgress,
): Promise<void> {
  const { span, leadSec, lengthSec, next, transitionSec, frame } = opts;
  const sub = subtitleFilter(opts.subtitles);
  // Input `input` played at its speed and framed, then `sec` of it from `fromSec`.
  const footage = (input: number, s: SourceSpan, fromSec: number, sec: number, id: string) => [
    `[${input}:v]setpts=(PTS-STARTPTS)/${s.speed.toFixed(4)}`,
    frame ? frameFilter(frame, id) : "scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1",
    `fps=${OUTPUT_FPS}`, "format=yuv420p",
    `tpad=stop_mode=clone:stop_duration=${(fromSec + sec).toFixed(3)}`,
    `trim=start=${fromSec.toFixed(3)}:duration=${sec.toFixed(3)}`, "setpts=PTS-STARTPTS",
  ].join(",");
  const graph = [`${footage(0, span, leadSec, lengthSec, "a")}[a]`];
  let picture = "[a]";
  if (next) {
    graph.push(`${footage(1, next, 0, transitionSec, "b")}[b]`);
    graph.push(`[a][b]xfade=transition=fade:duration=${transitionSec.toFixed(3)}:offset=${(lengthSec - transitionSec).toFixed(3)}[x]`);
    picture = "[x]";
  }
  graph.push(`${picture}${sub.filter ?? "null"}[v]`, `[${next ? 2 : 1}:a]apad[s]`);
  const input = (s: SourceSpan, sec: number) => ["-ss", s.startSec.toFixed(3), "-t", sec.toFixed(3), "-i", resolve(source)];
  await ffmpeg([
    "-y",
    ...input(span, span.lengthSec),
    // Only the first moments of the next passage show, in the dissolve.
    ...(next ? input(next, transitionSec * next.speed + 0.5) : []),
    "-i", resolve(opts.narration),
    "-filter_complex", graph.join(";"),
    "-map", "[v]", "-map", "[s]",
    "-t", lengthSec.toFixed(3),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart",
    resolve(outFile),
  ], p, sub.cwd);
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
