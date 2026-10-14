/** 75 → "1:15", 3725 → "1:02:05". Shared by server log messages and the client. */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return h ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const formatChars = (n: number) => n.toLocaleString("vi-VN");

/** A playback speed such as "1,25×". */
export const formatSpeed = (speed: number) => `${speed.toLocaleString("vi-VN")}×`;

/** Measured Edge TTS Vietnamese speaking speed at rate +0%. */
export const TTS_CHARS_PER_SEC = 14;

/** Rough narration length of a script read at `rate` (e.g. "+10%"). */
export function estimateSpeechSec(chars: number, rate: string): number {
  const factor = 1 + (parseInt(rate, 10) || 0) / 100;
  return chars / (TTS_CHARS_PER_SEC * factor);
}
