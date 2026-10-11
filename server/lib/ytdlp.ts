import { basename, dirname, isAbsolute, join } from "node:path";
import { config } from "../config.js";
import { ProcessError, run } from "./proc.js";
import type { SourceInfo } from "../types.js";

/** A download error that retrying will not fix (login required, video removed, unsupported link). */
export class FatalDownloadError extends Error {}


// Python must print UTF-8: titles are often Vietnamese and Windows defaults to the ANSI code page.
const env = () => ({ ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" });

/** Options shared by every call: cookies for sites that need a login, and a JS runtime for YouTube. */
function commonArgs(): string[] {
  const args = ["--no-playlist", "--no-warnings", "--js-runtimes", `node:${process.execPath}`];
  if (config.ytdlpCookies) args.push("--cookies", config.ytdlpCookies);
  else if (config.ytdlpCookiesFromBrowser) args.push("--cookies-from-browser", config.ytdlpCookiesFromBrowser);
  if (isAbsolute(config.ffmpeg)) args.push("--ffmpeg-location", dirname(config.ffmpeg));
  return args;
}

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
  if (/unsupported url|not a valid url|http error 404|not found|video unavailable|has been removed|copyright/i.test(line)) {
    return new FatalDownloadError(`Không tải được link này: ${line}`);
  }
  if (/sign in|log ?in|logged-in|--cookies|private video|age[- ]restricted|confirm your age/i.test(line)) {
    return new FatalDownloadError(
      `Trang này yêu cầu đăng nhập. Đặt YTDLP_COOKIES (file cookies.txt) hoặc YTDLP_COOKIES_FROM_BROWSER trong .env.local rồi thử lại. Chi tiết: ${line}`,
    );
  }
  return new Error(`yt-dlp: ${line}`);
}

/** Read a link's title, length and platform without downloading anything. */
export async function probeUrl(url: string, signal?: AbortSignal): Promise<SourceInfo> {
  let stdout: string;
  try {
    ({ stdout } = await ytdlp(["-J", url], { signal: signal ?? AbortSignal.timeout(90_000) }));
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

/**
 * Download the best audio-only stream (or the whole video when a site has no
 * separate audio) into `dir` as source.<ext>. Returns the file name.
 * yt-dlp keeps a .part file, so an interrupted download resumes on retry.
 */
export async function downloadAudio(
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
      url,
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
