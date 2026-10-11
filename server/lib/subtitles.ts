import { splitSentences } from "./text.js";

export interface Cue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface SubtitleLayout {
  fontSize: number;
  marginV: number;
  marginH: number;
  /** Longest cue, in characters: about two lines at this font size. */
  maxCueChars: number;
}

/** Size subtitles from the video frame so landscape and vertical backgrounds both read well. */
export function subtitleLayout(width: number, height: number): SubtitleLayout {
  const vertical = height > width;
  const fontSize = Math.round(Math.min(width, height) * 0.055);
  const marginH = Math.round(width * 0.06);
  // Arial averages about half an em per character, Vietnamese diacritics included.
  const charsPerLine = Math.floor((width - 2 * marginH) / (fontSize * 0.52));
  return {
    fontSize,
    marginH,
    // Vertical videos sit higher, clear of the TikTok / Shorts caption and buttons.
    marginV: Math.round(height * (vertical ? 0.22 : 0.07)),
    maxCueChars: Math.max(20, Math.min(90, Math.floor(charsPerLine * 1.8))),
  };
}

/** Greedily join pieces with spaces into lines of at most `limit` characters. */
function pack(pieces: string[], limit: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const next = current ? `${current} ${piece}` : piece;
    if (next.length > limit && current) {
      out.push(current);
      current = piece;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Break text into subtitle cues: whole sentences when they fit, otherwise at
 * commas, and a clause still too long is cut into near-equal halves (thirds…)
 * rather than a full cue plus a stray word or two.
 */
export function cueTexts(text: string, maxChars: number): string[] {
  const cues: string[] = [];
  for (const sentence of splitSentences(text)) {
    const phrases = sentence.length <= maxChars ? [sentence] : sentence.split(/(?<=[,;:])\s+/).flatMap((clause) => {
      if (clause.length <= maxChars) return [clause];
      const n = Math.ceil(clause.length / maxChars);
      return pack(clause.split(/\s+/), Math.min(maxChars, Math.ceil(clause.length / n) + 8));
    });
    const lines = pack(phrases, maxChars);
    // A short sentence may share a cue with the previous one, but never splits across cues.
    const last = cues.at(-1);
    if (lines.length === 1 && last && last.length + 1 + lines[0].length <= maxChars) cues[cues.length - 1] = `${last} ${lines[0]}`;
    else cues.push(...lines);
  }
  return cues;
}

/**
 * Split each clip's text into short cues and spread the clip's duration over
 * them by character count. TTS reads at a near-constant pace, so this stays
 * within a fraction of a second without word-level timing from the provider.
 */
export function buildCues(clips: { text: string; durationSec: number }[], gapSec: number, maxCueChars: number): Cue[] {
  const cues: Cue[] = [];
  let offset = 0;
  for (const clip of clips) {
    const pieces = cueTexts(clip.text, maxCueChars);
    const totalChars = pieces.reduce((s, p) => s + p.length, 0);
    let t = offset;
    for (const text of pieces) {
      const len = totalChars ? (clip.durationSec * text.length) / totalChars : 0;
      cues.push({ startSec: t, endSec: t + len, text });
      t += len;
    }
    offset += clip.durationSec + gapSec;
  }
  return cues;
}

/** ASS time: h:mm:ss.cc */
export function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs % 100)}`;
}

/** Braces start ASS override tags and backslashes start escapes, so neither may reach the renderer. */
const assText = (text: string) => text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();

/** Extra drawn elements (channel badge, subscribe animation): one style and its events. */
export interface AssLayer {
  style: string;
  events: string[];
}

/**
 * White bold subtitles with a dark outline, bottom-centred, sized for this
 * frame, plus any overlay `layers`.
 */
export function buildAss(cues: Cue[], width: number, height: number, layers: AssLayer[] = []): string {
  const l = subtitleLayout(width, height);
  const outline = Math.max(2, Math.round(l.fontSize * 0.08));
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${l.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},1,2,${l.marginH},${l.marginH},${l.marginV},1`,
    ...layers.map((x) => x.style),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...layers.flatMap((x) => x.events),
    ...cues.map((c) => `Dialogue: 0,${assTime(c.startSec)},${assTime(c.endSec)},Default,,0,0,0,,${assText(c.text)}`),
    "",
  ].join("\n");
}
