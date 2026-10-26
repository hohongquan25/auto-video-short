import { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, Save, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { api, type DefaultSettings, type GeminiKeys, type JobSettings, type LicenseStatus, type SummarySettings } from "../api";
import { FormatPicker, FullVideoToggle, PartLengthPicker, ReviewToggle, StylePicker, SubtitleToggle, VoicePicker } from "../components/Pickers";
import { SummarySettingsForm, summaryProblems } from "../components/SummarySettings";
import { errorMessage, useToast } from "../components/Toast";
import { useLibrary } from "../useLibrary";
import { RETAIL } from "../edition";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function SaveBar({ changed, busy, problem, onUndo, onSave }: {
  changed: boolean; busy: boolean; problem: string | null; onUndo: () => void; onSave: () => void;
}) {
  return (
    <div className={`apply-bar ${changed ? "pending" : ""}`}>
      <div className="spacer small">
        {problem ? <span className="warn-text">{problem}</span>
          : changed ? "Có thay đổi chưa lưu."
          : <span className="muted">Đang là cài đặt mặc định.</span>}
      </div>
      {changed && <button disabled={busy} onClick={onUndo}><Undo2 size={15} /> Hoàn tác</button>}
      <button className="primary" disabled={busy || !changed || !!problem} onClick={onSave}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} Lưu
      </button>
    </div>
  );
}

/** The pickers edit a job's settings; the backgrounds are left out, as a new video uses the whole library. */
const asJob = (d: DefaultSettings): JobSettings => ({ ...d, backgroundIds: [] });

