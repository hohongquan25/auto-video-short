import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Three rows of four on a wide screen. */
export const BACKGROUNDS_PER_PAGE = 12;

export interface Paging<T> {
  /** The items on the page shown. */
  items: T[];
  page: number;
  pages: number;
  setPage: (page: number) => void;
}

/** Splits `all` into pages; removing the last item of the last page steps back a page. */
export function usePaging<T>(all: T[], perPage: number): Paging<T> {
  const [wanted, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const page = Math.min(wanted, pages - 1);
  return { items: all.slice(page * perPage, (page + 1) * perPage), page, pages, setPage };
}

/** Page numbers to show: the first, the last, and the ones around `page`, with null for a gap. */
function pageItems(page: number, pages: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let p = 0; p < pages; p++) {
    if (p === 0 || p === pages - 1 || Math.abs(p - page) <= 1) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

/** Previous / page numbers / next; hidden when everything fits on one page. */
export function Pager({ paging, label }: { paging: Paging<unknown>; label: string }) {
  const { page, pages, setPage } = paging;
  if (pages < 2) return null;
  return (
    <nav className="pager" aria-label={label}>
      <button type="button" className="small" disabled={page === 0} aria-label="Trang trước" onClick={() => setPage(page - 1)}><ChevronLeft size={15} /></button>
      {pageItems(page, pages).map((p, i) =>
        p === null ? <span key={`gap-${i}`} className="muted">…</span> : (
          <button
            type="button" key={p} className={`small ${p === page ? "on" : ""}`}
            aria-current={p === page ? "page" : undefined} onClick={() => setPage(p)}
          >
            {p + 1}
          </button>
        ),
      )}
      <button type="button" className="small" disabled={page === pages - 1} aria-label="Trang sau" onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>
    </nav>
  );
}
