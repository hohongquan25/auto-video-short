import type { BrandPosition } from "../types.js";

/**
 * The channel badge, drawn with ASS vector shapes so it is crisp at any
 * resolution: a dark rounded pill with a thin accent border, an accent
 * circle holding a headphone icon, and the channel name with its last word
 * in the accent colour ("Gác trọ" white, "Audio" accent).
 */

/** Arial Bold advance widths per 1000 units (same as Helvetica Bold). */
const WIDTHS: Record<string, number> = {
  " ": 278, a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889,
  n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833, N: 722,
  O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ".": 278, ",": 278, ":": 333, "!": 333, "?": 611, "-": 333, "'": 238, "&": 722, "|": 280,
};

/**
 * Width of `text` set in Arial Bold at `fontSize`. Vietnamese letters are a
 * base letter plus marks that take no extra room, so they are measured as
 * the base letter (đ, which does not decompose, as d).
 */
export function textWidth(text: string, fontSize: number): number {
  const base = text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
  let units = 0;
  for (const ch of base) units += WIDTHS[ch] ?? 600;
  return (units / 1000) * fontSize;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** ASS drawing of a rounded rectangle with its top-left corner at (x, y). */
export function roundRect(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.min(radius, w / 2, h / 2);
  const c = r * 0.5523; // control-point offset that makes a cubic Bézier a quarter circle
  const [L, T, R, B] = [x, y, x + w, y + h];
  return [
    `m ${r1(L + r)} ${r1(T)}`,
    `l ${r1(R - r)} ${r1(T)}`,
    `b ${r1(R - r + c)} ${r1(T)} ${r1(R)} ${r1(T + r - c)} ${r1(R)} ${r1(T + r)}`,
    `l ${r1(R)} ${r1(B - r)}`,
    `b ${r1(R)} ${r1(B - r + c)} ${r1(R - r + c)} ${r1(B)} ${r1(R - r)} ${r1(B)}`,
    `l ${r1(L + r)} ${r1(B)}`,
    `b ${r1(L + r - c)} ${r1(B)} ${r1(L)} ${r1(B - r + c)} ${r1(L)} ${r1(B - r)}`,
    `l ${r1(L)} ${r1(T + r)}`,
    `b ${r1(L)} ${r1(T + r - c)} ${r1(L + r - c)} ${r1(T)} ${r1(L + r)} ${r1(T)}`,
  ].join(" ");
}

/**
 * Headphones fitting a `size` box centred on (cx, cy): a headband arch
 * (outer arc over, inner arc back, so no hole is needed) and two ear cups.
 */
export function headphones(cx: number, cy: number, size: number): string {
  const ro = size * 0.44; // outer radius of the band
  const ri = ro - size * 0.11; // inner radius
  const ay = cy + size * 0.02; // arch centre, a little low so the whole icon sits centred
  const k = 0.5523;
  const band = [
    `m ${r1(cx - ro)} ${r1(ay)}`,
    `b ${r1(cx - ro)} ${r1(ay - ro * k)} ${r1(cx - ro * k)} ${r1(ay - ro)} ${r1(cx)} ${r1(ay - ro)}`,
    `b ${r1(cx + ro * k)} ${r1(ay - ro)} ${r1(cx + ro)} ${r1(ay - ro * k)} ${r1(cx + ro)} ${r1(ay)}`,
    `l ${r1(cx + ri)} ${r1(ay)}`,
    `b ${r1(cx + ri)} ${r1(ay - ri * k)} ${r1(cx + ri * k)} ${r1(ay - ri)} ${r1(cx)} ${r1(ay - ri)}`,
    `b ${r1(cx - ri * k)} ${r1(ay - ri)} ${r1(cx - ri)} ${r1(ay - ri * k)} ${r1(cx - ri)} ${r1(ay)}`,
  ].join(" ");
  const cupW = size * 0.22;
  const cupH = size * 0.38;
  const cupY = ay - size * 0.04;
  return [
    band,
    roundRect(cx - ro - size * 0.02, cupY, cupW, cupH, cupW * 0.4),
    roundRect(cx + ro + size * 0.02 - cupW, cupY, cupW, cupH, cupW * 0.4),
  ].join(" ");
}

/** "#RRGGBB" → ASS "&HBBGGRR&". */
export function assColor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "&HFFFFFF&";
  return `&H${m[3]}${m[2]}${m[1]}&`.toUpperCase();
}

const assText = (text: string) => text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();

export interface BadgeSpec {
  text: string;
  position: BrandPosition;
  /** Accent colour, "#RRGGBB". */
  color: string;
  durationSec: number;
  /** Fade in at the start; off for a still image taken at the first frame. */
  fadeIn?: boolean;
}

/** Style and Dialogue lines that draw the badge on a `width`×`height` frame. */
export function badgeLines(b: BadgeSpec, width: number, height: number, time: (sec: number) => string): { style: string; events: string[] } {
  const vertical = height > width;
  const fs = Math.round(Math.min(width, height) * 0.036);
  const h = Math.round(fs * 1.9);
  const inset = Math.round(h * 0.13);
  const d = h - 2 * inset; // icon circle diameter
  const textX = inset + d + fs * 0.5;
  const text = assText(b.text);
  const w = Math.round(textX + textWidth(text, fs) + fs * 0.7);
  const marginH = Math.round(width * 0.035);
  // Below TikTok's "Following | For You" tabs on a vertical frame.
  const y = Math.round(height * (vertical ? 0.085 : 0.045));
  const x = b.position === "top-left" ? marginH : width - marginH - w;

  const accent = assColor(b.color);
  const dark = "&H161616&";
  const start = time(0);
  const end = time(b.durationSec + 1);
  const fade = b.fadeIn === false ? "" : "\\fad(600,0)";
  const draw = (layer: number, tags: string, path: string) =>
    `Dialogue: ${layer},${start},${end},Brand,,0,0,0,,{\\an7\\pos(0,0)${fade}\\p1${tags}}${path}{\\p0}`;

  // Last word in the accent colour, the rest white.
  const words = text.split(" ");
  const label = words.length > 1
    ? `${words.slice(0, -1).join(" ")} {\\1c${accent}}${words[words.length - 1]}`
    : text;
  const outline = Math.max(1.5, Math.round(fs * 0.07 * 10) / 10);
  const shadow = Math.max(1, Math.round(fs * 0.1));

  return {
    style: `Style: Brand,Arial,${fs},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    events: [
      draw(2, `\\1c${dark}\\1a&H30&\\bord${outline}\\3c${accent}\\3a&H20&\\shad${shadow}\\4c&H000000&\\4a&H90&`, roundRect(x, y, w, h, h / 2)),
      draw(3, `\\1c${accent}\\bord0\\shad0`, roundRect(x + inset, y + inset, d, d, d / 2)),
      draw(4, `\\1c${dark}\\bord0\\shad0`, headphones(x + inset + d / 2, y + h / 2, d * 0.62)),
      `Dialogue: 4,${start},${end},Brand,,0,0,0,,{\\an4\\pos(${r1(x + textX)},${r1(y + h / 2)})${fade}\\bord0\\shad0}${label}`,
    ],
  };
}
