import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";

type Kind = "success" | "error" | "info";
interface Toast { id: number; kind: Kind; text: string }

const ToastContext = createContext<(kind: Kind, text: string) => void>(() => {});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = (id: number) => setItems((all) => all.filter((t) => t.id !== id));

  const push = useCallback((kind: Kind, text: string) => {
    const id = nextId++;
    setItems((all) => [...all.slice(-3), { id, kind, text }]);
    setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = t.kind === "success" ? CircleCheck : t.kind === "error" ? CircleAlert : Info;
          return (
            <div key={t.id} className={`toast ${t.kind}`}>
              <Icon size={18} />
              <span>{t.text}</span>
              <button className="icon-btn" aria-label="Đóng" onClick={() => dismiss(t.id)}><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function copyText(text: string, toast: ReturnType<typeof useToast>, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("success", `Đã sao chép ${what}`);
  } catch {
    toast("error", "Trình duyệt không cho phép sao chép");
  }
}
