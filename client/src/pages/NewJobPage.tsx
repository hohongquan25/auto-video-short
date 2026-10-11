import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Check, CircleAlert, Clapperboard, FileAudio, FileVideo, Link2, LoaderCircle, Mic, Rocket, Sparkles,
  Upload, X,
} from "lucide-react";
import { api, type JobSettings } from "../api";
import {
  BackgroundPicker, DEFAULT_SETTINGS, PartLengthPicker, ReviewToggle, StylePicker, VoicePicker, defaultProvider, defaultVoice,
  estimateParts, providerReady,
} from "../components/Pickers";
import { FileDrop } from "../components/FileDrop";
import { LinkSource, useLinkProbe } from "../components/LinkSource";
import { errorMessage, useToast } from "../components/Toast";
import { AI_PROVIDER_LABELS, formatBytes, formatDuration, stripExt } from "../format";
import { useLibrary } from "../useLibrary";

const WIZARD = [
  { key: "source", label: "File truyện", icon: FileAudio },
  { key: "script", label: "Kịch bản", icon: Sparkles },
  { key: "voice", label: "Giọng đọc", icon: Mic },
  { key: "video", label: "Video", icon: Clapperboard },
  { key: "confirm", label: "Xác nhận", icon: Rocket },
] as const;

const MEDIA_ACCEPT = "audio/*,video/*,.mkv";

/** Local preview URL + duration of the chosen file, read by the browser. */
function useMediaInfo(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    setDuration(null);
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    const probe = document.createElement(file.type.startsWith("video") ? "video" : "audio");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => Number.isFinite(probe.duration) && setDuration(probe.duration);
    probe.src = u;
    return () => {
      probe.removeAttribute("src");
      URL.revokeObjectURL(u);
    };
  }, [file]);
  return { url, duration };
}

