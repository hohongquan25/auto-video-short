export const STEPS = [
  "download", "captions", "extract", "transcribe", "write", "rewrite", "review", "tts", "render", "publish", "upload", "summarize", "narrate", "cut",
] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  download: "Tải từ link",
  captions: "Lấy phụ đề",
  extract: "Tách audio",
  transcribe: "Nhận dạng giọng nói",
  write: "AI viết truyện",
  rewrite: "AI viết lại",
  review: "Duyệt kịch bản",
  tts: "Tạo giọng đọc",
  render: "Dựng video",
  publish: "Gợi ý đăng bài",
  upload: "Lưu lên Drive",
  summarize: "AI tóm tắt",
  narrate: "Lồng giọng kể",
  cut: "Cắt ghép video",
};

export type AiProvider = "claude" | "gemini";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  claude: "Claude",
  gemini: "Gemini",
};

export type VideoFormat = "original" | "tiktok" | "youtube";
/** How a background whose shape differs from the output frame fills it. */
export type FitMode = "blur" | "crop";

export const VIDEO_FORMATS: Record<VideoFormat, { label: string; desc: string; size: { width: number; height: number } | null }> = {
  original: { label: "Giữ nguyên", desc: "Theo khung và độ phân giải của video nền", size: null },
  tiktok: { label: "TikTok", desc: "Dọc 9:16 · 1080×1920 (cũng hợp Reels, Shorts)", size: { width: 1080, height: 1920 } },
  youtube: { label: "YouTube", desc: "Ngang 16:9 · 1920×1080", size: { width: 1920, height: 1080 } },
};

/** The order formats are rendered and listed in. */
export const FORMAT_ORDER: VideoFormat[] = ["tiktok", "youtube", "original"];

/**
 * How each chosen format is cut. Next to TikTok's short parts, YouTube gets
 * the whole story as one long video instead of parts of its own.
 */
export function formatPlan(formats: VideoFormat[]): { format: VideoFormat; whole: boolean }[] {
  return FORMAT_ORDER.filter((f) => formats.includes(f))
    .map((format) => ({ format, whole: format === "youtube" && formats.includes("tiktok") }));
}

export type JobStatus = "queued" | "running" | "waiting_review" | "failed" | "done";

export interface JobSettings {
  styleId: string;
  /** Which AI rewrites the script (unused when the style keeps the transcript verbatim). */
  aiProvider: AiProvider;
  voice: string;
  rate: string;
  /** Library videos to cut the backgrounds from, in a random order; at least one. */
  backgroundIds: string[];
  reviewBeforeTts: boolean;
  /** Burn the narration as subtitles into each video. */
  subtitles: boolean;
  /** Also join the parts into one uncut video. */
  fullVideo: boolean;
  /** Output frames, one set of videos per platform. */
  formats: VideoFormat[];
  fit: FitMode;
  minPartSec: number;
  maxPartSec: number;
}

/** What a new job starts from. Backgrounds are left out: a new job uses the whole library. */
export type DefaultSettings = Omit<JobSettings, "backgroundIds">;

/**
 * Defaults until the user saves their own. The style is not fixed here: it
 * is the first style that rewrites with AI.
 */
export const BUILTIN_DEFAULTS: Omit<DefaultSettings, "styleId"> = {
  aiProvider: "claude",
  voice: "olvroc:Ngọc Huyền",
  rate: "+0%",
  reviewBeforeTts: false,
  subtitles: true,
  fullVideo: true,
  formats: ["original"],
  fit: "blur",
  minPartSec: 120,
  maxPartSec: 300,
};

/** Stand-in voice when the default OlvRoc voice is not installed. */
export const FALLBACK_VOICE = "vi-VN-HoaiMyNeural";

export interface JobPart {
  index: number;
  file: string;
  durationSec: number;
  textFile: string;
  sizeBytes?: number;
  /** Cover image (JPG) next to the video, made by the publish step. */
  cover?: string;
}

export type FullVideo = Omit<JobPart, "index">;

/** The videos rendered for one format. File names are relative to the job's parts folder. */
export interface JobOutput {
  format: VideoFormat;
  /** Empty when the format gets the whole story as one video. */
  parts: JobPart[];
  /** The whole story in one video: the only video of a whole format, or the joined parts. */
  fullVideo: FullVideo | null;
}

