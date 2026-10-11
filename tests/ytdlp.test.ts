import { describe, expect, it } from "vitest";
import { FatalDownloadError, classifyError, parseProgressLine } from "../server/lib/ytdlp.js";

describe("parseProgressLine", () => {
  it("reads bytes, speed and eta from our progress template", () => {
    expect(parseProgressLine("SSPROG 524288 1048576 NA 262144.5 2")).toEqual({
      fraction: 0.5, downloadedBytes: 524288, speedBps: 262144.5, etaSec: 2,
    });
  });

  it("falls back to the estimated total and tolerates unknown values", () => {
    expect(parseProgressLine("SSPROG 100 NA 400 NA NA")).toEqual({
      fraction: 0.25, downloadedBytes: 100, speedBps: null, etaSec: null,
    });
    expect(parseProgressLine("SSPROG 100 NA NA None NA")?.fraction).toBeNull();
  });

  it("ignores other output", () => {
    expect(parseProgressLine("SSFILE C:\\jobs\\x\\source.webm")).toBeNull();
    expect(parseProgressLine("[youtube] Extracting URL")).toBeNull();
  });
});

describe("classifyError", () => {
  it("does not mistake a missing page for a login wall", () => {
    const err = classifyError("[generic] x: Unable to download webpage: HTTP Error 404: Not Found");
    expect(err).toBeInstanceOf(FatalDownloadError);
    expect(err.message).toMatch(/^Không tải được link này/);
  });

  it("points to cookies when the site asks for a login", () => {
    const err = classifyError("[youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies");
    expect(err.message).toMatch(/YTDLP_COOKIES/);
  });

  it("leaves unknown errors retryable", () => {
    expect(classifyError("Connection reset by peer")).not.toBeInstanceOf(FatalDownloadError);
  });
});
