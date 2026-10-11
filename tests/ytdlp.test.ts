import { describe, expect, it } from "vitest";
import {
  FatalDownloadError, classifyError, isTransientError, normalizeUrl, parseProgressLine, siteHeaderArgs,
} from "../server/lib/ytdlp.js";

describe("normalizeUrl", () => {
  it("turns a Douyin popup link into a direct video link", () => {
    expect(normalizeUrl("https://www.douyin.com/jingxuan?modal_id=7400000000000000001"))
      .toBe("https://www.douyin.com/video/7400000000000000001");
    expect(normalizeUrl("https://www.douyin.com/user/MS4w?from_tab_name=main&modal_id=123"))
      .toBe("https://www.douyin.com/video/123");
  });

  it("leaves other links alone", () => {
    for (const url of [
      "https://www.douyin.com/video/123?modal_id=456",
      "https://www.douyin.com/jingxuan?modal_id=abc",
      "https://example.com/?modal_id=123&site=douyin.com",
      "https://www.youtube.com/watch?v=abc",
    ]) expect(normalizeUrl(url)).toBe(url);
  });
});

describe("siteHeaderArgs", () => {
  it("adds a browser user agent and referer for Bilibili", () => {
    const args = siteHeaderArgs("https://www.bilibili.com/video/BV1Qo4y1s7XT");
    expect(args[0]).toBe("--user-agent");
    expect(args.slice(2)).toEqual(["--referer", "https://www.bilibili.com/"]);
    expect(siteHeaderArgs("https://b23.tv/abc123")).toHaveLength(4);
  });

  it("only matches the real host", () => {
    expect(siteHeaderArgs("https://www.youtube.com/watch?v=abc")).toEqual([]);
    expect(siteHeaderArgs("https://example.com/watch?url=bilibili.com")).toEqual([]);
    expect(siteHeaderArgs("https://notbilibili.com/video/1")).toEqual([]);
  });
});

describe("isTransientError", () => {
  it("retries network hiccups, rate limits and stale partial files", () => {
    for (const line of [
      "Read timed out",
      "[Errno 10054] Connection reset by peer",
      "HTTP Error 429: Too Many Requests",
      "HTTP Error 503: Service Unavailable",
      "HTTP Error 416: Requested Range Not Satisfiable",
    ]) expect(isTransientError(classifyError(line))).toBe(true);
  });

  it("does not retry errors that will fail again", () => {
    expect(isTransientError(classifyError("[youtube] abc: Video unavailable"))).toBe(false);
    expect(isTransientError(classifyError("[youtube] abc: Sign in to confirm you’re not a bot. Try again later"))).toBe(false);
    expect(isTransientError(classifyError("Requested format is not available"))).toBe(false);
  });
});

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

  it("treats region locks and DRM as permanent", () => {
    expect(classifyError("The uploader has not made this video available in your country")).toBeInstanceOf(FatalDownloadError);
    expect(classifyError("This video is DRM protected")).toBeInstanceOf(FatalDownloadError);
    expect(classifyError("[youtube] xxxxxxxxxxx: This video is unavailable")).toBeInstanceOf(FatalDownloadError);
  });

  it("leaves unknown errors retryable", () => {
    expect(classifyError("Connection reset by peer")).not.toBeInstanceOf(FatalDownloadError);
  });
});
