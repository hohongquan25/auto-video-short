export const STEPS = ["download", "extract", "transcribe", "rewrite", "review", "tts", "render"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  download: "Tải từ link",
  extract: "Tách audio",
  transcribe: "Nhận dạng giọng nói",
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

export type JobStatus = "queued" | "running" | "waiting_review" | "failed" | "done";

export interface JobSettings {
  styleId: string;
  /** Which AI rewrites the script (unused when the style keeps the transcript verbatim). */
  aiProvider: AiProvider;
  voice: string;
  rate: string;
  backgroundId: string;
  reviewBeforeTts: boolean;
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
  log: LogEntry[];
  /** Webhook for this job's status changes (e.g. an n8n Webhook node), on top of WEBHOOK_URL. */
  callbackUrl: string | null;
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
  vbee: { ok: boolean; configured: boolean; voices: number; error: string | null };
  ytdlp: { ok: boolean; version: string | null; cookies: string | null };
}

export interface Style {
  id: string;
  name: string;
  /** Empty prompt = keep the transcript verbatim (no AI rewrite). */
  prompt: string;
}

export interface Background {
  id: string;
  name: string;
  file: string;
  durationSec: number;
  createdAt: string;
}

export type TtsProvider = "edge" | "vbee";

export interface Voice {
  /** Edge voices use their Microsoft name; Vbee voices are "vbee:<voiceCode>". */
  id: string;
  name: string;
  gender: "male" | "female" | null;
  provider: TtsProvider;
  /** Sample clip hosted by the provider (Vbee), playable without spending credits. */
  demoUrl: string | null;
  /** Vbee credits charged per character (1 for standard voices, 2–3 for premium ones). */
  creditFactor: number | null;
}

export const VBEE_PREFIX = "vbee:";

export const voiceProvider = (id: string): TtsProvider => (id.startsWith(VBEE_PREFIX) ? "vbee" : "edge");

export const EDGE_VOICES: Voice[] = [
  { id: "vi-VN-HoaiMyNeural", name: "Hoài My", gender: "female", provider: "edge", demoUrl: null, creditFactor: null },
  { id: "vi-VN-NamMinhNeural", name: "Nam Minh", gender: "male", provider: "edge", demoUrl: null, creditFactor: null },
];
