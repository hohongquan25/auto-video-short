import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CircleAlert, Link2, CircleCheck, ClipboardCheck, Columns2, Copy, Download, FileSpreadsheet, FileText, FolderOpen,
  LoaderCircle, Megaphone, PenLine, RotateCcw, Square, Trash2, Undo2,
} from "lucide-react";
import { api, jobFileUrl, type Job, type JobDetail, type JobSettings, type Step } from "../api";
import {
  BackgroundPicker, FormatPicker, FullVideoToggle, PartLengthPicker, ReviewToggle, StylePicker, SubtitleToggle, VoicePicker, estimateParts,
} from "../components/Pickers";
import { Pipeline, StatusBadge } from "../components/JobStatus";
import { JobTitle } from "../components/JobTitle";
import { StatusPanel } from "../components/StatusPanel";
import { LogView } from "../components/LogView";
import { PublishTab } from "../components/PublishTab";
import { copyText, errorMessage, useToast } from "../components/Toast";
import {
  AI_PROVIDER_LABELS, STEP_LABELS, VIDEO_FORMATS, driveFolderUrl, estimateSpeechSec, formatBytes, formatChars, formatDate, formatDuration,
  renderedSec, sheetUrl, videoCount, videoFileName,
} from "../format";
import { deleteQuestion, isActive, jobSteps, stepForChange, useNow } from "../jobState";
import { useLibrary } from "../useLibrary";
import { usePolling } from "../usePolling";

type Tab = "result" | "publish" | "script" | "transcript" | "log" | "settings";

const TAB_FOR_STEP: Record<Step, Tab> = {
  download: "log",
  captions: "log",
  extract: "log",
  transcribe: "transcript",
  write: "log",
  rewrite: "script",
  review: "script",
  tts: "log",
  render: "result",
  publish: "publish",
  upload: "log",
  summarize: "log",
  narrate: "log",
  cut: "log",
};

