import { useEffect, useState } from "react";
import { CircleAlert, Link2, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { api, type SourceInfo } from "../api";
import { formatDuration } from "../format";
import { errorMessage } from "./Toast";

export interface LinkProbe {
  status: "idle" | "loading" | "ok" | "error";
  url: string;
  info: SourceInfo | null;
  error: string | null;
}

const looksLikeUrl = (s: string) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s);

/** Look up a pasted link (title, length, platform) shortly after the user stops typing. */
export function useLinkProbe(link: string): LinkProbe {
  const [state, setState] = useState<LinkProbe>({ status: "idle", url: "", info: null, error: null });
  useEffect(() => {
    const url = link.trim();
    if (!looksLikeUrl(url)) return setState({ status: "idle", url, info: null, error: null });
    let cancelled = false;
    setState({ status: "loading", url, info: null, error: null });
    const timer = setTimeout(() => {
      api.probeSource(url)
        .then((info) => !cancelled && setState({ status: "ok", url, info, error: null }))
        .catch((err) => !cancelled && setState({ status: "error", url, info: null, error: errorMessage(err) }));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [link]);
  return state;
}

export function LinkSource({ link, setLink, probe, ytdlpOk }: {
  link: string; setLink: (s: string) => void; probe: LinkProbe; ytdlpOk: boolean;
}) {
  const info = probe.info;
  return (
    <>
      {!ytdlpOk && (
        <div className="alert warn">
          <TriangleAlert size={16} />
          <div>Chưa cài yt-dlp nên chưa tải được từ link. Chạy <code>pnpm setup:whisper</code> rồi khởi động lại server.</div>
        </div>
      )}
      <label className="link-input">
        <Link2 size={17} />
        <input
          type="url" value={link} autoFocus
          placeholder="Dán link video: youtube.com/watch?v=…, tiktok.com/@…/video/…, facebook.com/…"
          onChange={(e) => setLink(e.target.value)}
        />
        {link && <button type="button" className="icon-btn" aria-label="Xoá link" onClick={() => setLink("")}><X size={15} /></button>}
      </label>

      {probe.status === "idle" && link.trim() && (
        <div className="small muted">Link cần bắt đầu bằng http:// hoặc https://</div>
      )}
      {probe.status === "loading" && (
        <div className="probe-loading small muted"><LoaderCircle size={15} className="spin" /> Đang lấy thông tin video…</div>
      )}
      {probe.status === "error" && (
        <div className="alert error"><CircleAlert size={16} /><div>{probe.error}</div></div>
      )}
      {probe.status === "ok" && info && (
        <div className="file-card link-card">
          {info.thumbnail
            ? <img className="link-thumb" src={info.thumbnail} alt="" referrerPolicy="no-referrer" />
            : <span className="file-icon"><Link2 size={22} /></span>}
          <div className="spacer">
            <b className="clamp-2">{info.title}</b>
            <div className="small muted">
              <span className="tag accent">{info.platform}</span>
              {info.uploader ? ` ${info.uploader}` : ""}
              {info.durationSec ? ` · dài ${formatDuration(info.durationSec)}` : ""}
            </div>
          </div>
        </div>
      )}
      <div className="small muted">
        Hỗ trợ YouTube, TikTok, Facebook, Instagram, X, SoundCloud và hơn 1.000 trang khác. Chỉ tải phần âm thanh.
        Trang yêu cầu đăng nhập (YouTube thường như vậy) cần cấu hình cookie trong <code>.env.local</code>.
      </div>
    </>
  );
}
