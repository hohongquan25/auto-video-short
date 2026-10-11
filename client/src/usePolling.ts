import { useCallback, useEffect, useRef, useState } from "react";

/** Load data now and re-load every `intervalMs` while `active` is true. */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number, active = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!active) return;
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs, active]);

  return { data, error, refresh };
}
