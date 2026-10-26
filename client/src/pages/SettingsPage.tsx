import { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, Save, Undo2 } from "lucide-react";
import { api, type DefaultSettings, type JobSettings, type SummarySettings } from "../api";
import { FormatPicker, FullVideoToggle, PartLengthPicker, ReviewToggle, StylePicker, SubtitleToggle, VoicePicker } from "../components/Pickers";
import { SummarySettingsForm, summaryProblems } from "../components/SummarySettings";
import { errorMessage, useToast } from "../components/Toast";
import { useLibrary } from "../useLibrary";

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
        (gọi từ n8n thì để AI tự chọn độ dài).
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
          <input type="text" value={draft.tag} placeholder="gactro" onChange={(e) => setDraft((d) => ({ ...d, tag: e.target.value }))} />
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
          <h1>Cài đặt mặc định</h1>
          <p className="muted">
            Video mới bắt đầu từ các cài đặt này, lúc tạo vẫn đổi riêng được cho từng video. Gọi API (n8n) mà không gửi cài đặt nào cũng dùng chúng.
          </p>
        </div>
      </div>
      <StoryDefaults saved={story} onSaved={setStory} />
      <NumberingSettings saved={numbering} channel={channel} onSaved={setNumbering} />
      <SummaryDefaults saved={summary} onSaved={setSummary} />
    </>
  );
}
