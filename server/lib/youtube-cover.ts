import { assColor, headphones, roundRect } from "./badge.js";
import type { FontMetrics } from "./font.js";
import type { AssLayer } from "./subtitles.js";

/**
 * The YouTube cover, after the covers of Vietnamese audio-story channels: a
 * picture of the story on the left melting into a white page, and on the
 * right the story's name in heavy capitals, its lines alternating between
 * the accent colour and near-black, a small genre line above it, the channel
 * below, and a few sparkles about. This draws the text and the sparkles;
 * ffmpeg lays the picture on the page (pictureCover).
 */

/** Share of the width the picture takes; the right part of it fades into the page. */
export const PICTURE_SHARE = 0.42;
/** Share of the picture's width that fades. */
export const FADE_SHARE = 0.32;
/** The font the cover is set in, shipped in assets/fonts. */
export const COVER_FONT = { file: "BeVietnamPro-Black.ttf", name: "Be Vietnam Pro Black" };
/** Pink of the covers this layout follows. */
export const COVER_ACCENT = "#E91E63";
const INK = "#161616";

const MAX_LINES = 5;
/** From one line of the name to the next, in font sizes: room for the marks above and below Vietnamese capitals. */
const PITCH = 0.8;
/** How much smaller a split may set the name for each short word ("CỦA", "ĐÊM") left alone on a line, which reads badly. */
const LONE_WORD = 0.25;
const isLone = (line: string) => !line.includes(" ") && line.length <= 3;

const r1 = (n: number) => Math.round(n * 10) / 10;
const assText = (text: string) => text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
const upper = (text: string) => assText(text).toLocaleUpperCase("vi");

