import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Check, CircleAlert, Clapperboard, FileAudio, FileVideo, Link2, LoaderCircle, Mic, PenLine, Rocket, Save, Sparkles,
  Upload, X, Zap,
} from "lucide-react";
import { api, type DefaultSettings, type JobSettings } from "../api";
import {
  BackgroundPicker, FormatPicker, FullVideoToggle, PartLengthPicker, ReviewToggle, StylePicker, SubtitleToggle, VoicePicker,
  estimateParts, providerReady,
} from "../components/Pickers";
import { FileDrop } from "../components/FileDrop";
import { LinkSource, useLinkProbe } from "../components/LinkSource";
import { DEFAULT_TOPIC, TopicSource, topicProblem } from "../components/TopicSource";
import { errorMessage, useToast } from "../components/Toast";
import { AI_PROVIDER_LABELS, VIDEO_FORMATS, formatBytes, formatDuration, formatPlan, stripExt } from "../format";
import { useLibrary } from "../useLibrary";
import { useMediaInfo } from "../useMediaInfo";

const WIZARD = [
  { key: "source", label: "Nguồn truyện", icon: FileAudio },
  { key: "script", label: "Kịch bản", icon: Sparkles },
  { key: "voice", label: "Giọng đọc", icon: Mic },
  { key: "video", label: "Video", icon: Clapperboard },
  { key: "confirm", label: "Xác nhận", icon: Rocket },
] as const;

const MEDIA_ACCEPT = "audio/*,video/*,.mkv";

