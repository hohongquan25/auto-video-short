import { useState } from "react";
import { Check, Pencil } from "lucide-react";
import { api, type Job } from "../api";
import { errorMessage, useToast } from "./Toast";

/** A job's name as the page heading, with a pencil to rename it in place. */
export function JobTitle({ job, onRenamed }: { job: Job; onRenamed: () => Promise<unknown> }) {
  const toast = useToast();
  /** The new name being typed, or null when the title is not being edited. */
  const [title, setTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rename = async () => {
    const next = title?.trim() ?? "";
    if (!next || next === job.title) return setTitle(null);
    setBusy(true);
    try {
      await api.renameJob(job.id, next);
      toast("success", job.drive ? "Đã đổi tên. File trên Drive mang tên mới ở lần tải lên sau" : "Đã đổi tên");
      setTitle(null);
      await onRenamed();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (title === null) {
    return (
      <div className="title-row">
        <h1 className="clamp-2">{job.title}</h1>
        <button className="icon-btn" title="Đổi tên" aria-label="Đổi tên video" onClick={() => setTitle(job.title)}><Pencil size={16} /></button>
      </div>
    );
  }
  return (
    <form className="title-edit" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
      <input
        type="text" aria-label="Tên video" autoFocus maxLength={200} value={title}
        onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setTitle(null)}
      />
      <button type="submit" className="primary" disabled={busy || !title.trim()}><Check size={15} /> Lưu</button>
      <button type="button" disabled={busy} onClick={() => setTitle(null)}>Huỷ</button>
    </form>
  );
}
