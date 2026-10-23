import { Captions, Check, Clock, Languages, Mic, Sparkles, Target, TriangleAlert } from "lucide-react";
import type { Meta, SummarySettings } from "../api";
import { AI_PROVIDER_LABELS, FORMAT_ORDER, LANGUAGES, SUMMARY_FOCUS_PRESETS, VIDEO_FORMATS, formatDuration } from "../format";
import { FIT_OPTIONS, FORMAT_ICONS, ProviderPicker, SubtitleToggle, VoicePicker, providerReady } from "./Pickers";

type Set = (patch: Partial<SummarySettings>) => void;

/** Lengths offered for the cut, in seconds. */
const TARGET_PRESETS = [60, 180, 300, 600, 900, 1200];
/** The cut must be clearly shorter than the video; the server says the same. */
const MAX_SHARE = 0.95;
const LANGUAGE_CODES = Object.keys(LANGUAGES);

/** What stops these settings from being run, as lines to show. */
export function summaryProblems(s: SummarySettings, meta: Meta, sourceSec: number | null): string[] {
  const problems: string[] = [];
  if (s.targetSec !== null && !(s.targetSec >= 30)) problems.push("Bản rút gọn dài ít nhất nửa phút");
  else if (s.targetSec !== null && sourceSec && s.targetSec >= sourceSec * MAX_SHARE) {
    problems.push(`Bản rút gọn phải ngắn hơn video gốc (${formatDuration(sourceSec)})`);
  }
  if (!providerReady(meta, s.aiProvider)) {
    problems.push(s.aiProvider === "claude" ? "Claude Code chưa đăng nhập" : `Chưa có API key cho ${AI_PROVIDER_LABELS.gemini}`);
  }
  if (!meta.voices.some((v) => v.id === s.voice)) problems.push(`Không có giọng ${s.voice.replace(/^olvroc:/, "")}, chọn giọng kể khác`);
  return problems;
}

