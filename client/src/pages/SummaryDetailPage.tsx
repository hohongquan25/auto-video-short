import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CircleAlert, Copy, Download, Lightbulb, Link2, LoaderCircle, RotateCcw, Square, Trash2 } from "lucide-react";
import { api, jobFileUrl, type Job, type JobDetail, type Meta, type Step, type SummaryResult, type SummarySettings } from "../api";
import { Pipeline, StatusBadge } from "../components/JobStatus";
import { JobTitle } from "../components/JobTitle";
import { LogView } from "../components/LogView";
import { StatusPanel } from "../components/StatusPanel";
import { SummarySettingsForm, summaryProblems } from "../components/SummarySettings";
import { copyText, errorMessage, useToast } from "../components/Toast";
import {
  AI_PROVIDER_LABELS, SHORT_OF_SUGGESTED, STEP_LABELS, clock, fileSlug, focusLabel, formatBytes, formatDate, formatDuration, languageLabel,
  storyNameFromTitle,
} from "../format";
import { deleteQuestion, isActive, summaryStepForChange, useNow } from "../jobState";
import { useLibrary } from "../useLibrary";
import { usePolling } from "../usePolling";

type Tab = "result" | "transcript" | "log" | "settings";

const TAB_FOR_STEP: Partial<Record<Step, Tab>> = { captions: "transcript", transcribe: "transcript", summarize: "result", narrate: "result", cut: "result" };

const downloadName = (job: Job) => `${fileSlug(storyNameFromTitle(job.title)) || "video"}_rut_gon.mp4`;

