import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { extname, join } from "node:path";
import { z } from "zod";
import { config, paths } from "./config.js";
import {
  deleteJob, ensureDataDirs, getBackground, getStyle, isValidId, jobDir, listBackgrounds,
  listJobs, listStyles, newId, saveBackgrounds, saveJob, saveStyles,
} from "./store.js";
import { cancel, enqueue, isBusy, liveJob, notify, resumeOnStartup } from "./queue.js";
import { jobLinks } from "./webhook.js";
import { appendLog, artifacts, resetFromStep } from "./pipeline/run-job.js";
import { synthesizeToFile } from "./pipeline/tts.js";
import { ffmpegVersion, hasVideoStream, probeDuration } from "./lib/ffmpeg.js";
import { run } from "./lib/proc.js";
import { claudeStatus } from "./lib/claude.js";
import { listVbeeVoices, vbeeConfigured, vbeeStatus } from "./lib/vbee.js";
import { probeUrl, ytdlpVersion } from "./lib/ytdlp.js";
import {
  EDGE_VOICES, STEPS, STEP_LABELS, voiceProvider, type Background, type Job, type SystemStatus, type Voice,
} from "./types.js";

ensureDataDirs();

const MEDIA_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".mp4", ".mkv", ".mov", ".webm", ".avi"]);
const VIDEO_EXT = new Set([".mp4", ".mkv", ".mov", ".webm", ".avi"]);

const upload = multer({
  dest: paths.uploads,
  limits: { fileSize: 20 * 1024 ** 3 },
  // Browsers send raw UTF-8 filenames; the latin1 default garbles Vietnamese names.
  defParamCharset: "utf8",
});

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const app = express();
app.use(express.json({ limit: "20mb" }));

// ── Access ──────────────────────────────────────────────────────────────────

const isLoopback = (addr = "") => addr === "::1" || addr.startsWith("127.") || addr.startsWith("::ffff:127.");

function tokenMatches(given: string | undefined): boolean {
  if (!given || !config.apiToken) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(config.apiToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Requests from this machine (the browser UI, the Vite proxy) are trusted.
 * Anything else, such as n8n in Docker or another computer, needs API_TOKEN as
 * "Authorization: Bearer <token>" or "X-API-Key: <token>".
 */
app.use(["/api", "/files"], (req, _res, next) => {
  if (isLoopback(req.socket.remoteAddress)) return next();
  const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (tokenMatches(bearer) || tokenMatches(req.get("x-api-key"))) return next();
  throw new HttpError(401, "Thiếu hoặc sai API token (gửi header Authorization: Bearer <API_TOKEN>)");
});

// ── Meta ────────────────────────────────────────────────────────────────────

/** Last line of an error: the useful part of a Python traceback or ffmpeg log. */
const errorLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).trim().split("\n").pop()!.slice(0, 300);

async function checkSystem(): Promise<SystemStatus> {
  const [ffmpeg, whisper, claude] = await Promise.all([
    ffmpegVersion()
      .then((version) => ({ ok: true, version }))
      .catch(() => ({ ok: false, version: null })),
    run(config.whisperPython, ["-c", "import faster_whisper"])
      .then(() => ({ ok: true, python: config.whisperPython, error: null }))
      .catch((err: unknown) => ({ ok: false, python: config.whisperPython, error: errorLine(err) })),
    claudeStatus(),
  ]);
  const vbee = await vbeeStatus();
  const ytdlpVer = await ytdlpVersion().catch(() => null);
  return {
    ffmpeg,
    whisper,
    gemini: { ok: Boolean(config.geminiApiKey), model: config.geminiModel },
    claude: { ok: claude.loggedIn, ...claude, model: config.claudeModel },
    vbee,
    ytdlp: {
      ok: ytdlpVer !== null,
      version: ytdlpVer,
      cookies: config.ytdlpCookies ? "file cookies.txt" : config.ytdlpCookiesFromBrowser ? `trình duyệt ${config.ytdlpCookiesFromBrowser}` : null,
    },
  };
}

/** Checked once per server start (spawning Python takes a second or two). */
let systemStatus: Promise<SystemStatus> | null = null;

/** Edge voices plus, when configured and reachable, Vbee's voice list. */
async function allVoices(): Promise<Voice[]> {
  const vbee = await listVbeeVoices().catch(() => []);
  return [...vbee, ...EDGE_VOICES];
}

app.get("/api/meta", async (req, res) => {
  if (!systemStatus || req.query.recheck) systemStatus = checkSystem();
  res.json({
    voices: await allVoices(),
    steps: STEPS,
    geminiConfigured: Boolean(config.geminiApiKey),
    geminiModel: config.geminiModel,
    whisperModel: config.whisperModel,
    system: await systemStatus,
  });
});

const PREVIEW_TEXT = "Xin chào, đây là giọng đọc thử. Đêm hôm ấy, trời mưa tầm tã, và câu chuyện của chúng ta bắt đầu từ một ngôi nhà nhỏ cuối làng.";
const rateSchema = z.string().regex(/^[+-]\d{1,3}%$/, "Tốc độ đọc không hợp lệ");

app.get("/api/voices/preview", async (req, res) => {
  const { voice, rate } = z.object({
    // Vbee voices are previewed from their own demo clips, which cost no credits.
    voice: z.enum(EDGE_VOICES.map((v) => v.id) as [string, ...string[]]),
    rate: rateSchema,
  }).parse(req.query);
  const file = join(paths.previews, `${voice}_${rate.replace("%", "")}.mp3`);
  if (!existsSync(file)) {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await synthesizeToFile(PREVIEW_TEXT, voice, rate, tmp);
      renameSync(tmp, file);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw new HttpError(502, `Không tạo được giọng thử (cần kết nối mạng): ${errorLine(err)}`);
    }
  }
  res.type("audio/mpeg").sendFile(file);
});

