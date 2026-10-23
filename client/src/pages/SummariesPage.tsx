import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, Plus, Scissors } from "lucide-react";
import { api } from "../api";
import { isActive, useNow } from "../jobState";
import { JobCard } from "../components/JobCard";
import { usePolling } from "../usePolling";

export function SummariesPage() {
  const { data: all, error, refresh } = usePolling(api.jobs, 2000);
  const jobs = useMemo(() => all?.filter((j) => j.kind === "summary"), [all]);
  const now = useNow(1000, Boolean(jobs?.some(isActive)));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tóm tắt video</h1>
          <p className="muted">Rút gọn một video dài thành bản ngắn mà người xem vẫn nắm đủ nội dung.</p>
        </div>
        <Link className="btn primary" to="/summaries/new"><Plus size={16} /> Tóm tắt video mới</Link>
      </div>

      {error && <div className="alert error"><CircleAlert size={16} />{error}</div>}
      {jobs && jobs.length === 0 && (
        <div className="card empty summary-empty">
          <Scissors size={28} />
          <p>
            App đọc phụ đề có sẵn của video, không có thì nhận dạng giọng nói (nhiều ngôn ngữ). AI chọn những đoạn quan trọng
            rồi ghép lại thành một video ngắn, kèm bản tóm tắt bằng chữ.
          </p>
          <Link className="btn primary" to="/summaries/new"><Plus size={16} /> Tóm tắt video đầu tiên</Link>
        </div>
      )}
      {jobs && jobs.length > 0 && (
        <div className="job-list">
          {jobs.map((job) => <JobCard key={job.id} job={job} now={now} refresh={refresh} />)}
        </div>
      )}
    </>
  );
}
