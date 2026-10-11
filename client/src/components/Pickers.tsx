import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bot, Captions, Check, ClipboardCheck, Crop, Droplet, Film, FileText, LoaderCircle, Monitor, Pause, Play, Proportions, RotateCcw,
  Smartphone, Sparkles, TriangleAlert, User, UserRound, type LucideIcon,
} from "lucide-react";
import {
  api, backgroundUrl, voicePreviewUrl, type AiProvider, type Background, type FitMode, type JobSettings, type Meta, type Style,
  type VideoFormat, type Voice,
} from "../api";
import { VIDEO_FORMATS, formatDuration, stripExt } from "../format";
import { useLibrary } from "../useLibrary";
import { FileDrop } from "./FileDrop";
import { errorMessage, useToast } from "./Toast";

export const DEFAULT_SETTINGS: Omit<JobSettings, "styleId" | "backgroundId" | "aiProvider"> = {
  voice: "vi-VN-HoaiMyNeural",
  rate: "+0%",
  reviewBeforeTts: false,
  subtitles: true,
  fullVideo: true,
  format: "original",
  fit: "blur",
  minPartSec: 120,
  maxPartSec: 300,
};

type Set = (patch: Partial<JobSettings>) => void;

// ── AI provider ─────────────────────────────────────────────────────────────

export const providerReady = (meta: Meta, p: AiProvider) => (p === "claude" ? meta.system.claude.ok : meta.geminiConfigured);

/** Claude when signed in, otherwise Gemini if it has a key, otherwise Claude (with a sign-in hint). */
export function defaultProvider(meta: Meta): AiProvider {
  if (meta.system.claude.ok) return "claude";
  return meta.geminiConfigured ? "gemini" : "claude";
}

