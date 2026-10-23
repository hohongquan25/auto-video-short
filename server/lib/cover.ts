import { assColor, roundRect, textWidth } from "./badge.js";
import type { AssLayer } from "./subtitles.js";

/**
 * A post cover: the background darkened, the story's hook in big white
 * capitals with a heavy outline, and an accent pill above it naming the part
 * ("PHẦN 2") or "TRỌN BỘ". Everything sits in the middle of the frame, the
 * area TikTok's 3:4 profile grid keeps.
 */

const MAX_LINES = 4;
/** libass sizes Arial so ascent plus descent (1.117 em) fills the font size, so glyphs are narrower than the size suggests. */
const EM = 1 / 1.117;
const measure = (text: string, fontSize: number) => textWidth(text, fontSize * EM);
const r1 = (n: number) => Math.round(n * 10) / 10;
const assText = (text: string) => text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();

/** Greedily break `text` into lines no wider than `maxWidth` at `fontSize`. */
export function wrapLines(text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ").filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next, fontSize) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * As many lines as the greedy wrap, but with the words spread so the lines
 * are as even in width as possible: no stray word alone on the last line.
 * Tries every split, which stays small for a cover-length hook.
 */
export function balancedLines(text: string, fontSize: number, maxWidth: number): string[] {
  const greedy = wrapLines(text, fontSize, maxWidth);
  const words = text.split(" ").filter(Boolean);
  const n = greedy.length;
  if (n < 2 || words.length > 30) return greedy;
  let best = greedy;
  let bestCost = Infinity;
  const split = (from: number, lines: string[]) => {
    if (lines.length === n - 1) {
      const all = [...lines, words.slice(from).join(" ")];
      const widths = all.map((l) => measure(l, fontSize));
      if (widths.some((w) => w > maxWidth)) return;
      const mean = widths.reduce((s, w) => s + w, 0) / n;
      const cost = widths.reduce((s, w) => s + (w - mean) ** 2, 0);
      if (cost < bestCost) [best, bestCost] = [all, cost];
      return;
    }
    // Leave at least one word for each remaining line.
    for (let to = from + 1; to <= words.length - (n - 1 - lines.length); to++) split(to, [...lines, words.slice(from, to).join(" ")]);
  };
  split(0, []);
  return best;
}

/** Font size and lines for the hook: as big as fits in MAX_LINES lines. */
export function coverText(text: string, width: number, height: number): { fontSize: number; lines: string[] } {
  const maxWidth = width * 0.84;
  const upper = assText(text).toLocaleUpperCase("vi");
  let fontSize = Math.round(height > width ? width * 0.105 : height * 0.12);
  while (wrapLines(upper, fontSize, maxWidth).length > MAX_LINES && fontSize > 24) fontSize = Math.round(fontSize * 0.9);
  return { fontSize, lines: balancedLines(upper, fontSize, maxWidth) };
}

export interface CoverSpec {
  text: string;
  /** Pill above the text, e.g. "PHẦN 2"; null for none. */
  label: string | null;
  /** Accent colour, "#RRGGBB". */
  accent: string;
}

export function coverLines(spec: CoverSpec, width: number, height: number, time: (sec: number) => string): AssLayer {
  const { fontSize: fs, lines } = coverText(spec.text, width, height);
  const lineH = fs * 1.18;
  const labelFs = Math.round(fs * 0.5);
  const pillH = labelFs * 1.8;
  const gap = fs * 0.45;
  const label = spec.label ? assText(spec.label).toLocaleUpperCase("vi") : "";
  const blockH = (label ? pillH + gap : 0) + lines.length * lineH;
  const cx = width / 2;
  const top = (height > width ? height * 0.45 : height * 0.5) - blockH / 2;

  const start = time(0);
  const end = time(10);
  const accent = assColor(spec.accent);
  const draw = (layer: number, tags: string, path: string) =>
    `Dialogue: ${layer},${start},${end},Cover,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0${tags}}${path}{\\p0}`;
  const events = [draw(0, "\\1c&H000000&\\1a&H70&", `m 0 0 l ${width} 0 l ${width} ${height} l 0 ${height}`)];

  let y = top;
  if (label) {
    const pillW = measure(label, labelFs) + labelFs * 2;
    events.push(draw(1, `\\1c${accent}`, roundRect(cx - pillW / 2, y, pillW, pillH, pillH / 2)));
    events.push(`Dialogue: 2,${start},${end},Cover,,0,0,0,,{\\an5\\pos(${r1(cx)},${r1(y + pillH / 2)})\\fs${labelFs}\\1c&H161616&\\bord0\\shad0}${label}`);
    y += pillH + gap;
  }
  lines.forEach((line, i) => {
    events.push(`Dialogue: 2,${start},${end},Cover,,0,0,0,,{\\an8\\pos(${r1(cx)},${r1(y + i * lineH)})}${line}`);
  });

  const outline = Math.max(3, Math.round(fs * 0.09));
  const shadow = Math.max(2, Math.round(fs * 0.06));
  return {
    style: `Style: Cover,Arial,${fs},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},8,0,0,0,1`,
    events,
  };
}
