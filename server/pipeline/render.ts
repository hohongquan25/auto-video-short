import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../config.js";
import { concatAudio, concatVideos, muxOnBackgrounds, probeDuration, probeVideoSize } from "../lib/ffmpeg.js";
import { Playlist } from "../lib/playlist.js";
import { formatBytes, formatDuration } from "../lib/format.js";
import { packParts } from "../lib/pack.js";
import { badgeLines } from "../lib/badge.js";
import { ctaLines, ctaStarts } from "../lib/subscribe.js";
import { assTime, buildAss, buildCues, subtitleLayout, type AssLayer } from "../lib/subtitles.js";
import { VIDEO_FORMATS, type Background, type Brand, type FitMode, type FullVideo, type JobPart, type VideoFormat } from "../types.js";
import type { StepReporter } from "./run-job.js";
import type { TtsSegment } from "./tts.js";

const GAP_SEC = 0.4;
/** Extra footage past the narration's expected end, so the picture never runs out first. */
const TAIL_SEC = 1;

const evenSize = (s: { width: number; height: number }) => ({ width: s.width - (s.width % 2), height: s.height - (s.height % 2) });
/** Share of a part's progress spent joining audio; the rest is the video encode. */
const AUDIO_SHARE = 0.1;

export async function renderParts(opts: {
  segments: TtsSegment[];
  /** The library videos to cut the backgrounds from, each with its own speed, mirror and colour shift. */
  backgrounds: Background[];
  /** Fixes the shuffled order, so a resumed render picks the same footage again. */
  seed: string;
  minPartSec: number;
  maxPartSec: number;
  /** Burn the narration text into the picture. */
  subtitles: boolean;
  /** Also join the parts into one uncut video (skipped when there is only one part). */
  fullVideo: boolean;
  /** Render the whole story as one video instead of parts; it comes back as `full`. */
  whole?: boolean;
  format: VideoFormat;
  fit: FitMode;
  /** Channel name stamped in a corner and the subscribe animation, when enabled. */
  brand: Brand;
  workDir: string;
  r: StepReporter;
}): Promise<{ parts: JobPart[]; full: FullVideo | null }> {
  const { segments, backgrounds, seed, minPartSec, maxPartSec, subtitles, fullVideo, whole = false, format, fit, brand, workDir, r } = opts;
  const { signal } = r;
  mkdirSync(workDir, { recursive: true });
  const playlist = new Playlist(backgrounds.map((b) => ({ ...b, speed: b.speed ?? 1 })), seed);
  // Every part shares one frame so they can be joined; "original" takes the first clip's.
  const target = VIDEO_FORMATS[format].size ?? evenSize(await probeVideoSize(join(paths.backgrounds, playlist.first.file)));
  const frame = { ...target, fit };
  const stamp = brand.enabled && brand.text.trim() ? brand : null;
  const anyOverlay = subtitles || stamp || brand.subscribe;
  // A vertical frame is a TikTok-style video, so it asks to follow rather than subscribe.
  const platform = format === "youtube" || frame.width >= frame.height ? "youtube" : "tiktok";

  const groups = whole ? [segments.map((_, idx) => idx)] : packParts(segments.map((s) => s.durationSec), GAP_SEC, minPartSec, maxPartSec);
  const expected = groups.map((g) => g.reduce((s, idx) => s + segments[idx].durationSec + GAP_SEC, 0));
  r.log(whole ? `Một video dài ${formatDuration(expected[0])}, không chia phần` : `Chia thành ${groups.length} video: ${expected.map(formatDuration).join(", ")}`);
  const parts: JobPart[] = [];

  for (let i = 0; i < groups.length; i++) {
    signal.throwIfAborted();
    const label = whole ? "Video đầy đủ" : `Phần ${i + 1}/${groups.length}`;
    const name = whole ? "full" : `part-${String(i + 1).padStart(2, "0")}`;
    const video = join(workDir, `${name}.mp4`);
    const textFile = join(workDir, `${name}.txt`);
    const audio = join(workDir, `${name}.m4a`);
    const subFile = join(workDir, `${name}.ass`);
    const group = groups[i].map((idx) => segments[idx]);
    const partProgress = (f: number) => r.progress((i + f) / groups.length);
    // Taken even for a part that is already made, so the parts after it get the same footage as before.
    const repeats = playlist.repeats;
    const shots = playlist.take(expected[i] + TAIL_SEC);
    if (playlist.repeats > repeats) r.log(`Đã dùng hết ${backgrounds.length} video nền đã chọn, lặp lại theo thứ tự ngẫu nhiên mới`, "warn");

    writeFileSync(textFile, group.map((s) => s.text).join("\n\n"));
    if (existsSync(video)) {
      r.log(`${label}: đã có sẵn từ lần chạy trước`);
    } else {
      const started = Date.now();
      // Render to a temp name so an interrupted encode is never mistaken for a finished part.
      const tmp = join(workDir, `${name}.partial.mp4`);
      r.detail(`${label}: ghép ${group.length} đoạn audio…`);
      await concatAudio(group.map((s) => s.file), GAP_SEC, audio, {
        totalSec: expected[i],
        onProgress: (f) => partProgress(f * AUDIO_SHARE),
        signal,
      });
      if (anyOverlay) {
        const cues = subtitles ? buildCues(group, GAP_SEC, subtitleLayout(frame.width, frame.height).maxCueChars) : [];
        const layers: AssLayer[] = [];
        if (stamp) {
          const spec = { text: stamp.text.trim(), position: stamp.position, color: stamp.color, durationSec: expected[i] };
          layers.push(badgeLines(spec, frame.width, frame.height, assTime));
        }
        if (brand.subscribe) {
          const starts = ctaStarts(expected[i], brand.subscribeAt);
          if (starts.length) layers.push(ctaLines({ platform, accent: brand.color, starts }, frame.width, frame.height, assTime));
        }
        writeFileSync(subFile, buildAss(cues, frame.width, frame.height, layers));
      }
      r.detail(`${label}: ghép ${shots.length} cảnh từ ${new Set(shots.map((s) => s.clip.id)).size} video nền…`);
      const backgroundShots = shots.map((s) => ({ file: join(paths.backgrounds, s.clip.file), startSec: s.startSec, lengthSec: s.lengthSec, look: s.clip }));
      await muxOnBackgrounds(backgroundShots, audio, tmp, { frame, subtitles: anyOverlay ? subFile : undefined }, {
        totalSec: expected[i],
        onProgress: (f) => {
          partProgress(AUDIO_SHARE + f * (1 - AUDIO_SHARE));
          r.detail(`${label}: dựng video ${Math.round(f * 100)}% (${formatDuration(f * expected[i])} / ${formatDuration(expected[i])})`);
        },
        signal,
      });
      renameSync(tmp, video);
      rmSync(audio, { force: true });
      r.log(`${label} xong: ${formatDuration(expected[i])}, ${formatBytes(statSync(video).size)} (mất ${formatDuration((Date.now() - started) / 1000)})`);
    }
    parts.push({
      index: i + 1,
      file: `${name}.mp4`,
      textFile: `${name}.txt`,
      durationSec: await probeDuration(video),
      sizeBytes: statSync(video).size,
    });
    partProgress(1);
  }
  if (whole) {
    const { file, textFile, durationSec, sizeBytes } = parts[0];
    return { parts: [], full: { file, textFile, durationSec, sizeBytes } };
  }
  if (!fullVideo || parts.length < 2) return { parts, full: null };

  const video = join(workDir, "full.mp4");
  const textFile = join(workDir, "full.txt");
  writeFileSync(textFile, segments.map((s) => s.text).join("\n\n"));
  if (existsSync(video)) {
    r.log("Video đầy đủ: đã có sẵn từ lần chạy trước");
  } else {
    // The parts share one encoding, so they are joined as-is: seconds instead of a second full encode.
    r.detail(`Ghép ${parts.length} phần thành video đầy đủ…`);
    const tmp = join(workDir, "full.partial.mp4");
    await concatVideos(workDir, parts.map((p) => p.file), tmp, { totalSec: null, signal });
    renameSync(tmp, video);
    r.log(`Video đầy đủ xong: ${formatDuration(await probeDuration(video))}, ${formatBytes(statSync(video).size)}`);
  }
  const full = { file: "full.mp4", textFile: "full.txt", durationSec: await probeDuration(video), sizeBytes: statSync(video).size };
  return { parts, full };
}
