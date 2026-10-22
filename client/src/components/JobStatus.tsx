import type { CSSProperties } from "react";
import {
  AudioLines, CloudDownload, CloudUpload, Captions, Check, CircleAlert, Clapperboard, ClipboardCheck, FileText, Hourglass, ListChecks, LoaderCircle, Megaphone, Mic,
  PenLine, Scissors, Sparkles, type LucideIcon,
} from "lucide-react";
import type { Job, JobStatus, Step } from "../api";
import { STATUS_LABELS, STEP_LABELS, formatDuration } from "../format";
import { jobSteps, stepSeconds, stepState, type StepState } from "../jobState";

export const STEP_ICONS: Record<Step, LucideIcon> = {
  download: CloudDownload,
  captions: FileText,
  extract: AudioLines,
  transcribe: Captions,
  write: PenLine,
  rewrite: Sparkles,
  review: ClipboardCheck,
  tts: Mic,
  render: Clapperboard,
  publish: Megaphone,
  upload: CloudUpload,
  summarize: ListChecks,
  cut: Scissors,
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`badge ${status}`}>
      {status === "running" && <LoaderCircle size={12} className="spin" />}
      {STATUS_LABELS[status]}
    </span>
  );
}

const STATE_TEXT: Record<StepState, string> = {
  done: "Xong",
  active: "Đang chạy",
  queued: "Chờ chạy",
  waiting: "Chờ bạn duyệt",
  error: "Lỗi",
  skipped: "Bỏ qua",
  pending: "Chưa chạy",
};

/** Full step tracker for the job page. */
export function Pipeline({ job, now, onSelect }: { job: Job; now: number; onSelect?: (step: Step) => void }) {
  return (
    <ol className="pipeline" style={{ "--steps": jobSteps(job).length } as CSSProperties}>
      {jobSteps(job).map((step, i) => {
        const state = stepState(job, step);
        const Icon = STEP_ICONS[step];
        const secs = stepSeconds(job, step, now);
        const sub =
          state === "active" ? `${Math.round(job.progress * 100)}%${secs !== null ? ` · ${formatDuration(secs)}` : ""}`
          : state === "done" && secs !== null ? formatDuration(secs)
          : STATE_TEXT[state];
        return (
          <li key={step} className={`pipe-step ${state}`}>
            <button type="button" className="pipe-node" onClick={() => onSelect?.(step)} disabled={!onSelect} title={STEP_LABELS[step]}>
              <span className="pipe-icon">
                {state === "done" ? <Check size={18} strokeWidth={3} />
                  : state === "error" ? <CircleAlert size={18} />
                  : state === "waiting" || state === "queued" ? <Hourglass size={17} />
                  : <Icon size={18} />}
                {state === "active" && (
                  <svg className="pipe-ring" viewBox="0 0 44 44" aria-hidden>
                    <circle cx="22" cy="22" r="20" pathLength={100} strokeDasharray={`${job.progress * 100} 100`} />
                  </svg>
                )}
              </span>
              <span className="pipe-label">
                <span className="pipe-num">{i + 1}</span> {STEP_LABELS[step]}
              </span>
              <span className="pipe-sub">{sub}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Compact one-segment-per-step bar for the job list. */
export function MiniPipeline({ job }: { job: Job }) {
  return (
    <div className="mini-pipe" aria-hidden>
      {jobSteps(job).map((step) => {
        const state = stepState(job, step);
        return (
          <span key={step} className={`mini-seg ${state}`} title={`${STEP_LABELS[step]}: ${STATE_TEXT[state]}`}>
            {state === "active" && <span style={{ width: `${job.progress * 100}%` }} />}
          </span>
        );
      })}
    </div>
  );
}
