import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Copy, Info, TriangleAlert } from "lucide-react";
import type { LogEntry, LogLevel, Step } from "../api";
import { STEP_LABELS, formatTime } from "../format";
import { STEPS } from "../jobState";
import { useToast } from "./Toast";

const LEVEL_ICON: Record<LogLevel, typeof Info> = {
  info: Info,
  success: CircleCheck,
  warn: TriangleAlert,
  error: CircleAlert,
};

type Filter = "all" | "problems" | Step;

export function LogView({ entries, live }: { entries: LogEntry[]; live: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const shown = useMemo(() => entries.filter((e) =>
    filter === "all" ? true
    : filter === "problems" ? e.level === "warn" || e.level === "error"
    : e.step === filter,
  ), [entries, filter]);
  const problems = entries.filter((e) => e.level === "warn" || e.level === "error").length;
  const stepsInLog = STEPS.filter((s) => entries.some((e) => e.step === s));

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown.length, follow]);

  const copy = async () => {
    const text = shown.map((e) => `${e.at ? `[${formatTime(e.at)}] ` : ""}${e.step ? `(${STEP_LABELS[e.step]}) ` : ""}${e.msg}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("success", `Đã sao chép ${shown.length} dòng nhật ký`);
    } catch {
      toast("error", "Trình duyệt không cho phép sao chép");
    }
  };

  return (
    <div className="logview">
      <div className="log-toolbar">
        <div className="chips">
          <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>Tất cả <span>{entries.length}</span></button>
          <button className={`chip ${filter === "problems" ? "on" : ""}`} onClick={() => setFilter("problems")} disabled={problems === 0}>
            Cảnh báo &amp; lỗi <span>{problems}</span>
          </button>
          {stepsInLog.map((s) => (
            <button key={s} className={`chip ${filter === s ? "on" : ""}`} onClick={() => setFilter(s)}>{STEP_LABELS[s]}</button>
          ))}
        </div>
        <span className="spacer" />
        {live && (
          <label className="toggle small">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            Tự cuộn
          </label>
        )}
        <button className="small" onClick={copy} disabled={shown.length === 0}><Copy size={14} /> Sao chép</button>
      </div>

      <div
        className="log" ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (live && atBottom !== follow) setFollow(atBottom);
        }}
      >
        {shown.length === 0 && <div className="muted">Chưa có nhật ký.</div>}
        {shown.map((e, i) => {
          const Icon = LEVEL_ICON[e.level];
          return (
            <div key={i} className={`log-row ${e.level}`}>
              <span className="log-time">{e.at ? formatTime(e.at) : ""}</span>
              <Icon size={14} className="log-icon" />
              {e.step && <span className="log-step">{STEP_LABELS[e.step]}</span>}
              <span className="log-msg">{e.msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
