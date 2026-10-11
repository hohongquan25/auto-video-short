import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Background, type Meta, type Style } from "./api";

interface Library {
  meta: Meta | null;
  styles: Style[];
  backgrounds: Background[];
  error: string | null;
  loaded: boolean;
  reload: (opts?: { recheck?: boolean }) => Promise<void>;
}

const LibraryContext = createContext<Library | null>(null);

/** Server meta, styles and backgrounds, shared by every page and refreshed after edits. */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [styles, setStyles] = useState<Style[]>([]);
  const [backgrounds, setBackgrounds] = useState<Background[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async (opts: { recheck?: boolean } = {}) => {
    try {
      const [m, s, b] = await Promise.all([api.meta(opts.recheck), api.styles(), api.backgrounds()]);
      setMeta(m);
      setStyles(s);
      setBackgrounds(b);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => void reload(), [reload]);

  return createElement(LibraryContext.Provider, { value: { meta, styles, backgrounds, error, loaded, reload } }, children);
}

export function useLibrary(): Library {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside LibraryProvider");
  return ctx;
}