/** How long the AI judged the summary must be to tell everything, and a redo at that length when the one chosen falls well short. */
function LengthAdvice({ job, result, targetSec, busy, onRetarget }: {
  job: Job; result: SummaryResult; targetSec: number | null; busy: boolean; onRetarget: (sec: number) => void;
}) {
  const suggested = result.suggested;
  if (!suggested) return null;
  const short = targetSec !== null && targetSec < suggested.sec * SHORT_OF_SUGGESTED;
  return (
    <div className={`alert ${short ? "warn" : "info"}`}>
      <Lightbulb size={16} />
      <div className="grow">
        {targetSec === null ? "AI chọn độ dài" : "AI ước tính cần khoảng"} <b>{formatDuration(suggested.sec)}</b> để kể đủ nội dung
        {suggested.reason ? `: ${suggested.reason}` : "."}
        {short && targetSec !== null && (
          <div className="row length-advice">
            <span>Độ dài bạn chọn ({formatDuration(targetSec)}) ngắn hơn nhiều nên có thể thiếu ý.</span>
            <button className="small" disabled={busy || isActive(job)} onClick={() => onRetarget(suggested.sec)}>
              <RotateCcw size={14} /> Làm lại với {formatDuration(suggested.sec)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultTab({ job, result, targetSec, busy, onRetarget }: {
  job: Job; result: SummaryResult | null; targetSec: number | null; busy: boolean; onRetarget: (sec: number) => void;
}) {
  const toast = useToast();
  const player = useRef<HTMLVideoElement>(null);
  if (!result) return <div className="empty">{isActive(job) ? "Bản tóm tắt sẽ hiện ở đây khi AI đọc xong lời thoại." : "Chưa có bản tóm tắt."}</div>;
  // Where each kept passage starts in the cut video, where it lasts as long as its narration.
  const starts: number[] = [];
  result.clips.reduce((at, c) => (starts.push(at), at + (c.outSec ?? c.endSec - c.startSec)), 0);
  const seek = (sec: number) => {
    if (!player.current) return;
    player.current.currentTime = sec;
    void player.current.play();
  };
  const fullText = [result.title, result.text, ...result.keyPoints.map((p) => `- ${p}`)].filter(Boolean).join("\n\n");
  const narration = result.clips.map((c) => c.narration).join("\n\n");
  return (
    <div className="summary-result">
      {result.file ? (
        <div className="summary-player">
          <video ref={player} src={`${jobFileUrl(job.id, result.file)}?v=${result.sizeBytes}`} controls preload="metadata" />
          <div className="row">
            <a className="btn primary" href={jobFileUrl(job.id, result.file)} download={downloadName(job)}><Download size={15} /> Tải video rút gọn</a>
            <span className="small muted">
              {result.durationSec ? formatDuration(result.durationSec) : ""}{result.sizeBytes ? ` · ${formatBytes(result.sizeBytes)}` : ""}
            </span>
          </div>
        </div>
      ) : (
        <div className="empty">{isActive(job) ? "Video rút gọn sẽ có khi cắt ghép xong." : "Chưa có video rút gọn."}</div>
      )}
      <LengthAdvice job={job} result={result} targetSec={targetSec} busy={busy} onRetarget={onRetarget} />

      <section>
        <div className="editor-toolbar small">
          <b>{result.title || "Tóm tắt"}</b>
          <span className="spacer" />
          <button className="small" onClick={() => copyText(fullText, toast, "bản tóm tắt")}><Copy size={14} /> Sao chép</button>
        </div>
        <div className="textblock">{result.text}</div>
        {result.keyPoints.length > 0 && (
          <>
            <h3>Ý chính</h3>
            <ul className="key-points">{result.keyPoints.map((p) => <li key={p}>{p}</li>)}</ul>
          </>
        )}
      </section>

      <section>
        <div className="editor-toolbar small">
          <b>{result.clips.length} đoạn và lời kể</b>
          <span className="spacer" />
          <button className="small" onClick={() => copyText(narration, toast, "lời kể")}><Copy size={14} /> Sao chép lời kể</button>
        </div>
        <ol className="clip-list">
          {result.clips.map((c, i) => (
            <li key={c.startSec}>
              <button type="button" className="link-btn" disabled={!result.file} title="Xem đoạn này trong bản rút gọn" onClick={() => seek(starts[i])}>
                {clock(starts[i])}
              </button>
              <span className="small muted">gốc {clock(c.startSec)}–{clock(c.endSec)}</span>
              <span>{c.narration}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function SettingsTab({ job, settings, meta, busy, onApply }: {
  job: Job; settings: SummarySettings; meta: Meta; busy: boolean; onApply: (step: Step, s: SummarySettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const step = summaryStepForChange(settings, draft);
  const problems = summaryProblems(draft, meta, job.sourceDurationSec);
  return (
    <>
      <SummarySettingsForm value={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} meta={meta} sourceSec={job.sourceDurationSec} />
      <div className="row settings-actions">
        <button className="primary" disabled={!step || busy || isActive(job) || problems.length > 0} onClick={() => step && onApply(step, draft)}>
          <RotateCcw size={15} /> {step ? `Lưu và chạy lại từ "${STEP_LABELS[step]}"` : "Chưa có thay đổi"}
        </button>
        {step && problems.map((p) => <span key={p} className="small warn-text">{p}</span>)}
        {isActive(job) && <span className="small muted">Dừng job trước khi đổi cài đặt.</span>}
      </div>
    </>
  );
}

export function SummaryDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { meta } = useLibrary();
  const [polling, setPolling] = useState(true);
  const { data, error: loadError, refresh } = usePolling<JobDetail>(() => api.job(id), 1500, polling);
  const [tab, setTab] = useState<Tab | null>(null);
  const [busy, setBusy] = useState(false);

  const job = data?.job;
  const active = job ? isActive(job) : true;
  const now = useNow(1000, active);
  useEffect(() => setPolling(active), [active]);

  if (loadError && !data) return <div className="alert error"><CircleAlert size={16} />{loadError}</div>;
  if (!job || !data || !meta) return <div className="loading"><LoaderCircle className="spin" /> Đang tải…</div>;
  const summary = job.summary;
  if (!summary) return <div className="alert error"><CircleAlert size={16} />Đây không phải job tóm tắt. <Link to={`/jobs/${job.id}`}>Mở trang video</Link></div>;
  const { result, settings } = summary;

  const currentTab: Tab = tab ?? (job.status === "done" ? "result" : "log");
  const problems = job.log.filter((e) => e.level === "warn" || e.level === "error").length;
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast("success", done);
      await refresh();
      setPolling(true);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const tabs: [Tab, string, number | null][] = [
    ["result", "Kết quả", result?.clips.length ?? null],
    ["transcript", "Lời thoại", null],
    ["log", "Nhật ký", problems || null],
    ["settings", "Cài đặt", null],
  ];
  const kept = result?.durationSec && job.sourceDurationSec ? Math.round((result.durationSec / job.sourceDurationSec) * 100) : null;

  return (
    <>
      <Link to="/summaries" className="back-link small"><ArrowLeft size={14} /> Tóm tắt video</Link>

      <div className="page-head">
        <div className="min-w-0 grow">
          <JobTitle job={job} onRenamed={refresh} />
          <div className="meta-chips small muted">
            <StatusBadge status={job.status} />
            <span>Tạo {formatDate(job.createdAt)}</span>
            {job.sourceUrl && (
              <a href={job.sourceInfo?.webpageUrl ?? job.sourceUrl} target="_blank" rel="noreferrer" className="source-link">
                <Link2 size={13} /> {job.sourceInfo?.platform ?? "Link"}{job.sourceInfo?.uploader ? ` · ${job.sourceInfo.uploader}` : ""}
              </a>
            )}
            {job.sourceDurationSec ? <span>Video gốc {formatDuration(job.sourceDurationSec)}</span> : null}
            <span>{settings.targetSec === null ? "Độ dài do AI chọn" : `Rút gọn còn ${formatDuration(settings.targetSec)}`}</span>
            {settings.focus && <span title={settings.focus}>Trọng tâm {focusLabel(settings.focus)}</span>}
            {summary.transcriptFrom && (
              <span>
                {summary.transcriptFrom === "captions" ? "Từ phụ đề" : "Nhận dạng giọng nói"}
                {summary.language ? ` · ${languageLabel(summary.language)}` : ""}
              </span>
            )}
            <span>Giọng kể {meta.voices.find((v) => v.id === settings.voice)?.name ?? settings.voice.replace(/^olvroc:/, "")}</span>
            <span>{AI_PROVIDER_LABELS[settings.aiProvider]}</span>
          </div>
        </div>
        <div className="row">
          {active && <button disabled={busy} onClick={() => act(() => api.stop(job.id), "Đã dừng job")}><Square size={15} /> Dừng</button>}
          <button
            className="danger" disabled={busy}
            onClick={() => {
              if (!confirm(deleteQuestion(job))) return;
              void act(async () => {
                await api.deleteJob(job.id);
                navigate("/summaries");
              }, "Đã xoá job");
            }}
          >
            <Trash2 size={15} /> Xoá
          </button>
        </div>
      </div>

      <div className="card pipeline-card">
        <Pipeline job={job} now={now} onSelect={(s) => setTab(TAB_FOR_STEP[s] ?? "log")} />
        <StatusPanel
          job={job} now={now} busy={busy} onLog={() => setTab("log")}
          onRetry={() => act(() => api.rerun(job.id), "Đã cho chạy lại")}
          done={{
            title: <>
              Đã rút gọn{job.sourceDurationSec ? ` ${formatDuration(job.sourceDurationSec)}` : ""} còn {result?.durationSec ? formatDuration(result.durationSec) : "?"}
              {kept !== null ? ` (${kept}%)` : ""}, {result?.clips.length ?? 0} đoạn
            </>,
            actions: <>
              <button onClick={() => setTab("result")}>Xem bản rút gọn</button>
              {result?.file && (
                <a className="btn primary" href={jobFileUrl(job.id, result.file)} download={downloadName(job)}><Download size={15} /> Tải về</a>
              )}
            </>,
          }}
        />
      </div>

      <div className="card">
        <div className="tabs" role="tablist">
          {tabs.map(([key, label, badge]) => (
            <button key={key} role="tab" aria-selected={currentTab === key} className={currentTab === key ? "active" : ""} onClick={() => setTab(key)}>
              {label}
              {badge !== null && <span className={`tab-badge ${key === "log" ? "warn" : ""}`}>{badge}</span>}
            </button>
          ))}
        </div>

        {currentTab === "result" && (
          <ResultTab
            job={job} result={result} targetSec={settings.targetSec} busy={busy}
            onRetarget={(sec) => act(
              () => api.rerunSummary(job.id, "summarize", { ...settings, targetSec: sec }),
              `Đã cho làm lại với độ dài ${formatDuration(sec)}`,
            )}
          />
        )}

        {currentTab === "transcript" && (
          data.transcript === null ? (
            <div className="empty">Lời thoại sẽ có sau bước "{summary.settings.useCaptions ? STEP_LABELS.captions : STEP_LABELS.transcribe}".</div>
          ) : (
            <>
              <div className="editor-toolbar small">
                <span>
                  {summary.transcriptFrom === "captions" ? "Lấy từ phụ đề của video" : "Nhận dạng từ giọng nói bằng Whisper"}
                  {summary.language ? ` · ${languageLabel(summary.language)}` : ""}
                </span>
                <span className="spacer" />
                <button className="small" onClick={() => copyText(data.transcript!, toast, "lời thoại")}><Copy size={14} /> Sao chép</button>
              </div>
              <div className="textblock">{data.transcript}</div>
            </>
          )
        )}

        {currentTab === "log" && <LogView entries={job.log} live={active} />}

        {currentTab === "settings" && (
          <SettingsTab
            key={JSON.stringify(settings)}
            job={job} settings={settings} meta={meta} busy={busy}
            onApply={(step, s) => act(() => api.rerunSummary(job.id, step, s), `Đã lưu cài đặt, chạy lại từ "${STEP_LABELS[step]}"`)}
          />
        )}
      </div>
    </>
  );
}
