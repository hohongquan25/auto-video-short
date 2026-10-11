import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractAudio, probeDuration } from "../lib/ffmpeg.js";
import { downloadAudio } from "../lib/ytdlp.js";
import { estimateSpeechSec, formatBytes, formatChars, formatDuration } from "../lib/format.js";
import { getBackground, getStyle, jobDir, saveJob } from "../store.js";
import { listVbeeVoices } from "../lib/vbee.js";
import { AI_PROVIDER_LABELS, EDGE_VOICES, STEPS, VBEE_PREFIX, voiceProvider, type Job, type LogLevel, type Step } from "../types.js";
import { paths } from "../config.js";
import { transcribe } from "./transcribe.js";
import { rewriteScript } from "./rewrite.js";
import { synthesizeScript } from "./tts.js";
import { renderParts } from "./render.js";

const LOG_LIMIT = 500;

export const artifacts = (id: string) => {
  const dir = jobDir(id);
  return {
    dir,
    audio: join(dir, "audio.wav"),
    transcript: join(dir, "transcript.txt"),
    rewriteDir: join(dir, "rewrite"),
    script: join(dir, "script.txt"),
    ttsDir: join(dir, "tts"),
    partsDir: join(dir, "parts"),
  };
};

/** Remove everything produced by `fromStep` and later steps. */
export function resetFromStep(job: Job, fromStep: Step): void {
  const a = artifacts(job.id);
  const from = STEPS.indexOf(fromStep);
  const at = (s: Step) => STEPS.indexOf(s) >= from;
  // Only a downloaded source can be fetched again; an uploaded file is never deleted.
  if (at("download") && job.sourceUrl && job.sourceFile) {
    rmSync(join(a.dir, job.sourceFile), { force: true });
    job.sourceFile = "";
  }
  if (at("extract")) rmSync(a.audio, { force: true });
  if (at("transcribe")) rmSync(a.transcript, { force: true });
  if (at("rewrite")) {
    rmSync(a.rewriteDir, { recursive: true, force: true });
    rmSync(a.script, { force: true });
  }
  if (at("review")) job.reviewApproved = false;
  if (at("tts")) rmSync(a.ttsDir, { recursive: true, force: true });
  if (at("render")) {
    rmSync(a.partsDir, { recursive: true, force: true });
    job.parts = [];
  }
  for (const s of STEPS) if (at(s)) delete job.timings[s];
}

export function appendLog(job: Job, msg: string, level: LogLevel = "info"): void {
  job.log.push({ at: new Date().toISOString(), level, step: job.step, msg });
  if (job.log.length > LOG_LIMIT) job.log = job.log.slice(-LOG_LIMIT);
}

/** Close the timing of the current step (on success, failure or pause). */
export function endStep(job: Job): void {
  const t = job.step ? job.timings[job.step] : undefined;
  if (t && !t.endedAt) t.endedAt = new Date().toISOString();
  job.detail = null;
}

/** What a pipeline step uses to report back to the job. */
export interface StepReporter {
  progress(fraction: number): void;
  /** Live one-liner shown under the progress bar; not kept in the log. */
  detail(text: string | null): void;
  log(msg: string, level?: LogLevel): void;
  signal: AbortSignal;
}

/**
 * Run (or resume) a job. Every step skips work whose output already exists,
 * so calling this again after a failure continues from the failed step.
 */
