import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { TTS_CHARS_PER_SEC, formatChars } from "../format";

export interface TopicDraft {
  prompt: string;
  minMinutes: number;
  maxMinutes: number;
}

export const DEFAULT_TOPIC: TopicDraft = { prompt: "", minMinutes: 30, maxMinutes: 45 };

const PRESETS = [
  { label: "Ngắn", min: 10, max: 15 },
  { label: "Vừa", min: 20, max: 30 },
  { label: "Dài", min: 30, max: 45 },
  { label: "Rất dài", min: 45, max: 60 },
];

export const topicProblem = (t: TopicDraft): string | null =>
  t.prompt.trim().length < 5 ? "Chưa nhập chủ đề truyện"
  : !(t.minMinutes >= 3 && t.maxMinutes <= 120 && t.maxMinutes >= t.minMinutes) ? "Độ dài truyện không hợp lệ (3–120 phút, tối đa ≥ tối thiểu)"
  : null;

export function TopicSource({ value, set, rate }: { value: TopicDraft; set: (t: TopicDraft) => void; rate: string }) {
  const preset = PRESETS.find((p) => p.min === value.minMinutes && p.max === value.maxMinutes);
  const [custom, setCustom] = useState(!preset);
  // The empty-topic case is already reported on the confirm step; only flag a bad length here.
  const lengthProblem = value.prompt.trim().length >= 5 ? topicProblem(value) : null;
  // Same sizing as the server: chapters of ~3,500 characters at the chosen voice speed.
  const chars = ((value.minMinutes + value.maxMinutes) / 2) * 60 * TTS_CHARS_PER_SEC * (1 + (parseInt(rate, 10) || 0) / 100);

  return (
    <>
      <label className="field">
        <span className="field-label">Chủ đề, ý tưởng truyện</span>
        <textarea
          rows={5} value={value.prompt} maxLength={4000}
          onChange={(e) => set({ ...value, prompt: e.target.value })}
          placeholder={"Ví dụ: Truyện ma làng quê miền Tây những năm tám mươi. Một cô giáo trẻ về dạy ở ngôi trường cũ bên bờ sông, " +
            "đêm nào cũng nghe tiếng trẻ con đọc bài dù trường đã đóng cửa. Kết thúc bất ngờ, có hậu."}
        />
      </label>
      <div className="small muted">
        Càng cụ thể càng tốt: thể loại, bối cảnh, nhân vật chính, nút thắt, kiểu kết thúc. AI sẽ lập dàn ý theo chương rồi viết lần lượt từng chương.
      </div>

      <h3>Độ dài truyện</h3>
      <div className="seg-control">
        {PRESETS.map((p) => (
          <button
            type="button" key={p.label}
            className={!custom && preset === p ? "on" : ""}
            onClick={() => {
              setCustom(false);
              set({ ...value, minMinutes: p.min, maxMinutes: p.max });
            }}
          >
            <b>{p.label}</b><span>{p.min}–{p.max} phút</span>
          </button>
        ))}
        <button type="button" className={custom ? "on" : ""} onClick={() => setCustom(true)}>
          <b>Tuỳ chỉnh</b><span>{custom ? `${value.minMinutes}–${value.maxMinutes} phút` : "tự nhập"}</span>
        </button>
      </div>
      {custom && (
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Tối thiểu (phút)</span>
            <input
              type="number" min={3} max={120} step={1} value={value.minMinutes}
              onChange={(e) => set({ ...value, minMinutes: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span className="field-label">Tối đa (phút)</span>
            <input
              type="number" min={3} max={120} step={1} value={value.maxMinutes}
              onChange={(e) => set({ ...value, maxMinutes: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
      {lengthProblem && <div className="alert error"><TriangleAlert size={16} />{lengthProblem}</div>}
      <div className="small muted">
        Khoảng <b>{formatChars(Math.round(chars))}</b> ký tự, chia khoảng <b>{Math.max(2, Math.round(chars / 3500))} chương</b> ở tốc độ đọc {rate}.
        Độ dài AI viết ra chỉ là gần đúng; bạn có thể bật duyệt kịch bản để đọc và sửa trước khi tạo giọng đọc.
      </div>
    </>
  );
}
