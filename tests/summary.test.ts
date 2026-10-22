import { describe, expect, it } from "vitest";
import { jobSteps, stepState } from "../client/src/jobState";
import { clock, languageCode, parseCaptions, timedTranscript } from "../server/lib/captions.js";
import { SUMMARY_DEFAULTS, type Job } from "../server/types.js";
import { pickCaptionTrack } from "../server/lib/ytdlp.js";
import { clipCues, clipsSec, mergeLines, parsePlan, pickClips, summaryPrompt } from "../server/pipeline/summary.js";

const line = (startSec: number, endSec: number, text: string) => ({ startSec, endSec, text });

describe("parseCaptions", () => {
  it("reads SRT, joining a cue's wrapped lines", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>there</i>,\r\nmy friend.\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nTom &amp; Jerry\r\n";
    expect(parseCaptions(srt)).toEqual([line(1, 3.5, "Hello there, my friend."), line(4, 6, "Tom & Jerry")]);
  });

  it("drops the lines YouTube's rolling captions repeat, and keeps each line up until the next", () => {
    const vtt = [
      "WEBVTT\nKind: captions\nLanguage: en",
      "00:00:00.000 --> 00:00:02.000 align:start position:0%\nwe<00:00:00.500><c> went</c><00:00:01.000><c> home</c>",
      "00:00:02.000 --> 00:00:02.010 align:start position:0%\nwe went home",
      "00:00:02.010 --> 00:00:04.000 align:start position:0%\nwe went home\nand<00:00:02.500><c> slept</c>",
      "00:00:04.000 --> 00:00:04.010\nand slept",
      "00:00:04.010 --> 00:00:06.000\nand slept\nthe end",
    ].join("\n\n");
    expect(parseCaptions(vtt)).toEqual([line(0, 2, "we went home"), line(2.01, 4, "and slept"), line(4.01, 6, "the end")]);
  });

  it("reads short VTT times without hours", () => {
    expect(parseCaptions("WEBVTT\n\n01:02.5 --> 01:04.25\nhi")).toEqual([line(62.5, 64.25, "hi")]);
  });
});

describe("caption languages and times", () => {
  it("turns file tags into two-letter codes", () => {
    expect(["eng", "vie", "jpn", "en-US", "und", null].map(languageCode)).toEqual(["en", "vi", "ja", "en", null, null]);
  });

  it("writes clock times and a readable transcript", () => {
    expect([5, 65, 3725].map(clock)).toEqual(["0:05", "1:05", "1:02:05"]);
    expect(timedTranscript([line(5, 7, "a"), line(65, 66, "b")])).toBe("[0:05] a\n[1:05] b");
  });
});

describe("pickCaptionTrack", () => {
  it("prefers captions people wrote, in the wanted or the video's language", () => {
    const info = { subtitles: { en: [], vi: [], live_chat: [] }, automatic_captions: { "en-orig": [] }, language: "en" };
    expect(pickCaptionTrack(info, "vi")).toEqual({ key: "vi", auto: false });
    expect(pickCaptionTrack(info, "")).toEqual({ key: "en", auto: false });
    // YouTube often does not say what a video speaks: any written track still tells what it says.
    expect(pickCaptionTrack({ subtitles: { de: [], en: [] }, automatic_captions: { en: [] } }, "")).toEqual({ key: "de", auto: false });
  });

  it("takes the site's captions of the speech itself, never its translations", () => {
    expect(pickCaptionTrack({ subtitles: {}, automatic_captions: { vi: [], fr: [], "ja-orig": [] } }, "")).toEqual({ key: "ja-orig", auto: true });
    expect(pickCaptionTrack({ automatic_captions: { vi: [], en: [] }, language: "en" }, "")).toEqual({ key: "en", auto: true });
    // Without knowing what is spoken, an automatic track may be a translation.
    expect(pickCaptionTrack({ automatic_captions: { vi: [], en: [] } }, "")).toBeNull();
  });
});

