import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, CircleAlert, Minus, RefreshCw } from "lucide-react";
import { useLibrary } from "../useLibrary";

interface Item {
  key: string;
  label: string;
  ok: boolean;
  /** Optional components show as "not set" instead of an error. */
  optional?: boolean;
  detail: string;
  fix?: string;
}

export function useSystemItems(): Item[] | null {
  const { meta } = useLibrary();
  if (!meta) return null;
  const s = meta.system;
  return [
    {
      key: "ffmpeg", label: "FFmpeg", ok: s.ffmpeg.ok,
      detail: s.ffmpeg.ok ? `Phiên bản ${s.ffmpeg.version}` : "Không tìm thấy ffmpeg",
      fix: "Cài ffmpeg (winget install Gyan.FFmpeg) hoặc đặt FFMPEG_PATH trong .env.local",
    },
    {
      key: "whisper", label: `Whisper (${meta.whisperModel})`, ok: s.whisper.ok,
      detail: s.whisper.ok ? "faster-whisper sẵn sàng" : s.whisper.error ?? "Chưa cài faster-whisper",
      fix: "Chạy: pnpm setup:whisper",
    },
    {
      key: "ytdlp", label: "Tải từ link (yt-dlp)", ok: s.ytdlp.ok, optional: true,
      detail: s.ytdlp.ok
        ? `Phiên bản ${s.ytdlp.version}${s.ytdlp.cookies ? ` · cookie từ ${s.ytdlp.cookies}` : " · chưa có cookie (YouTube có thể chặn)"}`
        : "Chưa cài yt-dlp",
      fix: "Chạy: pnpm setup:whisper",
    },
    {
      key: "claude", label: "Claude", ok: s.claude.ok, optional: true,
      detail: s.claude.ok
        ? `Đã đăng nhập${s.claude.subscription ? ` (gói ${s.claude.subscription})` : ""} · Claude Code ${s.claude.version} · model ${s.claude.model}`
        : s.claude.error ?? "Chưa sẵn sàng",
      fix: s.claude.installed
        ? "Mở terminal, chạy: claude, rồi đăng nhập tài khoản Claude"
        : "Cài: npm i -g @anthropic-ai/claude-code, rồi chạy: claude để đăng nhập",
    },
    {
      key: "olvroc", label: "OlvRoc", ok: s.olvroc.ok, optional: true,
      detail: s.olvroc.ok ? `${s.olvroc.voices} giọng tiếng Việt miễn phí` : s.olvroc.error ?? "Chưa cài",
      fix: "Chạy: pnpm setup:whisper (thư viện) và pnpm setup:olvroc (model ~520 MB)",
    },
    {
      key: "gemini", label: "Gemini", ok: s.gemini.ok, optional: true,
      detail: s.gemini.ok ? s.gemini.model : "Chưa có API key",
      fix: "Thêm GEMINI_API_KEY vào .env.local rồi khởi động lại server",
    },
  ];
}

/** Compact status list for the sidebar. */
export function SystemStatusPanel() {
  const items = useSystemItems();
  const { reload } = useLibrary();
  const [checking, setChecking] = useState(false);
  if (!items) return null;

  return (
    <div className="sys-panel">
      <div className="sys-head">
        <span>Hệ thống</span>
        <button
          className="icon-btn" title="Kiểm tra lại" aria-label="Kiểm tra lại hệ thống" disabled={checking}
          onClick={async () => {
            setChecking(true);
            await reload({ recheck: true });
            setChecking(false);
          }}
        >
          <RefreshCw size={13} className={checking ? "spin" : ""} />
        </button>
      </div>
      {items.map((it) => (
        <div key={it.key} className="sys-row" title={it.ok ? it.detail : `${it.detail}\n→ ${it.fix}`}>
          <span className={`dot ${it.ok ? "ok" : it.optional ? "off" : "bad"}`} />
          <span className="sys-label">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

/** First-run checklist shown on the home page until everything needed is in place. */
export function SetupGuide({ hasJobs }: { hasJobs: boolean }) {
  const items = useSystemItems();
  const { backgrounds } = useLibrary();
  if (!items) return null;

  const steps = [
    ...items.map((it) => ({
      key: it.key, ok: it.ok, optional: it.optional,
      title: it.ok ? `${it.label} đã sẵn sàng` : it.optional ? `${it.label}: chưa cấu hình (không bắt buộc)` : `${it.label}: chưa sẵn sàng`,
      desc: it.ok ? it.detail : `${it.detail}. ${it.fix}`,
      action: null as ReactNode,
    })),
    {
      key: "bg", ok: backgrounds.length > 0, optional: false,
      title: backgrounds.length ? `Đã có ${backgrounds.length} video nền` : "Thêm ít nhất một video nền",
      desc: "Video nền được lặp lại phía sau giọng đọc.",
      action: backgrounds.length ? null : <Link className="btn small" to="/library">Thêm video nền</Link>,
    },
  ];
  const blocking = steps.filter((s) => !s.ok && !s.optional);
  if (blocking.length === 0 && hasJobs) return null;

  return (
    <div className="card setup">
      <h2>{blocking.length ? "Chuẩn bị trước khi bắt đầu" : "Mọi thứ đã sẵn sàng 🎉"}</h2>
      <ul className="checklist">
        {steps.map((s) => (
          <li key={s.key} className={s.ok ? "ok" : s.optional ? "optional" : "todo"}>
            <span className="check-icon">{s.ok ? <Check size={14} strokeWidth={3} /> : s.optional ? <Minus size={14} /> : <CircleAlert size={14} />}</span>
            <span className="spacer">
              <b>{s.title}</b>
              <span className="small muted block">{s.desc}</span>
            </span>
            {s.action}
          </li>
        ))}
      </ul>
      {blocking.length === 0 && <Link className="btn primary" to="/new">Tạo video đầu tiên</Link>}
    </div>
  );
}
