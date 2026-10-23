import { type ReactNode } from "react";
import { CircleAlert, Hourglass, LoaderCircle, PartyPopper, RotateCcw, Square } from "lucide-react";
import type { Job } from "../api";
import { STEP_LABELS, formatSpan } from "../format";
import { jobSteps, stepEta, stepSeconds, totalProcessingSeconds } from "../jobState";
import { STEP_ICONS } from "./JobStatus";

/** What a job is doing right now, how far along it is, and what to do next. */
export function StatusPanel({ job, now, busy, onRetry, onLog, waiting, done }: {
  job: Job; now: number; busy: boolean;
  onRetry: () => void; onLog: () => void;
  /** The panel of a story job waiting for its script to be approved. */
  waiting?: ReactNode;
  /** Headline and buttons of a finished job. */
  done: { title: ReactNode; actions: ReactNode };
}) {
  if (job.status === "running" && job.step) {
    const Icon = STEP_ICONS[job.step];
    const elapsed = stepSeconds(job, job.step, now);
    const eta = stepEta(job, now);
    return (
      <div className="status-panel running">
        <div className="sp-head">
          <span className="sp-icon"><Icon size={20} /></span>
          <div className="spacer">
            <div className="sp-kicker">Bước {jobSteps(job).indexOf(job.step) + 1}/{jobSteps(job).length}</div>
            <div className="sp-title">{STEP_LABELS[job.step]}</div>
          </div>
          <div className="sp-percent">{Math.round(job.progress * 100)}%</div>
        </div>
        {/* Keyed by step so the bar starts fresh at 0% instead of sliding back from 100%. */}
        <div key={job.step} className="progress lg striped"><div style={{ width: `${Math.max(2, job.progress * 100)}%` }} /></div>
        <div className="sp-detail">{job.detail ?? "Đang xử lý…"}</div>
        <div className="sp-stats small muted">
          {elapsed !== null && <span>Bước này: {formatSpan(elapsed)}</span>}
          {eta !== null && <span>Còn khoảng: <b>{formatSpan(eta)}</b></span>}
          <span>Tổng thời gian xử lý: {formatSpan(totalProcessingSeconds(job, now))}</span>
        </div>
      </div>
    );
  }
  if (job.status === "queued") {
    return (
      <div className="status-panel queued">
        <div className="sp-head">
          <span className="sp-icon"><Hourglass size={20} /></span>
          <div className="spacer">
            <div className="sp-title">Đang chờ đến lượt</div>
            <div className="small muted">Mỗi lần chỉ chạy một job để Whisper và FFmpeg dùng hết CPU. Job sẽ tự bắt đầu.</div>
          </div>
          <LoaderCircle className="spin muted" />
        </div>
      </div>
    );
  }
  if (job.status === "waiting_review" && waiting) return <>{waiting}</>;
  if (job.status === "failed") {
    const stopped = job.error === "Đã dừng theo yêu cầu";
    const [first, ...rest] = (job.error ?? "Lỗi không xác định").split("\n");
    return (
      <div className={`status-panel ${stopped ? "stopped" : "failed"}`}>
        <div className="sp-head">
          <span className="sp-icon">{stopped ? <Square size={18} /> : <CircleAlert size={20} />}</span>
          <div className="spacer">
            <div className="sp-title">
              {stopped ? "Đã dừng" : "Bị lỗi"}{job.step ? ` ở bước "${STEP_LABELS[job.step]}"` : ""}
            </div>
            <div className="sp-error">{first}</div>
          </div>
        </div>
        {rest.join("\n").trim() && (
          <details className="error-details">
            <summary>Chi tiết kỹ thuật</summary>
            <pre>{rest.join("\n").trim()}</pre>
          </details>
        )}
        <div className="row">
          <button className="primary" disabled={busy} onClick={onRetry}>
            <RotateCcw size={15} /> {stopped ? "Tiếp tục" : "Thử lại từ bước lỗi"}
          </button>
          <button onClick={onLog}>Xem nhật ký</button>
          <span className="small muted">Các bước đã xong được giữ nguyên, không phải làm lại.</span>
        </div>
      </div>
    );
  }
  const took = totalProcessingSeconds(job, now);
  return (
    <div className="status-panel done">
      <div className="sp-head">
        <span className="sp-icon"><PartyPopper size={20} /></span>
        <div className="spacer">
          <div className="sp-title">{done.title}</div>
          {took > 0 && <div className="small muted">Thời gian xử lý {formatSpan(took)}</div>}
        </div>
        <div className="row">{done.actions}</div>
      </div>
    </div>
  );
}
