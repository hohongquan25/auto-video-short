import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { FileText, LoaderCircle, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { api, backgroundUrl, type Background, type Style } from "../api";
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
          <p className="muted">Video nền và phong cách viết lại dùng chung cho mọi video.</p>
        </div>
      </div>
      <BackgroundsSection />
      <StylesSection />
    </>
  );
}
