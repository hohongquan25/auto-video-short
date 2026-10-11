import { readdirSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "../config.js";
import { ProcessError, run } from "./proc.js";
import type { SourceInfo } from "../types.js";

// Link normalization, site headers and the retry rules below are adapted from
// Youwee (github.com/vanloctech/youwee, MIT licence).

/** A download error that retrying will not fix (login required, video removed, unsupported link). */
export class FatalDownloadError extends Error {}


// Python must print UTF-8: titles are often Vietnamese and Windows defaults to the ANSI code page.
const env = () => ({ ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" });

/** Options shared by every call: cookies for sites that need a login, and a JS runtime for YouTube. */
function commonArgs(): string[] {
  const args = ["--no-playlist", "--no-warnings", "--js-runtimes", `node:${process.execPath}`, "--extractor-retries", "2"];
  if (config.ytdlpCookies) args.push("--cookies", config.ytdlpCookies);
  else if (config.ytdlpCookiesFromBrowser) args.push("--cookies-from-browser", config.ytdlpCookiesFromBrowser);
  if (config.ytdlpProxy) args.push("--proxy", config.ytdlpProxy);
  if (isAbsolute(config.ffmpeg)) args.push("--ffmpeg-location", dirname(config.ffmpeg));
  return args;
}

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Rewrite link variants yt-dlp cannot read into their canonical form; exported for tests.
 * A Douyin video opened as a popup (douyin.com/…?modal_id=123) becomes douyin.com/video/123.
 */
export function normalizeUrl(url: string): string {
  const host = hostOf(url);
  if (host && hostIs(host, "douyin.com")) {
    const u = new URL(url);
    const id = u.searchParams.get("modal_id");
    if (!u.pathname.startsWith("/video/") && id && /^\d+$/.test(id)) return `https://www.douyin.com/video/${id}`;
  }
  return url;
}

const BILIBILI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

/** Headers a site requires before it serves media (Bilibili rejects yt-dlp's defaults); exported for tests. */
export function siteHeaderArgs(url: string): string[] {
  const host = hostOf(url);
  if (host && (host === "b23.tv" || hostIs(host, "bilibili.com"))) {
    return ["--user-agent", BILIBILI_USER_AGENT, "--referer", "https://www.bilibili.com/"];
  }
  return [];
}

/** The link always goes after "--" so yt-dlp can never read it as an option. */
const target = (url: string) => [...siteHeaderArgs(url), "--", url];

const [ytdlpCmd, ...ytdlpBaseArgs] = config.ytdlp;
const ytdlp = (args: string[], opts: Parameters<typeof run>[2] = {}) =>
  run(ytdlpCmd, [...ytdlpBaseArgs, ...commonArgs(), ...args], { env: env(), ...opts });

/** Turn yt-dlp's stderr into one readable line, with a hint for the usual login wall. */
function explain(err: unknown): Error {
  const stderr = err instanceof ProcessError ? err.stderr : err instanceof Error ? err.message : String(err);
  const line = stderr.split(/\r?\n/).reverse().find((l) => l.startsWith("ERROR:"))?.replace(/^ERROR:\s*/, "")
    ?? stderr.trim().split(/\r?\n/).pop() ?? "Lỗi không xác định";
  return classifyError(line);
}

/** Map a yt-dlp error line to a user-facing error; exported for tests. */
export function classifyError(line: string): Error {
  if (/unsupported (url|site)|not a valid url|http error 404|not found|video (is )?unavailable|has been removed|copyright|geo[- ]?restricted|available in your (country|region)|\bdrm\b/i.test(line)) {
    return new FatalDownloadError(`Không tải được link này: ${line}`);
  }
  if (/sign in|log ?in|logged-in|--cookies|private video|age[- ]restricted|confirm your age/i.test(line)) {
    return new FatalDownloadError(
      `Trang này yêu cầu đăng nhập. Đặt YTDLP_COOKIES (file cookies.txt) hoặc YTDLP_COOKIES_FROM_BROWSER trong .env.local rồi thử lại. Chi tiết: ${line}`,
    );
  }
  return new Error(`yt-dlp: ${line}`);
}

/** Network hiccups and rate limits that usually pass on their own; exported for tests. */
export function isTransientError(err: unknown): boolean {
  if (err instanceof FatalDownloadError) return false;
  const message = err instanceof Error ? err.message : String(err);
  return /timed? ?out|connection (reset|aborted|closed|refused)|network is unreachable|temporar(il)?y unavailable|try again|too many requests|http error (416|429|5\d\d)|range not satisfiable|remote end closed|unable to download video data|fragment.*(failed|error)|\b(ssl|tls)\b/i
    .test(message);
}

/**
 * A server answers 416 when a leftover .part file no longer matches the remote
 * file; resuming from it can never succeed, so the next attempt starts over.
 */
function removePartialDownloads(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (name.startsWith("source.") && /\.(part|ytdl)/.test(name)) rmSync(join(dir, name), { force: true });
  }
}

/** Read a link's title, length and platform without downloading anything. */
export async function probeUrl(url: string, signal?: AbortSignal): Promise<SourceInfo> {
  url = normalizeUrl(url);
  let stdout: string;
  try {
    ({ stdout } = await ytdlp(["-J", ...target(url)], { signal: signal ?? AbortSignal.timeout(90_000) }));
  } catch (err) {
    throw explain(err);
  }
  const d = JSON.parse(stdout) as {
    _type?: string; title?: string; uploader?: string; channel?: string; duration?: number;
    extractor_key?: string; webpage_url?: string; thumbnail?: string; is_live?: boolean;
  };
  if (d._type === "playlist") throw new FatalDownloadError("Đây là link danh sách phát, hãy dán link của một video");
  if (d.is_live) throw new FatalDownloadError("Không hỗ trợ video đang phát trực tiếp");
  return {
    title: d.title ?? "Không có tiêu đề",
    uploader: d.uploader ?? d.channel ?? null,
    durationSec: d.duration ?? null,
    platform: d.extractor_key ?? "Web",
    webpageUrl: d.webpage_url ?? url,
    thumbnail: d.thumbnail ?? null,
  };
}

export interface DownloadProgress {
  fraction: number | null;
  downloadedBytes: number;
  speedBps: number | null;
  etaSec: number | null;
}

const num = (s: string | undefined) => (s && s !== "NA" && s !== "None" ? Number(s) : NaN);

/** Parse a line printed by our --progress-template; null for any other line. */
export function parseProgressLine(line: string): DownloadProgress | null {
  const m = /^SSPROG (\S+) (\S+) (\S+) (\S+) (\S+)/.exec(line.trim());
  if (!m) return null;
  const done = num(m[1]);
  const total = Number.isFinite(num(m[2])) ? num(m[2]) : num(m[3]);
  const speed = num(m[4]);
  const eta = num(m[5]);
  return {
    fraction: Number.isFinite(done) && Number.isFinite(total) && total > 0 ? Math.min(1, done / total) : null,
    downloadedBytes: Number.isFinite(done) ? done : 0,
    speedBps: Number.isFinite(speed) ? speed : null,
    etaSec: Number.isFinite(eta) ? eta : null,
  };
}

/** Options that only matter when media is actually transferred. */
function transferArgs(): string[] {
  const args = ["--retries", "3", "--fragment-retries", "3", "--file-access-retries", "2"];
  if (config.ytdlpLimitRate) args.push("--limit-rate", config.ytdlpLimitRate);
  if (config.ytdlpAria2) args.push("--downloader", "aria2c", "--downloader-args", "aria2c:-x 8 -s 8 -k 1M");
  return args;
}

export type RetryHandler = (err: Error, attempt: number, total: number, delayMs: number) => void;

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

/**
 * Download the best audio-only stream (or the whole video when a site has no
 * separate audio) into `dir` as source.<ext>. Returns the file name.
 * Network errors are retried a few times; yt-dlp keeps a .part file, so each
 * attempt resumes where the previous one stopped.
 */
export async function downloadAudio(
  url: string, dir: string, onProgress: (p: DownloadProgress) => void, signal: AbortSignal, onRetry?: RetryHandler,
): Promise<string> {
  url = normalizeUrl(url);
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadOnce(url, dir, onProgress, signal);
    } catch (err) {
      if (signal.aborted || attempt >= RETRY_DELAYS_MS.length || !isTransientError(err)) throw err;
      if (/416|range not satisfiable/i.test((err as Error).message)) removePartialDownloads(dir);
      onRetry?.(err as Error, attempt + 2, RETRY_DELAYS_MS.length + 1, RETRY_DELAYS_MS[attempt]);
      await sleep(RETRY_DELAYS_MS[attempt], undefined, { signal });
    }
  }
}

async function downloadOnce(
  url: string, dir: string, onProgress: (p: DownloadProgress) => void, signal: AbortSignal,
): Promise<string> {
  let file = null as string | null;
  try {
    await ytdlp([
      "-f", "bestaudio/best",
      "-o", join(dir, "source.%(ext)s"),
      "--no-mtime",
      "--quiet", "--progress", "--newline",
      "--progress-template",
      "download:SSPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s",
      "--print", "after_move:SSFILE %(filepath)s",
      ...transferArgs(),
      ...target(url),
    ], {
      signal,
      onStdoutLine: (line) => {
        if (line.startsWith("SSFILE ")) file = line.slice(7).trim();
        else {
          const p = parseProgressLine(line);
          if (p) onProgress(p);
        }
      },
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw explain(err);
  }
  if (!file) throw new Error("yt-dlp không báo file đã tải");
  return basename(file);
}

export async function ytdlpVersion(): Promise<string> {
  const { stdout } = await run(ytdlpCmd, [...ytdlpBaseArgs, "--version"], { env: env() });
  return stdout.trim();
}
