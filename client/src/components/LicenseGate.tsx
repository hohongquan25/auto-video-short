import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CircleAlert, Clapperboard, Copy, KeyRound, LoaderCircle } from "lucide-react";
import { LICENSE_EVENT, api, type LicenseStatus } from "../api";
import { copyText, errorMessage, useToast } from "./Toast";

/** The page a packaged copy shows until it has a licence key that works on this machine. */
function Activation({ status, onActivated }: { status: LicenseStatus; onActivated: (s: LicenseStatus) => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.activateLicense(key);
      toast("success", `Đã kích hoạt Story Studio cho ${s.license?.name}`);
      onActivated(s);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="activation">
      <div className="card activation-card">
        <div className="brand">
          <span className="brand-mark"><Clapperboard size={18} /></span>
          <span>Story Studio</span>
        </div>
        <h1>Kích hoạt bản quyền</h1>
        {status.error && <div className="alert error"><CircleAlert size={16} />{status.error}</div>}
        <ol className="activation-steps">
          <li>Gửi <b>mã máy</b> dưới đây cho người bán Story Studio.</li>
          <li>Dán <b>khoá bản quyền</b> nhận được vào ô bên dưới rồi bấm Kích hoạt.</li>
        </ol>
        <div className="field">
          <span className="field-label">Mã máy</span>
          <div className="copy-line">
            <span className="machine-code">{status.machine}</span>
            <button className="small" onClick={() => copyText(status.machine, toast, "mã máy")}><Copy size={14} /> Sao chép</button>
          </div>
        </div>
        <label className="field">
          <span className="field-label">Khoá bản quyền</span>
          <textarea rows={4} value={key} placeholder="SS1-…" spellCheck={false} onChange={(e) => setKey(e.target.value)} />
        </label>
        {error && <div className="alert error"><CircleAlert size={16} />{error}</div>}
        <button className="primary full" disabled={busy || !key.trim()} onClick={activate}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <KeyRound size={16} />} Kích hoạt
        </button>
      </div>
    </div>
  );
}

/** Renders the app once this copy is activated; checks again whenever the server says the key stopped working. */
export function LicenseGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    api.license().then(setStatus, (err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    check();
    window.addEventListener(LICENSE_EVENT, check);
    return () => window.removeEventListener(LICENSE_EVENT, check);
  }, [check]);

  if (status?.ok) return children;
  if (status) return <Activation status={status} onActivated={setStatus} />;
  if (error) return <div className="alert error"><CircleAlert size={16} />Không kết nối được Story Studio: {error}</div>;
  return <div className="loading"><LoaderCircle className="spin" /> Đang tải…</div>;
}