export function NewJobPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { meta, styles, backgrounds, error: loadError } = useLibrary();
  const [mode, setMode] = useState<"file" | "link">("file");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const probe = useLinkProbe(mode === "link" ? link : "");
  const [title, setTitle] = useState("");
  const [settings, setSettings] = useState<JobSettings | null>(null);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [uploading, setUploading] = useState<number | null>(null);
  const media = useMediaInfo(file);

  useEffect(() => {
    if (settings || !meta || styles.length === 0) return;
    const aiProvider = defaultProvider(meta);
    // With no AI available, default to the style that keeps the transcript as is.
    const preferred = providerReady(meta, aiProvider) ? styles.find((s) => s.prompt) : styles.find((s) => !s.prompt);
    setSettings({ ...DEFAULT_SETTINGS, voice: defaultVoice(meta), aiProvider, styleId: (preferred ?? styles[0]).id, backgroundId: backgrounds[0]?.id ?? "" });
  }, [meta, styles, backgrounds, settings]);

  useEffect(() => {
    if (settings && !settings.backgroundId && backgrounds[0]) setSettings({ ...settings, backgroundId: backgrounds[0].id });
  }, [backgrounds, settings]);

  // Default the story title to the video's title once the link is recognised.
  useEffect(() => {
    if (probe.info) setTitle((t) => t || probe.info!.title);
  }, [probe.info]);

  if (loadError) return <div className="alert error"><CircleAlert size={16} />{loadError}</div>;
  if (!meta || !settings) return <div className="loading"><LoaderCircle className="spin" /> Đang tải…</div>;

  const set = (patch: Partial<JobSettings>) => setSettings((s) => (s ? { ...s, ...patch } : s));
  const rateFactor = 1 + (parseInt(settings.rate, 10) || 0) / 100;
  const sourceSec = mode === "file" ? media.duration : probe.info?.durationSec ?? null;
  const hasSource = mode === "file" ? Boolean(file) : probe.status === "ok";
  const speechSec = sourceSec ? sourceSec / rateFactor : null;
  const style = styles.find((s) => s.id === settings.styleId);
  const voice = meta.voices.find((v) => v.id === settings.voice);
  const background = backgrounds.find((b) => b.id === settings.backgroundId);

  // Warnings are shown but do not stop the job from being created.
  const problems: { step: number; text: string; warning?: boolean }[] = [];
  if (!hasSource) {
    problems.push({ step: 0, text: mode === "file" ? "Chưa chọn file truyện" : probe.status === "loading" ? "Đang kiểm tra link…" : "Chưa có link video hợp lệ" });
  }
  if (style?.prompt && !providerReady(meta, settings.aiProvider)) {
    const text = settings.aiProvider === "claude" ? "Claude Code chưa đăng nhập" : "Chưa có GEMINI_API_KEY";
    problems.push({ step: 1, text: `${text}, bước AI viết lại sẽ lỗi`, warning: true });
  }
  if (!background) problems.push({ step: 3, text: "Chưa chọn video nền" });
  if (settings.maxPartSec <= settings.minPartSec) problems.push({ step: 3, text: "Độ dài mỗi phần không hợp lệ" });
  const blocking = problems.filter((p) => !p.warning);
  const stepBlocked = (i: number) => blocking.some((p) => p.step === i);

  const goto = (i: number) => {
    setStep(i);
    setReached((r) => Math.max(r, i));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pickFile = (f: File) => {
    setFile(f);
    setTitle((t) => t || stripExt(f.name));
  };

  const submit = async () => {
    if (!hasSource || blocking.length) return;
    setUploading(0);
    try {
      const job = mode === "file" && file
        ? await api.createJob(file, title, settings, setUploading)
        : await api.createJobFromUrl(probe.url, title, settings);
      toast("success", "Đã tạo job, bắt đầu xử lý");
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      toast("error", errorMessage(err));
      setUploading(null);
    }
  };

  const summary = [
    {
      step: 0, label: "Nguồn",
      value: mode === "file"
        ? file ? `${file.name}${media.duration ? ` · ${formatDuration(media.duration)}` : ""}` : "Chưa chọn"
        : probe.info ? `${probe.info.platform}: ${probe.info.title}${probe.info.durationSec ? ` · ${formatDuration(probe.info.durationSec)}` : ""}` : "Chưa có link",
    },
    {
      step: 1, label: "Phong cách",
      value: `${style?.name ?? "?"}${style?.prompt ? ` · ${AI_PROVIDER_LABELS[settings.aiProvider]}` : ""}${settings.reviewBeforeTts ? " · có duyệt" : ""}`,
    },
    { step: 2, label: "Giọng đọc", value: `${voice?.name ?? settings.voice}${voice?.provider === "vbee" ? " (Vbee)" : ""} · ${settings.rate}` },
    { step: 3, label: "Video nền", value: background?.name ?? "Chưa chọn" },
    {
      step: 3, label: "Mỗi video",
      value: `${settings.minPartSec / 60}–${settings.maxPartSec / 60} phút${speechSec ? ` · ≈ ${estimateParts(speechSec, settings.minPartSec, settings.maxPartSec)} video` : ""}`,
    },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tạo video mới</h1>
          <p className="muted">Tải truyện lên, chọn giọng văn và giọng đọc. Phần còn lại Story Studio tự làm.</p>
        </div>
      </div>

      <ol className="wizard-steps">
        {WIZARD.map((w, i) => {
          const Icon = w.icon;
          const state = i === step ? "current" : i < step || i <= reached ? (stepBlocked(i) ? "warn" : "done") : "";
          return (
            <li key={w.key} className={state}>
              <button type="button" onClick={() => goto(i)} disabled={i > reached && !hasSource}>
                <span className="ws-icon">{state === "done" ? <Check size={15} strokeWidth={3} /> : <Icon size={15} />}</span>
                <span className="ws-label">{w.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="wizard">
        <div className="wizard-main card">
          {step === 0 && (
            <section>
              <h2>Truyện lấy từ đâu?</h2>
              <p className="muted small">Giọng nói sẽ được nhận dạng thành chữ bằng Whisper ({meta.whisperModel}) chạy ngay trên máy bạn.</p>
              <div className="seg-control source-mode">
                <button type="button" className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>
                  <b><Upload size={15} /> Tải file lên</b><span>video hoặc audio trên máy</span>
                </button>
                <button type="button" className={mode === "link" ? "on" : ""} onClick={() => setMode("link")}>
                  <b><Link2 size={15} /> Dán link video</b><span>YouTube, TikTok, Facebook…</span>
                </button>
              </div>
              {mode === "link" ? (
                <LinkSource link={link} setLink={setLink} probe={probe} ytdlpOk={meta.system.ytdlp.ok} />
              ) : !file ? (
                <FileDrop
                  accept={MEDIA_ACCEPT} onFile={pickFile}
                  title={<>Kéo thả file vào đây, hoặc <u>bấm để chọn</u></>}
                  hint="mp3, wav, m4a, ogg, flac, mp4, mkv, mov, webm…"
                />
              ) : (
                <div className="file-card">
                  <span className="file-icon">{file.type.startsWith("video") ? <FileVideo size={22} /> : <FileAudio size={22} />}</span>
                  <div className="spacer">
                    <b className="clamp-1">{file.name}</b>
                    <div className="small muted">
                      {formatBytes(file.size)}
                      {media.duration ? ` · dài ${formatDuration(media.duration)}` : " · đang đọc thời lượng…"}
                    </div>
                  </div>
                  <button className="icon-btn" aria-label="Bỏ chọn file" onClick={() => setFile(null)}><X size={16} /></button>
                  {media.url && (file.type.startsWith("video")
                    ? <video className="file-preview" src={media.url} controls preload="metadata" />
                    : <audio className="file-preview" src={media.url} controls preload="metadata" />)}
                </div>
              )}
              <label className="field">
                <span className="field-label">Tên truyện</span>
                <input
                  type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder={mode === "file" ? "Tự lấy theo tên file nếu bỏ trống" : "Tự lấy theo tiêu đề video nếu bỏ trống"}
                />
              </label>
            </section>
          )}

          {step === 1 && (
            <section>
              <h2>Bạn muốn kể lại câu chuyện theo giọng văn nào?</h2>
              <p className="muted small">AI giữ nguyên tình tiết và nhân vật, chỉ đổi cách kể. Chọn "Giữ nguyên văn" để không dùng AI.</p>
              <StylePicker value={settings} set={set} styles={styles} meta={meta} />
              <ReviewToggle value={settings} set={set} />
            </section>
          )}

          {step === 2 && (
            <section>
              <h2>Chọn giọng đọc</h2>
              <p className="muted small">Bấm <b>▶</b> để nghe thử (cần kết nối mạng).</p>
              <VoicePicker value={settings} set={set} meta={meta} speechSec={speechSec} />
            </section>
          )}

          {step === 3 && (
            <section>
              <h2>Video nền và độ dài mỗi video</h2>
              <h3>Video nền</h3>
              <BackgroundPicker value={settings} set={set} />
              <h3>Độ dài mỗi video</h3>
              <PartLengthPicker value={settings} set={set} speechSec={speechSec} />
            </section>
          )}

          {step === 4 && (
            <section>
              <h2>Kiểm tra lại và bắt đầu</h2>
              <dl className="summary-list">
                {summary.map((s) => (
                  <div key={s.label}>
                    <dt>{s.label}</dt>
                    <dd>{s.value}</dd>
                    <button className="link-btn small" onClick={() => goto(s.step)}>Sửa</button>
                  </div>
                ))}
              </dl>
              {problems.map((p) => (
                <div key={p.text} className={`alert ${p.warning ? "warn" : "error"}`}>
                  <CircleAlert size={16} />
                  <span className="spacer">{p.text}</span>
                  <button className="link-btn small" onClick={() => goto(p.step)}>Sửa</button>
                </div>
              ))}
              <div className="info-box small">
                Quy trình: tách audio → nhận dạng giọng nói → {style?.prompt ? `${AI_PROVIDER_LABELS[settings.aiProvider]} viết lại` : "giữ nguyên văn"}
                {settings.reviewBeforeTts ? " → dừng chờ bạn duyệt" : ""} → tạo giọng đọc → dựng video.
                Bạn có thể đóng trang này, job vẫn tiếp tục chạy.
              </div>
            </section>
          )}

          <div className="wizard-nav">
            {step > 0 ? (
              <button onClick={() => goto(step - 1)} disabled={uploading !== null}><ArrowLeft size={16} /> Quay lại</button>
            ) : <span />}
            {step < WIZARD.length - 1 ? (
              <button className="primary" onClick={() => goto(step + 1)} disabled={stepBlocked(step)}>
                Tiếp tục <ArrowRight size={16} />
              </button>
            ) : (
              <button className="primary lg" onClick={submit} disabled={blocking.length > 0 || uploading !== null}>
                {uploading !== null
                  ? <><LoaderCircle size={16} className="spin" /> Đang tải lên {Math.round(uploading * 100)}%</>
                  : <><Rocket size={16} /> Bắt đầu xử lý</>}
              </button>
            )}
          </div>
          {uploading !== null && <div className="progress lg"><div style={{ width: `${uploading * 100}%` }} /></div>}
        </div>

        <aside className="wizard-aside card">
          <h3>Tóm tắt</h3>
          <dl className="summary-list compact">
            {summary.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd className="clamp-2">{s.value}</dd>
              </div>
            ))}
          </dl>
          {speechSec && (
            <div className="small muted">Ước tính dựa trên độ dài file gốc; thực tế phụ thuộc vào kịch bản sau khi viết lại.</div>
          )}
          {step < WIZARD.length - 1 && (
            <button className="primary full" onClick={submit} disabled={blocking.length > 0 || uploading !== null}>
              {uploading !== null ? `Đang tải lên ${Math.round(uploading * 100)}%` : <><Rocket size={16} /> Bắt đầu ngay</>}
            </button>
          )}
        </aside>
      </div>
    </>
  );
}
