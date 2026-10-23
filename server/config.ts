import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const root = process.cwd();
const venvPython = process.platform === "win32"
  ? join(root, ".venv", "Scripts", "python.exe")
  : join(root, ".venv", "bin", "python");

const env = (key: string) => process.env[key]?.trim() || undefined;

/** An optional setting that must match `pattern`; a typo fails at startup instead of being silently ignored. */
function checkedEnv(key: string, pattern: RegExp, example: string): string | undefined {
  const value = env(key);
  if (value && !pattern.test(value)) throw new Error(`${key}="${value}" không hợp lệ (ví dụ: ${example})`);
  return value;
}

/**
 * A Drive folder or Google Sheet given by its id or by its link, e.g.
 * https://drive.google.com/drive/folders/<id> or https://docs.google.com/spreadsheets/d/<id>/edit.
 */
export function googleId(value: string | undefined, key: string): string | undefined {
  if (!value) return undefined;
  const id = value.match(/\/(?:folders|d)\/([\w-]{10,})/)?.[1] ?? (/^[\w-]{10,}$/.test(value) ? value : undefined);
  if (!id) throw new Error(`${key}="${value}" không hợp lệ (dán id hoặc link của thư mục / bảng tính)`);
  return id;
}

/**
 * Locate the Claude Code binary. On Windows npm only puts a .cmd shim on PATH,
 * which cannot be spawned without a shell, so look for the real claude.exe.
 */
function findClaude(): string {
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const candidates = [
    ...pathDirs.map((d) => join(d, "node_modules", "@anthropic-ai", "claude-code", "bin", exe)),
    join(homedir(), ".local", "bin", exe), // native installer
  ];
  return candidates.find((f) => existsSync(f)) ?? "claude";
}

const port = Number(env("PORT") ?? 5178);