/** Suggested post texts for a finished job, written by the AI from the story. */
export interface PublishKit {
  /** The AI that wrote it; null when the AI failed and the texts are built from the job title. */
  by: string | null;
  /** The AI's read of the story's niche and of what works for similar stories. */
  niche: { genre: string; audience: string; similar: string[]; insight: string } | null;
  /** Alternative post titles, best first. */
  titles: string[];
  /** The story's own short name, for file names and as the name in TikTok posts; missing from kits written before it was asked for. */
  storyName?: string | null;
  /** A few punchy words printed on the covers. */
  coverText: string;
  /** Post description, without hashtags. */
  caption: string;
  /** Each starting with "#". */
  hashtags: string[];
  /** One teaser line per part of the split formats. */
  partHooks: string[];
  /** Only when YouTube is one of the formats. */
  youtube: { title: string; description: string; tags: string[] } | null;
}

/** What to fill in when posting one video. */
export interface PostSuggestion {
  /** Null where the platform has only a description (TikTok), which then starts with the story's short name. */
  title: string | null;
  description: string;
  tags: string[];
}

/** TikTok takes at most this many hashtags in a post. */
export const TIKTOK_HASHTAGS = 5;

/**
 * The post for one video of `format`; `part` is null for a video holding the
 * whole story. Other than YouTube's own texts, a post is just the story's
 * short name and the hashtags TikTok takes, without a description.
 */
export function postFor(kit: PublishKit, format: VideoFormat, part: { index: number; total: number } | null): PostSuggestion {
  const suffix = part ? ` | Phần ${part.index}/${part.total}` : "";
  const best = kit.titles[0] ?? "";
  if (format === "youtube") {
    if (kit.youtube) return { title: kit.youtube.title + suffix, description: kit.youtube.description, tags: kit.youtube.tags };
    // Without the AI's YouTube texts a YouTube video keeps a full description: title, teaser or caption, every hashtag.
    const hook = (part && kit.partHooks[part.index - 1]) || kit.caption;
    return { title: null, description: [best + (part ? suffix : " (trọn bộ)"), hook, kit.hashtags.join(" ")].filter(Boolean).join("\n\n"), tags: [] };
  }
  // A kit without the AI's short name (written before it was asked for) takes it from the best title.
  const name = (kit.storyName || storyNameFromTitle(best) || best) + (part ? suffix : " (trọn bộ)");
  return { title: null, description: [name, kit.hashtags.slice(0, TIKTOK_HASHTAGS).join(" ")].filter(Boolean).join("\n\n"), tags: [] };
}

/** "Ba Tiếng Gõ Cửa!" → "ba_tieng_go_cua": no marks, lowercase, words joined by "_". */
export function fileSlug(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Past this a long title is cut after a whole word, keeping file names well inside every system's limit. */
const FILE_TITLE_CHARS = 80;
const cutTitle = (slug: string) =>
  slug.length <= FILE_TITLE_CHARS ? slug : slug.slice(0, FILE_TITLE_CHARS + 1).replace(/_[^_]*$/, "").slice(0, FILE_TITLE_CHARS);

/** Tags in brackets, hashtags, credits, and view or reaction counts, as source videos put in their titles. */
const TITLE_TAGS = /\[[^\]]*\]|【[^】]*】|\([^)]*\)|#\S*|\b(cre|credit|nguồn|source)\s*:.*$|\d[\d.,]*\s*[kmb]?\s*(views?|lượt xem|reactions?|likes?|lượt thích|comments?|bình luận|shares?)/giu;
/** Between the pieces of a title, and between its sentences when it is a whole teaser. */
const TITLE_SEPARATORS = /\s+[-–—]\s+|\s*[|·•]\s*|[:.]\s+/u;
/** A piece of a title that says nothing about the story: a number, its length, "full", a part number, the channel or the genre. */
const TITLE_NOISE = /^(\d+|full( bộ)?|trọn bộ|\d+\s*(phút|giờ|tiếng)|(tập|phần|part|ep)\s*\d+|.*\b(audio|official|channel|radio|podcast)\b.*|truyện (ngắn|audio|ma|hay|kể|kinh dị|ngôn tình|cổ tích|trinh thám)\b.*)$/iu;

/**
 * What a source video's title says the story is called: "[FULL] Mẹ bạn cùng
 * phòng - SHABI AUDIO" → "Mẹ bạn cùng phòng", "2 phút - Người đàn ông và quả
 * dừa - Bài học…" → "Người đàn ông và quả dừa". The first piece that is not
 * noise wins, as the story's name usually comes first and the channel last.
 */