describe("summary passages", () => {
  const lines = [line(0, 4, "a"), line(4.2, 9, "b"), line(10, 15, "c"), line(30, 35, "d"), line(35.5, 40, "e"), line(60, 60.5, "f")];

  it("pads, orders, joins near passages and drops slivers", () => {
    const clips = pickClips([
      { from: 4, to: 5, note: "later" },
      { from: 1, to: 2, note: "start" },
      { from: 3, to: 3, note: "" },
      { from: 6, to: 6, note: "too short" },
    ], lines, 61);
    expect(clips).toEqual([
      { startSec: 0, endSec: 15.35, note: "start" },
      { startSec: 29.85, endSec: 40.35, note: "later" },
    ]);
    expect(clipsSec(clips)).toBeCloseTo(25.85);
  });

  it("clamps line numbers the AI got wrong and swaps reversed ranges", () => {
    expect(pickClips([{ from: 5, to: 99, note: "" }, { from: 2, to: 1, note: "" }], lines, 61).map((c) => c.startSec)).toEqual([0, 35.35]);
  });

  it("reads the AI's reply", () => {
    const reply = 'Xong.\n{"title":"T","summary":"S","keyPoints":["k"],"clips":[{"from":"1","to":"2"}]}';
    expect(parsePlan(reply, lines, 61)).toEqual({ title: "T", text: "S", keyPoints: ["k"], clips: [{ startSec: 0, endSec: 9.35, note: "" }] });
    expect(() => parsePlan('{"summary":"S","clips":[{"from":6,"to":6}]}', lines, 61)).toThrow(/không chọn được/);
  });

  it("merges neighbouring lines when there are too many to send", () => {
    expect(mergeLines(lines, 3)).toEqual([line(0, 9, "a b"), line(10, 35, "c d"), line(35.5, 60.5, "e f")]);
    expect(mergeLines(lines, 10)).toBe(lines);
  });

  it("numbers every line for the AI, with its start and length", () => {
    const prompt = summaryPrompt({
      title: "V", durationSec: 61, lines: lines.slice(0, 2), from: "speech", language: "en", targetSec: 30, summaryLanguage: "vi",
    });
    expect(prompt).toContain("[1] 0:00 (4.0s) a\n[2] 0:04 (4.8s) b");
    expect(prompt).toContain("Tiếng Anh (nhận dạng tự động");
    expect(prompt).toContain("bằng Tiếng Việt");
  });
});

describe("clipCues", () => {
  it("times each kept line from the clip's start, inside the clip", () => {
    const lines = [line(9, 11, "before"), line(11, 13, "one two"), line(13, 20, "late")];
    const texts = new Map([[0, "before"], [1, "một hai"], [2, "late"]]);
    const cues = clipCues(lines, texts, { startSec: 10, endSec: 15, note: "" }, 40);
    expect(cues).toEqual([
      { startSec: 0, endSec: 1, text: "before" },
      { startSec: 1, endSec: 3, text: "một hai" },
      { startSec: 3, endSec: 5, text: "late" },
    ]);
  });
});

describe("job steps", () => {
  const job = (patch: Partial<Job>) =>
    ({ kind: "story", sourceUrl: null, sourceTopic: null, summary: null, status: "running", step: null, timings: {}, settings: {}, ...patch }) as Job;
  const summary = (patch: Partial<NonNullable<Job["summary"]>>) => ({ settings: SUMMARY_DEFAULTS, transcriptFrom: null, language: null, result: null, ...patch });

  it("shows a story job's own steps, as before summaries", () => {
    expect(jobSteps(job({}))).toEqual(["extract", "transcribe", "rewrite", "review", "tts", "render", "publish", "upload"]);
    expect(jobSteps(job({ sourceUrl: "https://x" }))[0]).toBe("download");
    expect(jobSteps(job({ sourceTopic: {} as Job["sourceTopic"] }))).toEqual(["write", "review", "tts", "render", "publish", "upload"]);
  });

  it("shows a summary job's steps, skipping speech when captions were read", () => {
    const j = job({ kind: "summary", sourceUrl: "https://x", summary: summary({ transcriptFrom: "captions" }) });
    expect(jobSteps(j)).toEqual(["download", "captions", "extract", "transcribe", "summarize", "cut"]);
    expect(stepState(j, "transcribe")).toBe("skipped");
    expect(stepState(job({ kind: "summary", summary: summary({ settings: { ...SUMMARY_DEFAULTS, useCaptions: false } }) }), "captions")).toBe("skipped");
  });
});