// ── Jobs ────────────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  styleId: z.string().min(1),
  aiProvider: z.enum(["claude", "gemini"]).default("claude"),
  voice: z.string().refine(
    (id) => EDGE_VOICES.some((v) => v.id === id) || /^vbee:[\w.-]+$/.test(id),
    "Giọng đọc không hợp lệ",
  ),
  rate: rateSchema,
  backgroundId: z.string().min(1),
  reviewBeforeTts: z.boolean(),
  minPartSec: z.number().min(10).max(3600),
  maxPartSec: z.number().min(20).max(3600),
}).refine((s) => s.maxPartSec > s.minPartSec, { message: "Độ dài tối đa phải lớn hơn tối thiểu" });

function loadJob(id: string): Job {
  const job = isValidId(id) ? liveJob(id) : null;
  if (!job) throw new HttpError(404, "Không tìm thấy job");
  return job;
}

function assertIdle(job: Job): void {
  if (isBusy(job.id)) throw new HttpError(409, "Job đang chạy, hãy dừng lại trước");
}

function validateSettingsRefs(s: z.infer<typeof settingsSchema>): void {
  if (!getStyle(s.styleId)) throw new HttpError(400, "Phong cách không tồn tại");
  if (!getBackground(s.backgroundId)) throw new HttpError(400, "Video nền không tồn tại");
  if (voiceProvider(s.voice) === "vbee" && !vbeeConfigured()) {
    throw new HttpError(400, "Giọng Vbee cần VBEE_APP_ID và VBEE_TOKEN trong .env.local");
  }
}

const readIfExists = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : null);

app.get("/api/jobs", (_req, res) => {
  res.json(listJobs().map((j) => liveJob(j.id) ?? j));
});

app.get("/api/jobs/:id", (req, res) => {
  const job = loadJob(req.params.id);
  const a = artifacts(job.id);
  res.json({ job, transcript: readIfExists(a.transcript), script: readIfExists(a.script), links: jobLinks(job) });
});

const linkSchema = z.url({ protocol: /^https?$/, error: "Link phải bắt đầu bằng http:// hoặc https://" });

