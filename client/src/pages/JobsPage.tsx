import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, Plus, Search } from "lucide-react";
import { api, type Job, type JobStatus } from "../api";
import { isActive, useNow } from "../jobState";
import { JobCard } from "../components/JobCard";
import { SetupGuide } from "../components/SystemStatus";
import { usePolling } from "../usePolling";

type Filter = "all" | "active" | JobStatus;

const FILTERS: { key: Filter; label: string; match: (j: Job) => boolean }[] = [
  { key: "all", label: "Tất cả", match: () => true },
  { key: "active", label: "Đang xử lý", match: isActive },
  { key: "waiting_review", label: "Chờ duyệt", match: (j) => j.status === "waiting_review" },
  { key: "done", label: "Hoàn thành", match: (j) => j.status === "done" },
  { key: "failed", label: "Lỗi", match: (j) => j.status === "failed" },
];

export function JobsPage() {
  const { data: all, error, refresh } = usePolling(api.jobs, 2000);
  // Summaries have their own page.
  const jobs = useMemo(() => all?.filter((j) => j.kind !== "summary"), [all]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const now = useNow(1000, Boolean(jobs?.some(isActive)));

  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const q = query.trim().toLowerCase();
    return (jobs ?? []).filter((j) => f.match(j) && (!q || j.title.toLowerCase().includes(q)));
  }, [jobs, filter, query]);

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
            {shown.map((job) => <JobCard key={job.id} job={job} now={now} refresh={refresh} />)}
          </div>
        </>
      )}
    </>
  );
}
