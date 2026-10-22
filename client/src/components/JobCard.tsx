import { type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CircleAlert, CircleCheck, ClipboardCheck, Clock, Film, Hourglass, RotateCcw, Scissors, Square, Trash2 } from "lucide-react";
import { api, type Job } from "../api";
import { STEP_LABELS, VIDEO_FORMATS, formatDuration, formatRelative, formatSpan, renderedSec, videoCount } from "../format";
import { deleteQuestion, isActive, jobSteps, stepEta } from "../jobState";
import { MiniPipeline, STEP_ICONS, StatusBadge } from "./JobStatus";
import { errorMessage, useToast } from "./Toast";

/** Where a job's own page is: summaries have theirs. */
export const jobPath = (job: Job) => (job.kind === "summary" ? `/summaries/${job.id}` : `/jobs/${job.id}`);

function JobIcon({ job }: { job: Job }) {
  const Icon =
    job.status === "done" ? CircleCheck
    : job.status === "failed" ? CircleAlert
    : job.status === "waiting_review" ? ClipboardCheck
    : job.status === "queued" ? Hourglass
    : job.step ? STEP_ICONS[job.step] : Clock;
  return <span className={`job-icon ${job.status}`}><Icon size={20} /></span>;
}

function DoneLine({ job }: { job: Job }) {
  const result = job.summary?.result;
  if (job.kind === "summary") {
    return (
      <div className="job-line">
        <Scissors size={14} /> Rút gọn {job.sourceDurationSec ? `${formatDuration(job.sourceDurationSec)} → ` : ""}
        {result?.durationSec ? formatDuration(result.durationSec) : "?"} · {result?.clips.length ?? 0} đoạn
      </div>
    );
  }
  const formats = job.outputs.length > 1 ? ` (${job.outputs.map((o) => VIDEO_FORMATS[o.format].label).join(" + ")})` : "";
  return <div className="job-line"><Film size={14} /> {videoCount(job.outputs)} video{formats} · dài {formatDuration(renderedSec(job.outputs))}</div>;
}

function JobSummary({ job, now }: { job: Job; now: number }) {
  if (job.status === "running" && job.step) {
    const eta = stepEta(job, now);
    return (
      <>
        <div className="job-line">
          <b>Bước {jobSteps(job).indexOf(job.step) + 1}/{jobSteps(job).length} · {STEP_LABELS[job.step]}</b>
          <span className="accent-text"> {Math.round(job.progress * 100)}%</span>
          {eta !== null && <span className="muted"> · còn khoảng {formatSpan(eta)}</span>}
        </div>
        {job.detail && <div className="job-detail">{job.detail}</div>}
      </>
    );
  }
  if (job.status === "queued") return <div className="job-line muted">Đang chờ trong hàng đợi…</div>;
  if (job.status === "waiting_review") return <div className="job-line warn-text">Kịch bản đã sẵn sàng, đang chờ bạn duyệt</div>;
  if (job.status === "failed") return <div className="job-line danger-text clamp-1">{job.error?.split("\n")[0]}</div>;
  return <DoneLine job={job} />;
}

/** One job in a list: its progress or result, and the actions that fit its state. */
export function JobCard({ job, now, refresh }: { job: Job; now: number; refresh: () => Promise<unknown> }) {
  const navigate = useNavigate();
  const toast = useToast();
  const act = async (e: MouseEvent, fn: () => Promise<unknown>, done: string) => {
    e.stopPropagation();
    try {
      await fn();
      toast("success", done);
      await refresh();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };
  const path = jobPath(job);
  return (
    <div className={`job-card ${job.status}`} onClick={() => navigate(path)}>
      <JobIcon job={job} />
      <div className="job-main">
        <div className="job-title-row">
          <Link to={path} className="job-title" onClick={(e) => e.stopPropagation()}>{job.title}</Link>
          <StatusBadge status={job.status} />
        </div>
        <MiniPipeline job={job} />
        <JobSummary job={job} now={now} />
        <div className="job-meta small muted">
          Tạo {formatRelative(job.createdAt, now)}
          {job.sourceDurationSec ? ` · ${job.kind === "summary" ? "video gốc" : "file gốc"} ${formatDuration(job.sourceDurationSec)}` : ""}
        </div>
      </div>
      <div className="job-actions">
        {isActive(job) && (
          <button onClick={(e) => act(e, () => api.stop(job.id), "Đã dừng job")}><Square size={14} /> Dừng</button>
        )}
        {job.status === "failed" && (
          <button className="primary" onClick={(e) => act(e, () => api.rerun(job.id), "Đã cho chạy lại")}><RotateCcw size={14} /> Thử lại</button>
        )}
        {job.status === "waiting_review" && <span className="btn primary">Duyệt ngay</span>}
        {job.status === "done" && <span className="btn">{job.kind === "summary" ? "Xem bản rút gọn" : `Xem ${videoCount(job.outputs)} video`}</span>}
        <button
          className="icon-btn danger" title="Xoá" aria-label={`Xoá ${job.title}`}
          onClick={(e) => {
            // Stopped before asking, so cancelling does not open the job.
            e.stopPropagation();
            if (confirm(deleteQuestion(job))) void act(e, () => api.deleteJob(job.id), "Đã xoá job");
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
