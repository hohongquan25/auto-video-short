import { Captions, Check, Clock, FileText, Languages, TriangleAlert } from "lucide-react";
import type { Meta, SummarySettings } from "../api";
import { AI_PROVIDER_LABELS, FORMAT_ORDER, LANGUAGES, VIDEO_FORMATS, formatDuration } from "../format";
import { FIT_OPTIONS, FORMAT_ICONS, ProviderPicker, providerReady } from "./Pickers";

type Set = (patch: Partial<SummarySettings>) => void;

/** Lengths offered for the cut, in seconds. */
const TARGET_PRESETS = [60, 180, 300, 600, 900, 1200];
/** The cut must be clearly shorter than the video; the server says the same. */
const MAX_SHARE = 0.95;
const LANGUAGE_CODES = Object.keys(LANGUAGES);

/** A first guess at the cut's length: about a sixth of the video, in whole minutes, from one to twenty. */
export const suggestTarget = (sourceSec: number) => Math.min(1200, Math.max(60, Math.round(sourceSec / 6 / 60) * 60));

/** What stops these settings from being run, as lines to show. */
export function summaryProblems(s: SummarySettings, meta: Meta, sourceSec: number | null): string[] {
  const problems: string[] = [];
  if (!(s.targetSec >= 30)) problems.push("Bản rút gọn dài ít nhất nửa phút");
  else if (sourceSec && s.targetSec >= sourceSec * MAX_SHARE) problems.push(`Bản rút gọn phải ngắn hơn video gốc (${formatDuration(sourceSec)})`);
  if (!providerReady(meta, s.aiProvider)) {
    problems.push(s.aiProvider === "claude" ? "Claude Code chưa đăng nhập" : `Chưa có API key cho ${AI_PROVIDER_LABELS.gemini}`);
  }
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
            value={Number.isFinite(value.targetSec) ? value.targetSec / 60 : ""}
            onChange={(e) => set({ targetSec: Math.round(Number(e.target.value) * 60) })}
          />
          phút{sourceSec ? <span className="muted">· video gốc dài {formatDuration(sourceSec)}</span> : null}
        </label>
        <div className="small muted">AI chọn các đoạn sao cho tổng độ dài gần mức này, đủ để người xem nắm hết nội dung.</div>
      </div>

      <div className="summary-grid">
        <label className="field">
          <span className="field-label"><Languages size={15} /> Video nói tiếng gì</span>
          <select value={value.language} onChange={(e) => set({ language: e.target.value })}>
            <option value="">Tự nhận ngôn ngữ</option>
            {LANGUAGE_CODES.map((c) => <option key={c} value={c}>{LANGUAGES[c]}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label"><FileText size={15} /> Viết tóm tắt bằng</span>
          <select value={value.summaryLanguage} onChange={(e) => set({ summaryLanguage: e.target.value })}>
            {LANGUAGE_CODES.map((c) => <option key={c} value={c}>{LANGUAGES[c]}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label"><Captions size={15} /> Phụ đề trên video</span>
          <select value={value.subtitles} onChange={(e) => set({ subtitles: e.target.value })}>
            <option value="none">Không chèn phụ đề</option>
            <option value="source">Theo lời nói trong video</option>
            {LANGUAGE_CODES.map((c) => <option key={c} value={c}>Dịch sang {LANGUAGES[c]}</option>)}
          </select>
        </label>
      </div>

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

      <ProviderPicker value={value} set={set} meta={meta} label="AI đọc nội dung và chọn đoạn" />
    </>
  );
}