function ProviderFix({ meta, provider }: { meta: Meta; provider: AiProvider }) {
  if (providerReady(meta, provider)) return null;
  const c = meta.system.claude;
  return (
    <div className="alert warn">
      <TriangleAlert size={16} />
      {provider === "claude" ? (
        <div>
          {c.installed
            ? <>Claude Code chưa đăng nhập tài khoản Claude ({c.error}). Mở terminal, chạy <code>claude</code> và đăng nhập, rồi bấm ↻ ở mục Hệ thống.</>
            : <>Chưa cài Claude Code. Chạy <code>npm i -g @anthropic-ai/claude-code</code>, sau đó chạy <code>claude</code> để đăng nhập, rồi bấm ↻ ở mục Hệ thống.</>}
        </div>
      ) : (
        <div>
          Chưa có <code>GEMINI_API_KEY</code> trong <code>.env.local</code>. Lấy key miễn phí tại{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a> rồi khởi động lại server.
        </div>
      )}
    </div>
  );
}

export function ProviderPicker({ value, set, meta, label = "AI dùng để viết lại" }: {
  value: JobSettings; set: Set; meta: Meta; label?: string;
}) {
  const c = meta.system.claude;
  const options: { id: AiProvider; title: string; desc: string; status: string }[] = [
    {
      id: "claude", title: "Claude",
      desc: `Dùng gói Claude bạn đã đăng ký, qua Claude Code · model ${c.model}. Tính vào hạn mức của gói, không tốn thêm phí.`,
      status: c.ok ? `Đã đăng nhập${c.subscription ? ` · gói ${c.subscription}` : ""}` : c.installed ? "Chưa đăng nhập" : "Chưa cài Claude Code",
    },
    {
      id: "gemini", title: "Gemini",
      desc: `API miễn phí của Google AI Studio · model ${meta.geminiModel}.`,
      status: meta.geminiConfigured ? "Đã có API key" : "Thiếu API key",
    },
  ];
  return (
    <>
      <div className="field-label provider-label">{label}</div>
      <div className="choice-grid two">
        {options.map((o) => {
          const ready = providerReady(meta, o.id);
          return (
            <button
              type="button" key={o.id}
              className={`choice ${value.aiProvider === o.id ? "selected" : ""}`}
              onClick={() => set({ aiProvider: o.id })}
            >
              <div className="choice-head">
                <Bot size={16} />
                <b>{o.title}</b>
                {value.aiProvider === o.id && <Check size={16} className="choice-check" />}
              </div>
              <div className="choice-body">{o.desc}</div>
              <div className="choice-foot"><span className={`tag ${ready ? "ok" : "warn"}`}>{o.status}</span></div>
            </button>
          );
        })}
      </div>
      <ProviderFix meta={meta} provider={value.aiProvider} />
    </>
  );
}

// ── Style ───────────────────────────────────────────────────────────────────

/** `writing`: the AI writes the story from a topic, so every style uses AI and the verbatim one means "no set style". */
export function StylePicker({ value, set, styles, meta, writing = false }: {
  value: JobSettings; set: Set; styles: Style[]; meta: Meta; writing?: boolean;
}) {
  const selected = styles.find((s) => s.id === value.styleId);
  return (
    <>
      <div className="choice-grid">
        {styles.map((s) => {
          const ai = Boolean(s.prompt) || writing;
          return (
            <button
              type="button" key={s.id}
              className={`choice ${value.styleId === s.id ? "selected" : ""}`}
              onClick={() => set({ styleId: s.id })}
            >
              <div className="choice-head">
                {ai ? <Sparkles size={16} /> : <FileText size={16} />}
                <b>{s.name}</b>
                {value.styleId === s.id && <Check size={16} className="choice-check" />}
              </div>
              <div className="choice-body clamp-3">{s.prompt || (writing
                ? "Không đặt phong cách riêng: AI tự chọn giọng kể hợp với chủ đề."
                : "Không dùng AI: đọc lại đúng nội dung Whisper nhận dạng được.")}</div>
              <div className="choice-foot">
                {ai ? <span className="tag accent">{writing ? "AI viết" : "AI viết lại"}</span> : <span className="tag">Không dùng AI</span>}
              </div>
            </button>
          );
        })}
      </div>
      <div className="small muted">
        Muốn thêm giọng văn riêng? <Link to="/library#styles">Quản lý phong cách</Link>
      </div>
      {(selected?.prompt || writing) && (
        <ProviderPicker value={value} set={set} meta={meta} label={writing ? "AI dùng để viết truyện" : undefined} />
      )}
    </>
  );
}

export function ReviewToggle({ value, set }: { value: JobSettings; set: Set }) {
  return (
    <label className={`switch-card ${value.reviewBeforeTts ? "on" : ""}`}>
      <ClipboardCheck size={20} />
      <span className="spacer">
        <b>Dừng lại để tôi duyệt kịch bản</b>
        <span className="small muted block">Đọc và sửa bản viết lại trước khi tạo giọng đọc và video.</span>
      </span>
      <input type="checkbox" className="switch" checked={value.reviewBeforeTts} onChange={(e) => set({ reviewBeforeTts: e.target.checked })} />
    </label>
  );
}

// ── Voice ───────────────────────────────────────────────────────────────────

/** Vbee names look like "HN - Ngọc Huyền": split off the accent region. */
function splitVoiceName(name: string): { name: string; region: string | null } {
  const m = /^(HN|SG|HUE|Huế|DN)\s*-\s*(.+)$/i.exec(name);
  if (!m) return { name, region: null };
  const region = { HN: "Giọng Bắc", SG: "Giọng Nam", HUE: "Giọng Huế", "HUẾ": "Giọng Huế", DN: "Giọng Trung" }[m[1].toUpperCase()] ?? m[1];
  return { name: m[2], region };
}

type GenderFilter = "all" | "female" | "male";

/** "hn_female_ngochuyen_full_48k-fhg" → "48 kHz"; tells apart Vbee voices sharing a name. */
const sampleRate = (id: string) => {
  const m = /_(\d{2})k[-_]/.exec(id);
  return m ? `${m[1]} kHz` : null;
};

/** A Vbee voice when Vbee is connected (Ngọc Huyền if available), else the default Edge voice. */
export function defaultVoice(meta: Meta): string {
  const vbee = meta.voices.filter((v) => v.provider === "vbee");
  if (!meta.system.vbee.ok || vbee.length === 0) return DEFAULT_SETTINGS.voice;
  return (vbee.find((v) => v.id.includes("ngochuyen")) ?? vbee.find((v) => v.gender === "female") ?? vbee[0]).id;
}

export function VoicePicker({ value, set, meta, speechSec }: { value: JobSettings; set: Set; meta: Meta; speechSec?: number | null }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<{ voice: string; loading: boolean } | null>(null);
  const [gender, setGender] = useState<GenderFilter>("all");
  const toast = useToast();
  const rateNum = parseInt(value.rate, 10) || 0;
  const vbeeVoices = meta.voices.filter((v) => v.provider === "vbee");
  const edgeVoices = meta.voices.filter((v) => v.provider === "edge");
  const vbee = meta.system.vbee;

  useEffect(() => () => audio.current?.pause(), []);

  const preview = (v: Voice) => {
    audio.current?.pause();
    if (playing?.voice === v.id) return setPlaying(null);
    // Vbee: the provider's own demo clip (free). Edge: synthesized by our server at the chosen speed.
    const url = v.provider === "vbee" ? v.demoUrl : voicePreviewUrl(v.id, value.rate);
    if (!url) return toast("error", "Giọng này không có mẫu nghe thử");
    const el = new Audio(url);
    audio.current = el;
    setPlaying({ voice: v.id, loading: true });
    el.onplaying = () => setPlaying({ voice: v.id, loading: false });
    el.onended = () => setPlaying(null);
    el.onerror = async () => {
      setPlaying(null);
      if (v.provider === "vbee") return toast("error", "Không phát được mẫu giọng của Vbee");
      // The <audio> element hides the server's message, so fetch it for the toast.
      const res = await fetch(url).catch(() => null);
      const data = res ? await res.json().catch(() => null) : null;
      toast("error", data?.error ?? "Không phát được giọng thử");
    };
    void el.play().catch(() => {});
  };

  const card = (v: Voice) => {
    const { name, region } = splitVoiceName(v.name);
    const isPlaying = playing?.voice === v.id;
    const genderText = v.gender === "male" ? "Nam" : v.gender === "female" ? "Nữ" : null;
    return (
      <div
        key={v.id} className={`choice voice ${value.voice === v.id ? "selected" : ""}`}
        role="radio" aria-checked={value.voice === v.id} tabIndex={0}
        onClick={() => set({ voice: v.id })}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && set({ voice: v.id })}
      >
        <span className="avatar">{v.gender === "male" ? <User size={22} /> : <UserRound size={22} />}</span>
        <span className="spacer">
          <b>{name}</b>
          <span className="small muted block">
            {[genderText, region, sampleRate(v.id)].filter(Boolean).join(" · ") || "Tiếng Việt"}
            {v.creditFactor && v.creditFactor > 1 && <span className="tag warn credit">×{v.creditFactor} credit</span>}
          </span>
        </span>
        <button
          type="button" className="round-btn" aria-label={`Nghe thử giọng ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            preview(v);
          }}
        >
          {isPlaying && playing.loading ? <LoaderCircle size={16} className="spin" /> : isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
      </div>
    );
  };

  const shownVbee = vbeeVoices.filter((v) => gender === "all" || v.gender === gender);

  return (
    <>
      <div className="voice-group-head">
        <b>Vbee</b>
        <span className="small muted">
          {vbee.ok ? `${vbeeVoices.length} giọng · tính phí theo ký tự · nghe thử bằng mẫu của Vbee` : "Giọng đọc tiếng Việt trả phí"}
        </span>
        {vbee.ok && vbeeVoices.length > 6 && (
          <div className="chips">
            {(["all", "female", "male"] as const).map((g) => (
              <button key={g} type="button" className={`chip ${gender === g ? "on" : ""}`} onClick={() => setGender(g)}>
                {{ all: "Tất cả", female: "Nữ", male: "Nam" }[g]}
              </button>
            ))}
          </div>
        )}
      </div>
      {vbee.ok ? (
        <div className="choice-grid two voice-scroll">{shownVbee.map(card)}</div>
      ) : (
        <div className="alert warn">
          <TriangleAlert size={16} />
          <div>
            {vbee.configured
              ? <>Không kết nối được Vbee: {vbee.error}</>
              : <>{vbee.error}. Lấy App ID và Token trong Vbee Studio, điền vào <code>.env.local</code> rồi khởi động lại server.</>}
          </div>
        </div>
      )}

      <div className="voice-group-head">
        <b>Microsoft Edge</b>
        <span className="small muted">Miễn phí · nghe thử theo tốc độ đang chọn</span>
      </div>
      <div className="choice-grid two">{edgeVoices.map(card)}</div>

      <div className="field">
        <div className="field-label">
          Tốc độ đọc <b className="accent-text">{rateNum > 0 ? "+" : ""}{rateNum}%</b>
          {rateNum !== 0 && (
            <button type="button" className="link-btn small" onClick={() => set({ rate: "+0%" })}><RotateCcw size={12} /> Mặc định</button>
          )}
        </div>
        <input
          type="range" min={-30} max={30} step={5} value={rateNum} className="range"
          onChange={(e) => {
            const n = Number(e.target.value);
            set({ rate: `${n >= 0 ? "+" : ""}${n}%` });
          }}
        />
        <div className="range-labels small muted"><span>Chậm rãi</span><span>Bình thường</span><span>Nhanh</span></div>
        {speechSec ? <div className="small muted">Ước tính giọng đọc dài khoảng <b>{formatDuration(speechSec)}</b>.</div> : null}
      </div>
    </>
  );
}

// ── Background ──────────────────────────────────────────────────────────────

function BackgroundTile({ bg, selected, onSelect }: { bg: Background; selected: boolean; onSelect: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  return (
    <button
      type="button" className={`bg-tile ${selected ? "selected" : ""}`} onClick={onSelect}
      onMouseEnter={() => void video.current?.play().catch(() => {})}
      onMouseLeave={() => video.current?.pause()}
    >
      <video ref={video} src={`${backgroundUrl(bg.file)}#t=0.5`} muted loop playsInline preload="metadata" />
      <span className="bg-duration">{formatDuration(bg.durationSec)}</span>
      {selected && <span className="bg-check"><Check size={16} strokeWidth={3} /></span>}
      <span className="bg-name">{bg.name}</span>
    </button>
  );
}

export function BackgroundPicker({ value, set }: { value: JobSettings; set: Set }) {
  const { backgrounds, reload } = useLibrary();
  const [uploading, setUploading] = useState<number | null>(null);
  const toast = useToast();

  const upload = async (file: File) => {
    setUploading(0);
    try {
      const bg = await api.uploadBackground(file, stripExt(file.name), setUploading);
      await reload();
      set({ backgroundId: bg.id });
      toast("success", `Đã thêm video nền "${bg.name}"`);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setUploading(null);
    }
  };

  return (
    <>
      <div className="bg-grid">
        {backgrounds.map((b) => (
          <BackgroundTile key={b.id} bg={b} selected={value.backgroundId === b.id} onSelect={() => set({ backgroundId: b.id })} />
        ))}
        {uploading !== null ? (
          <div className="dropzone compact disabled">
            <LoaderCircle size={22} className="spin drop-icon" />
            <div className="drop-title">Đang tải lên {Math.round(uploading * 100)}%</div>
            <div className="progress"><div style={{ width: `${uploading * 100}%` }} /></div>
          </div>
        ) : (
          <FileDrop
            compact accept="video/*,.mkv" onFile={upload}
            title={backgrounds.length ? "Thêm video nền" : "Tải video nền đầu tiên"}
            hint="mp4, mov, mkv, webm"
          />
        )}
      </div>
      <div className="small muted">Video nền tự lặp lại cho đủ độ dài giọng đọc, âm thanh gốc của video nền được tắt.</div>
    </>
  );
}

export function SubtitleToggle({ value, set }: { value: JobSettings; set: Set }) {
  return (
    <label className={`switch-card ${value.subtitles ? "on" : ""}`}>
      <Captions size={20} />
      <span className="spacer">
        <b>Chèn phụ đề vào video</b>
        <span className="small muted block">Lời đọc hiện thành chữ ở cuối khung hình, chạy theo giọng đọc.</span>
      </span>
      <input type="checkbox" className="switch" checked={value.subtitles} onChange={(e) => set({ subtitles: e.target.checked })} />
    </label>
  );
}

export function FullVideoToggle({ value, set }: { value: JobSettings; set: Set }) {
  return (
    <label className={`switch-card ${value.fullVideo ? "on" : ""}`}>
      <Film size={20} />
      <span className="spacer">
        <b>Thêm một video đầy đủ không cắt</b>
        <span className="small muted block">Ngoài các phần đã chia, có thêm một video cả truyện ở cuối danh sách. Chỉ tạo khi có từ hai phần trở lên.</span>
      </span>
      <input type="checkbox" className="switch" checked={value.fullVideo} onChange={(e) => set({ fullVideo: e.target.checked })} />
    </label>
  );
}

// ── Output format ───────────────────────────────────────────────────────────

const FORMAT_ICONS: Record<VideoFormat, LucideIcon> = { tiktok: Smartphone, youtube: Monitor, original: Proportions };
const FIT_OPTIONS: { id: FitMode; label: string; desc: string; icon: LucideIcon }[] = [
  { id: "blur", label: "Nền mờ", desc: "giữ trọn video nền, lấp chỗ trống bằng nền mờ", icon: Droplet },
  { id: "crop", label: "Cắt cho đầy khung", desc: "phóng to, cắt bớt phần thừa", icon: Crop },
];

/** What the chosen background will look like in the output frame, built with CSS from the same clip. */
function FramePreview({ src, format, fit }: { src: string; format: VideoFormat; fit: FitMode }) {
  const size = VIDEO_FORMATS[format].size!;
  return (
    <div className={`frame-preview ${size.height > size.width ? "tall" : "wide"}`} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
      {fit === "blur" && <video className="fp-blur" src={src} muted loop autoPlay playsInline aria-hidden />}
      <video className={fit === "blur" ? "fp-fit" : "fp-cover"} src={src} muted loop autoPlay playsInline aria-hidden />
      <span className="fp-sub">Phụ đề nằm ở đây</span>
    </div>
  );
}

export function FormatPicker({ value, set }: { value: JobSettings; set: Set }) {
  const { backgrounds } = useLibrary();
  const bg = backgrounds.find((b) => b.id === value.backgroundId);
  return (
    <>
      <div className="choice-grid">
        {(["tiktok", "youtube", "original"] as const).map((f) => {
          const Icon = FORMAT_ICONS[f];
          return (
            <button type="button" key={f} className={`choice ${value.format === f ? "selected" : ""}`} onClick={() => set({ format: f })}>
              <div className="choice-head">
                <Icon size={16} />
                <b>{VIDEO_FORMATS[f].label}</b>
                {value.format === f && <Check size={16} className="choice-check" />}
              </div>
              <div className="choice-body">{VIDEO_FORMATS[f].desc}</div>
            </button>
          );
        })}
      </div>
      {value.format !== "original" && (
        <div className="fit-row">
          <div className="spacer">
            <div className="field-label">Khi video nền khác khung hình</div>
            <div className="seg-control fit-control">
              {FIT_OPTIONS.map((o) => (
                <button type="button" key={o.id} className={value.fit === o.id ? "on" : ""} onClick={() => set({ fit: o.id })}>
                  <b><o.icon size={14} /> {o.label}</b><span>{o.desc}</span>
                </button>
              ))}
            </div>
          </div>
          {bg && <FramePreview key={bg.id} src={backgroundUrl(bg.file)} format={value.format} fit={value.fit} />}
        </div>
      )}
    </>
  );
}

// ── Part length ─────────────────────────────────────────────────────────────

const PRESETS = [
  { label: "Ngắn", desc: "1–2 phút", min: 60, max: 120 },
  { label: "Vừa", desc: "2–5 phút", min: 120, max: 300 },
  { label: "Dài", desc: "5–10 phút", min: 300, max: 600 },
  { label: "Rất dài", desc: "10–20 phút", min: 600, max: 1200 },
];

export function estimateParts(speechSec: number, minSec: number, maxSec: number): number {
  if (speechSec <= maxSec) return 1;
  return Math.max(1, Math.round(speechSec / ((minSec + maxSec) / 2)));
}

export function PartLengthPicker({ value, set, speechSec }: { value: JobSettings; set: Set; speechSec?: number | null }) {
  const preset = PRESETS.find((p) => p.min === value.minPartSec && p.max === value.maxPartSec);
  const [custom, setCustom] = useState(!preset);
  const invalid = value.maxPartSec <= value.minPartSec;

  return (
    <>
      <div className="seg-control">
        {PRESETS.map((p) => (
          <button
            type="button" key={p.label}
            className={!custom && preset === p ? "on" : ""}
            onClick={() => {
              setCustom(false);
              set({ minPartSec: p.min, maxPartSec: p.max });
            }}
          >
            <b>{p.label}</b><span>{p.desc}</span>
          </button>
        ))}
        <button type="button" className={custom ? "on" : ""} onClick={() => setCustom(true)}>
          <b>Tuỳ chỉnh</b><span>{custom ? `${value.minPartSec / 60}–${value.maxPartSec / 60} phút` : "tự nhập"}</span>
        </button>
      </div>
      {custom && (
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Tối thiểu (phút)</span>
            <input
              type="number" min={0.5} max={60} step={0.5} value={value.minPartSec / 60}
              onChange={(e) => set({ minPartSec: Math.round(Number(e.target.value) * 60) })}
            />
          </label>
          <label className="field">
            <span className="field-label">Tối đa (phút)</span>
            <input
              type="number" min={1} max={60} step={0.5} value={value.maxPartSec / 60}
              onChange={(e) => set({ maxPartSec: Math.round(Number(e.target.value) * 60) })}
            />
          </label>
        </div>
      )}
      {invalid && <div className="alert error"><TriangleAlert size={16} />Độ dài tối đa phải lớn hơn tối thiểu.</div>}
      {speechSec && !invalid ? (
        <div className="small muted">
          Với giọng đọc khoảng {formatDuration(speechSec)}, sẽ ra khoảng <b>{estimateParts(speechSec, value.minPartSec, value.maxPartSec)} video</b>.
          Video chỉ được cắt giữa các câu.
        </div>
      ) : (
        <div className="small muted">Truyện được chia thành nhiều video, chỉ cắt giữa các câu.</div>
      )}
    </>
  );
}
