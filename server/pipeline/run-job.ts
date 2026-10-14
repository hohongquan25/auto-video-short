import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractAudio, probeDuration } from "../lib/ffmpeg.js";
import { downloadAudio } from "../lib/ytdlp.js";
import { creepProgress } from "../lib/progress.js";
import { estimateSpeechSec, formatBytes, formatChars, formatDuration } from "../lib/format.js";
import { getBackground, getBrand, getStyle, jobDir, saveJob } from "../store.js";
import { listOlvrocVoices } from "../lib/olvroc.js";
import {
  AI_PROVIDER_LABELS, EDGE_VOICES, STEPS, TTS_PROVIDER_LABELS, VIDEO_FORMATS, formatPlan, renderedSec, videoCount, voiceProvider,
  type Background, type Job, type JobOutput, type LogLevel, type Step,
} from "../types.js";
import { transcribe } from "./transcribe.js";
import { rewriteScript } from "./rewrite.js";
import { writeStory } from "./write.js";
import { synthesizeScript } from "./tts.js";
import { renderParts } from "./render.js";
import { preparePublish } from "./publish.js";

const LOG_LIMIT = 500;

export const artifacts = (id: string) => {
  const dir = jobDir(id);
  return {
    dir,
    audio: join(dir, "audio.wav"),
    transcript: join(dir, "transcript.txt"),
    storyDir: join(dir, "story"),
    rewriteDir: join(dir, "rewrite"),
    script: join(dir, "script.txt"),
    ttsDir: join(dir, "tts"),
    partsDir: join(dir, "parts"),
    publishKit: join(dir, "publish.json"),
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
  if (at("write")) rmSync(a.storyDir, { recursive: true, force: true });
  if (at("rewrite")) {
    rmSync(a.rewriteDir, { recursive: true, force: true });
    rmSync(a.script, { force: true });
  }
  if (at("review")) job.reviewApproved = false;
  if (at("tts")) rmSync(a.ttsDir, { recursive: true, force: true });
  if (at("render")) {
    rmSync(a.partsDir, { recursive: true, force: true });
    job.outputs = [];
  }
  if (at("publish")) {
    rmSync(a.publishKit, { force: true });
    for (const v of job.outputs.flatMap((o) => [...o.parts, ...(o.fullVideo ? [o.fullVideo] : [])])) {
      if (v.cover) rmSync(join(a.partsDir, v.cover), { force: true });
      delete v.cover;
    }
    job.publish = null;
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
  /**
   * For work that reports only when a large piece finishes: move the bar
   * smoothly toward `target` over about `etaSec` until the next progress().
   */
  expect(target: number, etaSec: number): void;
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

  let creep: { from: number; target: number; etaSec: number; startedAt: number } | null = null;
  let creepTimer: NodeJS.Timeout | null = null;
  const tick = () => {
    // Stops itself once real progress takes over or the job stops running.
    if (!creep || signal.aborted || job.status !== "running") {
      if (creepTimer) clearInterval(creepTimer);
      creepTimer = null;
      return;
    }
    const p = creepProgress(creep.from, creep.target, (Date.now() - creep.startedAt) / 1000, creep.etaSec);
    if (p > job.progress) {
      job.progress = p;
      save();
    }
  };

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
      creep = null;
      // Never backwards within a step: a real report can land just below where the bar crept to.
      job.progress = Math.max(job.progress, Math.min(1, fraction));
      save(fraction >= 1);
    },
    expect: (target, etaSec) => {
      creep = { from: job.progress, target: Math.min(1, target), etaSec, startedAt: Date.now() };
      creepTimer ??= setInterval(tick, 500);
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
    creep = null;
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
    }, signal, (err, attempt, total, delayMs) => {
      r.log(`Tải lỗi "${err.message.split("\n")[0].slice(0, 200)}", thử lại lần ${attempt}/${total} sau ${delayMs / 1000}s`, "warn");
      r.detail(`Chờ ${delayMs / 1000}s rồi thử lại…`);
    });
    r.log(`Tải xong: ${job.sourceFile} (${formatBytes(statSync(join(a.dir, job.sourceFile)).size)}, mất ${stepElapsed("download")})`, "success");
  }

  // ── AI writes the story (jobs created from a topic) ───────────────────────
  if (job.sourceTopic && !existsSync(a.script)) {
    const topic = job.sourceTopic;
    const style = getStyle(job.settings.styleId);
    if (!style) throw new Error(`Không tìm thấy phong cách "${job.settings.styleId}"`);
    enter("write", `Bắt đầu viết truyện ${topic.minMinutes}–${topic.maxMinutes} phút bằng ${AI_PROVIDER_LABELS[job.settings.aiProvider]}` +
      (style.prompt ? `, phong cách "${style.name}"` : ""));
    const story = await writeStory({
      topic,
      stylePrompt: style.prompt,
      provider: job.settings.aiProvider,
      rate: job.settings.rate,
      workDir: a.storyDir,
      r,
    });
    writeFileSync(a.script, story.script);
    if (topic.autoTitle) job.title = story.title.slice(0, 200);
    const speech = estimateSpeechSec(story.script.length, job.settings.rate);
    r.log(`Viết xong "${story.title}": ${formatChars(story.script.length)} ký tự, ước tính ${formatDuration(speech)} giọng đọc (mất ${stepElapsed("write")})`, "success");
  }

  // ── 1. Extract ──────────────────────────────────────────────────────────
  if (!job.sourceTopic && !existsSync(a.audio)) {
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
  if (!job.sourceTopic && !existsSync(a.transcript)) {
    enter("transcribe", "Bắt đầu nhận dạng giọng nói (Whisper)");
    await transcribe(a.audio, a.transcript, r);
    const chars = readFileSync(a.transcript, "utf8").length;
    r.log(`Nhận dạng xong: ${formatChars(chars)} ký tự (mất ${stepElapsed("transcribe")})`, "success");
  }

  // ── 3. Rewrite (a topic job's script was written above) ─────────────────
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

  const backgrounds = job.settings.backgroundIds.map(getBackground).filter((b): b is Background => b !== null);
  if (backgrounds.length === 0) throw new Error("Các video nền đã chọn đều đã bị xoá, hãy chọn video nền khác rồi chạy lại");
  const brand = getBrand();
  // Videos already made (a retry after the publish step failed) are kept as they are.
  if (job.outputs.length === 0) {
    // ── 5. TTS ──────────────────────────────────────────────────────────────
    const voiceId = job.settings.voice;
    const provider = voiceProvider(voiceId);
    const knownVoices = provider === "olvroc" ? await listOlvrocVoices().catch(() => []) : EDGE_VOICES;
    const voiceName = knownVoices.find((v) => v.id === voiceId)?.name ?? voiceId.replace(/^olvroc:/, "");
    enter("tts", `Bắt đầu đọc kịch bản: giọng ${voiceName} (${TTS_PROVIDER_LABELS[provider]}), tốc độ ${job.settings.rate}`);
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
    const plan = formatPlan(job.settings.formats);
    const frames = plan.map((p) => (p.format === "original" ? "gốc" : VIDEO_FORMATS[p.format].label) + (p.whole ? " (1 video dài)" : "")).join(" + ");
    const fit = plan.some((p) => p.format !== "original") ? ` (${job.settings.fit === "blur" ? "nền mờ" : "cắt cho đầy khung"})` : "";
    const stamp = (brand.enabled && brand.text ? `, tên kênh "${brand.text}"` : "") + (brand.subscribe ? ", hiệu ứng đăng ký" : "");
    const footageSec = backgrounds.reduce((s, b) => s + b.durationSec / (b.speed ?? 1), 0);
    enter("render", `Bắt đầu dựng video, ghép ngẫu nhiên từ ${backgrounds.length} video nền (tổng ${formatDuration(footageSec)}), khung ${frames}${fit}${job.settings.subtitles ? ", có phụ đề" : ""}${stamp}`);
    const missing = job.settings.backgroundIds.length - backgrounds.length;
    if (missing > 0) r.log(`${missing} video nền đã chọn không còn trong thư viện, bỏ qua`, "warn");
    const outputs: JobOutput[] = [];
    for (const [k, { format, whole }] of plan.entries()) {
      // Each format is its own share of the step, and says which one it is when there are several.
      const tag = plan.length > 1 ? `${VIDEO_FORMATS[format].label} · ` : "";
      const sub: StepReporter = {
        ...r,
        progress: (f) => r.progress((k + f) / plan.length),
        detail: (text) => r.detail(text && tag + text),
        log: (msg, level) => r.log(tag + msg, level),
      };
      const rendered = await renderParts({
        segments,
        backgrounds,
        seed: `${job.id}:${format}`,
        minPartSec: job.settings.minPartSec,
        maxPartSec: job.settings.maxPartSec,
        subtitles: job.settings.subtitles,
        fullVideo: job.settings.fullVideo,
        whole,
        format,
        fit: job.settings.fit,
        brand,
        workDir: join(a.partsDir, format),
        r: sub,
      });
      const inDir = <T extends { file: string; textFile: string }>(v: T): T => ({ ...v, file: `${format}/${v.file}`, textFile: `${format}/${v.textFile}` });
      outputs.push({ format, parts: rendered.parts.map(inDir), fullVideo: rendered.full && inDir(rendered.full) });
    }
    job.outputs = outputs;
  }

  // ── 7. Publish ──────────────────────────────────────────────────────────
  enter("publish", "Bắt đầu chuẩn bị đăng bài: tiêu đề, mô tả, hashtag và ảnh bìa");
  job.publish = await preparePublish({
    title: job.title,
    script: readFileSync(a.script, "utf8"),
    outputs: job.outputs,
    provider: job.settings.aiProvider,
    partsDir: a.partsDir,
    kitFile: a.publishKit,
    backgrounds,
    fit: job.settings.fit,
    brand,
    r,
  });

  endStep(job);
  job.status = "done";
  job.step = null;
  job.progress = 1;
  const { outputs } = job;
  const made = outputs.map((o) => `${VIDEO_FORMATS[o.format].label}: ${o.parts.length ? `${o.parts.length} phần${o.fullVideo ? " + bản đầy đủ" : ""}` : "1 video dài"}`);
  appendLog(job, `Hoàn thành ${videoCount(outputs)} video (${made.join(", ")}), dài ${formatDuration(renderedSec(outputs))}`, "success");
  save(true);
}
