/** One timed line of what a video says, from its captions or from Whisper. */
export interface TimedLine {
  startSec: number;
  endSec: number;
  text: string;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const seconds = (m: RegExpExecArray) =>
  Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
/** Caption text without its markup: VTT word timings and styling tags, ASS overrides, HTML entities. */
const plain = (line: string) =>
  line.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, " ").trim();

/**
 * Read SRT or WebVTT captions into timed lines, one per cue. YouTube's
 * automatic captions roll: each cue repeats the line shown before it above
 * the new one, and a short cue repeats it alone, so lines the previous cue
 * already showed are dropped. A cue's other lines are one wrapped sentence.
 */
export function parseCaptions(text: string): TimedLine[] {
  const lines: TimedLine[] = [];
  let shown: string[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const rows = block.split("\n");
    const at = rows.findIndex((row) => row.includes("-->"));
    if (at < 0) continue;
    const [from, to] = rows[at].split("-->");
    const start = TIME.exec(from);
    const end = TIME.exec(to);
    if (!start || !end) continue;
    const texts = rows.slice(at + 1).map(plain).filter(Boolean);
    const fresh = texts.filter((t) => !shown.includes(t));
    if (texts.length) shown = texts;
    if (fresh.length) lines.push({ startSec: seconds(start), endSec: seconds(end), text: fresh.join(" ") });
  }
  lines.sort((a, b) => a.startSec - b.startSec);
  // A rolling line stays up until the next one replaces it.
  for (const [i, line] of lines.entries()) {
    const next = lines[i + 1];
    if (line.endSec - line.startSec < 0.5 && next) line.endSec = Math.max(line.endSec, next.startSec);
    if (line.endSec <= line.startSec) line.endSec = line.startSec + 1;
  }
  return lines;
}

/** Two-letter codes of the three-letter language tags video files carry (ISO 639-2). */
const ISO_639_2: Record<string, string> = {
  eng: "en", vie: "vi", chi: "zh", zho: "zh", jpn: "ja", kor: "ko", tha: "th", ind: "id", may: "ms", msa: "ms",
  fre: "fr", fra: "fr", ger: "de", deu: "de", spa: "es", por: "pt", rus: "ru", hin: "hi", ara: "ar",
};

/** "eng" → "en", "en-US" → "en"; null for "und" (undetermined) and missing tags. */
export function languageCode(tag: string | null | undefined): string | null {
  const t = (tag ?? "").toLowerCase().split(/[-_]/)[0];
  if (!t || t === "und") return null;
  return ISO_639_2[t] ?? t;
}

/** h:mm:ss, or m:ss under an hour. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** The transcript as people read it: one "[m:ss] line" per timed line. */
export const timedTranscript = (lines: TimedLine[]): string => lines.map((l) => `[${clock(l.startSec)}] ${l.text}`).join("\n");
