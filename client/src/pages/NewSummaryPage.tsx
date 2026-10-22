import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, CircleAlert, FileText, FileVideo, Link2, LoaderCircle, Scissors, Upload, X } from "lucide-react";
import { api, type SummarySettings } from "../api";
import { FileDrop } from "../components/FileDrop";
import { LinkSource, useLinkProbe } from "../components/LinkSource";
import { providerReady } from "../components/Pickers";
import { SummarySettingsForm, suggestTarget, summaryProblems } from "../components/SummarySettings";
import { errorMessage, useToast } from "../components/Toast";
import { SUMMARY_DEFAULTS, formatBytes, formatDuration } from "../format";
import { useLibrary } from "../useLibrary";
import { useMediaInfo } from "../useMediaInfo";

const VIDEO_ACCEPT = "video/*,.mkv";

export function NewSummaryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { meta, error: loadError } = useLibrary();
  const [mode, setMode] = useState<"file" | "link">("file");
  const [file, setFile] = useState<File | null>(null);
  const [captions, setCaptions] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const probe = useLinkProbe(mode === "link" ? link : "");
  const media = useMediaInfo(file);
  const [title, setTitle] = useState("");
  const [settings, setSettings] = useState<SummarySettings>(SUMMARY_DEFAULTS);
  /** Until the length is picked by hand, it follows the chosen video. */
  const [targetPicked, setTargetPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState<number | null>(null);

  const set = (patch: Partial<SummarySettings>) => {
    if ("targetSec" in patch) setTargetPicked(true);
    setSettings((s) => ({ ...s, ...patch }));
  };

  // Claude when it is signed in, otherwise Gemini when it has a key.
  useEffect(() => {
    if (meta && !providerReady(meta, "claude") && providerReady(meta, "gemini")) setSettings((s) => ({ ...s, aiProvider: "gemini" }));
  }, [meta]);

  const sourceSec = mode === "file" ? media.duration : probe.info?.durationSec ?? null;
  useEffect(() => {
    if (sourceSec && !targetPicked) setSettings((s) => ({ ...s, targetSec: suggestTarget(sourceSec) }));
  }, [sourceSec, targetPicked]);

  if (loadError) return <div className="alert error"><CircleAlert size={16} />{loadError}</div>;
  if (!meta) return <div className="loading"><LoaderCircle className="spin" /> Đang tải…</div>;

  const hasSource = mode === "file" ? Boolean(file) : probe.status === "ok";
  const problems = [
    ...(hasSource ? [] : [mode === "file" ? "Chưa chọn video" : "Chưa có link video dùng được"]),
    ...summaryProblems(settings, meta, sourceSec),
  ];

  const submit = async () => {
    setBusy(true);
    try {
      const job = mode === "file" && file
        ? await api.createSummary(file, captions, title, settings, setUploaded)
        : await api.createSummaryFromUrl(probe.url, title, settings);
      toast("success", "Đã tạo job tóm tắt");
      navigate(`/summaries/${job.id}`);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
      setUploaded(null);
    }
  };

  return (
    <>
      <Link to="/summaries" className="back-link small"><ArrowLeft size={14} /> Tóm tắt video</Link>
      <div className="page-head">
        <div>
          <h1>Tóm tắt video mới</h1>
          <p className="muted">
            App đọc nội dung video từ phụ đề có sẵn hoặc giọng nói (Whisper {meta.whisperModel}, nhiều ngôn ngữ), AI chọn những đoạn quan trọng và ghép lại thành một video ngắn.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Video cần tóm tắt</h2>
        <div className="seg-control source-mode">
          <button type="button" className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>
            <b><Upload size={15} /> Tải video lên</b><span>video trên máy</span>
          </button>
          <button type="button" className={mode === "link" ? "on" : ""} onClick={() => setMode("link")}>
            <b><Link2 size={15} /> Dán link video</b><span>YouTube, TikTok, Facebook…</span>
          </button>
        </div>
        {mode === "link" ? (
          <LinkSource link={link} setLink={setLink} probe={probe} ytdlpOk={meta.system.ytdlp.ok} />
        ) : !file ? (
          <FileDrop
            accept={VIDEO_ACCEPT} onFile={setFile}
            title={<>Kéo thả video vào đây, hoặc <u>bấm để chọn</u></>}
            hint="mp4, mkv, mov, webm, avi…"
          />
        ) : (
          <>
            <div className="file-card">
              <span className="file-icon"><FileVideo size={22} /></span>
              <div className="spacer">
                <b className="clamp-1">{file.name}</b>
                <div className="small muted">
                  {formatBytes(file.size)}
                  {media.duration ? ` · dài ${formatDuration(media.duration)}` : " · đang đọc thời lượng…"}
                </div>
              </div>
              <button className="icon-btn" aria-label="Bỏ chọn video" onClick={() => setFile(null)}><X size={16} /></button>
              {media.url && <video className="file-preview" src={media.url} controls preload="metadata" />}
            </div>
            <div className="row small captions-row">
              {captions ? (
                <>
                  <FileText size={14} /> <b>{captions.name}</b>
                  <button className="icon-btn" aria-label="Bỏ file phụ đề" onClick={() => setCaptions(null)}><X size={14} /></button>
                </>
              ) : (
                <label className="btn small">
                  <FileText size={14} /> Thêm file phụ đề (.srt, .vtt)
                  <input
                    type="file" accept=".srt,.vtt" hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setCaptions(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <span className="muted">Không bắt buộc. Có phụ đề thì không phải nhận dạng giọng nói.</span>
            </div>
          </>
        )}
        <label className="field">
          <span className="field-label">Tên</span>
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={mode === "file" ? "Tự lấy theo tên file nếu bỏ trống" : "Tự lấy theo tiêu đề video nếu bỏ trống"}
          />
        </label>
      </div>

      <div className="card">
        <h2>Bản rút gọn</h2>
        <SummarySettingsForm value={settings} set={set} meta={meta} sourceSec={sourceSec} />
      </div>

      <div className="card submit-card">
        {problems.length > 0 && <ul className="small warn-text problem-list">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {uploaded !== null && <div className="progress"><div style={{ width: `${uploaded * 100}%` }} /></div>}
        <button className="primary lg" disabled={problems.length > 0 || busy} onClick={submit}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Scissors size={16} />}
          {busy ? (uploaded !== null ? `Đang tải lên ${Math.round(uploaded * 100)}%` : "Đang tạo…") : "Bắt đầu tóm tắt"}
        </button>
      </div>
    </>
  );
}
