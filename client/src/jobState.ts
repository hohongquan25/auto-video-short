import { useEffect, useState } from "react";
import type { Job, JobSettings, Step } from "./api";

export const STEPS: Step[] = ["download", "extract", "transcribe", "write", "rewrite", "review", "tts", "render"];

/** Steps that turn a recording into a script; a topic job's AI writes the script instead. */
const MEDIA_STEPS: Step[] = ["download", "extract", "transcribe", "rewrite"];

/** The steps shown for a job: "download" only exists for jobs created from a link. */
export const jobSteps = (job: Job): Step[] => STEPS.filter((s) =>
  job.sourceTopic ? !MEDIA_STEPS.includes(s) : s !== "write" && (s !== "download" || job.sourceUrl));

export type StepState = "done" | "active" | "queued" | "waiting" | "error" | "skipped" | "pending";

export function stepState(job: Job, step: Step): StepState {
  if (step === "review" && !job.settings.reviewBeforeTts) return "skipped";
  if (step === "download" && !job.sourceUrl) return "skipped";
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

/** Earliest step whose output is invalidated by a settings change. */
export function stepForChange(job: Job, after: JobSettings): Step | null {
  const before = job.settings;
  if (before.styleId !== after.styleId || before.aiProvider !== after.aiProvider) return job.sourceTopic ? "write" : "rewrite";
  if (before.reviewBeforeTts !== after.reviewBeforeTts && after.reviewBeforeTts) return "review";
  if (before.voice !== after.voice || before.rate !== after.rate) return "tts";
  if (
    before.backgroundId !== after.backgroundId ||
    before.subtitles !== after.subtitles ||
    before.fullVideo !== after.fullVideo ||
    before.format !== after.format ||
    (after.format !== "original" && before.fit !== after.fit) ||
    before.minPartSec !== after.minPartSec ||
    before.maxPartSec !== after.maxPartSec
  ) return "render";
  return null;
}

export const isActive = (job: Job) => job.status === "running" || job.status === "queued";

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
