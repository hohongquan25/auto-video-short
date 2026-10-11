import { spawn } from "node:child_process";
import { basename } from "node:path";

export interface RunOptions {
  onStdoutLine?: (line: string) => void;
  signal?: AbortSignal;
  /** Written to the child's stdin, which is then closed. */
  input?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/** A non-zero exit; keeps stdout because some tools report errors there. */
export class ProcessError extends Error {
  constructor(message: string, public code: number | null, public stdout: string, public stderr: string) {
    super(message);
  }
}

/** Run a process without a shell (args are passed verbatim, no injection). */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, signal: opts.signal, env: opts.env, cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    let pending = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stdout.length < 1_000_000) stdout += text;
      if (!opts.onStdoutLine) return;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) opts.onStdoutLine(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.stdin.on("error", () => {}); // child exited before reading all input; "close" reports why
    child.stdin.end(opts.input);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      // The last stderr line is usually the actual cause (Python exception, ffmpeg error).
      const cause = stderr.trim().split(/\r?\n/).pop()?.trim();
      const name = basename(cmd);
      const message = `${cause ? `${name}: ${cause}` : `${name} thoát với mã ${code}`}\n${cmd} (mã ${code})\n${stderr.slice(-2000)}`;
      reject(new ProcessError(message, code, stdout, stderr));
    });
  });
}
