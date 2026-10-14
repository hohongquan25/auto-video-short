export const STEPS = ["download", "extract", "transcribe", "write", "rewrite", "review", "tts", "render", "publish"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  download: "Tải từ link",
  extract: "Tách audio",
  transcribe: "Nhận dạng giọng nói",
  write: "AI viết truyện",
  rewrite: "AI viết lại",
  review: "Duyệt kịch bản",
  tts: "Tạo giọng đọc",
  render: "Dựng video",
  publish: "Gợi ý đăng bài",
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
  /** Null where the platform has only a description (TikTok), which then starts with the title. */
  title: string | null;
  description: string;
  tags: string[];
}

/** The post for one video of `format`; `part` is null for a video holding the whole story. */
export function postFor(kit: PublishKit, format: VideoFormat, part: { index: number; total: number } | null): PostSuggestion {
  const suffix = part ? ` | Phần ${part.index}/${part.total}` : "";
  if (format === "youtube" && kit.youtube) {
    return { title: kit.youtube.title + suffix, description: kit.youtube.description, tags: kit.youtube.tags };
  }
  const title = (kit.titles[0] ?? "") + (part ? suffix : " (trọn bộ)");
  const hook = (part && kit.partHooks[part.index - 1]) || kit.caption;
  return { title: null, description: [title, hook, kit.hashtags.join(" ")].filter(Boolean).join("\n\n"), tags: [] };
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

export interface Job {
  id: string;
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
}

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
