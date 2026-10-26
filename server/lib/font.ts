import { readFileSync } from "node:fs";

/**
 * What text layout needs from a TrueType font: each character's advance and
 * the height libass fits into a font size. libass, like VSFilter, scales a
 * font so usWinAscent + usWinDescent fills the size, so widths are measured
 * in that unit.
 */
export interface FontMetrics {
  /** Width of `text` set at `fontSize` as libass draws it. */
  width: (text: string, fontSize: number) => number;
  /** Height of the capitals at `fontSize`. */
  capHeight: (fontSize: number) => number;
}

function tables(buf: Buffer): Map<string, number> {
  const found = new Map<string, number>();
  const count = buf.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    found.set(buf.toString("latin1", rec, rec + 4), buf.readUInt32BE(rec + 8));
  }
  return found;
}

/** Character → glyph, from the Unicode cmap (format 12 when there is one, else format 4). */
function charMap(buf: Buffer, cmap: number): (code: number) => number {
  const subtables: { platform: number; encoding: number; at: number }[] = [];
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8;
    subtables.push({ platform: buf.readUInt16BE(rec), encoding: buf.readUInt16BE(rec + 2), at: cmap + buf.readUInt32BE(rec + 4) });
  }
  const pick = (format: number) => subtables.find((s) => (s.platform === 0 || (s.platform === 3 && [1, 10].includes(s.encoding))) && buf.readUInt16BE(s.at) === format);
  const f12 = pick(12);
  if (f12) {
    const groups = buf.readUInt32BE(f12.at + 12);
    return (code) => {
      for (let g = 0; g < groups; g++) {
        const rec = f12.at + 16 + g * 12;
        const start = buf.readUInt32BE(rec);
        if (code >= start && code <= buf.readUInt32BE(rec + 4)) return buf.readUInt32BE(rec + 8) + code - start;
      }
      return 0;
    };
  }
  const f4 = pick(4);
  if (!f4) throw new Error("Font không có bảng ký tự Unicode");
  const segs = buf.readUInt16BE(f4.at + 6) / 2;
  const ends = f4.at + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const ranges = deltas + segs * 2;
  return (code) => {
    if (code > 0xffff) return 0;
    for (let s = 0; s < segs; s++) {
      if (code > buf.readUInt16BE(ends + s * 2)) continue;
      const start = buf.readUInt16BE(starts + s * 2);
      if (code < start) return 0;
      const delta = buf.readInt16BE(deltas + s * 2);
      const range = buf.readUInt16BE(ranges + s * 2);
      if (!range) return (code + delta) & 0xffff;
      const glyph = buf.readUInt16BE(ranges + s * 2 + range + (code - start) * 2);
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
    return 0;
  };
}

export function readFontMetrics(file: string): FontMetrics {
  const buf = readFileSync(file);
  const t = tables(buf);
  const at = (tag: string) => {
    const offset = t.get(tag);
    if (offset === undefined) throw new Error(`Font thiếu bảng ${tag}: ${file}`);
    return offset;
  };
  const os2 = at("OS/2");
  const unit = 1 / (buf.readUInt16BE(os2 + 74) + buf.readUInt16BE(os2 + 76));
  const metrics = buf.readUInt16BE(at("hhea") + 34);
  const hmtx = at("hmtx");
  const advance = (glyph: number) => buf.readUInt16BE(hmtx + Math.min(glyph, metrics - 1) * 4);
  const glyphOf = charMap(buf, at("cmap"));
  const cache = new Map<string, number>();
  const units = (ch: string) => {
    let u = cache.get(ch);
    if (u === undefined) cache.set(ch, (u = advance(glyphOf(ch.codePointAt(0)!))));
    return u;
  };
  // sCapHeight is in OS/2 version 2 and later; older fonts get the usual 70% of the em.
  const cap = buf.readUInt16BE(os2) >= 2 ? buf.readInt16BE(os2 + 88) : 0.7 * buf.readUInt16BE(at("head") + 18);
  return {
    width: (text, fontSize) => {
      let sum = 0;
      for (const ch of text.normalize("NFC")) sum += units(ch);
      return sum * unit * fontSize;
    },
    capHeight: (fontSize) => cap * unit * fontSize,
  };
}