/** yt-dlp failures become 400s: the link, not the server, is the problem. */
async function probeOrReject(url: string) {
  try {
    return await probeUrl(url);
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
}

/** Check a video link (title, length, platform) before creating a job from it. */
app.post("/api/sources/probe", async (req, res) => {
  const { url } = z.object({ url: linkSchema }).parse(req.body);
  res.json(await probeOrReject(url.trim()));
});

/**
 * Create a job from an uploaded file (multipart field "media") or a video link
 * (field "url"; multipart or JSON body). "settings" is a JSON string in
 * multipart and may be a plain object in a JSON body.
 */
app.post("/api/jobs", upload.single("media"), async (req, res) => {
  const file = req.file;
  try {
    const sourceUrl = !file && req.body.url ? linkSchema.parse(String(req.body.url).trim()) : null;
    if (!file && !sourceUrl) throw new HttpError(400, "Cần file video/audio (trường media) hoặc link video (trường url)");
    const ext = file ? extname(file.originalname).toLowerCase() : "";
    if (file && !MEDIA_EXT.has(ext)) throw new HttpError(400, `Định dạng ${ext || "không rõ"} không được hỗ trợ`);

    const rawSettings = typeof req.body.settings === "string" ? JSON.parse(req.body.settings || "{}") : (req.body.settings ?? {});
    const settings = settingsSchema.parse(rawSettings);
    validateSettingsRefs(settings);
    const callbackUrl = req.body.callbackUrl
      ? z.url({ protocol: /^https?$/, error: "callbackUrl phải là link http(s)" }).parse(String(req.body.callbackUrl).trim())
      : null;
    const sourceInfo = sourceUrl ? await probeOrReject(sourceUrl) : null;

    const id = newId();
    mkdirSync(jobDir(id), { recursive: true });
    const sourceFile = file ? `source${ext}` : "";
    if (file) renameSync(file.path, join(jobDir(id), sourceFile));

    const now = new Date().toISOString();
    const title = String(req.body.title ?? "").trim() || (file ? file.originalname.replace(/\.[^.]+$/, "") : sourceInfo!.title);
    const job: Job = {
      id, title: title.slice(0, 200), sourceFile, sourceDurationSec: sourceInfo?.durationSec ?? null,
      sourceUrl, sourceInfo, createdAt: now, updatedAt: now,
      status: "queued", step: null, progress: 0, detail: null, timings: {}, error: null,
      settings, reviewApproved: false, parts: [], log: [], callbackUrl,
    };
    appendLog(job, sourceUrl ? `Đã tạo job từ link ${sourceInfo!.platform}, đang chờ xử lý` : "Đã tạo job, đang chờ xử lý");
    saveJob(job);
    enqueue(id);
    res.status(201).json(job);
  } catch (err) {
    if (file && existsSync(file.path)) rmSync(file.path, { force: true });
    throw err;
  }
});

app.put("/api/jobs/:id/script", (req, res) => {
  const job = loadJob(req.params.id);
  assertIdle(job);
  const { script } = z.object({ script: z.string().trim().min(1, "Kịch bản đang trống") }).parse(req.body);
  writeFileSync(artifacts(job.id).script, script);
  resetFromStep(job, "tts");
  appendLog(job, "Kịch bản đã được chỉnh sửa thủ công");
  saveJob(job);
  res.json(job);
});

app.post("/api/jobs/:id/continue", (req, res) => {
  const job = loadJob(req.params.id);
  assertIdle(job);
  job.reviewApproved = true;
  job.status = "queued";
  appendLog(job, "Đã duyệt kịch bản, tiếp tục xử lý", "success");
  saveJob(job);
  enqueue(job.id);
  res.json(job);
});

app.post("/api/jobs/:id/rerun", (req, res) => {
  const job = loadJob(req.params.id);
  assertIdle(job);
  const body = z.object({
    fromStep: z.enum(STEPS).optional(),
    settings: settingsSchema.optional(),
  }).parse(req.body);

  if (body.settings) {
    validateSettingsRefs(body.settings);
    job.settings = body.settings;
  }
  if (body.fromStep) resetFromStep(job, body.fromStep);
  job.status = "queued";
  job.error = null;
  if (body.settings) appendLog(job, "Đã cập nhật cài đặt");
  appendLog(job, body.fromStep ? `Chạy lại từ bước "${STEP_LABELS[body.fromStep]}"` : "Thử lại từ bước bị lỗi");
  saveJob(job);
  enqueue(job.id);
  res.json(job);
});

app.post("/api/jobs/:id/stop", (req, res) => {
  const job = loadJob(req.params.id);
  cancel(job.id);
  if (job.status === "queued") {
    job.status = "failed";
    job.error = "Đã dừng theo yêu cầu";
    appendLog(job, job.error, "warn");
    saveJob(job);
    notify(job);
  }
  res.json(job);
});

app.delete("/api/jobs/:id", (req, res) => {
  const job = loadJob(req.params.id);
  cancel(job.id);
  deleteJob(job.id);
  res.status(204).end();
});

// ── Styles ──────────────────────────────────────────────────────────────────

const styleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().max(4000),
});