function defaultTab(job: Job): Tab {
  if (job.status === "waiting_review") return "script";
  if (job.status === "done") return "result";
  return "log";
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function ResultTab({ job }: { job: Job }) {
  const toast = useToast();
  if (job.outputs.length === 0) {
    return <div className="empty">{isActive(job) ? "Video sẽ xuất hiện ở đây khi dựng xong." : "Chưa có video."}</div>;
  }
  const copyPart = async (textFile: string, what: string) => {
    const text = await fetch(jobFileUrl(job.id, `parts/${textFile}`)).then((r) => r.text()).catch(() => null);
    if (text === null) return toast("error", "Không tải được lời đọc");
    await copyText(text, toast, `lời đọc ${what}`);
  };
  const several = job.outputs.length > 1;
  return (
    <>
      {job.outputs.map((o) => {
        const name = VIDEO_FORMATS[o.format].label;
        const videos = [
          ...o.parts.map((p) => ({ ...p, label: `Phần ${p.index}/${o.parts.length}`, what: `phần ${p.index}`, download: `${videoFileName(job, o.format, p.index)}.mp4` })),
          ...(o.fullVideo ? [{
            ...o.fullVideo,
            label: o.parts.length ? "Bản đầy đủ (không cắt)" : "Cả truyện, không chia phần",
            what: "bản đầy đủ",
            download: `${videoFileName(job, o.format, null)}.mp4`,
          }] : []),
        ];
        return (
          <section key={o.format}>
            {several && (
              <h3 className="output-head">
                {name}
                <span className="small muted">{o.parts.length ? `${o.parts.length} phần${o.fullVideo ? " + bản đầy đủ" : ""}` : "1 video dài"}</span>
              </h3>
            )}
            <div className="parts">
              {videos.map((v) => (
                <div className="part" key={v.file}>
                  <video
                    src={jobFileUrl(job.id, `parts/${v.file}`)} controls preload="metadata"
                    className={o.format === "tiktok" ? "tall" : undefined}
                  />
                  <div className="part-meta">
                    <div>
                      <b>{v.label}</b>
                      <div className="small muted">
                        {formatDuration(v.durationSec)}{v.sizeBytes ? ` · ${formatBytes(v.sizeBytes)}` : ""}
                      </div>
                    </div>
                    <span className="spacer" />
                    <button className="icon-btn" title="Sao chép lời đọc" aria-label="Sao chép lời đọc" onClick={() => copyPart(v.textFile, v.what)}>
                      <Copy size={15} />
                    </button>
                    <a className="btn small primary" href={jobFileUrl(job.id, `parts/${v.file}`)} download={v.download}>
                      <Download size={14} /> Tải về
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}

function ScriptTab({ job, data, draft, setDraft, busy, onSave, onApprove }: {
  job: Job; data: JobDetail; draft: string | null; setDraft: (s: string | null) => void; busy: boolean;
  onSave: () => void; onApprove: () => void;
}) {
  const [compare, setCompare] = useState(false);
  if (data.script === null) {
    return <div className="empty">Kịch bản sẽ có sau bước "{STEP_LABELS[job.sourceTopic ? "write" : "rewrite"]}".</div>;
  }
  const text = draft ?? "";
  const dirty = draft !== null && draft !== data.script;
  const speech = estimateSpeechSec(text.length, job.settings.rate);
  const locked = isActive(job);

  return (
    <>
      <div className="editor-toolbar small">
        <span><b>{formatChars(text.length)}</b> ký tự</span>
        <span>≈ <b>{formatDuration(speech)}</b> giọng đọc</span>
        <span>≈ <b>{estimateParts(speech, job.settings.minPartSec, job.settings.maxPartSec)}</b> video</span>
        {dirty && <span className="tag warn">Chưa lưu</span>}
        <span className="spacer" />
        {data.transcript && (
          <button className={`small ${compare ? "on" : ""}`} onClick={() => setCompare(!compare)}>
            <Columns2 size={14} /> So sánh bản gốc
          </button>
        )}
      </div>
      <div className={compare ? "compare" : ""}>
        {compare && (
          <div>
            <div className="compare-label small muted">Bản gốc (Whisper)</div>
            <div className="textblock">{data.transcript}</div>
          </div>
        )}
        <div>
          {compare && <div className="compare-label small muted">Kịch bản sẽ được đọc</div>}
          <textarea className="script-editor" rows={20} value={text} disabled={locked} onChange={(e) => setDraft(e.target.value)} />
        </div>
      </div>
      <div className="row editor-actions">
        {locked && <span className="small muted">Đang xử lý, chỉ sửa được khi job dừng hoặc xong.</span>}
        <span className="spacer" />
        {dirty && <button disabled={busy} onClick={() => setDraft(data.script)}><Undo2 size={15} /> Huỷ thay đổi</button>}
        {job.status === "waiting_review" ? (
          <button className="primary" disabled={busy || !text.trim()} onClick={onApprove}>
            <CircleCheck size={15} /> {dirty ? "Lưu, duyệt & tạo video" : "Duyệt & tạo video"}
          </button>
        ) : (
          <button className="primary" disabled={busy || locked || !dirty || !text.trim()} onClick={onSave}>
            Lưu &amp; tạo lại video
          </button>
        )}
      </div>
    </>
  );
}

function SettingsTab({ job, busy, onApply, onRerunFrom }: {
  job: Job; busy: boolean;
  onApply: (step: Step, settings: JobSettings) => void;
  onRerunFrom: (step: Step) => void;
}) {
  const { meta, styles } = useLibrary();
  const [draft, setDraft] = useState<JobSettings>(job.settings);
  const [manualStep, setManualStep] = useState<Step>("render");
  if (!meta) return <div className="loading"><LoaderCircle className="spin" /></div>;

  const set = (patch: Partial<JobSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const changeStep = stepForChange(job, draft);
  const locked = isActive(job);
  const speechSec = job.outputs.length ? renderedSec(job.outputs) : job.sourceDurationSec;

  return (
    <div className="settings-tab">
      <section>
        <h3>{job.sourceTopic ? "Phong cách kể" : "Phong cách viết lại"}</h3>
        <StylePicker value={draft} set={set} styles={styles} meta={meta} writing={Boolean(job.sourceTopic)} />
        <ReviewToggle value={draft} set={set} />
      </section>
      <section>
        <h3>Giọng đọc</h3>
        <VoicePicker value={draft} set={set} meta={meta} />
      </section>
      <section>
        <h3>Video nền</h3>
        <BackgroundPicker value={draft} set={set} />
        <SubtitleToggle value={draft} set={set} />
      </section>
      <section>
        <h3>Định dạng xuất</h3>
        <FormatPicker value={draft} set={set} />
      </section>
      <section>
        <h3>Độ dài mỗi video</h3>
        <PartLengthPicker value={draft} set={set} speechSec={speechSec} />
        <FullVideoToggle value={draft} set={set} />
      </section>

      <div className={`apply-bar ${changeStep ? "pending" : ""}`}>
        <div className="spacer small">
          {locked ? "Đợi job chạy xong hoặc bấm Dừng để đổi cài đặt."
            : changeStep ? <>Sẽ chạy lại từ bước <b>{STEP_LABELS[changeStep]}</b>, các bước trước được giữ nguyên.</>
            : <span className="muted">Chưa có thay đổi.</span>}
        </div>
        {changeStep && <button disabled={busy} onClick={() => setDraft(job.settings)}><Undo2 size={15} /> Hoàn tác</button>}
        <button className="primary" disabled={busy || locked || !changeStep} onClick={() => onApply(changeStep!, draft)}>
          Áp dụng &amp; chạy lại
        </button>
      </div>

      <details className="advanced">
        <summary>Nâng cao: chạy lại thủ công từ một bước</summary>
        <div className="row">
          <select value={manualStep} onChange={(e) => setManualStep(e.target.value as Step)} style={{ width: "auto" }}>
            {jobSteps(job).filter((s) => s !== "review" || job.settings.reviewBeforeTts).map((s) => (
              <option key={s} value={s}>{jobSteps(job).indexOf(s) + 1}. {STEP_LABELS[s]}</option>
            ))}
          </select>
          <button disabled={busy || locked} onClick={() => onRerunFrom(manualStep)}><RotateCcw size={15} /> Chạy lại từ bước này</button>
        </div>
        <div className="small muted">Kết quả của bước đã chọn và các bước sau sẽ bị xoá rồi tạo lại.</div>
      </details>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function JobDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { styles, meta } = useLibrary();
  const [polling, setPolling] = useState(true);
  const { data, error: loadError, refresh } = usePolling(() => api.job(id), 1500, polling);
  const [tab, setTab] = useState<Tab | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const job = data?.job;
  const active = job ? isActive(job) : true;
  const now = useNow(1000, active);

  useEffect(() => setPolling(active), [active]);
  useEffect(() => {
    if (draft === null && data?.script != null) setDraft(data.script);
  }, [data?.script, draft]);
  // A summary job opened by a story link (a webhook, an old bookmark) goes to its own page.
  useEffect(() => {
    if (job?.kind === "summary") navigate(`/summaries/${job.id}`, { replace: true });
  }, [job?.kind, job?.id, navigate]);

  if (loadError && !data) return <div className="alert error"><CircleAlert size={16} />{loadError}</div>;
  if (!job || !data || job.kind === "summary") return <div className="loading"><LoaderCircle className="spin" /> Đang tải…</div>;

  const currentTab: Tab = tab ?? defaultTab(job);
  const scriptDirty = draft !== null && draft !== data.script;
  const problems = job.log.filter((e) => e.level === "warn" || e.level === "error").length;
  const style = styles.find((s) => s.id === job.settings.styleId);
  const voice = meta?.voices.find((v) => v.id === job.settings.voice);

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

  const approve = () => act(async () => {
    if (scriptDirty && draft !== null) await api.saveScript(job.id, draft);
    await api.continueJob(job.id);
    setDraft(null);
    setTab("log");
  }, "Đã duyệt, bắt đầu tạo giọng đọc");

  const tabs: [Tab, string, number | null][] = [
    ["result", "Kết quả", videoCount(job.outputs) || null],
    ["publish", "Đăng bài", null],
    ["script", "Kịch bản", null],
    ["transcript", job.sourceTopic ? "Chủ đề" : "Bản gốc", null],
    ["log", "Nhật ký", problems || null],
    ["settings", "Cài đặt", null],
  ];

  return (
    <>
      <Link to="/" className="back-link small"><ArrowLeft size={14} /> Danh sách video</Link>

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
            {job.sourceTopic && (
              <span className="source-link"><PenLine size={13} /> AI viết · {job.sourceTopic.minMinutes}–{job.sourceTopic.maxMinutes} phút</span>
            )}
            {job.sourceDurationSec ? <span>{job.sourceUrl ? "Dài" : "File gốc"} {formatDuration(job.sourceDurationSec)}</span> : null}
            {style && <span>{style.name}{style.prompt || job.sourceTopic ? ` · ${AI_PROVIDER_LABELS[job.settings.aiProvider]}` : ""}</span>}
            {voice && <span>{voice.name}{voice.provider === "olvroc" ? " (OlvRoc)" : ""} {job.settings.rate}</span>}
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
                navigate("/");
              }, "Đã xoá job");
            }}
          >
            <Trash2 size={15} /> Xoá
          </button>
        </div>
      </div>

      <div className="card pipeline-card">
        <Pipeline job={job} now={now} onSelect={(s) => setTab(TAB_FOR_STEP[s])} />
        <StatusPanel
          job={job} now={now} busy={busy} onLog={() => setTab("log")}
          onRetry={() => act(() => api.rerun(job.id), "Đã cho chạy lại")}
          waiting={(
            <div className="status-panel waiting">
              <div className="sp-head">
                <span className="sp-icon"><ClipboardCheck size={20} /></span>
                <div className="spacer">
                  <div className="sp-title">Kịch bản đã sẵn sàng, mời bạn duyệt</div>
                  <div className="small muted">Đọc lại, sửa chỗ chưa ưng ở tab Kịch bản, rồi bấm duyệt để tạo giọng đọc và video.</div>
                </div>
              </div>
              <div className="row">
                <button onClick={() => setTab("script")}><FileText size={15} /> Mở kịch bản</button>
                <button className="primary" disabled={busy} onClick={approve}><CircleCheck size={15} /> Duyệt &amp; tạo video</button>
              </div>
            </div>
          )}
          done={{
            title: <>
              Hoàn thành {videoCount(job.outputs)} video{job.outputs.length > 1 ? ` (${job.outputs.map((o) => VIDEO_FORMATS[o.format].label).join(" + ")})` : ""},
              {" "}dài {formatDuration(renderedSec(job.outputs))}
            </>,
            actions: <>
              <button onClick={() => setTab("result")}>Xem video</button>
              {job.drive && (
                <>
                  <a className="btn" href={driveFolderUrl(job.drive.folderId)} target="_blank" rel="noreferrer"><FolderOpen size={15} /> Drive</a>
                  <a className="btn" href={sheetUrl(job.drive.sheetId)} target="_blank" rel="noreferrer"><FileSpreadsheet size={15} /> Sheet</a>
                </>
              )}
              {job.publish && <button className="primary" onClick={() => setTab("publish")}><Megaphone size={15} /> Đăng bài</button>}
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
              {key === "script" && scriptDirty && <span className="tab-dot" />}
            </button>
          ))}
        </div>

        {currentTab === "result" && <ResultTab job={job} />}

        {currentTab === "publish" && (
          <PublishTab
            job={job} busy={busy}
            onRegenerate={() => act(() => api.rerun(job.id, "publish"), "Đang tạo lại gợi ý đăng bài")}
          />
        )}

        {currentTab === "script" && (
          <ScriptTab
            job={job} data={data} draft={draft} setDraft={setDraft} busy={busy} onApprove={approve}
            onSave={() => act(async () => {
              await api.saveScript(job.id, draft!);
              await api.rerun(job.id);
              setDraft(null);
              setTab("log");
            }, "Đã lưu kịch bản, đang tạo lại video")}
          />
        )}

        {currentTab === "transcript" && (
          job.sourceTopic ? (
            <>
              <div className="editor-toolbar small">
                <span>Truyện dài <b>{job.sourceTopic.minMinutes}–{job.sourceTopic.maxMinutes} phút</b>, do AI viết theo chủ đề</span>
                <span className="spacer" />
                <button className="small" onClick={() => copyText(job.sourceTopic!.prompt, toast, "chủ đề")}><Copy size={14} /> Sao chép</button>
              </div>
              <div className="textblock">{job.sourceTopic.prompt}</div>
            </>
          ) : data.transcript === null ? (
            <div className="empty">Bản gốc sẽ có sau bước "{STEP_LABELS.transcribe}".</div>
          ) : (
            <>
              <div className="editor-toolbar small">
                <span><b>{formatChars(data.transcript.length)}</b> ký tự, nhận dạng bằng Whisper</span>
                <span className="spacer" />
                <button className="small" onClick={() => copyText(data.transcript!, toast, "bản gốc")}><Copy size={14} /> Sao chép</button>
              </div>
              <div className="textblock">{data.transcript}</div>
            </>
          )
        )}

        {currentTab === "log" && <LogView entries={job.log} live={active} />}

        {currentTab === "settings" && (
          <SettingsTab
            key={JSON.stringify(job.settings)}
            job={job} busy={busy}
            onApply={(step, settings) => act(() => api.rerun(job.id, step, settings), `Đã lưu cài đặt, chạy lại từ "${STEP_LABELS[step]}"`)}
            onRerunFrom={(step) => {
              if (!confirm(`Xoá kết quả từ bước "${STEP_LABELS[step]}" trở đi và chạy lại?`)) return;
              void act(() => api.rerun(job.id, step), `Đang chạy lại từ "${STEP_LABELS[step]}"`);
            }}
          />
        )}
      </div>
    </>
  );
}
