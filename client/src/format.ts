import type { CSSProperties } from "react";
import { RECOLOR, type BackgroundLook, type JobStatus } from "../../server/types";

export {
  AI_PROVIDER_LABELS, BACKGROUND_SPEEDS, FORMAT_ORDER, STEP_LABELS, VIDEO_FORMATS, driveFolderUrl, formatPlan, postFor, renderedSec, sheetUrl,
  LANGUAGES, SHORT_OF_SUGGESTED, SUMMARY_DEFAULTS, SUMMARY_FOCUS_PRESETS, fileSlug, focusLabel, languageLabel, storyNameFromTitle, videoCount, videoFileName,
} from "../../server/types";
export { TTS_CHARS_PER_SEC, estimateSpeechSec, formatBytes, formatChars, formatDuration, formatSpeed } from "../../server/lib/format";
export { clock } from "../../server/lib/captions";

export const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Đang chờ",
  running: "Đang xử lý",
  waiting_review: "Chờ duyệt",
  failed: "Lỗi",
  done: "Hoàn thành",
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", { hour12: false, dateStyle: "short", timeStyle: "short" });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", { hour12: false });
}

export function formatRelative(iso: string, now = Date.now()): string {
  const sec = Math.round((now - Date.parse(iso)) / 1000);
  if (sec < 45) return "vừa xong";
  if (sec < 3600) return `${Math.round(sec / 60)} phút trước`;
  if (sec < 86400) return `${Math.round(sec / 3600)} giờ trước`;
  if (sec < 7 * 86400) return `${Math.round(sec / 86400)} ngày trước`;
  return formatDate(iso);
}

/** 42 → "42 giây", 200 → "3 phút 20 giây", 4000 → "1 giờ 7 phút". */
export function formatSpan(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} giây`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return m ? `${h} giờ ${m} phút` : `${h} giờ`;
  const r = s % 60;
  return r ? `${m} phút ${r} giây` : `${m} phút`;
}

export const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");

/** CSS copy of a background's mirror and colour shift (lookFilter in server/lib/ffmpeg.ts); speed is playAt. */
/** Callback ref that plays a preview video at a background's speed, so it moves like the render. */
export const playAt = (speed = 1) => (el: HTMLVideoElement | null) => {
  if (el) el.defaultPlaybackRate = el.playbackRate = speed;
};

export function lookStyle(look: BackgroundLook): CSSProperties {
  const { hueDeg, saturation, contrast } = RECOLOR;
  return {
    transform: look.mirror ? "scaleX(-1)" : undefined,
    filter: look.recolor ? `hue-rotate(${hueDeg}deg) saturate(${saturation}) contrast(${contrast})` : undefined,
  };
}
