import { useRef, useState, type ReactNode } from "react";
import { UploadCloud } from "lucide-react";

interface Props {
  accept: string;
  onFile: (file: File) => void;
  title: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
}

/** Click-or-drop file zone. */
export function FileDrop({ accept, onFile, title, hint, compact, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      className={`dropzone ${over ? "over" : ""} ${compact ? "compact" : ""} ${disabled ? "disabled" : ""}`}
      role="button" tabIndex={0}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !disabled) onFile(f);
      }}
    >
      <UploadCloud size={compact ? 22 : 34} className="drop-icon" />
      <div className="drop-title">{title}</div>
      {hint && <div className="drop-hint">{hint}</div>}
      <input
        ref={input} type="file" accept={accept} hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
