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

if (!existsSync(venvPython)) {
  run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", venvDir]);
}
// yt-dlp downloads audio from video links; sites change often, so re-run this to update it.
run(venvPython, ["-m", "pip", "install", "--upgrade", "pip", "faster-whisper", "yt-dlp[default,curl-cffi]"]);
console.log("\nWhisper và yt-dlp đã sẵn sàng. Model Whisper sẽ tự tải về ở lần chạy đầu tiên.");
