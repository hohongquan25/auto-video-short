import { config } from "./config.js";
import type { Job, LogLevel } from "./types.js";

/** Absolute links to a job's page and output files, for tools outside the browser. */
export function jobLinks(job: Job) {
  const base = config.publicUrl;
  return {
    page: `${base}/jobs/${job.id}`,
    api: `${base}/api/jobs/${job.id}`,
    parts: job.parts.map((p) => ({
      index: p.index,
      durationSec: p.durationSec,
      video: `${base}/files/jobs/${job.id}/parts/${p.file}`,
      text: `${base}/files/jobs/${job.id}/parts/${p.textFile}`,
    })),
  };
}

const EVENTS = { done: "job.done", failed: "job.failed", waiting_review: "job.waiting_review" } as const;

async function post(url: string, body: string): Promise<void> {
  const delays = [0, 5000, 20000];
  let lastError: unknown;
  for (const delay of delays) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Tell the job's webhook(s) that it reached a resting state. Never throws:
 * a webhook that is down must not affect the job, so failures only go to the log.
 * The payload is a snapshot taken now; `log` must write to the job's latest
 * state, since the job may be resumed while a slow webhook is still retrying.
 */
export async function notifyWebhooks(job: Job, log: (msg: string, level?: LogLevel) => void): Promise<void> {
  const event = EVENTS[job.status as keyof typeof EVENTS];
  const urls = [...new Set([job.callbackUrl, config.webhookUrl].filter((u): u is string => Boolean(u)))];
  if (!event || urls.length === 0) return;

  const body = JSON.stringify({
    event,
    job: {
      id: job.id,
      title: job.title,
      status: job.status,
      step: job.step,
      error: job.error,
      sourceUrl: job.sourceUrl,
      settings: job.settings,
      parts: job.parts,
    },
    links: jobLinks(job),
  });
  for (const url of urls) {
    try {
      await post(url, body);
      log(`Đã gửi webhook "${event}" tới ${new URL(url).host}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Gửi webhook tới ${url} thất bại sau 3 lần thử: ${msg}`, "warn");
    }
  }
}
