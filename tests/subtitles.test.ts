import { describe, expect, it } from "vitest";
import { badgeLines } from "../server/lib/badge.js";
import { assTime, buildAss, buildCues, cueTexts, subtitleLayout } from "../server/lib/subtitles.js";

describe("buildCues", () => {
  it("spreads each clip over its cues by length and skips the gap between clips", () => {
    const cues = buildCues([
      { text: "Một hai ba. Bốn năm sáu.", durationSec: 4 },
      { text: "Bảy tám.", durationSec: 1 },
    ], 0.4, 12);
    expect(cues.map((c) => c.text)).toEqual(["Một hai ba.", "Bốn năm sáu.", "Bảy tám."]);
    expect(cues[0].startSec).toBe(0);
    expect(cues[1].startSec).toBeCloseTo(cues[0].endSec);
    expect(cues[1].endSec).toBeCloseTo(4);
    expect(cues[2].startSec).toBeCloseTo(4.4);
    expect(cues[2].endSec).toBeCloseTo(5.4);
  });

  it("keeps every cue within the length limit", () => {
    const text = "Ngày xửa ngày xưa, ở một ngôi làng nhỏ ven sông, có một cậu bé tên là An sống cùng bà ngoại già yếu.";
    const cues = buildCues([{ text, durationSec: 8 }], 0.4, 40);
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(40);
    expect(cues.at(-1)!.endSec).toBeCloseTo(8);
  });
});

describe("cueTexts", () => {
  it("breaks a long sentence at commas, never mid-clause when the clause fits", () => {
    const text = "Ngày xửa ngày xưa, ở một ngôi làng nhỏ ven sông, có một cậu bé tên là An.";
    expect(cueTexts(text, 50)).toEqual(["Ngày xửa ngày xưa, ở một ngôi làng nhỏ ven sông,", "có một cậu bé tên là An."]);
  });

  it("cuts an over-long clause into balanced halves instead of leaving a stray word", () => {
    const cues = cueTexts("một hai ba bốn năm sáu bảy tám chín mười mười một", 40);
    expect(cues).toHaveLength(2);
    expect(Math.abs(cues[0].length - cues[1].length)).toBeLessThan(15);
  });
});

describe("subtitleLayout", () => {
  it("fits fewer characters per cue on a vertical frame and lifts the text higher", () => {
    const wide = subtitleLayout(1920, 1080);
    const tall = subtitleLayout(1080, 1920);
    expect(tall.maxCueChars).toBeLessThan(wide.maxCueChars);
    expect(tall.marginV / 1920).toBeGreaterThan(wide.marginV / 1080);
  });
});

describe("buildAss", () => {
  it("formats times and strips ASS override characters from the text", () => {
    expect(assTime(3725.456)).toBe("1:02:05.46");
    const ass = buildAss([{ startSec: 1, endSec: 2.5, text: "Xin {\\b1}chào\nbạn" }], 1280, 720);
    expect(ass).toContain("PlayResX: 1280");
    expect(ass).toContain("Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Xin b1chào bạn");
  });
});

describe("buildAss with a brand mark", () => {
  it("draws the badge for the whole video with the last word in the accent colour", () => {
    const badge = badgeLines({ text: "Gác trọ Audio", position: "top-right", color: "#FFB020", durationSec: 200 }, 1080, 1920, assTime);
    const ass = buildAss([], 1080, 1920, [badge]);
    expect(ass).toMatch(/^Style: Brand,Arial,/m);
    const events = ass.split("\n").filter((l) => l.includes(",Brand,"));
    expect(events.every((l) => l.includes("0:00:00.00,0:03:21.00"))).toBe(true);
    // The pill, the icon circle, the headphones and the text.
    expect(events).toHaveLength(4);
    expect(ass).toContain("Gác trọ {\\1c&H20B0FF&}Audio");
  });

  it("leaves the brand out when none is given", () => {
    expect(buildAss([], 1920, 1080)).not.toContain("Brand");
  });
});
