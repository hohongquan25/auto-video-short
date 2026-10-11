import { getJob, listJobs, saveJob } from "./store.js";
import { appendLog, endStep, runJob } from "./pipeline/run-job.js";
import { notifyWebhooks } from "./webhook.js";
import type { Job, LogLevel } from "./types.js";

/** Jobs run one at a time: Whisper and FFmpeg already use every CPU core. */
const pending: string[] = [];
let running: { job: Job; controller: AbortController } | null = null;

export function enqueue(id: string): void {
  if (!pending.includes(id) && running?.job.id !== id) pending.push(id);
  void pump();
}

/** The in-memory copy of the running job is the freshest version of it. */
export function liveJob(id: string): Job | null {
  return running?.job.id === id ? running.job : getJob(id);
}

export function isBusy(id: string): boolean {
  return running?.job.id === id || pending.includes(id);
}

export function cancel(id: string): void {
  const i = pending.indexOf(id);
  if (i >= 0) pending.splice(i, 1);
  if (running?.job.id === id) running.controller.abort();
}

/** Append to the freshest copy of a job: the running one in memory, else the file. */
function logToJob(id: string, msg: string, level?: LogLevel): void {
  const job = running?.job.id === id ? running.job : getJob(id);
  if (!job) return;
  appendLog(job, msg, level);
  if (running?.job !== job) saveJob(job);
}

/** Fire webhooks for a job that just finished, failed or paused for review. */
export function notify(job: Job): void {
  void notifyWebhooks(job, (msg, level) => logToJob(job.id, msg, level));
}

async function pump(): Promise<void> {
  if (running) return;
  const id = pending.shift();
  if (!id) return;
  const job = getJob(id);
  if (!job) return void pump();

  const controller = new AbortController();
  running = { job, controller };
  job.status = "running";
  job.error = null;
  appendLog(job, "Bắt đầu xử lý");
  saveJob(job);

  try {
    await runJob(job, controller.signal);
  } catch (err) {
    endStep(job);
    job.status = "failed";
    if (controller.signal.aborted) {
      job.error = "Đã dừng theo yêu cầu";
      appendLog(job, job.error, "warn");
    } else {
      job.error = err instanceof Error ? err.message : String(err);
      appendLog(job, `Lỗi: ${job.error.split("\n")[0]}`, "error");
    }
    saveJob(job);
  } finally {
    running = null;
    notify(job);
    void pump();
  }
}

/** Resume jobs that were queued or interrupted by a server restart. */
export function resumeOnStartup(): void {
  const jobs = listJobs()
    .filter((j) => j.status === "queued" || j.status === "running")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const job of jobs) {
    if (job.status === "running") {
      job.status = "queued";
      appendLog(job, "Tiếp tục sau khi khởi động lại server", "warn");
      saveJob(job);
    }
    enqueue(job.id);
  }
}
