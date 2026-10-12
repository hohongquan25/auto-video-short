import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const venvDir = join(process.cwd(), ".venv");
const venvPython = process.platform === "win32"
  ? join(venvDir, "Scripts", "python.exe")
  : join(venvDir, "bin", "python");

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const ytdlp = "yt-dlp[default,curl-cffi]";

// `pnpm update:ytdlp`: sites change often, so yt-dlp alone is upgraded; everything else stays as is.
if (process.argv.includes("--ytdlp-only")) {
  if (!existsSync(venvPython)) {
    console.error("Chưa có .venv, chạy pnpm setup:whisper trước");
    process.exit(1);
  }
  run(venvPython, ["-m", "pip", "install", "--upgrade", ytdlp]);
  process.exit(0);
}

if (!existsSync(venvPython)) {
  run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", venvDir]);
}
// One resolve, so upgrading faster-whisper can never move the versions OlvRoc is pinned to.
run(venvPython, [
  "-m", "pip", "install", "--upgrade", "pip", "faster-whisper", ytdlp,
  "-r", join("python", "olvroc", "requirements.txt"),
]);
console.log("\nWhisper và yt-dlp đã sẵn sàng. Model Whisper sẽ tự tải về ở lần chạy đầu tiên.");
console.log("Giọng OlvRoc cần thêm model (~520 MB): chạy pnpm setup:olvroc");
