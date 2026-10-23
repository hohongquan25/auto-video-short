import { describe, expect, it } from "vitest";
import { jobSteps, stepState } from "../client/src/jobState";
import { clock, languageCode, parseCaptions, timedTranscript } from "../server/lib/captions.js";
import { SUMMARY_DEFAULTS, type Job } from "../server/types.js";
import { pickCaptionTrack } from "../server/lib/ytdlp.js";
import {
  clipsSec, cutPlan, fitClip, lengthBounds, mergeLines, numberedLines, parsePlan, pickClips, summaryPrompt, wordsPerTenSec,
} from "../server/pipeline/summary.js";

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

  it("pads, orders, joins near passages with their narration and drops passages with nothing to say", () => {
    const clips = pickClips([
      { from: 4, to: 5, narration: "Sau đó." },
      { from: 1, to: 2, narration: "Mở đầu." },
      { from: 3, to: 3, narration: "Tiếp theo." },
      { from: 6, to: 6, narration: "" },
    ], lines, 61);
    expect(clips).toEqual([
      { startSec: 0, endSec: 15.35, narration: "Mở đầu. Tiếp theo." },
      { startSec: 29.85, endSec: 40.35, narration: "Sau đó." },
    ]);
    expect(clipsSec(clips)).toBeCloseTo(25.85);
  });

  it("clamps line numbers the AI got wrong and swaps reversed ranges", () => {
    expect(pickClips([{ from: 5, to: 99, narration: "x" }, { from: 2, to: 1, narration: "y" }], lines, 61).map((c) => c.startSec)).toEqual([0, 35.35]);
  });

  it("reads the AI's reply", () => {
    const reply = 'Xong.\n{"title":"T","summary":"S","keyPoints":["k"],"clips":[{"from":"1","to":"2","narration":" N "}]}';
    expect(parsePlan(reply, lines, 61)).toEqual({
      title: "T", text: "S", keyPoints: ["k"], suggested: null, clips: [{ startSec: 0, endSec: 9.35, narration: "N" }],
    });
    expect(() => parsePlan('{"summary":"S","clips":[{"from":1,"to":2}]}', lines, 61)).toThrow(/có lời kể/);
  });

  it("reads the length the AI judged enough, kept within bounds, and shrugs off a garbled one", () => {
    const reply = (sec: unknown) => JSON.stringify({ summary: "S", suggestedSec: sec, suggestedReason: "Ba diễn biến", clips: [{ from: 1, to: 2, narration: "N" }] });
    expect(parsePlan(reply("17.4"), lines, 61).suggested).toEqual({ sec: 17, reason: "Ba diễn biến" });
    expect(parsePlan(reply(999), lines, 61).suggested).toEqual({ sec: 20, reason: "Ba diễn biến" });
    expect(parsePlan(reply("khá dài"), lines, 61).suggested).toBeNull();
    expect([lengthBounds(7200), lengthBounds(600), lengthBounds(120)]).toEqual([
      { minSec: 60, maxSec: 1800 }, { minSec: 60, maxSec: 200 }, { minSec: 30, maxSec: 40 },
    ]);
  });

  it("merges neighbouring lines when there are too many to send", () => {
    expect(mergeLines(lines, 3)).toEqual([line(0, 9, "a b"), line(10, 35, "c d"), line(35.5, 60.5, "e f")]);
    expect(mergeLines(lines, 10)).toBe(lines);
  });

  it("numbers every line for the AI and sizes the narration for the voice's speed", () => {
    const prompt = summaryPrompt({
      title: "V", durationSec: 61, lines: lines.slice(0, 2), from: "speech", language: "en", targetSec: 30, rate: "+0%", focus: "",
    });
    expect(prompt).toContain("[1] 0:00 (4.0s) a\n[2] 0:04 (4.8s) b");
    expect(prompt).toContain("Tiếng Anh (nhận dạng tự động");
    expect(prompt).toContain("khoảng 30 chữ cho mỗi 10 giây");
    expect(prompt).toContain("tổng độ dài khoảng 30 giây");
    expect(wordsPerTenSec("+20%")).toBe(36);
  });

  it("lets the AI choose the length when none is wanted", () => {
    const prompt = summaryPrompt({
      title: "V", durationSec: 61, lines: lines.slice(0, 2), from: "captions", language: null, targetSec: null, rate: "+0%", focus: "",
    });
    expect(prompt).toContain("vừa đủ dài để kể trọn nội dung");
    expect(prompt).toContain("trong khoảng 15 đến 20 giây");
    expect(prompt).toContain("tổng độ dài bằng độ dài vừa đủ ở bước 2");
    expect(prompt).not.toContain("<trong_tam>");
  });

  it("puts the user's focus ahead of the general rules", () => {
    const prompt = summaryPrompt({
      title: "V", durationSec: 61, lines: lines.slice(0, 2), from: "captions", language: null, targetSec: null, rate: "+0%",
      focus: "  Tập trung vào các cảnh đánh nhau. ",
    });
    expect(prompt).toContain("<trong_tam>\nTập trung vào các cảnh đánh nhau.\n</trong_tam>");
    expect(prompt).toContain("Ưu tiên những khúc đúng trọng tâm ở trên.");
  });

  it("points out the long pauses between lines, where fights and chases often are", () => {
    expect(numberedLines(lines.slice(1, 4))).toBe("[1] 0:04 (4.8s) b\n[2] 0:10 (5.0s) c\n… 15 giây không lời thoại …\n[3] 0:30 (5.0s) d");
  });
});

describe("cutPlan", () => {
  it("makes each passage as long as its narration and its pause, its footage also covering the dissolve into it", () => {
    const clips = [{ startSec: 10, endSec: 20, narration: "a" }, { startSec: 40, endSec: 50, narration: "b" }];
    expect(cutPlan(clips, [9.8, 5], 100)).toEqual([
      { lengthSec: 10, leadSec: 0, span: { startSec: 10, lengthSec: 10, speed: 1 } },
      { lengthSec: 5.2, leadSec: 0.5, span: { startSec: 40, lengthSec: 7.125, speed: 1.25 } },
    ]);
  });
});

describe("fitClip", () => {
  const clip = { startSec: 10, endSec: 20, narration: "x" };

  it("plays a passage a little slower or faster to last as long as its narration", () => {
    expect(fitClip(clip, 10, 30)).toEqual({ startSec: 10, lengthSec: 10, speed: 1 });
    const slower = fitClip(clip, 11, 30);
    expect(slower.lengthSec).toBeCloseTo(10);
    expect(slower.speed).toBeCloseTo(10 / 11);
  });

  it("cuts a passage short when its narration is much shorter", () => {
    expect(fitClip(clip, 5, 30)).toEqual({ startSec: 10, lengthSec: 6.25, speed: 1.25 });
  });

  it("plays on into what follows when the narration is much longer, never into the next passage", () => {
    expect(fitClip(clip, 20, 30)).toEqual({ startSec: 10, lengthSec: 16, speed: 0.8 });
    expect(fitClip(clip, 20, 22)).toEqual({ startSec: 10, lengthSec: 12, speed: 0.8 });
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
    expect(jobSteps(j)).toEqual(["download", "captions", "extract", "transcribe", "summarize", "narrate", "cut"]);
    expect(stepState(j, "transcribe")).toBe("skipped");
    expect(stepState(job({ kind: "summary", summary: summary({ settings: { ...SUMMARY_DEFAULTS, useCaptions: false } }) }), "captions")).toBe("skipped");
  });
});