export function SummarySettingsForm({ value, set, meta, sourceSec }: {
  value: SummarySettings; set: Set; meta: Meta; sourceSec: number | null;
}) {
  return (
    <>
      <div className="field">
        <div className="field-label"><Clock size={15} /> Độ dài bản rút gọn</div>
        <div className="seg-control target-control">
          <button type="button" className={value.targetSec === null ? "on" : ""} onClick={() => set({ targetSec: null })}>
            <b><Sparkles size={14} /> AI tự chọn</b>
            <span>vừa đủ nội dung</span>
          </button>
          {TARGET_PRESETS.map((sec) => (
            <button
              type="button" key={sec} className={value.targetSec === sec ? "on" : ""}
              disabled={sourceSec !== null && sec >= sourceSec * MAX_SHARE} onClick={() => set({ targetSec: sec })}
            >
              <b>{sec / 60} phút</b>
              {sourceSec ? <span>{Math.round((sec / sourceSec) * 100)}% video</span> : null}
            </button>
          ))}
        </div>
        <label className="row small">
          Hoặc nhập
          <input
            type="number" min={0.5} max={240} step={0.5} style={{ width: 90 }}
            value={value.targetSec !== null && Number.isFinite(value.targetSec) ? value.targetSec / 60 : ""}
            onChange={(e) => set({ targetSec: Math.round(Number(e.target.value) * 60) })}
          />
          phút{sourceSec ? <span className="muted">· video gốc dài {formatDuration(sourceSec)}</span> : null}
        </label>
        <div className="small muted">
          {value.targetSec === null
            ? "AI đọc hết nội dung rồi tự chọn độ dài vừa đủ để kể trọn mọi diễn biến hoặc ý chính (thường 1/10 đến 1/4 video gốc), kèm lý do trong kết quả."
            : "AI chọn các đoạn hình và viết lời kể sao cho tổng độ dài gần mức này. Nếu mức này quá ngắn để kể đủ, kết quả sẽ gợi ý độ dài nên chọn."}
        </div>
      </div>

      <div className="field">
        <div className="field-label"><Target size={15} /> Trọng tâm tóm tắt</div>
        <div className="seg-control">
          <button type="button" className={value.focus.trim() === "" ? "on" : ""} onClick={() => set({ focus: "" })}>
            <b>Kể trọn nội dung</b>
            <span>đều mọi diễn biến</span>
          </button>
          {SUMMARY_FOCUS_PRESETS.map((p) => (
            <button type="button" key={p.label} className={value.focus.trim() === p.text ? "on" : ""} onClick={() => set({ focus: p.text })}>
              <b>{p.label}</b>
              <span>{p.hint}</span>
            </button>
          ))}
        </div>
        <textarea
          rows={4} maxLength={2000} value={value.focus} onChange={(e) => set({ focus: e.target.value })}
          placeholder="Hoặc tự viết, ví dụ: chỉ giữ các trận đấu của nhân vật chính, bỏ qua tuyến truyện phụ…"
        />
        <div className="small muted">
          AI ưu tiên yêu cầu này hơn cách tóm tắt thông thường khi chọn đoạn và viết lời kể. Có thể bấm một mẫu rồi sửa lại cho hợp với video.
        </div>
      </div>

      <label className="field">
        <span className="field-label"><Languages size={15} /> Video nói tiếng gì</span>
        <select value={value.language} onChange={(e) => set({ language: e.target.value })}>
          <option value="">Tự nhận ngôn ngữ</option>
          {LANGUAGE_CODES.map((c) => <option key={c} value={c}>{LANGUAGES[c]}</option>)}
        </select>
      </label>

      <label className={`switch-card ${value.useCaptions ? "on" : ""}`}>
        <Captions size={20} />
        <span className="spacer">
          <b>Đọc phụ đề có sẵn của video</b>
          <span className="small muted block">
            Nhanh hơn nhiều so với nhận dạng giọng nói. Video không có phụ đề thì app tự nhận dạng bằng Whisper.
          </span>
        </span>
        <input type="checkbox" className="switch" checked={value.useCaptions} onChange={(e) => set({ useCaptions: e.target.checked })} />
      </label>
      {!meta.system.whisper.ok && (
        <div className="alert warn">
          <TriangleAlert size={16} />
          <div>Whisper chưa sẵn sàng ({meta.system.whisper.error}): chỉ tóm tắt được video có phụ đề. Chạy <code>pnpm setup:whisper</code> để nhận dạng giọng nói.</div>
        </div>
      )}

      <div className="field-label"><Mic size={15} /> Giọng kể chuyện</div>
      <div className="small muted">
        Tiếng gốc của video được tắt. Người dẫn chuyện kể lại từng đoạn bằng tiếng Việt, theo ngôi thứ ba.
      </div>
      <VoicePicker value={value} set={set} meta={meta} />
      <SubtitleToggle value={value} set={set} />

      <div className="field-label">Khung hình</div>
      <div className="choice-grid">
        {FORMAT_ORDER.map((f) => {
          const Icon = FORMAT_ICONS[f];
          const on = value.format === f;
          return (
            <button type="button" key={f} className={`choice ${on ? "selected" : ""}`} aria-pressed={on} onClick={() => set({ format: f })}>
              <div className="choice-head">
                <Icon size={16} />
                <b>{f === "original" ? "Giữ nguyên" : VIDEO_FORMATS[f].label}</b>
                {on && <Check size={16} className="choice-check" />}
              </div>
              <div className="choice-body">{f === "original" ? "Theo khung và độ phân giải của video gốc" : VIDEO_FORMATS[f].desc}</div>
            </button>
          );
        })}
      </div>
      {value.format !== "original" && (
        <div className="seg-control fit-control">
          {FIT_OPTIONS.map((o) => (
            <button type="button" key={o.id} className={value.fit === o.id ? "on" : ""} onClick={() => set({ fit: o.id })}>
              <b><o.icon size={14} /> {o.label}</b>
              <span>{o.id === "blur" ? "giữ trọn hình gốc, lấp chỗ trống bằng nền mờ" : o.desc}</span>
            </button>
          ))}
        </div>
      )}

      <ProviderPicker value={value} set={set} meta={meta} label="AI đọc nội dung, chọn đoạn và viết lời kể" />
    </>
  );
}
