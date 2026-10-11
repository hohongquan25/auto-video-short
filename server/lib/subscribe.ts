import { assColor, roundRect, textWidth } from "./badge.js";

/**
 * The "subscribe + bell" call to action, as ASS vector shapes and animation
 * tags. About five seconds:
 *   0.0s  button and bell pop in
 *   0.45s a cursor glides onto the button, clicks at 1.2s (ripple), and the
 *         button turns grey: "ĐÃ ĐĂNG KÝ"
 *   1.6s  the cursor moves to the bell and clicks at 2.2s: the bell swings
 *         and takes the channel's accent colour
 *   4.5s  everything fades out
 * TikTok says "THEO DÕI" (follow) in its pink-red instead of YouTube's red.
 */

export type CtaPlatform = "youtube" | "tiktok";
export type CtaTiming = "start" | "end" | "both";

const LABELS: Record<CtaPlatform, { idle: string; done: string; color: string }> = {
  youtube: { idle: "ĐĂNG KÝ", done: "ĐÃ ĐĂNG KÝ", color: "#FF0033" },
  tiktok: { idle: "THEO DÕI", done: "ĐÃ THEO DÕI", color: "#FE2C55" },
};

/** Length of one run of the animation, in seconds. */
export const CTA_SEC = 5;

/** When the animation starts in a video of `durationSec`: shortly after the start, before the end, or both. */
export function ctaStarts(durationSec: number, timing: CtaTiming): number[] {
  const early = 2.5;
  const late = durationSec - CTA_SEC - 1;
  // Too short for two runs that do not overlap: keep the one asked for, or the late one.
  if (late < early + CTA_SEC + 2) {
    if (late < 0.5) return [];
    return [timing === "start" ? early : late];
  }
  return timing === "start" ? [early] : timing === "end" ? [late] : [early, late];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Bell centred on (0, 0) in a `s`-sized box: body with a flared rim, a knob on top and the clapper below. */
function bell(s: number): string {
  // Drawn around (0, 0) but shifted so every coordinate is positive and the shape starts at
  // exactly 0: libass centres a drawing on the box from its origin to its far edge, so
  // negative coordinates would push the bell off the button's centre line.
  const p = (x: number, y: number) => `${r1((x + 0.44) * s)} ${r1((y + 0.5) * s)}`;
  const body = [
    `m ${p(-0.44, 0.24)}`,
    `b ${p(-0.31, 0.14)} ${p(-0.31, 0.02)} ${p(-0.31, -0.08)}`,
    `b ${p(-0.31, -0.33)} ${p(-0.17, -0.41)} ${p(0, -0.41)}`,
    `b ${p(0.17, -0.41)} ${p(0.31, -0.33)} ${p(0.31, -0.08)}`,
    `b ${p(0.31, 0.02)} ${p(0.31, 0.14)} ${p(0.44, 0.24)}`,
    `l ${p(-0.44, 0.24)}`,
  ].join(" ");
  const knob = roundRect((0.44 - 0.065) * s, 0, 0.13 * s, 0.13 * s, 0.065 * s);
  const clapper = roundRect((0.44 - 0.11) * s, (0.5 + 0.28) * s, 0.22 * s, 0.17 * s, 0.085 * s);
  return `${body} ${knob} ${clapper}`;
}

/** Classic arrow pointer with its tip at (0, 0). */
function cursor(s: number): string {
  const pts = [[0, 0], [0, 0.92], [0.24, 0.7], [0.4, 1.04], [0.53, 0.98], [0.37, 0.65], [0.68, 0.65]];
  return `m ${pts.map(([x, y]) => `${r1(x * s)} ${r1(y * s)}`).join(" l ")}`;
}

/** Frame-relative layout, exported for tests. */
export function ctaLayout(width: number, height: number, platform: CtaPlatform) {
  const vertical = height > width;
  // Larger on a phone-shaped frame, where the button would otherwise look lost.
  const fs = Math.round(Math.min(width, height) * (vertical ? 0.058 : 0.046));
  const h = Math.round(fs * 2.15);
  const label = LABELS[platform];
  const w = Math.round(Math.max(textWidth(label.idle, fs), textWidth(label.done, fs)) + fs * 2.2);
  const bellSize = Math.round(h * 0.95);
  const gap = Math.round(fs * 0.7);
  const total = w + gap + bellSize;
  // Above the subtitles (which sit at 22% / 7% from the bottom).
  const cy = Math.round(height * (vertical ? 0.63 : 0.7));
  const left = Math.round((width - total) / 2);
  return {
    fs, h, w, bellSize, cy,
    buttonX: left + w / 2,
    bellX: left + w + gap + bellSize / 2,
  };
}

export interface CtaSpec {
  platform: CtaPlatform;
  /** Bell colour once it is "on": the channel accent. */
  accent: string;
  /** Seconds into the video at which each run starts. */
  starts: number[];
}

export function ctaLines(spec: CtaSpec, width: number, height: number, time: (sec: number) => string): { style: string; events: string[] } {
  const { fs, h, w, bellSize, cy, buttonX, bellX } = ctaLayout(width, height, spec.platform);
  const label = LABELS[spec.platform];
  const red = assColor(label.color);
  const accent = assColor(spec.accent);
  const shadow = Math.max(2, Math.round(fs * 0.12));
  const pill = roundRect(0, 0, w, h, h / 2);
  const bellPath = bell(bellSize);
  const clickX = buttonX + w * 0.22;
  const cursorSize = Math.round(fs * 1.5);
  const cursorBorder = Math.max(1.5, r1(fs * 0.07));
  const ripple = roundRect(0, 0, h * 0.8, h * 0.8, h * 0.4);

  // Pop in from nothing with a slight overshoot.
  const pop = "\\fscx0\\fscy0\\t(0,180,\\fscx112\\fscy112)\\t(180,320,\\fscx100\\fscy100)";
  // Damped swing about the top of the bell.
  const swing = [18, -16, 13, -10, 7, -4, 0]
    .map((deg, i) => `\\t(${2200 + i * 170},${2370 + i * 170},\\frz${deg})`).join("");
  const fadeOut = "\\fad(0,450)";

  const events: string[] = [];
  for (const t0 of spec.starts) {
    const ev = (layer: number, from: number, to: number, tags: string, body: string) =>
      `Dialogue: ${layer},${time(t0 + from)},${time(t0 + to)},Cta,,0,0,0,,{${tags}}${body}`;
    const shape = (path: string) => `{\\p1}${path}{\\p0}`;
    const at = (x: number, y: number) => `\\an5\\pos(${r1(x)},${r1(y)})`;

    // Button before the click: red, squashes as it is pressed.
    const press = "\\t(1200,1300,\\fscx94\\fscy94)";
    events.push(ev(10, 0, 1.35, `${at(buttonX, cy)}${pop}${press}\\1c${red}\\bord0\\shad${shadow}\\4c&H000000&\\4a&H80&`, shape(pill)));
    events.push(ev(11, 0, 1.35, `${at(buttonX, cy)}${pop}${press}\\bord0\\shad0\\1c&HFFFFFF&`, label.idle));
    // After the click: grey, springs back to full size.
    const release = "\\fscx94\\fscy94\\t(0,140,\\fscx100\\fscy100)";
    events.push(ev(10, 1.35, CTA_SEC, `${at(buttonX, cy)}${release}${fadeOut}\\1c&H3A3A3A&\\bord0\\shad${shadow}\\4c&H000000&\\4a&H80&`, shape(pill)));
    events.push(ev(11, 1.35, CTA_SEC, `${at(buttonX, cy)}${release}${fadeOut}\\bord0\\shad0\\1c&HD0D0D0&`, label.done));

    // Bell: white with a dark edge, swings and turns accent when clicked.
    const pivot = `\\org(${r1(bellX)},${r1(cy - bellSize * 0.48)})`;
    events.push(ev(10, 0, CTA_SEC,
      `${at(bellX, cy)}${pivot}${pop}${fadeOut}\\1c&HFFFFFF&\\t(2200,2260,\\1c${accent})\\bord${r1(fs * 0.06)}\\3c&H202020&\\shad${shadow}\\4a&H80&${swing}`,
      shape(bellPath)));

    // Click ripples.
    const rippleTags = "\\1c&HFFFFFF&\\1a&H50&\\bord0\\shad0\\fscx30\\fscy30\\t(0,550,\\fscx230\\fscy230\\1a&HFF&)";
    events.push(ev(12, 1.2, 1.75, `${at(clickX, cy)}${rippleTags}`, shape(ripple)));
    events.push(ev(12, 2.2, 2.75, `${at(bellX, cy)}${rippleTags}`, shape(ripple)));

    // Cursor: in from the lower right to the button, then on to the bell.
    const cursorTags = `\\an7\\1c&HFFFFFF&\\bord${cursorBorder}\\3c&H000000&\\shad0`;
    const click = (ms: number) => `\\t(${ms},${ms + 100},\\fscx82\\fscy82)\\t(${ms + 100},${ms + 200},\\fscx100\\fscy100)`;
    const sx = clickX + w * 0.7;
    const sy = cy + h * 1.9;
    events.push(ev(13, 0.45, 1.6, `${cursorTags}\\move(${r1(sx)},${r1(sy)},${r1(clickX)},${r1(cy)},0,600)\\fad(150,0)${click(750)}`, shape(cursor(cursorSize))));
    events.push(ev(13, 1.6, 3.1, `${cursorTags}\\move(${r1(clickX)},${r1(cy)},${r1(bellX)},${r1(cy)},0,450)\\fad(0,400)${click(600)}`, shape(cursor(cursorSize))));
  }

  return {
    style: `Style: Cta,Arial,${fs},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,5,0,0,0,1`,
    events,
  };
}