app.get("/api/styles", (_req, res) => {
  res.json(listStyles());
});

app.post("/api/styles", (req, res) => {
  const data = styleSchema.parse(req.body);
  const style = { id: newId(), ...data };
  saveStyles([...listStyles(), style]);
  res.status(201).json(style);
});

app.put("/api/styles/:id", (req, res) => {
  const data = styleSchema.parse(req.body);
  const styles = listStyles();
  const style = styles.find((s) => s.id === req.params.id);
  if (!style) throw new HttpError(404, "Không tìm thấy phong cách");
  Object.assign(style, data);
  saveStyles(styles);
  res.json(style);
});

app.delete("/api/styles/:id", (req, res) => {
  saveStyles(listStyles().filter((s) => s.id !== req.params.id));
  res.status(204).end();
});

// ── Backgrounds ─────────────────────────────────────────────────────────────

app.get("/api/backgrounds", (_req, res) => {
  res.json(listBackgrounds());
});

app.post("/api/backgrounds", upload.single("file"), async (req, res) => {
  const file = req.file;
  try {
    if (!file) throw new HttpError(400, "Chưa chọn file video");
    const ext = extname(file.originalname).toLowerCase();
    if (!VIDEO_EXT.has(ext)) throw new HttpError(400, "Video nền phải là mp4, mkv, mov, webm hoặc avi");
    if (!(await hasVideoStream(file.path))) throw new HttpError(400, "File không chứa hình ảnh video");

    const id = newId();
    const fileName = `${id}${ext}`;
    renameSync(file.path, join(paths.backgrounds, fileName));
    const item: Background = {
      id,
      name: String(req.body.name ?? "").trim() || file.originalname,
      file: fileName,
      durationSec: await probeDuration(join(paths.backgrounds, fileName)),
      createdAt: new Date().toISOString(),
    };
    saveBackgrounds([...listBackgrounds(), item]);
    res.status(201).json(item);
  } catch (err) {
    if (file && existsSync(file.path)) rmSync(file.path, { force: true });
    throw err;
  }
});

app.delete("/api/backgrounds/:id", (req, res) => {
  const items = listBackgrounds();
  const item = items.find((b) => b.id === req.params.id);
  if (item) {
    rmSync(join(paths.backgrounds, item.file), { force: true });
    saveBackgrounds(items.filter((b) => b.id !== item.id));
  }
  res.status(204).end();
});

// ── Static files ────────────────────────────────────────────────────────────

app.use("/files/jobs", express.static(paths.jobs));
app.use("/files/backgrounds", express.static(paths.backgrounds));

if (existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist));
  app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/files/")) return next();
    res.sendFile(join(config.clientDist, "index.html"));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
  if (err instanceof z.ZodError) return void res.status(400).json({ error: err.issues.map((i) => i.message).join("; ") });
  if (err instanceof SyntaxError) return void res.status(400).json({ error: "Dữ liệu gửi lên không hợp lệ" });
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Lỗi không xác định" });
});

if (!isLoopback(config.host) && config.host !== "localhost" && !config.apiToken) {
  console.error(`HOST=${config.host} cho phép máy khác truy cập nên bắt buộc phải đặt API_TOKEN trong .env.local`);
  process.exit(1);
}

app.listen(config.port, config.host, () => {
  console.log(`Story Studio đang chạy: http://${config.host}:${config.port}`);
  resumeOnStartup();
});
