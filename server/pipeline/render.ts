import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { concatAudio, muxOnBackground, probeDuration } from "../lib/ffmpeg.js";
import { formatBytes, formatDuration } from "../lib/format.js";
import { packParts } from "../lib/pack.js";
import type { JobPart } from "../types.js";
import type { StepReporter } from "./run-job.js";
import type { TtsSegment } from "./tts.js";

const GAP_SEC = 0.4;
/** Share of a part's progress spent joining audio; the rest is the video encode. */
const AUDIO_SHARE = 0.1;

export async function renderParts(opts: {
  segments: TtsSegment[];
  backgroundFile: string;
  minPartSec: number;
  maxPartSec: number;
  workDir: string;
  r: StepReporter;
}): Promise<JobPart[]> {
  const { segments, backgroundFile, minPartSec, maxPartSec, workDir, r } = opts;
  const { signal } = r;
  mkdirSync(workDir, { recursive: true });

  const groups = packParts(segments.map((s) => s.durationSec), GAP_SEC, minPartSec, maxPartSec);
  const expected = groups.map((g) => g.reduce((s, idx) => s + segments[idx].durationSec + GAP_SEC, 0));
  r.log(`Chia thành ${groups.length} video: ${expected.map(formatDuration).join(", ")}`);
  const parts: JobPart[] = [];

  for (let i = 0; i < groups.length; i++) {
    signal.throwIfAborted();
    const label = `Phần ${i + 1}/${groups.length}`;
    const name = `part-${String(i + 1).padStart(2, "0")}`;
    const video = join(workDir, `${name}.mp4`);
    const textFile = join(workDir, `${name}.txt`);
    const audio = join(workDir, `${name}.m4a`);
    const group = groups[i].map((idx) => segments[idx]);
    const partProgress = (f: number) => r.progress((i + f) / groups.length);

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
      await muxOnBackground(backgroundFile, audio, tmp, {
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
  return parts;
}
