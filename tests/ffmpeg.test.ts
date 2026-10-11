import { describe, expect, it } from "vitest";
import { frameFilter } from "../server/lib/ffmpeg.js";

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
