import { useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CircleAlert, CircleCheck, ClipboardCheck, Clock, Film, Hourglass, Plus, RotateCcw, Search, Square,
} from "lucide-react";
import { api, type Job, type JobStatus } from "../api";
import { STEP_LABELS, formatDuration, formatRelative, formatSpan } from "../format";
import { isActive, jobSteps, stepEta, useNow } from "../jobState";
import { MiniPipeline, STEP_ICONS, StatusBadge } from "../components/JobStatus";
import { SetupGuide } from "../components/SystemStatus";
import { errorMessage, useToast } from "../components/Toast";
import { usePolling } from "../usePolling";

type Filter = "all" | "active" | JobStatus;

const FILTERS: { key: Filter; label: string; match: (j: Job) => boolean }[] = [
  { key: "all", label: "Tất cả", match: () => true },
  { key: "active", label: "Đang xử lý", match: isActive },
  { key: "waiting_review", label: "Chờ duyệt", match: (j) => j.status === "waiting_review" },
  { key: "done", label: "Hoàn thành", match: (j) => j.status === "done" },
  { key: "failed", label: "Lỗi", match: (j) => j.status === "failed" },
];

function JobIcon({ job }: { job: Job }) {
  const Icon =
    job.status === "done" ? CircleCheck
    : job.status === "failed" ? CircleAlert
    : job.status === "waiting_review" ? ClipboardCheck
    : job.status === "queued" ? Hourglass
    : job.step ? STEP_ICONS[job.step] : Clock;
  return <span className={`job-icon ${job.status}`}><Icon size={20} /></span>;
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
  const total = job.parts.reduce((s, p) => s + p.durationSec, 0);
  return <div className="job-line"><Film size={14} /> {job.parts.length} video · tổng {formatDuration(total)}</div>;
}

export function JobsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: jobs, error, refresh } = usePolling(api.jobs, 2000);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const now = useNow(1000, Boolean(jobs?.some(isActive)));

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const q = query.trim().toLowerCase();
    return (jobs ?? []).filter((j) => f.match(j) && (!q || j.title.toLowerCase().includes(q)));
  }, [jobs, filter, query]);

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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Video của bạn</h1>
          <p className="muted">Theo dõi tiến độ và kết quả các truyện đã tạo.</p>
        </div>
        <Link className="btn primary" to="/new"><Plus size={16} /> Tạo video mới</Link>
      </div>

      {error && <div className="alert error"><CircleAlert size={16} />{error}</div>}
      {jobs && <SetupGuide hasJobs={jobs.length > 0} />}

      {jobs && jobs.length > 0 && (
        <>
          <div className="toolbar">
            <div className="tabs-pill">
              {FILTERS.map((f) => {
                const count = jobs.filter(f.match).length;
                if (f.key !== "all" && count === 0) return null;
                return (
                  <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
                    {f.label} <span className="count">{count}</span>
                  </button>
                );
              })}
            </div>
            <label className="search">
              <Search size={15} />
              <input type="search" placeholder="Tìm theo tên truyện…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>

          <div className="job-list">
            {shown.length === 0 && <div className="empty card">Không có video nào khớp bộ lọc.</div>}
            {shown.map((job) => (
              <div key={job.id} className={`job-card ${job.status}`} onClick={() => navigate(`/jobs/${job.id}`)}>
                <JobIcon job={job} />
                <div className="job-main">
                  <div className="job-title-row">
                    <Link to={`/jobs/${job.id}`} className="job-title" onClick={(e) => e.stopPropagation()}>{job.title}</Link>
                    <StatusBadge status={job.status} />
                  </div>
                  <MiniPipeline job={job} />
                  <JobSummary job={job} now={now} />
                  <div className="job-meta small muted">
                    Tạo {formatRelative(job.createdAt, now)}
                    {job.sourceDurationSec ? ` · file gốc ${formatDuration(job.sourceDurationSec)}` : ""}
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
                  {job.status === "done" && <span className="btn">Xem {job.parts.length} video</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
