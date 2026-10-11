import { describe, expect, it } from "vitest";
import { CTA_SEC, ctaLayout, ctaLines, ctaStarts } from "../server/lib/subscribe.js";
import { assTime } from "../server/lib/subtitles.js";

describe("ctaStarts", () => {
  it("runs early, late or both in a long video", () => {
    expect(ctaStarts(200, "start")).toEqual([2.5]);
    expect(ctaStarts(200, "end")).toEqual([200 - CTA_SEC - 1]);
    expect(ctaStarts(200, "both")).toEqual([2.5, 200 - CTA_SEC - 1]);
  });

  it("runs once when two runs would crowd a short video, and not at all when it cannot fit", () => {
    expect(ctaStarts(15, "both")).toEqual([15 - CTA_SEC - 1]);
    expect(ctaStarts(15, "start")).toEqual([2.5]);
    expect(ctaStarts(6, "both")).toEqual([]);
  });
});

describe("ctaLayout", () => {
  it("keeps the button and bell inside the frame", () => {
    for (const [w, h] of [[1080, 1920], [1920, 1080]]) {
      for (const platform of ["youtube", "tiktok"] as const) {
        const l = ctaLayout(w, h, platform);
        expect(l.buttonX - l.w / 2).toBeGreaterThan(0);
        expect(l.bellX + l.bellSize / 2).toBeLessThan(w);
      }
    }
  });
});

describe("ctaLines", () => {
  it("says follow on TikTok and subscribe on YouTube, once per run", () => {
    const tiktok = ctaLines({ platform: "tiktok", accent: "#FFB020", starts: [2.5, 100] }, 1080, 1920, assTime);
    expect(tiktok.events.filter((e) => e.endsWith("}THEO DÕI"))).toHaveLength(2);
    const youtube = ctaLines({ platform: "youtube", accent: "#FFB020", starts: [2.5] }, 1920, 1080, assTime);
    expect(youtube.events.some((e) => e.endsWith("}ĐÃ ĐĂNG KÝ"))).toBe(true);
  });
});
