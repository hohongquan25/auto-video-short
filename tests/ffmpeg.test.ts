import { describe, expect, it } from "vitest";
import { frameFilter, lookFilter, shotsGraph } from "../server/lib/ffmpeg.js";

describe("frameFilter", () => {
  it("crops to fill the frame", () => {
    expect(frameFilter({ width: 1080, height: 1920, fit: "crop" }))
      .toBe("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1");
  });

  it("fits the whole picture over a blurred quarter-size copy", () => {
    const f = frameFilter({ width: 1080, height: 1920, fit: "blur" });
    expect(f).toContain("crop=270:480,boxblur");
    expect(f).toContain("[fg]scale=1080:1920:force_original_aspect_ratio=decrease");
    expect(f).toMatch(/overlay=\(W-w\)\/2:\(H-h\)\/2,setsar=1$/);
  });
});

describe("lookFilter", () => {
  it("is empty when the background is used as is", () => {
    expect(lookFilter({})).toBe("");
    expect(lookFilter({ mirror: false, recolor: false })).toBe("");
  });

  it("mirrors, then shifts the colours", () => {
    expect(lookFilter({ mirror: true })).toBe("hflip");
    expect(lookFilter({ mirror: true, recolor: true })).toBe("hflip,hue=h=12:s=1.15,eq=contrast=1.05");
  });

  it("runs ahead of the blur frame graph on its default input", () => {
    const chain = [lookFilter({ mirror: true }), frameFilter({ width: 1080, height: 1920, fit: "blur" })].join(",");
    expect(chain).toMatch(/^hflip,split=2\[bg\]\[fg\];/);
  });
});

describe("lookFilter speed", () => {
  it("speeds the picture up before anything else", () => {
    expect(lookFilter({ speed: 1.5, mirror: true })).toBe("setpts=PTS/1.5,hflip");
  });

  it("leaves normal speed out", () => {
    expect(lookFilter({ speed: 1 })).toBe("");
  });
});

describe("shotsGraph", () => {
  it("alters and frames each shot on its own, then joins them and burns the text in", () => {
    const g = shotsGraph([{ mirror: true }, { speed: 2 }], { width: 1080, height: 1920, fit: "blur" }, "ass=part-01.ass");
    expect(g).toMatch(/^\[0:v\]setpts=PTS-STARTPTS,hflip,split=2\[bg0\]\[fg0\];/);
    expect(g).toContain("[1:v]setpts=PTS-STARTPTS,setpts=PTS/2,split=2[bg1][fg1]");
    expect(g).toContain("[blur1][fit1]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p[v1]");
    expect(g).toMatch(/\[v0\]\[v1\]concat=n=2:v=1:a=0,tpad=stop_mode=clone:stop_duration=2,ass=part-01\.ass\[out\]$/);
  });

  it("ends on the joined picture when there is nothing to burn in", () => {
    const g = shotsGraph([{}], { width: 1920, height: 1080, fit: "crop" }, null);
    expect(g).toMatch(/\[v0\]concat=n=1:v=1:a=0,tpad=stop_mode=clone:stop_duration=2\[out\]$/);
  });
});