/** `hex` mixed with white, `share` of the way. */
function tint(hex: string, share: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${c.map((v) => Math.round(v + (255 - v) * share).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * `words` in `n` lines as even as possible: the widest line as narrow as it
 * can be, then the widths as close as they can be. Tries every split, which
 * stays small for a name of a few words.
 */
export function splitLines(words: string[], n: number, width: (s: string) => number): string[] {
  let best: string[] = [words.join(" ")];
  let bestCost: [number, number] = [Infinity, Infinity];
  const walk = (from: number, lines: string[]) => {
    if (lines.length === n - 1) {
      const all = [...lines, words.slice(from).join(" ")];
      const widths = all.map(width);
      const widest = Math.max(...widths);
      const spread = widths.reduce((s, w) => s + (widest - w) ** 2, 0);
      if (widest < bestCost[0] - 1e-9 || (Math.abs(widest - bestCost[0]) < 1e-9 && spread < bestCost[1])) [best, bestCost] = [all, [widest, spread]];
      return;
    }
    for (let to = from + 1; to <= words.length - (n - 1 - lines.length); to++) walk(to, [...lines, words.slice(from, to).join(" ")]);
  };
  walk(0, []);
  return best;
}

/**
 * The name's lines and the biggest font size that fits them in `box`, the
 * capitals no taller than `maxCap`. `given` is the AI's split of the name at
 * natural breaks; it is used as long as it still holds the name's words.
 */
export function nameLayout(
  name: string, given: string[] | null, m: FontMetrics, box: { width: number; height: number }, maxCap: number,
): { fontSize: number; lines: string[] } {
  const words = upper(name).split(" ").filter(Boolean);
  const fit = (lines: string[]) => {
    const widest = Math.max(...lines.map((l) => m.width(l, 1)));
    const capped = maxCap / m.capHeight(1);
    return Math.min(box.width / widest, box.height / (lines.length * PITCH), capped);
  };
  const theirs = given?.map(upper).filter(Boolean) ?? [];
  if (theirs.length && theirs.length <= MAX_LINES && theirs.join(" ") === words.join(" ")) return { fontSize: fit(theirs), lines: theirs };
  let best = { fontSize: 0, lines: [words.join(" ")], score: 0 };
  for (let n = 1; n <= Math.min(MAX_LINES, words.length); n++) {
    const lines = splitLines(words, n, (s) => m.width(s, 1));
    const fontSize = fit(lines);
    const lone = n > 1 ? lines.filter(isLone).length : 0;
    const score = fontSize * (1 - LONE_WORD * lone);
    if (score > best.score) best = { fontSize, lines, score };
  }
  return { fontSize: best.fontSize, lines: best.lines };
}

/** A four-pointed sparkle centred on (x, y), its points `r` from the centre. */
function sparkle(x: number, y: number, r: number): string {
  const k = r * 0.16;
  const p = (dx: number, dy: number) => `${r1(x + dx)} ${r1(y + dy)}`;
  return `m ${p(0, -r)} b ${p(k, -k)} ${p(k, -k)} ${p(r, 0)} b ${p(k, k)} ${p(k, k)} ${p(0, r)} b ${p(-k, k)} ${p(-k, k)} ${p(-r, 0)} b ${p(-k, -k)} ${p(-k, -k)} ${p(0, -r)}`;
}

const dot = (x: number, y: number, r: number) => roundRect(x - r, y - r, r * 2, r * 2, r);

export interface YoutubeCoverSpec {
  /** The story's name. */
  name: string;
  /** The AI's split of the name into lines at natural breaks; null to split it here. */
  lines: string[] | null;
  /** The small genre line above the name, e.g. "TRUYỆN MA AUDIO FULL". */
  label: string;
  /** Pill above the name, e.g. "PHẦN 2"; null for the whole story. */
  part: string | null;
  channel: string | null;
  /** "#RRGGBB". */
  accent: string;
}

export function youtubeCoverLines(spec: YoutubeCoverSpec, width: number, height: number, m: FontMetrics, time: (sec: number) => string): AssLayer {
  const start = time(0);
  const end = time(10);
  const accent = assColor(spec.accent);
  const soft = assColor(tint(spec.accent, 0.55));
  const ink = assColor(INK);
  const shape = (layer: number, tags: string, path: string) =>
    `Dialogue: ${layer},${start},${end},YtCover,,0,0,0,,{\\an7\\pos(0,0)\\p1\\bord0\\shad0${tags}}${path}{\\p0}`;
  const text = (layer: number, x: number, y: number, tags: string, t: string) =>
    `Dialogue: ${layer},${start},${end},YtCover,,0,0,0,,{\\an5\\pos(${r1(x)},${r1(y)})${tags}}${t}`;

  const left = width * (PICTURE_SHARE + 0.02);
  const right = width * 0.97;
  const cx = (left + right) / 2;
  const colW = right - left;
  const events: string[] = [];

  // A faint blush of the accent in the corners of the page, then the sparkles.
  for (const [x, y] of [[width, 0], [width, height]]) {
    events.push(shape(0, `\\1c${accent}\\1a&HEC&\\blur${Math.round(height * 0.08)}`, dot(x, y, height * 0.42)));
  }
  const sparkles: [number, number, number, string][] = [
    [0.962, 0.1, 0.03, accent], [0.925, 0.215, 0.014, soft], [0.986, 0.47, 0.019, soft],
    [0.455, 0.07, 0.017, soft], [0.475, 0.94, 0.024, accent], [0.905, 0.955, 0.013, soft],
  ];
  for (const [x, y, r, c] of sparkles) events.push(shape(1, `\\1c${c}`, sparkle(width * x, height * y, height * r)));
  for (const [x, y, r] of [[0.94, 0.06, 0.006], [0.497, 0.895, 0.005], [0.99, 0.36, 0.005]]) {
    events.push(shape(1, `\\1c${soft}`, dot(width * x, height * y, height * r)));
  }

  // The genre line, then the part pill, at the top of the column.
  const labelFs = Math.round(height * 0.036);
  const label = upper(spec.label);
  let top = height * 0.075;
  if (label) {
    events.push(text(3, cx, top, `\\fs${labelFs}\\fsp${Math.round(labelFs * 0.06)}\\1c${ink}\\bord0\\shad0`, label));
    top += labelFs * 0.9;
  }
  if (spec.part) {
    const partFs = Math.round(height * 0.042);
    const part = upper(spec.part);
    const pillH = partFs * 1.15;
    const pillW = m.width(part, partFs) + partFs * 1.6;
    const y = top + pillH * 0.35;
    events.push(shape(2, `\\1c${accent}`, roundRect(cx - pillW / 2, y, pillW, pillH, pillH / 2)));
    events.push(text(3, cx, y + pillH / 2, `\\fs${partFs}\\1c&HFFFFFF&\\bord0\\shad0`, part));
    top = y + pillH;
  }

  // The channel at the bottom, after a headphone in the accent colour.
  const channelFs = Math.round(height * 0.04);
  const bottom = height * 0.935;
  if (spec.channel) {
    const channel = upper(spec.channel);
    const icon = channelFs * 1.1;
    const w = icon + channelFs * 0.35 + m.width(channel, channelFs);
    const x0 = cx - w / 2;
    events.push(shape(2, `\\1c${accent}`, headphones(x0 + icon / 2, bottom, icon)));
    events.push(`Dialogue: 3,${start},${end},YtCover,,0,0,0,,{\\an4\\pos(${r1(x0 + icon + channelFs * 0.35)},${r1(bottom)})\\fs${channelFs}\\1c${ink}\\bord0\\shad0}${channel}`);
  }

  // The name, as big as fits between them, its lines taking turns in the two colours.
  const boxTop = top + height * 0.035;
  const boxBottom = (spec.channel ? bottom - channelFs : height * 0.95) - height * 0.035;
  const { fontSize: fs, lines } = nameLayout(spec.name, spec.lines, m, { width: colW * 0.96, height: boxBottom - boxTop }, height * 0.15);
  const pitch = fs * PITCH;
  const first = (boxTop + boxBottom) / 2 - (pitch * (lines.length - 1)) / 2;
  // A white rim where the name crosses the picture, and a soft shadow lifting it off the page.
  const outline = Math.max(3, Math.round(fs * 0.035));
  const shadow = Math.max(2, Math.round(fs * 0.02));
  const blur = Math.max(1, Math.round(fs * 0.015));
  lines.forEach((line, i) => {
    events.push(text(4, cx, first + i * pitch, `\\fs${r1(fs)}\\1c${i % 2 ? ink : accent}\\bord${outline}\\shad${shadow}\\blur${blur}`, line));
  });

  return {
    style: `Style: YtCover,${COVER_FONT.name},${Math.round(fs)},&H00FFFFFF,&H000000FF,&H00FFFFFF,&HB4000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    events,
  };
}
