export const STEPS = ["download", "extract", "transcribe", "write", "rewrite", "review", "tts", "render"] as const;
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

export type JobStatus = "queued" | "running" | "waiting_review" | "failed" | "done";

export interface JobSettings {
  styleId: string;
  /** Which AI rewrites the script (unused when the style keeps the transcript verbatim). */
  aiProvider: AiProvider;
  voice: string;
  rate: string;
  backgroundId: string;
  reviewBeforeTts: boolean;
  /** Burn the narration as subtitles into each video. */
  subtitles: boolean;
  /** Also join the parts into one uncut video. */
  fullVideo: boolean;
  /** Output frame for the target platform. */
  format: VideoFormat;
  fit: FitMode;
  minPartSec: number;
  maxPartSec: number;
}

export interface JobPart {
  index: number;
  file: string;
  durationSec: number;
  textFile: string;
  sizeBytes?: number;
}

export type FullVideo = Omit<JobPart, "index">;

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
  parts: JobPart[];
  /** All parts joined into one video; null when not wanted or there is only one part. */
  fullVideo: FullVideo | null;
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
}

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
