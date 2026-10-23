import { EdgeTTS } from "edge-tts-universal";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chunkText } from "../lib/text.js";
import { probeDuration } from "../lib/ffmpeg.js";
import { TTS_CHARS_PER_SEC, formatChars, formatDuration } from "../lib/format.js";
import { FatalTtsError, olvrocSynthesize } from "../lib/olvroc.js";
import { TTS_PROVIDER_LABELS, voiceProvider } from "../types.js";
import type { StepReporter } from "./run-job.js";

/**
 * Segments are the smallest unit a part can be cut at, so each part should
 * hold at least ~3 of them. Capped at ~1 min of speech for Edge TTS reliability.
 */
export function ttsChunkChars(maxPartSec: number): number {
  return Math.round(Math.min(1000, Math.max(150, (maxPartSec * TTS_CHARS_PER_SEC) / 3)));
}

interface TtsIndex {
  chunkChars: number;
  voice: string;
  rate: string;
  segments: TtsSegment[];
}

export interface TtsSegment {
  file: string;
  text: string;
  durationSec: number;
}

export async function synthesizeToFile(text: string, voice: string, rate: string, outFile: string): Promise<void> {
  const result = await new EdgeTTS(text, voice, { rate }).synthesize();
  const buffer = Buffer.from(await result.audio.arrayBuffer());
  if (buffer.length === 0) throw new Error("Edge TTS trả về audio rỗng");
  writeFileSync(outFile, buffer);
}

/**
 * Edge TTS is a free endpoint, so stay gentle; OlvRoc runs on this machine's CPU, one segment at a time in a single worker.
 */
const CONCURRENCY = { edge: 1, olvroc: 1 } as const;

/** Read `text` aloud into `outFile` (MP3) with Edge TTS or OlvRoc, retrying what may pass. */
export async function synthesize(
  text: string, voice: string, rate: string, outFile: string, r: StepReporter, label: string,
): Promise<void> {
  const provider = voiceProvider(voice);
  // Written under a temp name so an interrupted download is never reused as a finished segment.
  const tmp = `${outFile}.part`;
  const delays = [2000, 5000, 10000, 20000, 40000];
  for (let attempt = 0; ; attempt++) {
    try {
      if (provider === "olvroc") await olvrocSynthesize(text, voice, rate, tmp, r.signal, (msg) => r.log(msg));
      else await synthesizeToFile(text, voice, rate, tmp);
      renameSync(tmp, outFile);
      return;
    } catch (err) {
      rmSync(tmp, { force: true });
      if (r.signal.aborted || err instanceof FatalTtsError || attempt >= delays.length) throw err;
      const msg = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 200);
      r.log(`${label}: ${TTS_PROVIDER_LABELS[provider]} lỗi "${msg}", thử lại lần ${attempt + 2}/${delays.length + 1} sau ${delays[attempt] / 1000}s`, "warn");
      await new Promise((res) => setTimeout(res, delays[attempt]));
    }
  }
}

/**
 * Synthesize the script into short segments. Segment files from an
 * interrupted run are reused; a finished set is reused as long as it was made
 * with the same chunk size and voice.
 */
export async function synthesizeScript(opts: {
  script: string;
  voice: string;
  rate: string;
  maxPartSec: number;
  workDir: string;
  r: StepReporter;
}): Promise<TtsSegment[]> {
  const { script, voice, rate, maxPartSec, workDir, r } = opts;
  const chunkChars = ttsChunkChars(maxPartSec);

  const indexFile = join(workDir, "segments.json");
  if (existsSync(indexFile)) {
    const index = JSON.parse(readFileSync(indexFile, "utf8")) as TtsIndex;
    if (index.chunkChars === chunkChars && index.voice === voice && index.rate === rate) {
      r.log(`Dùng lại ${index.segments.length} đoạn audio đã tạo trước đó`);
      r.progress(1);
      return index.segments;
    }
    r.log("Cài đặt giọng đọc đã thay đổi, tạo lại toàn bộ audio");
    rmSync(workDir, { recursive: true, force: true });
  }
  mkdirSync(workDir, { recursive: true });

  const provider = voiceProvider(voice);
  const chunks = chunkText(script, chunkChars);
  const concurrency = Math.min(CONCURRENCY[provider], chunks.length);
  r.log(
    `Chia kịch bản ${formatChars(script.length)} ký tự thành ${chunks.length} đoạn đọc (tối đa ${chunkChars} ký tự/đoạn), ` +
    `dùng ${TTS_PROVIDER_LABELS[provider]}${concurrency > 1 ? `, ${concurrency} đoạn song song` : ""}`,
  );

  const files = chunks.map((_, i) => join(workDir, `seg-${String(i + 1).padStart(4, "0")}.mp3`));
  const durations: number[] = new Array(chunks.length);
  let reused = 0;
  let done = 0;
  let next = 0;
  let failed = false;
  let nextMilestone = 0.25;
  // A segment takes tens of seconds and reports only when done, so pace the bar
  // between them: Edge TTS read about 22 characters per second in testing.
  const startedAt = Date.now();
  let synthesized = 0;
  const avgChars = chunks.reduce((s, c) => s + c.length, 0) / chunks.length;
  const expectNext = () => {
    if (done >= chunks.length) return;
    const secPerSegment = synthesized > 0 ? (Date.now() - startedAt) / 1000 / synthesized : avgChars / 22 / concurrency;
    r.expect((done + 1) / chunks.length, secPerSegment);
  };
  expectNext();

  const worker = async () => {
    while (next < chunks.length && !failed) {
      const i = next++;
      r.signal.throwIfAborted();
      const label = `Đoạn ${i + 1}/${chunks.length}`;
      if (existsSync(files[i])) {
        reused++;
      } else {
        const preview = chunks[i].length > 80 ? `${chunks[i].slice(0, 80)}…` : chunks[i];
        r.detail(`${label}: "${preview}"`);
        try {
          await synthesize(chunks[i], voice, rate, files[i], r, label);
          synthesized++;
        } catch (err) {
          failed = true; // stop the other workers from starting new segments
          throw err;
        }
      }
      durations[i] = await probeDuration(files[i]);
      done++;
      const fraction = done / chunks.length;
      r.progress(fraction);
      expectNext();
      if (fraction >= nextMilestone && fraction < 1) {
        const sec = durations.reduce((s, d) => s + (d ?? 0), 0);
        r.log(`Đã đọc ${done}/${chunks.length} đoạn (${formatDuration(sec)} audio)`);
        while (nextMilestone <= fraction) nextMilestone += 0.25;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  if (reused > 0) r.log(`Dùng lại ${reused} đoạn audio từ lần chạy bị gián đoạn`);
  const segments = chunks.map((text, i) => ({ file: files[i], text, durationSec: durations[i] }));
  const index: TtsIndex = { chunkChars, voice, rate, segments };
  writeFileSync(indexFile, JSON.stringify(index, null, 2));
  return segments;
}
