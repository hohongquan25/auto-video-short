import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { config } from "../config.js";
import { OLVROC_PREFIX, type Voice } from "../types.js";
import { encodeMp3 } from "./ffmpeg.js";
import { run } from "./proc.js";

/** A TTS error that retrying will not fix (missing packages or model, bad voice). */
export class FatalTtsError extends Error {}

/**
 * OlvRoc: 25 free Vietnamese voices synthesized on this machine by
 * python/olvroc_tts.py (model code in python/olvroc). Loading the model takes
 * seconds, so one worker process stays up and reads every segment.
 */

// ── Voices ──────────────────────────────────────────────────────────────────

interface PresetVoice { name: string; description: string; gender: string | null }

/** Where the Python side finds the model files and which backbone it loads. */
const pythonEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  OLVROC_MODEL_DIR: config.olvrocModelDir,
  OLVROC_PRECISION: config.olvrocPrecision,
});

/** Checked once per server start, like the rest of the system status; `force` re-checks. */
let voiceList: Promise<Voice[]> | null = null;

export function listOlvrocVoices(force = false): Promise<Voice[]> {
  if (!voiceList || force) {
    // Also checks that the packages are installed and the model files are in place.
    voiceList = run(config.olvrocPython, [config.olvrocScript, "--voices"], { env: pythonEnv() }).then(({ stdout }) =>
      (JSON.parse(stdout) as PresetVoice[]).map<Voice>((v) => ({
        id: `${OLVROC_PREFIX}${v.name}`,
        name: v.name,
        gender: v.gender === "male" || v.gender === "female" ? v.gender : null,
        provider: "olvroc",
        detail: v.description || undefined,
      })));
    voiceList.catch(() => {}); // callers handle it; this keeps a cached failure from being "unhandled"
  }
  return voiceList;
}

export async function olvrocStatus(force = false): Promise<{ ok: boolean; python: string; voices: number; error: string | null }> {
  try {
    const voices = await listOlvrocVoices(force);
    return { ok: true, python: config.olvrocPython, voices: voices.length, error: null };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 300);
    return { ok: false, python: config.olvrocPython, voices: 0, error: msg };
  }
}

// ── Worker ──────────────────────────────────────────────────────────────────

/** The model holds a few GB of RAM, so the worker exits after this long without work. */
const IDLE_MS = 10 * 60_000;

type Reply =
  | { event: "loading" }
  | { event: "ready"; seconds: number }
  | { event?: undefined; id: number; ok: true; seconds: number; duration: number }
  | { event?: undefined; id: number; ok: false; error: string };

class Worker {
  /** Seconds the model took to load. */
  readonly ready: Promise<number>;
  private dead = false;
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: () => void; reject: (err: Error) => void }>();
  private nextId = 1;
  private stderr = "";
  private idleTimer: NodeJS.Timeout | null = null;
  private onReady!: (seconds: number) => void;
  private onFail!: (err: Error) => void;

  constructor() {
    this.ready = new Promise((resolve, reject) => {
      this.onReady = resolve;
      this.onFail = reject;
    });
    this.ready.catch(() => {}); // failures also reach every pending request
    this.child = spawn(config.olvrocPython, [config.olvrocScript], {
      windowsHide: true,
      env: pythonEnv(),
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.onLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-20000);
    });
    this.child.stdin.on("error", () => {}); // the process died; "close" reports why
    this.child.on("error", (err) => this.fail(new FatalTtsError(`Không chạy được Python của OlvRoc (${config.olvrocPython}): ${err.message}`)));
    this.child.on("close", (code) => this.fail(this.exitError(code)));
  }

  private onLine(line: string): void {
    let msg: Reply;
    try {
      msg = JSON.parse(line) as Reply;
    } catch {
      return;
    }
    if (msg.event === "ready") return this.onReady(msg.seconds);
    if (msg.event) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    // The same text and voice would fail the same way again, so do not retry.
    if (msg.ok) p.resolve();
    else p.reject(new FatalTtsError(`OlvRoc báo lỗi: ${msg.error}`));
    if (this.pending.size === 0) this.idleTimer = setTimeout(() => this.kill(), IDLE_MS);
  }

  private exitError(code: number | null): Error {
    const cause = this.stderr.trim().split(/\r?\n/).pop()?.trim();
    const msg = `OlvRoc dừng (mã ${code})${cause ? `: ${cause}` : ""}`;
    // A missing package or model file will not appear between retries.
    if (/ModuleNotFoundError|No module named/.test(this.stderr)) return new FatalTtsError(`${msg}. Chạy "pnpm setup:whisper" để cài`);
    if (/Thiếu model OlvRoc/.test(this.stderr)) return new FatalTtsError(`${msg}. Chạy "pnpm setup:olvroc" để tải model`);
    return new Error(msg);
  }

  private fail(err: Error): void {
    if (this.dead) return;
    this.dead = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.onFail(err);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  /** Write `text` read by preset `voice` to `outWav`. */
  synthesize(text: string, voice: string, outWav: string): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, text, voice, out: outWav })}\n`);
    });
  }

  /** False once the process exited or is being stopped, so new work goes to a fresh worker. */
  get usable(): boolean {
    return !this.dead && !this.stopping;
  }

  private stopping = false;

  kill(): void {
    this.stopping = true;
    this.child.kill();
  }
}

let worker: Worker | null = null;

function getWorker(log?: (msg: string) => void): Worker {
  if (worker?.usable) return worker;
  const w = new Worker();
  worker = w;
  log?.("Nạp model OlvRoc (lần đầu sẽ tải model về, có thể mất vài phút)");
  w.ready.then((sec) => log?.(`Đã nạp model OlvRoc sau ${sec}s`), () => {});
  return w;
}

// ── Synthesis ───────────────────────────────────────────────────────────────

/** Node 24's fs.rmSync silently keeps files with Vietnamese names on Windows; unlink does not. */
function removeFile(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // already gone
  }
}

/** "+10%" → 1.1 for ffmpeg's atempo, which OlvRoc has no setting for. */
export function olvrocTempo(rate: string): number {
  const tempo = 1 + (parseInt(rate, 10) || 0) / 100;
  return Math.round(Math.min(2, Math.max(0.5, tempo)) * 100) / 100;
}

/** Synthesize one text to MP3. Cancelling stops the worker, since a running synthesis cannot be interrupted. */
export async function olvrocSynthesize(
  text: string, voiceId: string, rate: string, outFile: string, signal: AbortSignal, log?: (msg: string) => void,
): Promise<void> {
  signal.throwIfAborted();
  const w = getWorker(log);
  const wav = `${outFile}.wav`;
  const onAbort = () => w.kill();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await w.synthesize(text, voiceId.slice(OLVROC_PREFIX.length), wav);
    await encodeMp3(wav, outFile, olvrocTempo(rate), signal);
  } finally {
    signal.removeEventListener("abort", onAbort);
    removeFile(wav);
  }
}