export function NewJobPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { meta, styles, backgrounds, error: loadError } = useLibrary();
  const [mode, setMode] = useState<"file" | "link" | "topic">("file");
  const [topic, setTopic] = useState(DEFAULT_TOPIC);
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const probe = useLinkProbe(mode === "link" ? link : "");
  const [title, setTitle] = useState("");
  const [defaults, setDefaults] = useState<DefaultSettings | null>(null);
  const [settings, setSettings] = useState<JobSettings | null>(null);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [uploading, setUploading] = useState<number | null>(null);
  const media = useMediaInfo(file);

  useEffect(() => {
    api.defaults().then(setDefaults).catch((e) => toast("error", errorMessage(e)));
  }, [toast]);

  // The wizard starts from the saved defaults.
  useEffect(() => {
    if (!settings && defaults) setSettings({ ...defaults, backgroundIds: backgrounds.map((b) => b.id) });
  }, [defaults, backgrounds, settings]);

  useEffect(() => {
    // Every library video is used unless taken out; also covers a first video uploaded on this page.
    if (settings && settings.backgroundIds.length === 0 && backgrounds.length) setSettings({ ...settings, backgroundIds: backgrounds.map((b) => b.id) });
  }, [backgrounds, settings]);

  // Default the story title to the video's title once the link is recognised.
  useEffect(() => {
    if (probe.info) setTitle((t) => t || probe.info!.title);
  }, [probe.info]);

  if (loadError) return <div className="alert error"><CircleAlert size={16} />{loadError}</div>;
  if (!meta || !settings) return <div className="loading"><LoaderCircle className="spin" /> Đang tải…</div>;

  const set = (patch: Partial<JobSettings>) => setSettings((s) => (s ? { ...s, ...patch } : s));
  const rateFactor = 1 + (parseInt(settings.rate, 10) || 0) / 100;
  const sourceSec = mode === "file" ? media.duration : mode === "link" ? probe.info?.durationSec ?? null : null;
  const hasSource = mode === "file" ? Boolean(file) : mode === "link" ? probe.status === "ok" : !topicProblem(topic);
  // A written story is sized in narration minutes already, at whatever voice speed is chosen.
  const speechSec = mode === "topic" ? ((topic.minMinutes + topic.maxMinutes) / 2) * 60 : sourceSec ? sourceSec / rateFactor : null;
  const style = styles.find((s) => s.id === settings.styleId);
  const voice = meta.voices.find((v) => v.id === settings.voice);
  const chosen = backgrounds.filter((b) => settings.backgroundIds.includes(b.id));

  // Warnings are shown but do not stop the job from being created.
  const problems: { step: number; text: string; warning?: boolean }[] = [];
  if (!hasSource) {
    problems.push({
      step: 0,
      text: mode === "file" ? "Chưa chọn file truyện"
        : mode === "topic" ? topicProblem(topic)!
        : probe.status === "loading" ? "Đang kiểm tra link…" : "Chưa có link video hợp lệ",
    });
  }
  if ((style?.prompt || mode === "topic") && !providerReady(meta, settings.aiProvider)) {
    const text = settings.aiProvider === "claude" ? "Claude Code chưa đăng nhập" : "Chưa có GEMINI_API_KEY";
    // A topic job cannot do anything without the AI; a rewrite job would at least fail at a clear step.
    problems.push(mode === "topic"
      ? { step: 1, text: `${text}, AI không thể viết truyện` }
      : { step: 1, text: `${text}, bước AI viết lại sẽ lỗi`, warning: true });
  }
  if (chosen.length === 0) problems.push({ step: 3, text: "Chưa chọn video nền" });
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

  const create = async (s: JobSettings) => {
    setUploading(0);
    try {
      const job = mode === "file" && file ? await api.createJob(file, title, s, setUploading)
        : mode === "topic" ? await api.createJobFromTopic({ ...topic, prompt: topic.prompt.trim() }, title, s)
        : await api.createJobFromUrl(probe.url, title, s);
      toast("success", "Đã tạo job, bắt đầu xử lý");
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      toast("error", errorMessage(err));
      setUploading(null);
    }
  };

  const submit = () => {
    if (hasSource && !blocking.length) void create(settings);
  };

  // Quick create: the saved defaults and the whole library, whatever the wizard has been set to.
  const quickSettings: JobSettings | null = defaults && { ...defaults, backgroundIds: backgrounds.map((b) => b.id) };
  const quickStyle = styles.find((s) => s.id === defaults?.styleId);
  const quickVoice = meta.voices.find((v) => v.id === defaults?.voice);
  const quickProblem = !defaults ? "Đang tải cài đặt mặc định…"
    : backgrounds.length === 0 ? "Chưa có video nền, hãy thêm ở Thư viện"
    : !quickVoice ? `Không có giọng ${defaults.voice.replace(/^olvroc:/, "")}`
    : (quickStyle?.prompt || mode === "topic") && !providerReady(meta, defaults.aiProvider) ? `${AI_PROVIDER_LABELS[defaults.aiProvider]} chưa sẵn sàng`
    : null;
  const quickSummary = defaults && [
    `${quickStyle?.name ?? "?"}${quickStyle?.prompt || mode === "topic" ? ` (${AI_PROVIDER_LABELS[defaults.aiProvider]} ${mode === "topic" ? "viết" : "viết lại"})` : ""}`,
    `giọng ${quickVoice?.name ?? defaults.voice.replace(/^olvroc:/, "")}`,
    `cả ${backgrounds.length} video nền`,
    formatPlan(defaults.formats).map((p) => VIDEO_FORMATS[p.format].label).join(" + "),
    defaults.subtitles ? "có phụ đề" : "",
  ].filter(Boolean).join(" · ");

  const { backgroundIds: _, ...current } = settings;
  const isDefault = defaults !== null && (Object.keys(defaults) as (keyof DefaultSettings)[])
    .every((k) => JSON.stringify(current[k]) === JSON.stringify(defaults[k]));
  const saveAsDefaults = async () => {
    setSavingDefaults(true);
    try {
      setDefaults(await api.saveDefaults(current));
      toast("success", "Đã lưu làm cài đặt mặc định");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSavingDefaults(false);
    }
  };

  const summary = [
    {
      step: 0, label: "Nguồn",
      value: mode === "file"
        ? file ? `${file.name}${media.duration ? ` · ${formatDuration(media.duration)}` : ""}` : "Chưa chọn"
        : mode === "topic"
        ? topic.prompt.trim() ? `AI viết ${topic.minMinutes}–${topic.maxMinutes} phút: ${topic.prompt.trim().slice(0, 80)}${topic.prompt.trim().length > 80 ? "…" : ""}` : "Chưa nhập chủ đề"
        : probe.info ? `${probe.info.platform}: ${probe.info.title}${probe.info.durationSec ? ` · ${formatDuration(probe.info.durationSec)}` : ""}` : "Chưa có link",
    },
    {
      step: 1, label: "Phong cách",
      value: `${style?.name ?? "?"}${style?.prompt || mode === "topic" ? ` · ${AI_PROVIDER_LABELS[settings.aiProvider]}` : ""}${settings.reviewBeforeTts ? " · có duyệt" : ""}`,
    },
    { step: 2, label: "Giọng đọc", value: `${voice?.name ?? settings.voice}${voice?.provider === "olvroc" ? " (OlvRoc)" : ""} · ${settings.rate}` },
    {
      step: 3, label: "Video nền",
      value: `${chosen.length === 0 ? "Chưa chọn" : `${chosen.length === backgrounds.length ? "Cả " : `${chosen.length}/`}${backgrounds.length} video, ghép ngẫu nhiên`}${settings.subtitles ? " · có phụ đề" : ""}`,
    },
    {
      step: 3, label: "Định dạng",
      value: formatPlan(settings.formats).map((p) => `${VIDEO_FORMATS[p.format].label}${p.whole ? " (1 video dài)" : ""}`).join(" + ") +
        (settings.formats.some((f) => f !== "original") ? ` · ${settings.fit === "blur" ? "nền mờ" : "cắt đầy khung"}` : ""),
    },
    {
      step: 3, label: "Mỗi video",
      value: `${settings.minPartSec / 60}–${settings.maxPartSec / 60} phút${speechSec ? ` · ≈ ${estimateParts(speechSec, settings.minPartSec, settings.maxPartSec)} video` : ""}${settings.fullVideo ? " · thêm bản đầy đủ" : ""}`,
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
              <p className="muted small">
                {mode === "topic"
                  ? "AI sẽ tự viết một truyện mới theo chủ đề bạn đưa ra, rồi đọc và dựng thành video."
                  : <>Giọng nói sẽ được nhận dạng thành chữ bằng Whisper ({meta.whisperModel}) chạy ngay trên máy bạn.</>}
              </p>
              <div className="seg-control source-mode">
                <button type="button" className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>
                  <b><Upload size={15} /> Tải file lên</b><span>video hoặc audio trên máy</span>
                </button>
                <button type="button" className={mode === "link" ? "on" : ""} onClick={() => setMode("link")}>
                  <b><Link2 size={15} /> Dán link video</b><span>YouTube, TikTok, Facebook…</span>
                </button>
                <button type="button" className={mode === "topic" ? "on" : ""} onClick={() => setMode("topic")}>
                  <b><PenLine size={15} /> AI tự viết truyện</b><span>theo chủ đề bạn đưa ra</span>
                </button>
              </div>
              {mode === "topic" ? (
                <TopicSource value={topic} set={setTopic} rate={settings.rate} />
              ) : mode === "link" ? (
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
                  placeholder={mode === "file" ? "Tự lấy theo tên file nếu bỏ trống"
                    : mode === "topic" ? "AI tự đặt tên truyện nếu bỏ trống"
                    : "Tự lấy theo tiêu đề video nếu bỏ trống"}
                />
              </label>
              <div className="quick-create">
                <Zap size={20} className="quick-icon" />
                <div className="spacer">
                  <b>Tạo nhanh với cài đặt mặc định</b>
                  <div className="small muted">{quickSummary ?? "…"}</div>
                  {quickProblem && hasSource && <div className="small warn-text">{quickProblem}</div>}
                </div>
                <button
                  className="primary" disabled={!hasSource || !!quickProblem || uploading !== null}
                  title={hasSource ? undefined : "Đưa nguồn truyện vào trước"}
                  onClick={() => quickSettings && void create(quickSettings)}
                >
                  {uploading !== null ? <><LoaderCircle size={16} className="spin" /> {Math.round(uploading * 100)}%</> : <><Zap size={16} /> Tạo nhanh</>}
                </button>
              </div>
            </section>
          )}

          {step === 1 && (
            <section>
              {mode === "topic" ? (
                <>
                  <h2>AI nên kể câu chuyện theo giọng văn nào?</h2>
                  <p className="muted small">Phong cách quyết định không khí và cách kể của truyện AI viết ra.</p>
                </>
              ) : (
                <>
                  <h2>Bạn muốn kể lại câu chuyện theo giọng văn nào?</h2>
                  <p className="muted small">AI giữ nguyên tình tiết và nhân vật, chỉ đổi cách kể. Chọn "Giữ nguyên văn" để không dùng AI.</p>
                </>
              )}
              <StylePicker value={settings} set={set} styles={styles} meta={meta} writing={mode === "topic"} />
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
              <SubtitleToggle value={settings} set={set} />
              <h3>Định dạng xuất</h3>
              <FormatPicker value={settings} set={set} />
              <h3>Độ dài mỗi video</h3>
              <PartLengthPicker value={settings} set={set} speechSec={speechSec} />
              <FullVideoToggle value={settings} set={set} />
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
              <div className="row defaults-row">
                <button onClick={saveAsDefaults} disabled={isDefault || savingDefaults}>
                  <Save size={15} /> {isDefault ? "Đang là cài đặt mặc định" : "Lưu làm cài đặt mặc định"}
                </button>
                <span className="small muted">Dùng cho nút Tạo nhanh và mỗi lần tạo video mới (trừ video nền: luôn chọn cả thư viện).</span>
              </div>
              {problems.map((p) => (
                <div key={p.text} className={`alert ${p.warning ? "warn" : "error"}`}>
                  <CircleAlert size={16} />
                  <span className="spacer">{p.text}</span>
                  <button className="link-btn small" onClick={() => goto(p.step)}>Sửa</button>
                </div>
              ))}
              <div className="info-box small">
                Quy trình: {mode === "topic"
                  ? `${AI_PROVIDER_LABELS[settings.aiProvider]} lập dàn ý và viết từng chương`
                  : <>tách audio → nhận dạng giọng nói → {style?.prompt ? `${AI_PROVIDER_LABELS[settings.aiProvider]} viết lại` : "giữ nguyên văn"}</>}
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
