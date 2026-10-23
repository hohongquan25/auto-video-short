import { Compass, Copy, Download, ImageIcon, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { jobFileUrl, type Job, type JobPart } from "../api";
import { VIDEO_FORMATS, formatDuration, postFor, videoFileName } from "../format";
import { isActive } from "../jobState";
import { copyText, useToast } from "./Toast";

/** A text with a copy button beside it. */
function CopyField({ label, text, what, multiline = false }: { label: string; text: string; what: string; multiline?: boolean }) {
  const toast = useToast();
  return (
    <div className="copy-field">
      <div className="copy-field-head">
        <span className="field-label">{label}</span>
        <button className="icon-btn" title={`Sao chép ${what}`} aria-label={`Sao chép ${what}`} onClick={() => copyText(text, toast, what)}>
          <Copy size={15} />
        </button>
      </div>
      <div className={multiline ? "copy-text multiline" : "copy-text"}>{text}</div>
    </div>
  );
}

/**
 * Everything needed to post the finished videos: title ideas, description
 * and hashtags, then for each video its cover and the exact text to paste.
 */
export function PublishTab({ job, busy, onRegenerate }: { job: Job; busy: boolean; onRegenerate: () => void }) {
  const toast = useToast();
  const kit = job.publish;
  const locked = isActive(job);
  if (!kit) {
    return (
      <div className="empty">
        {locked ? "Gợi ý đăng bài sẽ có sau khi dựng xong video." : (
          <>
            <p>Job này chưa có gợi ý đăng bài.</p>
            {job.outputs.length > 0 && (
              <button className="primary" disabled={busy} onClick={onRegenerate}><Sparkles size={15} /> Tạo gợi ý và ảnh bìa</button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="publish">
      <div className="editor-toolbar small">
        {kit.by ? <span>Gợi ý bởi <b>{kit.by}</b></span> : (
          <span className="warn-text"><TriangleAlert size={14} /> AI chưa viết được gợi ý, đây là bản mẫu theo tên truyện</span>
        )}
        <span className="spacer" />
        <button className="small" disabled={busy || locked} onClick={onRegenerate}><RotateCcw size={14} /> Tạo lại gợi ý</button>
      </div>

      {kit.niche && (
        <div className="niche-box">
          <div className="niche-head"><Compass size={16} /> <b>Ngách truyện:</b> {kit.niche.genre}</div>
          {kit.niche.audience && <div className="small"><span className="muted">Người xem:</span> {kit.niche.audience}</div>}
          {kit.niche.similar.length > 0 && <div className="small"><span className="muted">Cùng ngách:</span> {kit.niche.similar.join(" · ")}</div>}
          {kit.niche.insight && <div className="small"><span className="muted">Nhận xét:</span> {kit.niche.insight}</div>}
        </div>
      )}

      <div className="publish-ideas">
        <div className="copy-field">
          <span className="field-label">Tiêu đề gợi ý</span>
          {kit.titles.map((t) => (
            <div key={t} className="copy-line">
              <span>{t}</span>
              <button className="icon-btn" title="Sao chép tiêu đề" aria-label="Sao chép tiêu đề" onClick={() => copyText(t, toast, "tiêu đề")}>
                <Copy size={15} />
              </button>
            </div>
          ))}
        </div>
        <div>
          <CopyField label="Mô tả" text={kit.caption} what="mô tả" />
          <CopyField label="Hashtag" text={kit.hashtags.join(" ")} what="hashtag" />
        </div>
      </div>

      {job.outputs.map((o) => {
        const tall = o.format === "tiktok";
        const videos: { video: Omit<JobPart, "index">; label: string; part: { index: number; total: number } | null }[] = [
          ...o.parts.map((p) => ({ video: p, label: `Phần ${p.index}/${o.parts.length}`, part: { index: p.index, total: o.parts.length } })),
          ...(o.fullVideo ? [{ video: o.fullVideo, label: o.parts.length ? "Bản đầy đủ" : "Cả truyện", part: null }] : []),
        ];
        const name = VIDEO_FORMATS[o.format].label;
        return (
          <section key={o.format}>
            <h3 className="output-head">
              {o.format === "original" ? "Video khung gốc" : `Đăng ${name}`}
              <span className="small muted">{videos.length} video</span>
            </h3>
            <div className="posts">
              {videos.map(({ video, label, part }) => {
                const post = postFor(kit, o.format, part);
                const base = videoFileName(job, o.format, part?.index ?? null);
                return (
                  <div className="post" key={video.file}>
                    <div className={`post-cover ${tall ? "tall" : ""}`}>
                      {video.cover
                        ? <img src={jobFileUrl(job.id, `parts/${video.cover}`)} alt={`Ảnh bìa ${label}`} loading="lazy" />
                        : <span className="muted"><ImageIcon size={22} /></span>}
                    </div>
                    <div className="post-body">
                      <div className="post-head">
                        <b>{label}</b>
                        <span className="small muted">{formatDuration(video.durationSec)}</span>
                      </div>
                      {post.title && <CopyField label="Tiêu đề" text={post.title} what="tiêu đề" />}
                      <CopyField label={post.title ? "Mô tả" : "Nội dung đăng"} text={post.description} what="nội dung đăng" multiline />
                      {post.tags.length > 0 && <CopyField label="Thẻ" text={post.tags.join(", ")} what="thẻ" />}
                      <div className="row">
                        {video.cover && (
                          <a className="btn small" href={jobFileUrl(job.id, `parts/${video.cover}`)} download={`${base}.jpg`}>
                            <ImageIcon size={14} /> Tải ảnh bìa
                          </a>
                        )}
                        <a className="btn small primary" href={jobFileUrl(job.id, `parts/${video.file}`)} download={`${base}.mp4`}>
                          <Download size={14} /> Tải video
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
