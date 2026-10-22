import { useEffect, useState } from "react";
import type { Job, JobSettings, Step, SummarySettings } from "./api";

export const STEPS: Step[] = [
  "download", "captions", "extract", "transcribe", "write", "rewrite", "review", "tts", "render", "publish", "upload", "summarize", "cut",
];

/** Steps that turn a recording into a script; a topic job's AI writes the script instead. */
const MEDIA_STEPS: Step[] = ["download", "extract", "transcribe", "rewrite"];

/** Steps of a summary job, and the ones only it has. */
const SUMMARY_STEPS: Step[] = ["download", "captions", "extract", "transcribe", "summarize", "cut"];
const SUMMARY_ONLY: Step[] = ["captions", "summarize", "cut"];

/** The steps shown for a job: "download" only exists for jobs created from a link. */
export const jobSteps = (job: Job): Step[] => (job.kind === "summary" ? SUMMARY_STEPS : STEPS).filter((s) =>
  (s !== "download" || job.sourceUrl) &&
  (job.kind === "summary" || (!SUMMARY_ONLY.includes(s) && (job.sourceTopic ? !MEDIA_STEPS.includes(s) : s !== "write"))));

export type StepState = "done" | "active" | "queued" | "waiting" | "error" | "skipped" | "pending";

export function stepState(job: Job, step: Step): StepState {
  const summary = job.summary;
  if (summary && step === "captions" && !summary.settings.useCaptions) return "skipped";
  if (summary?.transcriptFrom === "captions" && (step === "extract" || step === "transcribe")) return "skipped";
  if (step === "review" && !job.settings.reviewBeforeTts) return "skipped";
  if (step === "download" && !job.sourceUrl) return "skipped";
  // Only runs when Google Drive is set up on the server.
  if (step === "upload" && job.status === "done" && !job.timings.upload) return "skipped";
  if (job.status === "done") return "done";
  if (step === job.step) {
    if (job.status === "running") return "active";
    if (job.status === "failed") return "error";
    if (job.status === "waiting_review") return "waiting";
    return "queued";
  }
  if (job.timings[step]?.endedAt) return "done";
  // Jobs from before step timings were recorded: everything before the current step is done.
  if (Object.keys(job.timings).length === 0 && job.step && STEPS.indexOf(step) < STEPS.indexOf(job.step)) return "done";
  return "pending";
}

/** Seconds spent in a step: finished duration, or time so far if it is running. */
export function stepSeconds(job: Job, step: Step, now: number): number | null {
  const t = job.timings[step];
  if (!t) return null;
  const end = t.endedAt ? Date.parse(t.endedAt) : job.step === step && job.status === "running" ? now : null;
  return end === null ? null : (end - Date.parse(t.startedAt)) / 1000;
}

/** Remaining seconds of the running step, extrapolated from its progress so far. */
export function stepEta(job: Job, now: number): number | null {
  if (job.status !== "running" || !job.step || job.progress < 0.03 || job.progress >= 1) return null;
  const elapsed = stepSeconds(job, job.step, now);
  if (elapsed === null || elapsed < 5) return null;
  return (elapsed * (1 - job.progress)) / job.progress;
}

/** Total processing time recorded across all steps (review wait excluded). */
export function totalProcessingSeconds(job: Job, now: number): number {
  return STEPS.filter((s) => s !== "review").reduce((sum, s) => sum + (stepSeconds(job, s, now) ?? 0), 0);
}

const sameSet = <T>(a: T[], b: T[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Earliest step whose output is invalidated by a settings change. */
export function stepForChange(job: Job, after: JobSettings): Step | null {
  const before = job.settings;
  if (before.styleId !== after.styleId || before.aiProvider !== after.aiProvider) return job.sourceTopic ? "write" : "rewrite";
  if (before.reviewBeforeTts !== after.reviewBeforeTts && after.reviewBeforeTts) return "review";
  if (before.voice !== after.voice || before.rate !== after.rate) return "tts";
  if (
    !sameSet(before.backgroundIds, after.backgroundIds) ||
    before.subtitles !== after.subtitles ||
    before.fullVideo !== after.fullVideo ||
    !sameSet(before.formats, after.formats) ||
    (after.formats.some((f) => f !== "original") && before.fit !== after.fit) ||
    before.minPartSec !== after.minPartSec ||
    before.maxPartSec !== after.maxPartSec
  ) return "render";
  return null;
}

/** Earliest step of a summary job whose output is invalidated by a settings change. */
export function summaryStepForChange(before: SummarySettings, after: SummarySettings): Step | null {
  if (before.language !== after.language || before.useCaptions !== after.useCaptions) return "captions";
  if (before.aiProvider !== after.aiProvider || before.targetSec !== after.targetSec || before.summaryLanguage !== after.summaryLanguage) return "summarize";
  if (before.subtitles !== after.subtitles || before.format !== after.format || (after.format !== "original" && before.fit !== after.fit)) return "cut";
  return null;
}

export const isActive = (job: Job) => job.status === "running" || job.status === "queued";

/** Asked before deleting a job. Its Drive copies and Sheet rows are left alone, so pending ones still get posted. */
export const deleteQuestion = (job: Job): string =>
  `Xoá "${job.title}" cùng toàn bộ file đã tạo?` +
  (job.drive ? "\n\nVideo trên Google Drive và các dòng trong Google Sheet vẫn giữ nguyên: video nào đang chờ đăng thì n8n vẫn đăng." : "");

/** Current time, re-rendered every `ms` while `enabled`. */
export function useNow(ms = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
  return now;
}
