import { tmpdir } from "node:os";
import { config } from "../config.js";
import { ProcessError, run } from "./proc.js";

/** An AI error that retrying will not fix (usage limit reached, not signed in). */
export class FatalAiError extends Error {}

/**
 * Environment for the Claude Code child process. API keys are removed so the
 * call always goes through the signed-in Claude subscription, and the markers
 * of an enclosing Claude Code session are dropped so it runs standalone.
 */
function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]) delete env[key];
  return env;
}

export interface ClaudeStatus {
  installed: boolean;
  loggedIn: boolean;
  version: string | null;
  subscription: string | null;
  error: string | null;
}

export async function claudeStatus(): Promise<ClaudeStatus> {
  const env = claudeEnv();
  let version: string | null;
  try {
    const { stdout } = await run(config.claudePath, ["--version"], { env });
    version = stdout.trim().split(/\s+/)[0] || "unknown";
  } catch {
    return { installed: false, loggedIn: false, version: null, subscription: null, error: "Chưa cài Claude Code" };
  }
  try {
    const { stdout } = await run(config.claudePath, ["auth", "status", "--json"], { env });
    const s = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
    const viaSubscription = s.loggedIn === true && s.authMethod === "claude.ai";
    return {
      installed: true,
      loggedIn: viaSubscription,
      version,
      subscription: s.subscriptionType ?? null,
      error: viaSubscription ? null : s.loggedIn ? `Đang đăng nhập bằng ${s.authMethod}, không phải tài khoản claude.ai` : "Chưa đăng nhập",
    };
  } catch (err) {
    // `auth status` exits non-zero when signed out but still prints its JSON.
    const out = err instanceof ProcessError ? err.stdout : "";
    const loggedOut = /"loggedIn"\s*:\s*false/.test(out);
    return { installed: true, loggedIn: false, version, subscription: null, error: loggedOut ? "Chưa đăng nhập" : "Không đọc được trạng thái đăng nhập" };
  }
}

interface ClaudeResult {
  type: "result";
  subtype: string;
  is_error: boolean;
  result?: string;
}

function classify(message: string): Error {
  // Short rate limits and "overloaded" are transient and left to the retry loop.
  if (/usage limit|limit reached|hit your limit|quota/i.test(message)) {
    return new FatalAiError(`Claude báo hết hạn mức sử dụng: ${message}`);
  }
  if (/log ?in|authenticat|credential|unauthori[sz]ed|401|403/i.test(message)) {
    return new FatalAiError(`Claude Code chưa đăng nhập hoặc phiên đăng nhập hết hạn (chạy "claude" trong terminal để đăng nhập lại): ${message}`);
  }
  return new Error(`Claude lỗi: ${message}`);
}

/**
 * One single-turn completion through Claude Code's headless mode
 * (`claude -p`), billed to the signed-in Claude subscription.
 * Tools are disabled and no settings or session history are loaded or saved.
 */
export async function claudeComplete(prompt: string, systemPrompt: string, signal: AbortSignal): Promise<string> {
  const args = [
    "-p",
    "--model", config.claudeModel,
    "--output-format", "json",
    "--system-prompt", systemPrompt,
    "--tools", "",
    "--setting-sources", "",
    "--no-session-persistence",
  ];
  let stdout: string;
  try {
    ({ stdout } = await run(config.claudePath, args, {
      input: prompt,
      env: claudeEnv(),
      // An unrelated directory, so no project CLAUDE.md is picked up as context.
      cwd: tmpdir(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]),
    }));
  } catch (err) {
    if (signal.aborted) throw err;
    if (err instanceof ProcessError && err.stdout.trim()) stdout = err.stdout;
    else if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new FatalAiError(`Không tìm thấy Claude Code (${config.claudePath}). Cài bằng: npm i -g @anthropic-ai/claude-code`);
    } else throw err;
  }

  let res: ClaudeResult;
  try {
    res = JSON.parse(stdout) as ClaudeResult;
  } catch {
    throw new Error(`Claude Code trả về dữ liệu không đọc được: ${stdout.slice(0, 200)}`);
  }
  if (res.is_error || res.subtype !== "success") throw classify(res.result || res.subtype);
  const text = res.result?.trim();
  if (!text) throw new Error("Claude trả về kết quả rỗng");
  return text;
}
