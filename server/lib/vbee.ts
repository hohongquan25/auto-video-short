import { writeFileSync } from "node:fs";
import { config } from "../config.js";
import { VBEE_PREFIX, type Voice } from "../types.js";

const TTS_URL = "https://api.vbee.vn/v1/tts";
const VOICES_URL = "https://vbee.vn/api/public/v1/voices";

/** A Vbee error that retrying will not fix (bad credentials, no credits, unknown voice). */
export class FatalTtsError extends Error {}

export const vbeeConfigured = () => Boolean(config.vbeeAppId && config.vbeeToken);

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.vbeeToken}`,
    "App-Id": config.vbeeAppId ?? "",
    "Content-Type": "application/json",
  };
}

/** Pull a readable message out of Vbee's two error shapes. */
function errorOf(body: unknown, status: number): string {
  const b = body as { error?: { code?: string; message?: string }; error_code?: unknown; error_message?: string } | null;
  const msg = b?.error?.message ?? b?.error_message ?? `HTTP ${status}`;
  const code = b?.error?.code ?? b?.error_code;
  return code ? `${msg} (${code})` : msg;
}

async function call<T>(url: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { ...init, headers: headers(), signal: signal ?? AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => null);
  if (res.ok && (body as { status?: number } | null)?.status !== 0) return body as T;
  const msg = errorOf(body, res.status);
  // 400/401/403 mean bad input, credentials or credits: retrying cannot help.
  if (res.status === 400 || res.status === 401 || res.status === 403 || (body as { error_code?: number })?.error_code === 401) {
    throw new FatalTtsError(res.status === 401 || /unauthori/i.test(msg)
      ? `Vbee từ chối xác thực, kiểm tra VBEE_APP_ID và VBEE_TOKEN (token có thể đã hết hạn): ${msg}`
      : `Vbee báo lỗi: ${msg}`);
  }
  throw new Error(`Vbee lỗi: ${msg}`);
}

// ── Voices ──────────────────────────────────────────────────────────────────

interface VbeeVoice { code: string; name: string; gender?: string; language_code?: string; demo?: string; credit_factor?: number }
interface VoicesPage { result: { voices: VbeeVoice[]; pagination?: { has_next_page?: boolean; next_cursor?: string | null } } }

let voiceCache: { at: number; voices: Voice[] } | null = null;

async function fetchVoices(ownership: "VBEE" | "PERSONAL"): Promise<VbeeVoice[]> {
  const all: VbeeVoice[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < 20; page++) {
    // voiceOwnership is required in practice, although the docs list it as optional.
    const q = new URLSearchParams({ voiceOwnership: ownership, languageCode: "vi-VN", limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const body = await call<VoicesPage>(`${VOICES_URL}?${q}`, { method: "GET" });
    all.push(...(body.result?.voices ?? []));
    cursor = body.result?.pagination?.next_cursor;
    if (!body.result?.pagination?.has_next_page || !cursor) break;
  }
  return all;
}

/** Vietnamese Vbee voices (the account's own cloned voices first), cached for an hour. */
export async function listVbeeVoices(force = false): Promise<Voice[]> {
  if (!vbeeConfigured()) return [];
  if (!force && voiceCache && Date.now() - voiceCache.at < 3600_000) return voiceCache.voices;
  const [personal, standard] = await Promise.all([fetchVoices("PERSONAL").catch(() => []), fetchVoices("VBEE")]);
  const all = [...personal, ...standard];
  const voices = all
    .filter((v) => !v.language_code || v.language_code === "vi-VN")
    .map<Voice>((v) => ({
      id: `${VBEE_PREFIX}${v.code}`,
      name: v.name,
      gender: v.gender === "male" || v.gender === "female" ? v.gender : null,
      provider: "vbee",
      demoUrl: v.demo ?? null,
      creditFactor: v.credit_factor ?? 1,
    }));
  voiceCache = { at: Date.now(), voices };
  return voices;
}

export async function vbeeStatus(): Promise<{ ok: boolean; configured: boolean; voices: number; error: string | null }> {
  if (!vbeeConfigured()) {
    const missing = !config.vbeeAppId ? "VBEE_APP_ID và VBEE_TOKEN" : "VBEE_TOKEN";
    return { ok: false, configured: false, voices: 0, error: `Chưa có ${missing} trong .env.local` };
  }
  try {
    const voices = await listVbeeVoices(true);
    return { ok: true, configured: true, voices: voices.length, error: null };
  } catch (err) {
    return { ok: false, configured: true, voices: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Synthesis ───────────────────────────────────────────────────────────────

/** "+10%" → 1.1, clamped to the 0.25–1.9 range Vbee accepts. */
export function vbeeSpeed(rate: string): number {
  const speed = 1 + (parseInt(rate, 10) || 0) / 100;
  return Math.round(Math.min(1.9, Math.max(0.25, speed)) * 100) / 100;
}

interface TtsRequest { requestId?: string; status?: string; audioLink?: string; result?: TtsRequest }

/**
 * Synthesize one text with Vbee's async API: submit, poll until done, then
 * download the audio (its link expires a few minutes after completion).
 */
export async function vbeeSynthesize(text: string, voiceId: string, rate: string, outFile: string, signal: AbortSignal): Promise<void> {
  if (!vbeeConfigured()) throw new FatalTtsError("Chưa cấu hình VBEE_APP_ID và VBEE_TOKEN trong .env.local");
  const created = await call<TtsRequest>(TTS_URL, {
    method: "POST",
    body: JSON.stringify({
      text,
      voiceCode: voiceId.slice(VBEE_PREFIX.length),
      mode: "async",
      webhookUrl: config.vbeeWebhookUrl,
      outputFormat: "mp3",
      bitrate: 128,
      speed: vbeeSpeed(rate),
    }),
  }, AbortSignal.any([signal, AbortSignal.timeout(60_000)]));
  const requestId = (created.result ?? created).requestId;
  if (!requestId) throw new Error(`Vbee không trả về requestId: ${JSON.stringify(created).slice(0, 200)}`);

  const deadline = Date.now() + 15 * 60_000;
  let delay = 1500;
  while (true) {
    signal.throwIfAborted();
    if (Date.now() > deadline) throw new Error(`Vbee xử lý quá 15 phút (request ${requestId})`);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 8000);
    const got = await call<TtsRequest>(`${TTS_URL}/requests/${requestId}`, { method: "GET" }, AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
    const req = got.result ?? got;
    if (req.status === "COMPLETED" && req.audioLink) {
      const audio = await fetch(req.audioLink, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
      if (!audio.ok) throw new Error(`Không tải được audio từ Vbee: HTTP ${audio.status}`);
      const buffer = Buffer.from(await audio.arrayBuffer());
      if (buffer.length === 0) throw new Error("Vbee trả về audio rỗng");
      writeFileSync(outFile, buffer);
      return;
    }
    if (req.status === "FAILED") throw new Error(`Vbee không tạo được audio (request ${requestId})`);
  }
}