export async function runJob(job: Job, signal: AbortSignal): Promise<void> {
  const a = artifacts(job.id);
  let lastSaved = 0;

  const save = (force = false) => {
    if (!force && Date.now() - lastSaved < 1000) return;
    lastSaved = Date.now();
    try {
      saveJob(job);
    } catch {
      // job deleted mid-write; the abort signal will stop the step shortly
    }
  };
  const r: StepReporter = {
    progress: (fraction) => {
      job.progress = Math.max(0, Math.min(1, fraction));
      save(fraction >= 1);
    },
    detail: (text) => {
      job.detail = text;
      save();
    },
    log: (msg, level = "info") => {
      appendLog(job, msg, level);
      save(level !== "info");
    },
    signal,
  };
  const enter = (step: Step, message: string) => {
    endStep(job);
    job.step = step;
    job.progress = 0;
    job.timings[step] = { startedAt: new Date().toISOString(), endedAt: null };
    appendLog(job, message);
    save(true);
  };
  const stepElapsed = (step: Step) => {
    const t = job.timings[step];
    return t ? formatDuration((Date.now() - Date.parse(t.startedAt)) / 1000) : "?";
  };

  // ── 0. Download (jobs created from a link) ──────────────────────────────
  if (job.sourceUrl && !job.sourceFile) {
    const info = job.sourceInfo;
    enter("download", `Bắt đầu tải audio từ ${info?.platform ?? "link"}: ${job.sourceUrl}`);
    if (info) {
      r.log(`"${info.title}"${info.uploader ? ` của ${info.uploader}` : ""}${info.durationSec ? ` · dài ${formatDuration(info.durationSec)}` : ""}`);
    }
    r.detail("Đang kết nối…");
    job.sourceFile = await downloadAudio(job.sourceUrl, a.dir, (p) => {
      if (p.fraction !== null) r.progress(p.fraction);
      const speed = p.speedBps ? ` · ${formatBytes(p.speedBps)}/s` : "";
      const eta = p.etaSec !== null ? ` · còn ${formatDuration(p.etaSec)}` : "";
      r.detail(`Đã tải ${formatBytes(p.downloadedBytes)}${p.fraction !== null ? ` (${Math.round(p.fraction * 100)}%)` : ""}${speed}${eta}`);
    }, signal);
    r.log(`Tải xong: ${job.sourceFile} (${formatBytes(statSync(join(a.dir, job.sourceFile)).size)}, mất ${stepElapsed("download")})`, "success");
  }

  // ── 1. Extract ──────────────────────────────────────────────────────────
  if (!existsSync(a.audio)) {
    enter("extract", "Bắt đầu tách audio từ file gốc");
    const source = join(a.dir, job.sourceFile);
    const sourceSec = await probeDuration(source).catch(() => null);
    job.sourceDurationSec = sourceSec;
    r.log(`File gốc: ${job.sourceFile.split(".").pop()?.toUpperCase()} · ${formatBytes(statSync(source).size)}${sourceSec ? ` · dài ${formatDuration(sourceSec)}` : ""}`);
    r.detail("Đang chuyển sang WAV mono 16 kHz cho Whisper…");
    const tmp = `${a.audio}.partial.wav`;
    await extractAudio(source, tmp, { totalSec: sourceSec, onProgress: r.progress, signal });
    renameSync(tmp, a.audio);
    r.log(`Tách audio xong (${formatBytes(statSync(a.audio).size)}, mất ${stepElapsed("extract")})`, "success");
  }

  // ── 2. Transcribe ───────────────────────────────────────────────────────
  if (!existsSync(a.transcript)) {
    enter("transcribe", "Bắt đầu nhận dạng giọng nói (Whisper)");
    await transcribe(a.audio, a.transcript, r);
    const chars = readFileSync(a.transcript, "utf8").length;
    r.log(`Nhận dạng xong: ${formatChars(chars)} ký tự (mất ${stepElapsed("transcribe")})`, "success");
  }

  // ── 3. Rewrite ──────────────────────────────────────────────────────────
  if (!existsSync(a.script)) {
    const style = getStyle(job.settings.styleId);
    if (!style) throw new Error(`Không tìm thấy phong cách "${job.settings.styleId}"`);
    enter("rewrite", style.prompt
      ? `Bắt đầu viết lại theo phong cách "${style.name}" bằng ${AI_PROVIDER_LABELS[job.settings.aiProvider]}`
      : "Giữ nguyên văn bản gốc, không dùng AI");
    const script = await rewriteScript({
      transcript: readFileSync(a.transcript, "utf8"),
      stylePrompt: style.prompt,
      provider: job.settings.aiProvider,
      workDir: a.rewriteDir,
      r,
    });
    writeFileSync(a.script, script);
    const speech = estimateSpeechSec(script.length, job.settings.rate);
    r.log(`Kịch bản hoàn tất: ${formatChars(script.length)} ký tự, ước tính ${formatDuration(speech)} giọng đọc`, "success");
  }

  // ── 4. Review ───────────────────────────────────────────────────────────
  if (job.settings.reviewBeforeTts && !job.reviewApproved) {
    endStep(job);
    job.step = "review";
    job.progress = 0;
    job.status = "waiting_review";
    job.timings.review = { startedAt: new Date().toISOString(), endedAt: null };
    appendLog(job, "Đang chờ bạn duyệt kịch bản. Sửa nếu cần rồi bấm \"Duyệt & tạo video\"", "warn");
    save(true);
    return;
  }

  // ── 5. TTS ──────────────────────────────────────────────────────────────
  const voiceId = job.settings.voice;
  const knownVoices = voiceProvider(voiceId) === "vbee" ? await listVbeeVoices().catch(() => []) : EDGE_VOICES;
  const voiceName = knownVoices.find((v) => v.id === voiceId)?.name ?? voiceId.replace(VBEE_PREFIX, "");
  enter("tts", `Bắt đầu đọc kịch bản: giọng ${voiceName} (${voiceProvider(voiceId) === "vbee" ? "Vbee" : "Edge TTS"}), tốc độ ${job.settings.rate}`);
  const segments = await synthesizeScript({
    script: readFileSync(a.script, "utf8"),
    voice: job.settings.voice,
    rate: job.settings.rate,
    maxPartSec: job.settings.maxPartSec,
    workDir: a.ttsDir,
    r,
  });
  const speechSec = segments.reduce((s, x) => s + x.durationSec, 0);
  r.log(`Giọng đọc xong: ${segments.length} đoạn, tổng ${formatDuration(speechSec)} (mất ${stepElapsed("tts")})`, "success");

  // ── 6. Render ───────────────────────────────────────────────────────────
  const background = getBackground(job.settings.backgroundId);
  if (!background) throw new Error("Video nền đã bị xoá, hãy chọn video nền khác rồi chạy lại");
  enter("render", `Bắt đầu dựng video trên nền "${background.name}"`);
  job.parts = await renderParts({
    segments,
    backgroundFile: join(paths.backgrounds, background.file),
    minPartSec: job.settings.minPartSec,
    maxPartSec: job.settings.maxPartSec,
    workDir: a.partsDir,
    r,
  });

  endStep(job);
  job.status = "done";
  job.step = null;
  job.progress = 1;
  const totalSec = job.parts.reduce((s, p) => s + p.durationSec, 0);
  appendLog(job, `Hoàn thành: ${job.parts.length} video, tổng ${formatDuration(totalSec)}`, "success");
  save(true);
}