export function storyNameFromTitle(title: string): string {
  const pieces = title.replace(TITLE_TAGS, " ").split(TITLE_SEPARATORS).map((s) => s.replace(/["“”'‘’]/g, "").trim()).filter(Boolean);
  return pieces.find((s) => !TITLE_NOISE.test(s)) ?? pieces.join(" ");
}

/**
 * Name, without extension, of one video of a job and of its cover, on Drive
 * and when downloaded: "ba_tieng_go_cua_phan_1", or "ba_tieng_go_cua_day_du"
 * for the uncut story next to parts. It is the short name the AI gave the
 * story, or else the job title without its noise. The format is named only
 * when the job has several, which share one folder.
 */
export function videoFileName(job: Pick<Job, "title" | "outputs" | "publish">, format: VideoFormat, part: number | null): string {
  const title = cutTitle(fileSlug(job.publish?.storyName || storyNameFromTitle(job.title))) || cutTitle(fileSlug(job.title)) || "video";
  const hasParts = job.outputs.some((o) => o.format === format && o.parts.length > 0);
  const rest = [
    job.outputs.length > 1 ? VIDEO_FORMATS[format].label : "",
    part ? `Phần ${part}` : hasParts ? "Đầy đủ" : "",
  ];
  return [title, ...rest.map(fileSlug)].filter(Boolean).join("_");
}

export const videoCount = (outputs: JobOutput[]): number =>
  outputs.reduce((n, o) => n + o.parts.length + (o.fullVideo ? 1 : 0), 0);

/** Length of the rendered story, the same in every format. */
export function renderedSec(outputs: JobOutput[]): number {
  const o = outputs[0];
  if (!o) return 0;
  return o.parts.length ? o.parts.reduce((s, p) => s + p.durationSec, 0) : o.fullVideo?.durationSec ?? 0;
}

export type LogLevel = "info" | "success" | "warn" | "error";

export interface LogEntry {
  /** ISO time; empty for entries migrated from the old plain-text log. */
  at: string;
  level: LogLevel;
  step: Step | null;
  msg: string;
}

export interface StepTiming {
  startedAt: string;
  endedAt: string | null;
}

/** A story job turns a recording or topic into narrated videos; a summary job retells a long video over the passages that matter. */
export type JobKind = "story" | "summary";

export interface Job {
  id: string;
  kind: JobKind;
  title: string;
  /** Empty until a job created from a link has been downloaded. */
  sourceFile: string;
  sourceDurationSec: number | null;
  /** Set for jobs created from a video link instead of an uploaded file. */
  sourceUrl: string | null;
  sourceInfo: SourceInfo | null;
  /** Set for jobs whose story the AI writes from a topic instead of a recording. */
  sourceTopic: StoryTopic | null;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  step: Step | null;
  progress: number;
  /** One-line description of what the current step is doing right now. */
  detail: string | null;
  timings: Partial<Record<Step, StepTiming>>;
  error: string | null;
  settings: JobSettings;
  reviewApproved: boolean;
  /** One entry per chosen format, in FORMAT_ORDER. */
  outputs: JobOutput[];
  /** Post suggestions, made after the videos; null until then. */
  publish: PublishKit | null;
  log: LogEntry[];
  /** Webhook for this job's status changes (e.g. an n8n Webhook node), on top of WEBHOOK_URL. */
  callbackUrl: string | null;
  /** Where the videos went on Google Drive; null until the upload step has run. */
  drive: DriveUpload | null;
  /** Everything a summary job knows and makes; null for story jobs, whose `settings` it replaces. */
  summary: SummaryJob | null;
}

/** Languages offered for what a video says, its summary and its subtitles; Whisper and the AIs know many more. */
export const LANGUAGES: Record<string, string> = {
  vi: "Tiếng Việt", en: "Tiếng Anh", zh: "Tiếng Trung", ja: "Tiếng Nhật", ko: "Tiếng Hàn", th: "Tiếng Thái",
  id: "Tiếng Indonesia", ms: "Tiếng Mã Lai", fr: "Tiếng Pháp", de: "Tiếng Đức", es: "Tiếng Tây Ban Nha",
  pt: "Tiếng Bồ Đào Nha", ru: "Tiếng Nga", hi: "Tiếng Hindi", ar: "Tiếng Ả Rập",
};

/** "en", "en-US", "en-orig" → "Tiếng Anh"; a language not in the list keeps its code. */
export const languageLabel = (code: string): string => LANGUAGES[code.split("-")[0].toLowerCase()] ?? code;

export interface SummarySettings {
  /** Which AI picks the passages and writes the summary and its narration. */
  aiProvider: AiProvider;
  /** Wanted length of the cut video; null lets the AI take what it judges telling every main point needs. */
  targetSec: number | null;
  /** What the summary should dwell on, in the user's words, ahead of the AI's general rules; "" tells the whole content evenly. */
  focus: string;
  /** What the video speaks, a code from LANGUAGES; "" lets the captions or Whisper tell. */
  language: string;
  /** Read the video's own captions when it has some, instead of transcribing its speech. */
  useCaptions: boolean;
  /** The narrator's voice and speed, as in a story job. The video's own sound is dropped. */
  voice: string;
  rate: string;
  /** Burn the narration as subtitles into the video. */
  subtitles: boolean;
  format: VideoFormat;
  fit: FitMode;
}

export const SUMMARY_DEFAULTS: SummarySettings = {
  aiProvider: "claude", targetSec: null, focus: "", language: "", useCaptions: true, voice: BUILTIN_DEFAULTS.voice, rate: "+0%",
  subtitles: true, format: "original", fit: "blur",
};

/** Ready-made focuses for a summary; the user may edit one or write their own. */
export const SUMMARY_FOCUS_PRESETS: { label: string; hint: string; text: string }[] = [
  {
    label: "Cảnh đánh nhau", hint: "giữ trọn các trận đấu",
    text: "Tập trung vào các cảnh đánh nhau, giao chiến, rượt đuổi. Dành phần lớn thời lượng cho những cảnh này và giữ trọn từng trận, " +
      "từ lúc xung đột nổ ra đến khi ngã ngũ, kể cả những khoảng dài không lời thoại nằm giữa lời thách thức, tiếng la hét hay mệnh lệnh tấn công. " +
      "Lời kể tả dồn dập từng pha giao đấu: ai ra đòn, ai lép vế, bước ngoặt, kết cục, đủ dài để phủ hết cảnh. " +
      "Phần còn lại của câu chuyện chỉ kể gọn trong các câu chuyển ý, đủ để người xem hiểu vì sao các bên đối đầu.",
  },
  {
    label: "Tình cảm", hint: "chuyện tình, cảm xúc",
    text: "Tập trung vào chuyện tình cảm giữa các nhân vật: những lần gặp gỡ, rung động, hiểu lầm, chia ly và hàn gắn. " +
      "Lời kể khắc hoạ cảm xúc của nhân vật. Các tuyến truyện khác chỉ kể gọn trong các câu chuyển ý.",
  },
  {
    label: "Gay cấn, bất ngờ", hint: "bí mật, cú lật",
    text: "Tập trung vào những tình tiết gay cấn và bất ngờ: bí mật bị lộ, cú lật ngược, khoảnh khắc nghẹt thở. " +
      "Lời kể giữ nhịp hồi hộp, gợi tò mò trước mỗi bước ngoặt rồi mới hé lộ. Các phần bình lặng chỉ kể gọn trong các câu chuyển ý.",
  },
];

/** A focus by its preset's name, or "riêng" when the user wrote their own; null when there is none. */
export function focusLabel(focus: string): string | null {
  if (!focus) return null;
  return SUMMARY_FOCUS_PRESETS.find((p) => p.text === focus)?.label ?? "riêng";
}

/** One passage of the source kept in the cut, in the source's seconds, and what the narrator says over it. */
export interface SummaryClip {
  startSec: number;
  endSec: number;
  /** The passage retold in the third person, in Vietnamese. */
  narration: string;
  /** Length in the cut video, which follows the narration; set once it has been read aloud. */
  outSec?: number;
}

/** A wanted length under this share of what the AI judged enough likely leaves main points out. */
export const SHORT_OF_SUGGESTED = 0.8;

export interface SummaryResult {
  title: string;
  text: string;
  keyPoints: string[];
  clips: SummaryClip[];
  /** How long the AI judged a summary must be to tell every main point, and why; missing from summaries made before it was asked. */
  suggested?: { sec: number; reason: string } | null;
  /** The cut video in the job folder; null until the cut step has made it. */
  file: string | null;
  durationSec: number | null;
  sizeBytes: number | null;
}

export interface SummaryJob {
  settings: SummarySettings;
  /** Where the timed transcript came from; null until there is one. */
  transcriptFrom: "captions" | "speech" | null;
  /** Language of the transcript, as its captions or Whisper report it. */
  language: string | null;
  /** The AI's summary and passages, then the cut video; null until the summarize step. */
  result: SummaryResult | null;
}

/** A file the upload step sent to Drive, with the size and time of the local file it was sent from. */
export interface DriveFile {
  id: string;
  size: number;
  mtimeMs: number;
}

export interface DriveUpload {
  /** The folder the job's folder was made in; a new one is made when this changes. */
  rootId: string;
  /** The job's own folder, holding its videos and covers. */
  folderId: string;
  /** The Google Sheet the job's videos were listed in, one row each. */
  sheetId: string;
  /** Uploaded files by their path in the job's parts folder. An unchanged file is not sent again. */
  files: Record<string, DriveFile>;
}

export const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export interface StoryTopic {
  /** The user's topic or idea: genre, setting, characters, twists… */
  prompt: string;
  /** Wanted narration length, in minutes at the job's voice rate. */
  minMinutes: number;
  maxMinutes: number;
  /** No title was given, so the AI's title replaces the placeholder. */
  autoTitle: boolean;
}

export interface SourceInfo {
  title: string;
  uploader: string | null;
  durationSec: number | null;
  /** yt-dlp extractor name, e.g. "Youtube", "TikTok", "Facebook". */
  platform: string;
  webpageUrl: string;
  thumbnail: string | null;
}

export interface SystemStatus {
  ffmpeg: { ok: boolean; version: string | null };
  whisper: { ok: boolean; python: string; error: string | null };
  gemini: { ok: boolean; model: string };
  claude: { ok: boolean; installed: boolean; version: string | null; subscription: string | null; model: string; error: string | null };
  olvroc: { ok: boolean; python: string; voices: number; error: string | null };
  ytdlp: { ok: boolean; version: string | null; cookies: string | null };
  google: GoogleStatus;
}

export interface GoogleStatus {
  ok: boolean;
  /** How the app signs in to Google: a service account key, or a person's account through OAuth. Null when not set up. */
  auth: "service" | "oauth" | null;
  /** OAuth is set up, so an account can be connected (or reconnected) from the browser. */
  canConnect: boolean;
  account: string | null;
  folderUrl: string | null;
  sheetUrl: string | null;
  error: string | null;
}

export interface Style {
  id: string;
  name: string;
  /** Empty prompt = keep the transcript verbatim (no AI rewrite). */
  prompt: string;
}

export type BrandPosition = "top-left" | "top-right";

/** The channel name stamped on every rendered video. */
export interface Brand {
  enabled: boolean;
  text: string;
  position: BrandPosition;
  /** Accent colour of the badge, "#RRGGBB". */
  color: string;
  /** Animated "subscribe + bell" call to action in each video. */
  subscribe: boolean;
  subscribeAt: "start" | "end" | "both";
}

export interface Background {
  id: string;
  name: string;
  file: string;
  durationSec: number;
  createdAt: string;
  /** Mirror the picture left to right in rendered videos. The file itself is never changed. */
  mirror?: boolean;
  /** Shift the colours slightly (RECOLOR) in rendered videos. */
  recolor?: boolean;
  /** Play the background faster in rendered videos, one of BACKGROUND_SPEEDS (1 when unset). */
  speed?: number;
}

/** How a background's picture is altered when it is rendered. */
export type BackgroundLook = Pick<Background, "mirror" | "recolor" | "speed">;

/** The speeds a background can be fast-forwarded to, cycled through by its button in the library. */
export const BACKGROUND_SPEEDS = [1, 1.25, 1.5, 2];

/** The "recolor" shift, applied by ffmpeg and copied by the CSS preview in the library. */
export const RECOLOR = { hueDeg: 12, saturation: 1.15, contrast: 1.05 };

export type TtsProvider = "edge" | "olvroc";

export const TTS_PROVIDER_LABELS: Record<TtsProvider, string> = {
  edge: "Edge TTS",
  olvroc: "OlvRoc",
};

export interface Voice {
  /** Edge voices use their Microsoft name; OlvRoc voices are "olvroc:<preset name>". */
  id: string;
  name: string;
  gender: "male" | "female" | null;
  provider: TtsProvider;
  /** Shown under the name in place of gender and region, e.g. "Nam · Bắc · Phong cách tin tức". */
  detail?: string;
}

export const OLVROC_PREFIX = "olvroc:";

export const voiceProvider = (id: string): TtsProvider =>
  id.startsWith(OLVROC_PREFIX) ? "olvroc" : "edge";

export const EDGE_VOICES: Voice[] = [
  { id: "vi-VN-HoaiMyNeural", name: "Hoài My", gender: "female", provider: "edge" },
  { id: "vi-VN-NamMinhNeural", name: "Nam Minh", gender: "male", provider: "edge" },
];
