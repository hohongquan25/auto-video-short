import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { paths } from "./config.js";
import type { Background, Brand, DefaultSettings, FullVideo, Job, JobPart, Style, VideoFormat } from "./types.js";

const ID_RE = /^[a-z0-9-]{4,64}$/;

export function newId(): string {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 19).replace(/[-:T]/g, "").replace(/(\d{8})(\d{6})/, "$1-$2");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

const DEFAULT_STYLES: Style[] = [
  {
    id: "giu-nguyen",
    name: "Giữ nguyên văn (không viết lại)",
    prompt: "",
  },
  {
    id: "ke-chuyen-cuon-hut",
    name: "Kể chuyện cuốn hút",
    prompt:
      "Viết lại theo giọng một người kể chuyện audio chuyên nghiệp: câu văn mượt, giàu hình ảnh, nhịp kể có lúc chậm lúc dồn dập để giữ chân người nghe. Dùng văn nói tự nhiên, xưng hô nhất quán.",
  },
  {
    id: "truyen-ma",
    name: "Truyện ma rùng rợn",
    prompt:
      "Viết lại theo phong cách kể truyện ma đêm khuya: không khí u ám, hồi hộp, nhấn vào âm thanh, bóng tối và cảm giác bất an. Câu ngắn ở các đoạn cao trào.",
  },
  {
    id: "hai-huoc",
    name: "Hài hước, dí dỏm",
    prompt:
      "Viết lại với giọng kể hài hước, dí dỏm, thêm các nhận xét duyên dáng của người kể nhưng không thay đổi diễn biến hay chi tiết của câu chuyện.",
  },
];

export function ensureDataDirs(): void {
  for (const dir of [paths.jobs, paths.backgrounds, paths.uploads, paths.previews]) mkdirSync(dir, { recursive: true });
  if (!existsSync(paths.stylesFile)) writeJson(paths.stylesFile, DEFAULT_STYLES);
  if (!existsSync(paths.backgroundsFile)) writeJson(paths.backgroundsFile, []);
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export function jobDir(id: string): string {
  if (!isValidId(id)) throw new Error(`Invalid job id: ${id}`);
  return join(paths.jobs, id);
}

export function saveJob(job: Job): void {
  const dir = jobDir(job.id);
  // A job deleted while still running keeps reporting progress until it aborts.
  if (!existsSync(dir)) return;
  job.updatedAt = new Date().toISOString();
  writeJson(join(dir, "job.json"), job);
}

/** Fill in fields added after a job file was first written. */
function migrateJob(job: Job): Job {
  const legacy = job as Job & {
    log: (Job["log"][number] | string)[];
    settings: { format?: VideoFormat; backgroundId?: string };
    parts?: JobPart[];
    fullVideo?: FullVideo | null;
  };
  job.log = legacy.log.map((e) => (typeof e === "string" ? { at: "", level: "info", step: null, msg: e } : e));
  job.timings ??= {};
  job.detail ??= null;
  job.sourceDurationSec ??= null;
  job.settings.aiProvider ??= "gemini";
  job.settings.subtitles ??= false;
  job.settings.fullVideo ??= false;
  job.settings.formats ??= [legacy.settings.format ?? "original"];
  delete legacy.settings.format;
  job.settings.fit ??= "blur";
  // Jobs from before several backgrounds had exactly one.
  job.settings.backgroundIds ??= legacy.settings.backgroundId ? [legacy.settings.backgroundId] : [];
  delete legacy.settings.backgroundId;
  // Jobs from before several formats kept their one set of videos at the top of the parts folder.
  if (!job.outputs) {
    const parts = legacy.parts ?? [];
    const fullVideo = legacy.fullVideo ?? null;
    job.outputs = parts.length || fullVideo ? [{ format: job.settings.formats[0], parts, fullVideo }] : [];
  }
  job.publish ??= null;
  delete legacy.parts;
  delete legacy.fullVideo;
  job.callbackUrl ??= null;
  job.sourceUrl ??= null;
  job.sourceInfo ??= null;
  job.sourceTopic ??= null;
  job.drive ??= null;
  job.kind ??= "story";
  job.summary ??= null;
  return job;
}

export function getJob(id: string): Job | null {
  if (!isValidId(id)) return null;
  const job = readJson<Job | null>(join(jobDir(id), "job.json"), null);
  return job && migrateJob(job);
}

export function listJobs(): Job[] {
  if (!existsSync(paths.jobs)) return [];
  return readdirSync(paths.jobs)
    .filter(isValidId)
    .map(getJob)
    .filter((j): j is Job => j !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteJob(id: string): void {
  // Retries cover Windows file locks held briefly by a just-killed ffmpeg/python.
  rmSync(jobDir(id), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

// ── Styles ──────────────────────────────────────────────────────────────────

export function listStyles(): Style[] {
  return readJson<Style[]>(paths.stylesFile, []);
}

export function getStyle(id: string): Style | null {
  return listStyles().find((s) => s.id === id) ?? null;
}

export function saveStyles(styles: Style[]): void {
  writeJson(paths.stylesFile, styles);
}

// ── Backgrounds ─────────────────────────────────────────────────────────────

export function listBackgrounds(): Background[] {
  return readJson<Background[]>(paths.backgroundsFile, []);
}

export function getBackground(id: string): Background | null {
  return listBackgrounds().find((b) => b.id === id) ?? null;
}

export function saveBackgrounds(items: Background[]): void {
  writeJson(paths.backgroundsFile, items);
}

// ── Channel brand ───────────────────────────────────────────────────────────

const DEFAULT_BRAND: Brand = { enabled: false, text: "", position: "top-left", color: "#FFB020", subscribe: false, subscribeAt: "both" };

export function getBrand(): Brand {
  return { ...DEFAULT_BRAND, ...readJson<Partial<Brand>>(paths.brandFile, {}) };
}

export function saveBrand(brand: Brand): void {
  writeJson(paths.brandFile, brand);
}

// ── Default job settings ────────────────────────────────────────────────────

/** The defaults the user saved, or null while the built-in ones apply. */
export function getSavedDefaults(): DefaultSettings | null {
  return readJson<DefaultSettings | null>(paths.defaultsFile, null);
}

export function saveDefaults(defaults: DefaultSettings): void {
  writeJson(paths.defaultsFile, defaults);
}

// ── Google account ──────────────────────────────────────────────────────────

/** What the app remembers about the Google account connected through OAuth. */
export interface GoogleState {
  refreshToken?: string;
  account?: string;
  /** The folder and sheet the app made itself when none were configured. */
  folderId?: string;
  sheetId?: string;
}

export function getGoogleState(): GoogleState {
  return readJson<GoogleState>(paths.googleFile, {});
}

export function saveGoogleState(patch: GoogleState): void {
  writeJson(paths.googleFile, { ...getGoogleState(), ...patch });
}