export const config = {
  port,
  /** 127.0.0.1 = only this machine; 0.0.0.0 also lets Docker containers / the LAN in (needs API_TOKEN). */
  host: env("HOST") ?? "127.0.0.1",
  /** Required for requests that do not come from this machine. */
  apiToken: env("API_TOKEN"),
  /** Base URL other tools use to reach this server, for links in webhooks and API responses. */
  publicUrl: (env("PUBLIC_URL") ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
  /** Default webhook notified when any job finishes, fails or waits for review. */
  webhookUrl: env("WEBHOOK_URL"),
  dataDir: resolve(root, env("DATA_DIR") ?? "data"),
  clientDist: join(root, "dist", "client"),
  geminiApiKey: env("GEMINI_API_KEY"),
  geminiModel: env("GEMINI_MODEL") ?? "gemini-flash-latest",
  claudePath: env("CLAUDE_PATH") ?? findClaude(),
  claudeModel: env("CLAUDE_MODEL") ?? "sonnet",
  /** Same Python as Whisper: `pnpm setup:whisper` installs what python/olvroc needs too. */
  olvrocPython: env("WHISPER_PYTHON") ?? (existsSync(venvPython) ? venvPython : "python"),
  /** Model files (~650 MB, kept out of git), downloaded by `pnpm setup:olvroc`. */
  olvrocModelDir: join(root, "models", "olvroc"),
  olvrocScript: join(root, "python", "olvroc_tts.py"),
  /** fp32 = best quality; int8 = ~1.6x faster on CPUs with VNNI, garbled audio on older ones. */
  olvrocPrecision: checkedEnv("OLVROC_PRECISION", /^(fp32|int8)$/, "fp32") ?? "fp32",
  whisperModel: env("WHISPER_MODEL") ?? "large-v3-turbo",
  whisperLanguage: env("WHISPER_LANGUAGE") ?? "vi",
  /**
   * Batched greedy decoding transcribed ~5x faster than sequential beam 5 on an
   * i5-13400F (medium and large-v3-turbo alike), with near-identical Vietnamese text.
   */
  whisperBeamSize: checkedEnv("WHISPER_BEAM_SIZE", /^([1-9]|10)$/, "1") ?? "1",
  whisperBatchSize: checkedEnv("WHISPER_BATCH_SIZE", /^([1-9]|[1-5]\d|6[0-4])$/, "8") ?? "8",
  /** 0 lets CTranslate2 choose; more threads did not help in testing. */
  whisperThreads: checkedEnv("WHISPER_THREADS", /^\d{1,3}$/, "0") ?? "0",
  whisperPython: env("WHISPER_PYTHON") ?? (existsSync(venvPython) ? venvPython : "python"),
  whisperScript: join(root, "python", "transcribe.py"),
  /** yt-dlp command: YTDLP_PATH, else the copy installed in .venv by `pnpm setup:whisper`. */
  ytdlp: env("YTDLP_PATH") ? [env("YTDLP_PATH")!] : existsSync(venvPython) ? [venvPython, "-m", "yt_dlp"] : ["yt-dlp"],
  /** cookies.txt for sites that need a login (YouTube often does). Takes precedence over the browser option. */
  ytdlpCookies: env("YTDLP_COOKIES"),
  /** Read cookies straight from a browser profile: firefox, chrome, edge, brave… */
  ytdlpCookiesFromBrowser: env("YTDLP_COOKIES_FROM_BROWSER"),
  /** Proxy for every yt-dlp request (probe and download). */
  ytdlpProxy: checkedEnv("YTDLP_PROXY", /^(https?|socks4a?|socks5h?):\/\/\S+$/i, "socks5://127.0.0.1:1080"),
  /** Download speed cap in bytes per second, e.g. 2M or 500K. */
  ytdlpLimitRate: checkedEnv("YTDLP_LIMIT_RATE", /^\d+(\.\d+)?[KMG]?$/i, "2M"),
  /** Download through aria2c (must be on PATH) with several connections. */
  ytdlpAria2: /^(1|true|yes|on)$/i.test(env("YTDLP_ARIA2") ?? ""),
  /** Service account key (JSON). Its uploads need a folder in a Shared Drive: service accounts have no storage of their own. */
  googleServiceAccountFile: env("GOOGLE_SERVICE_ACCOUNT_FILE") && resolve(root, env("GOOGLE_SERVICE_ACCOUNT_FILE")!),
  /** OAuth client ("Desktop app") for uploading as a person's own Google account, connected from the browser. */
  googleClientId: env("GOOGLE_CLIENT_ID"),
  googleClientSecret: env("GOOGLE_CLIENT_SECRET"),
  /** Where finished videos go; with OAuth, a "Story Studio" folder and sheet are made when these are empty. */
  googleDriveFolderId: googleId(env("GOOGLE_DRIVE_FOLDER_ID"), "GOOGLE_DRIVE_FOLDER_ID"),
  googleSheetId: googleId(env("GOOGLE_SHEET_ID"), "GOOGLE_SHEET_ID"),
  googleSheetTab: env("GOOGLE_SHEET_TAB") ?? "Videos",
  ffmpeg: env("FFMPEG_PATH") ?? "ffmpeg",
  ffprobe: env("FFPROBE_PATH") ?? "ffprobe",
};

export const paths = {
  jobs: join(config.dataDir, "jobs"),
  backgrounds: join(config.dataDir, "backgrounds"),
  uploads: join(config.dataDir, "uploads"),
  previews: join(config.dataDir, "previews"),
  stylesFile: join(config.dataDir, "styles.json"),
  backgroundsFile: join(config.dataDir, "backgrounds.json"),
  brandFile: join(config.dataDir, "brand.json"),
  defaultsFile: join(config.dataDir, "defaults.json"),
  summaryDefaultsFile: join(config.dataDir, "summary-defaults.json"),
  numberingFile: join(config.dataDir, "numbering.json"),
  /** The connected Google account's refresh token and the folder and sheet made for it. Secret. */
  googleFile: join(config.dataDir, "google.json"),
};
