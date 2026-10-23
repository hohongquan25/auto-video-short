import { useEffect, useState } from "react";

/** Local preview URL + duration of the chosen file, read by the browser. */
export function useMediaInfo(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    setDuration(null);
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    const probe = document.createElement(file.type.startsWith("video") ? "video" : "audio");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => Number.isFinite(probe.duration) && setDuration(probe.duration);
    probe.src = u;
    return () => {
      probe.removeAttribute("src");
      URL.revokeObjectURL(u);
    };
  }, [file]);
  return { url, duration };
}