function StoryDefaults({ saved, onSaved }: { saved: DefaultSettings; onSaved: (d: DefaultSettings) => void }) {
  const toast = useToast();
  const { meta, styles } = useLibrary();
  const [draft, setDraft] = useState<JobSettings>(asJob(saved));
  const [busy, setBusy] = useState(false);
  if (!meta) return null;

  const set = (patch: Partial<JobSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const { backgroundIds: _, ...current } = draft;
  const problem = draft.maxPartSec <= draft.minPartSec ? "Độ dài mỗi video không hợp lệ (tối đa phải lớn hơn tối thiểu)"
    : !meta.voices.some((v) => v.id === draft.voice) ? `Không có giọng ${draft.voice.replace(/^olvroc:/, "")}, chọn giọng khác`
    : null;
  const save = async () => {
    setBusy(true);
    try {
      const d = await api.saveDefaults(current);
      onSaved(d);
      setDraft(asJob(d));
      toast("success", "Đã lưu cài đặt mặc định của video truyện");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card settings-tab" id="story">
      <h2>Video truyện</h2>
      <p className="small muted">
        Dùng cho nút Tạo nhanh và là điểm bắt đầu mỗi lần tạo video mới. Video nền không nằm ở đây: video mới luôn dùng cả thư viện, bỏ bớt ngay lúc tạo.
      </p>
      <section>
        <h3>Phong cách viết lại</h3>
        <StylePicker value={draft} set={set} styles={styles} meta={meta} />
        <ReviewToggle value={draft} set={set} />
      </section>
      <section>
        <h3>Giọng đọc</h3>
        <VoicePicker value={draft} set={set} meta={meta} />
      </section>
      <section>
        <h3>Phụ đề</h3>
        <SubtitleToggle value={draft} set={set} />
      </section>
      <section>
        <h3>Định dạng xuất</h3>
        <FormatPicker value={draft} set={set} />
      </section>
      <section>
        <h3>Độ dài mỗi video</h3>
        <PartLengthPicker value={draft} set={set} />
        <FullVideoToggle value={draft} set={set} />
      </section>
      <SaveBar changed={!same(current, saved)} busy={busy} problem={problem} onUndo={() => setDraft(asJob(saved))} onSave={save} />
    </section>
  );
}

function SummaryDefaults({ saved, onSaved }: { saved: SummarySettings; onSaved: (d: SummarySettings) => void }) {
  const toast = useToast();
  const { meta } = useLibrary();
  const [draft, setDraft] = useState<SummarySettings>(saved);
  const [busy, setBusy] = useState(false);
  if (!meta) return null;

  const save = async () => {
    setBusy(true);
    try {
      const d = await api.saveSummaryDefaults(draft);
      onSaved(d);
      setDraft(d);
      toast("success", "Đã lưu cài đặt mặc định của tóm tắt video");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" id="summary">
      <h2>Tóm tắt video</h2>
      <p className="small muted">
        Là điểm bắt đầu mỗi lần tạo tóm tắt mới. Độ dài đã chọn mà dài quá so với một video thì lúc tạo sẽ báo để chọn lại
        {RETAIL ? "." : " (gọi từ n8n thì để AI tự chọn độ dài)."}
      </p>
      <SummarySettingsForm value={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} meta={meta} sourceSec={null} />
      <SaveBar
        changed={!same(draft, saved)} busy={busy} problem={summaryProblems(draft, meta, null)[0] ?? null}
        onUndo={() => setDraft(saved)} onSave={save}
      />
    </section>
  );
}

type NumberingDraft = { tag: string; next: number };

function NumberingSettings({ saved, channel, onSaved }: { saved: NumberingDraft; channel: string; onSaved: (n: NumberingDraft) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const tag = draft.tag.trim().replace(/^#+/, "");
  const problem = tag && !/^[\p{L}\p{N}_]+$/u.test(tag) ? "Tên thẻ chỉ gồm chữ, số và dấu gạch dưới, không có khoảng trắng"
    : !(Number.isInteger(draft.next) && draft.next >= 1) ? "Số kế tiếp phải là số nguyên từ 1 trở lên"
    : null;
  const save = async () => {
    setBusy(true);
    try {
      const n = await api.saveNumbering({ tag, next: draft.next });
      onSaved(n);
      setDraft(n);
      toast("success", "Đã lưu cách đánh số");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" id="numbering">
      <h2>Đánh số video trọn bộ</h2>
      <p className="small muted">
        Mỗi truyện mới nhận một số khi làm xong video. Video trọn bộ TikTok và YouTube của truyện đó có số này sau tên, rồi tới tên kênh
        (đặt ở Thư viện), ví dụ <b>Ba tiếng gõ cửa (Truyện Full){tag && ` #${tag}${draft.next}`}{channel && ` | ${channel}`}</b>
        {!tag && " (đang tắt đánh số)"}. Trên TikTok số này tính là một trong 5 hashtag. Để trống tên thẻ để tắt.
      </p>
      <div className="grid-2">
        <label className="field">
          <span className="field-label">Tên thẻ</span>
          <input type="text" value={draft.tag} placeholder="kenhtruyen" onChange={(e) => setDraft((d) => ({ ...d, tag: e.target.value }))} />
        </label>
        <label className="field">
          <span className="field-label">Số của truyện kế tiếp</span>
          <input type="number" min={1} step={1} value={draft.next} onChange={(e) => setDraft((d) => ({ ...d, next: Number(e.target.value) }))} />
        </label>
      </div>
      <SaveBar changed={!same({ tag, next: draft.next }, saved)} busy={busy} problem={problem} onUndo={() => setDraft(saved)} onSave={save} />
    </section>
  );
}

type KeyName = "gemini" | "geminiImage";

/** The Gemini keys: one the AI writes with, and one for drawing YouTube covers, which needs billing. */
function GeminiKeySettings() {
  const toast = useToast();
  const { reload } = useLibrary();
  const [keys, setKeys] = useState<GeminiKeys | null>(null);
  const [draft, setDraft] = useState<Record<KeyName, string>>({ gemini: "", geminiImage: "" });
  const [busy, setBusy] = useState<KeyName | null>(null);

  useEffect(() => {
    api.keys().then(setKeys).catch((e) => toast("error", errorMessage(e)));
  }, [toast]);

  /** null removes the key. */
  const save = async (which: KeyName, value: string | null) => {
    setBusy(which);
    try {
      setKeys(await api.saveKeys(which === "gemini" ? { gemini: value } : { geminiImage: value }));
      setDraft((d) => ({ ...d, [which]: "" }));
      toast("success", value ? "Đã kiểm tra và lưu khoá" : "Đã xoá khoá");
      // The system panel and the AI pickers show whether Gemini is ready.
      await reload({ recheck: true });
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  if (!keys) return null;

  const field = (which: KeyName, label: string, hint: string | null) => (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="key-row">
        <input
          type="password" autoComplete="off" spellCheck={false} value={draft[which]}
          placeholder={keys[which] ? `Đang dùng ${keys[which]}, dán khoá khác để thay` : "Dán khoá vào đây"}
          onChange={(e) => setDraft((d) => ({ ...d, [which]: e.target.value }))}
        />
        <button className="primary" disabled={busy !== null || !draft[which].trim()} onClick={() => save(which, draft[which].trim())}>
          {busy === which ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} Lưu
        </button>
        {keys[which] && <button disabled={busy !== null} onClick={() => save(which, null)}><Trash2 size={15} /> Xoá</button>}
      </div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );

  return (
    <section className="card" id="keys">
      <h2>Khoá Gemini</h2>
      <p className="small muted">
        Gemini là AI của Google, dùng để viết lại, viết truyện, tóm tắt và gợi ý đăng bài. Lấy khoá miễn phí tại{" "}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>{" "}
        (đăng nhập Google, bấm <b>Create API key</b>), rồi dán vào ô dưới đây.
      </p>
      {!keys.geminiReady && <div className="alert warn"><TriangleAlert size={16} />Chưa có khoá Gemini nên các bước dùng AI chưa chạy được.</div>}
      {field("gemini", "Khoá Gemini", !keys.gemini && keys.geminiReady ? "Đang dùng GEMINI_API_KEY trong .env.local" : null)}
      {field(
        "geminiImage", "Khoá vẽ ảnh bìa YouTube (không bắt buộc)",
        "Gemini chỉ vẽ ảnh bằng khoá của dự án đã bật thanh toán, khoảng 0,034 USD một ảnh, mỗi truyện một ảnh. Để trống thì dùng khoá ở trên; vẽ không được thì ảnh bìa YouTube dùng khung hình video nền.",
      )}
    </section>
  );
}

const dayText = (day: string) => day.split("-").reverse().join("/");

/** Who this packaged copy is licensed to, and until when. */
function LicenseInfo() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  useEffect(() => {
    api.license().then(setStatus).catch(() => {});
  }, []);
  const license = status?.license;
  if (!license) return null;
  return (
    <section className="card" id="license">
      <h2>Bản quyền</h2>
      <p className="small">
        Đăng ký cho <b>{license.name}</b> · mã máy <code>{status.machine}</code> · cấp ngày {dayText(license.issued)} ·{" "}
        {license.expires ? <>dùng đến hết ngày <b>{dayText(license.expires)}</b></> : "không hết hạn"}
      </p>
    </section>
  );
}

/** Where every new job starts: the story video defaults (also used by Tạo nhanh) and the summary defaults. */
export function SettingsPage() {
  const toast = useToast();
  const { meta, error: loadError } = useLibrary();
  const [story, setStory] = useState<DefaultSettings | null>(null);
  const [summary, setSummary] = useState<SummarySettings | null>(null);
  const [numbering, setNumbering] = useState<NumberingDraft | null>(null);
  const [channel, setChannel] = useState("");

  useEffect(() => {
    api.defaults().then(setStory).catch((e) => toast("error", errorMessage(e)));
    api.summaryDefaults().then(setSummary).catch((e) => toast("error", errorMessage(e)));
    api.numbering().then(setNumbering).catch((e) => toast("error", errorMessage(e)));
    // Only for the example name: without it the example just has no channel.
    api.brand().then((b) => setChannel(b.text.trim())).catch(() => {});
  }, [toast]);

  if (loadError) return <div className="alert error"><CircleAlert size={16} />{loadError}</div>;
  if (!meta || !story || !summary || !numbering) return <div className="loading"><LoaderCircle className="spin" /> Đang tải…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cài đặt</h1>
          <p className="muted">
            Khoá Gemini cho AI, và các cài đặt mặc định: video mới bắt đầu từ đó, lúc tạo vẫn đổi riêng được cho từng video.
            {!RETAIL && " Gọi API (n8n) mà không gửi cài đặt nào cũng dùng chúng."}
          </p>
        </div>
      </div>
      <GeminiKeySettings />
      <StoryDefaults saved={story} onSaved={setStory} />
      <NumberingSettings saved={numbering} channel={channel} onSaved={setNumbering} />
      <SummaryDefaults saved={summary} onSaved={setSummary} />
      {RETAIL && <LicenseInfo />}
    </>
  );
}
