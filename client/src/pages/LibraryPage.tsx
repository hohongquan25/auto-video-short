import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import { BadgeCheck, Bell, BellRing, FileText, Headphones, LoaderCircle, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { api, backgroundUrl, type Background, type Brand, type Style } from "../api";
import { FileDrop } from "../components/FileDrop";
import { errorMessage, useToast } from "../components/Toast";
import { formatDuration, stripExt } from "../format";
import { useLibrary } from "../useLibrary";

function BackgroundCard({ bg, onDelete }: { bg: Background; onDelete: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  return (
    <div
      className="bg-card"
      onMouseEnter={() => void video.current?.play().catch(() => {})}
      onMouseLeave={() => video.current?.pause()}
    >
      <div className="bg-tile static">
        <video ref={video} src={`${backgroundUrl(bg.file)}#t=0.5`} muted loop playsInline preload="metadata" />
        <span className="bg-duration">{formatDuration(bg.durationSec)}</span>
      </div>
      <div className="bg-card-foot">
        <b className="clamp-1 spacer" title={bg.name}>{bg.name}</b>
        <button className="icon-btn danger" title="Xoá" aria-label={`Xoá video nền ${bg.name}`} onClick={onDelete}><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

function BackgroundsSection() {
  const { backgrounds, reload } = useLibrary();
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const toast = useToast();

  const upload = async (file: File) => {
    const name = stripExt(file.name);
    setUploading({ name, progress: 0 });
    try {
      await api.uploadBackground(file, name, (progress) => setUploading({ name, progress }));
      await reload();
      toast("success", `Đã thêm video nền "${name}"`);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setUploading(null);
    }
  };

  return (
    <section className="card" id="backgrounds">
      <div className="section-head">
        <div>
          <h2>Video nền</h2>
          <p className="small muted">Video được lặp lại phía sau giọng đọc. Nên dùng video ngang, không có chữ, dài 30 giây trở lên.</p>
        </div>
      </div>
      <div className="bg-grid">
        {backgrounds.map((b) => (
          <BackgroundCard
            key={b.id} bg={b}
            onDelete={() => {
              if (!confirm(`Xoá video nền "${b.name}"?`)) return;
              api.deleteBackground(b.id).then(() => reload()).then(() => toast("success", "Đã xoá video nền"))
                .catch((e) => toast("error", errorMessage(e)));
            }}
          />
        ))}
        {uploading ? (
          <div className="dropzone compact disabled">
            <LoaderCircle size={22} className="spin drop-icon" />
            <div className="drop-title clamp-1">{uploading.name}</div>
            <div className="progress"><div style={{ width: `${uploading.progress * 100}%` }} /></div>
            <div className="drop-hint">{Math.round(uploading.progress * 100)}%</div>
          </div>
        ) : (
          <FileDrop compact accept="video/*,.mkv" onFile={upload} title="Thêm video nền" hint="Kéo thả hoặc bấm để chọn" />
        )}
      </div>
    </section>
  );
}

function StyleEditor({ style, onSaved, onCancel }: { style: Style | null; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(style?.name ?? "");
  const [prompt, setPrompt] = useState(style?.prompt ?? "");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const save = async () => {
    setSaving(true);
    try {
      if (style) await api.updateStyle(style.id, name, prompt);
      else await api.createStyle(name, prompt);
      toast("success", style ? "Đã lưu phong cách" : "Đã thêm phong cách");
      onSaved();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="style-editor">
      <label className="field">
        <span className="field-label">Tên phong cách</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Bà kể chuyện miền Tây" autoFocus />
      </label>
      <label className="field">
        <span className="field-label">Mô tả giọng văn cho AI</span>
        <textarea
          rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ví dụ: Kể theo giọng một bà cụ ở quê, chậm rãi, nhiều từ địa phương miền Tây… (để trống = không viết lại)"
        />
        <span className="small muted">Chỉ cần mô tả giọng văn. Quy tắc giữ nguyên nội dung, viết số bằng chữ… đã được thêm tự động.</span>
      </label>
      <div className="row">
        <button className="primary" disabled={!name.trim() || saving} onClick={save}>Lưu</button>
        <button onClick={onCancel}>Huỷ</button>
      </div>
    </div>
  );
}

function StylesSection() {
  const { styles, reload } = useLibrary();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const toast = useToast();

  const done = () => {
    setEditing(null);
    void reload();
  };

  return (
    <section className="card" id="styles">
      <div className="section-head">
        <div>
          <h2>Phong cách viết lại</h2>
          <p className="small muted">Mô tả giọng văn để AI (Claude hoặc Gemini) kể lại câu chuyện. Nội dung và tình tiết luôn được giữ nguyên.</p>
        </div>
        {editing === null && <button onClick={() => setEditing("new")}><Plus size={15} /> Thêm phong cách</button>}
      </div>
      {editing === "new" && <StyleEditor style={null} onSaved={done} onCancel={() => setEditing(null)} />}
      <div className="style-list">
        {styles.map((s) =>
          editing === s.id ? (
            <StyleEditor key={s.id} style={s} onSaved={done} onCancel={() => setEditing(null)} />
          ) : (
            <div className="style-item" key={s.id}>
              <span className={`style-icon ${s.prompt ? "ai" : ""}`}>{s.prompt ? <Sparkles size={16} /> : <FileText size={16} />}</span>
              <div className="spacer">
                <b>{s.name}</b>
                <div className="small muted clamp-2">{s.prompt || "Không dùng AI, giữ nguyên văn bản nhận dạng."}</div>
              </div>
              <button className="icon-btn" title="Sửa" aria-label={`Sửa ${s.name}`} onClick={() => setEditing(s.id)}><Pencil size={15} /></button>
              <button
                className="icon-btn danger" title="Xoá" aria-label={`Xoá ${s.name}`}
                onClick={() => {
                  if (!confirm(`Xoá phong cách "${s.name}"?`)) return;
                  api.deleteStyle(s.id).then(() => reload()).then(() => toast("success", "Đã xoá phong cách"))
                    .catch((e) => toast("error", errorMessage(e)));
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

const BRAND_COLORS = [
  { name: "Vàng hổ phách", hex: "#FFB020" },
  { name: "Cam san hô", hex: "#FF6B4A" },
  { name: "Hồng", hex: "#FF5C9A" },
  { name: "Xanh ngọc", hex: "#19C3B1" },
  { name: "Xanh dương", hex: "#3D9BFF" },
];

/** CSS copy of the badge drawn into the video (server/lib/badge.ts). */
function BrandBadge({ text, color }: { text: string; color: string }) {
  const words = text.split(/\s+/);
  return (
    <span className="brand-badge" style={{ "--brand": color } as CSSProperties}>
      <span className="bb-icon"><Headphones size={9} strokeWidth={3} /></span>
      <span className="bb-text">
        {words.length > 1 ? <>{words.slice(0, -1).join(" ")} <span className="bb-accent">{words[words.length - 1]}</span></> : text}
      </span>
    </span>
  );
}

function BrandSection() {
  const toast = useToast();
  const [saved, setSaved] = useState<Brand | null>(null);
  const [draft, setDraft] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.brand().then((b) => {
      setSaved(b);
      setDraft(b);
    }).catch((e) => toast("error", errorMessage(e)));
  }, [toast]);

  if (!draft || !saved) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<Brand>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    setBusy(true);
    try {
      const b = await api.saveBrand({ ...draft, text: draft.text.trim() });
      setSaved(b);
      setDraft(b);
      toast("success", "Đã lưu, áp dụng cho các video dựng từ giờ");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" id="brand">
      <div className="section-head">
        <div>
          <h2>Nhận diện kênh trên video</h2>
          <p className="small muted">
            Tên kênh và hiệu ứng đăng ký được thêm vào mọi video khi dựng, đúng vị trí cho cả khung TikTok lẫn YouTube. Video nền trong thư viện không bị thay đổi.
          </p>
        </div>
      </div>
      <div className="brand-row">
        <div className="spacer">
          <label className={`switch-card ${draft.enabled ? "on" : ""}`}>
            <BadgeCheck size={20} />
            <span className="spacer">
              <b>Hiện tên kênh trên video</b>
              <span className="small muted block">Áp dụng cho các video dựng từ giờ trở đi.</span>
            </span>
            <input type="checkbox" className="switch" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          </label>
          <label className="field">
            <span className="field-label">Tên kênh</span>
            <input type="text" value={draft.text} maxLength={60} placeholder="Ví dụ: Gác trọ Audio" onChange={(e) => set({ text: e.target.value })} />
          </label>
          <div className="field-label">Vị trí</div>
          <div className="seg-control">
            <button type="button" className={draft.position === "top-left" ? "on" : ""} onClick={() => set({ position: "top-left" })}>
              <b>Góc trên trái</b>
            </button>
            <button type="button" className={draft.position === "top-right" ? "on" : ""} onClick={() => set({ position: "top-right" })}>
              <b>Góc trên phải</b>
            </button>
          </div>
          <div className="field-label">Màu nhấn</div>
          <div className="swatches">
            {BRAND_COLORS.map((c) => (
              <button
                type="button" key={c.hex} title={c.name} aria-label={c.name} aria-pressed={draft.color === c.hex}
                className={`swatch ${draft.color === c.hex ? "on" : ""}`} style={{ background: c.hex }}
                onClick={() => set({ color: c.hex })}
              />
            ))}
          </div>
          <label className={`switch-card ${draft.subscribe ? "on" : ""}`}>
            <BellRing size={20} />
            <span className="spacer">
              <b>Hiệu ứng đăng ký và chuông thông báo</b>
              <span className="small muted block">
                Nút bật lên, con trỏ bấm "Đăng ký" rồi bấm chuông cho chuông rung (khoảng 5 giây). Video dọc ghi "Theo dõi" như TikTok.
              </span>
            </span>
            <input type="checkbox" className="switch" checked={draft.subscribe} onChange={(e) => set({ subscribe: e.target.checked })} />
          </label>
          {draft.subscribe && (
            <>
              <div className="field-label">Hiện vào lúc nào trong mỗi video</div>
              <div className="seg-control">
                {([["start", "Đầu video", "sau 2,5 giây"], ["end", "Cuối video", "6 giây trước khi hết"], ["both", "Cả hai", "đầu và cuối"]] as const).map(([id, label, hint]) => (
                  <button type="button" key={id} className={draft.subscribeAt === id ? "on" : ""} onClick={() => set({ subscribeAt: id })}>
                    <b>{label}</b><span>{hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="row">
            <button className="primary" disabled={busy || !dirty || (draft.enabled && !draft.text.trim())} onClick={save}>Lưu</button>
            {dirty && <button disabled={busy} onClick={() => setDraft(saved)}>Hoàn tác</button>}
          </div>
        </div>
        <div className={`brand-preview ${draft.position}`} aria-hidden>
          {draft.enabled && draft.text.trim() && <BrandBadge text={draft.text.trim()} color={draft.color} />}
          {draft.subscribe && (
            <span className="cta-mock">
              <span className="cta-btn">THEO DÕI</span>
              <span className="cta-bell" style={{ color: draft.color }}><Bell size={13} fill="currentColor" /></span>
            </span>
          )}
        </div>
      </div>
      <div className="small muted">Job đã xong muốn có tên kênh hay hiệu ứng thì vào tab Cài đặt của job, chọn chạy lại từ bước "Dựng video" (giọng đọc được dùng lại).</div>
    </section>
  );
}

export function LibraryPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [hash]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Thư viện</h1>
          <p className="muted">Tên kênh, video nền và phong cách viết lại dùng chung cho mọi video.</p>
        </div>
      </div>
      <BrandSection />
      <BackgroundsSection />
      <StylesSection />
    </>
  );
}
