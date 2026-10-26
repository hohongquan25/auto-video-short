/**
 * Builds the edition sold to customers (server/edition.ts) into release/:
 *
 *   release/StoryStudio/                  the app as it is installed: the bundled server and client,
 *                                         the Python scripts, fonts, OlvRoc models, and runtime/ with
 *                                         its own Node, Python (with every package) and ffmpeg
 *   release/StoryStudio-Setup-<ver>.exe   the installer, made by Inno Setup 6 when it is installed
 *
 * Downloads (embeddable Python, ffmpeg, the installer's Vietnamese texts) and the assembled
 * Python are kept in build-cache/, so later builds only redo the app itself.
 *
 * Needs, once: `pnpm license keygen`, `pnpm setup:whisper` (its .venv installs the Python
 * packages, so they are the versions this app was tested with) and `pnpm setup:olvroc`.
 */
import { build as bundle } from "esbuild";
import { build as viteBuild } from "vite";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { LICENSE_PUBLIC_KEY } from "../server/lib/license-key.js";

const root = resolve(import.meta.dirname, "..");
const release = join(root, "release");
const app = join(release, "StoryStudio");
const cache = join(root, "build-cache");
const venvPython = join(root, ".venv", "Scripts", "python.exe");
const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;

const FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const VIETNAMESE_ISL_URL = "https://raw.githubusercontent.com/jrsoftware/issrc/main/Files/Languages/Unofficial/Vietnamese.isl";
/** The Visual C++ runtime onnxruntime and ctranslate2 load; a clean Windows may not have it, so it travels with Python. */
const VC_RUNTIME = ["msvcp140.dll", "msvcp140_1.dll", "msvcp140_2.dll", "concrt140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];
/** Windows' own bsdtar, which unpacks zip files; Git's tar earlier on PATH cannot. */
const TAR = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

const step = (title: string) => console.log(`\n▶ ${title}`);

function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}): string {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], encoding: "utf8", ...opts });
  if (r.error) fail(`Không chạy được ${cmd}: ${r.error.message}`);
  if (r.status !== 0) fail(`${basename(cmd)} ${args.join(" ")} lỗi (mã ${r.status})`);
  return typeof r.stdout === "string" ? r.stdout : "";
}

/** `url` saved as `file` in the cache, downloaded only the first time. */
async function download(url: string, file: string): Promise<string> {
  if (existsSync(file)) return file;
  console.log(`  tải ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${url}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  renameSync(`${file}.part`, file);
  return file;
}

function sizeOf(path: string): number {
  const s = statSync(path);
  return s.isDirectory() ? readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0) : s.size;
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

/**
 * Python remakes its __pycache__ on first use, and leaving it out keeps the
 * deepest paths well under Windows' 260 characters wherever the app is installed.
 */
const notCache = (src: string) => basename(src) !== "__pycache__";

/** Text files customers open in Notepad: UTF-8 with a BOM and Windows line breaks. */
const writeWindowsText = (file: string, text: string) => writeFileSync(file, `\uFEFF${text.replace(/\r?\n/g, "\r\n")}`);

function preflight(): void {
  if (process.platform !== "win32") fail("Bộ cài Windows phải build trên Windows");
  if (!LICENSE_PUBLIC_KEY) fail("Chưa có khoá bản quyền: chạy pnpm license keygen trước");
  if (!existsSync(venvPython)) fail("Chưa có .venv: chạy pnpm setup:whisper trước");
  for (const dir of ["fp32", "codec"]) {
    if (!existsSync(join(root, "models", "olvroc", dir))) fail("Chưa có model OlvRoc: chạy pnpm setup:olvroc trước");
  }
}

async function buildClient(): Promise<void> {
  step("Giao diện");
  process.env.VITE_EDITION = "retail";
  await viteBuild({
    configFile: join(root, "vite.config.ts"),
    build: { outDir: join(app, "dist", "client"), emptyOutDir: true },
    logLevel: "warn",
  });
}

/** One minified file with every npm package in it; returns the packages, for the licence notices. */
async function buildServer(): Promise<Map<string, string>> {
  step("Server");
  const result = await bundle({
    entryPoints: [join(root, "server", "index.ts")],
    outfile: join(app, "server", "server.mjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    minify: true,
    legalComments: "none",
    metafile: true,
    logLevel: "warning",
    // Fixes the edition, so the parts it leaves out are dropped from the bundle.
    define: { "process.env.STUDIO_EDITION": '"retail"', __dirname: "__bundleDirname", __filename: "__bundleFilename" },
    // CommonJS packages inside an ES module still call require() and read __dirname.
    banner: {
      js: [
        'import { createRequire as __bundleCreateRequire } from "node:module";',
        'import { fileURLToPath as __bundleFileURLToPath } from "node:url";',
        'import { dirname as __bundleDirnameOf } from "node:path";',
        "const require = __bundleCreateRequire(import.meta.url);",
        "const __bundleFilename = __bundleFileURLToPath(import.meta.url);",
        "const __bundleDirname = __bundleDirnameOf(__bundleFilename);",
      ].join("\n"),
    },
  });
  const packages = new Map<string, string>();
  for (const input of Object.keys(result.metafile.inputs)) {
    const m = input.replace(/\\/g, "/").match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//);
    if (m) packages.set(m[2], join(root, m[1]));
  }
  console.log(`  ${mb(statSync(join(app, "server", "server.mjs")).size)}, gồm ${packages.size} gói npm`);
  return packages;
}

function copyAppFiles(): void {
  step("Script Python, font, model OlvRoc");
  for (const name of ["transcribe.py", "olvroc_tts.py"]) cpSync(join(root, "python", name), join(app, "python", name));
  cpSync(join(root, "python", "olvroc"), join(app, "python", "olvroc"), { recursive: true, filter: notCache });
  cpSync(join(root, "assets", "fonts"), join(app, "assets", "fonts"), { recursive: true });
  // fp32 only: the packaged app reads with full quality, int8 garbles on older CPUs.
  for (const dir of ["fp32", "codec"]) cpSync(join(root, "models", "olvroc", dir), join(app, "models", "olvroc", dir), { recursive: true });
  cpSync(join(root, "installer", "Story Studio.cmd"), join(app, "Story Studio.cmd"));
  cpSync(join(root, "installer", "story-studio.ico"), join(app, "story-studio.ico"));
  writeWindowsText(join(app, "HUONG-DAN.txt"), readFileSync(join(root, "installer", "HUONG-DAN.txt"), "utf8"));
}

function copyNode(): void {
  step(`Node ${process.version}`);
  const dest = join(app, "runtime", "node");
  mkdirSync(dest, { recursive: true });
  copyFileSync(process.execPath, join(dest, "node.exe"));
  const license = join(dirname(process.execPath), "LICENSE");
  if (existsSync(license)) copyFileSync(license, join(dest, "LICENSE.txt"));
}

/**
 * Python's embeddable build with faster-whisper and OlvRoc's packages installed
 * into it, pinned to the versions in .venv. It runs from any folder: its ._pth
 * file lists where modules are, including the app's python\ for olvroc.
 */
async function buildPython(): Promise<void> {
  const pyVersion = run(venvPython, ["-c", "import platform; print(platform.python_version())"], { stdio: ["ignore", "pipe", "inherit"] }).trim();
  step(`Python ${pyVersion}`);
  const requirements = readFileSync(join(root, "python", "olvroc", "requirements.txt"), "utf8");
  const frozen = run(venvPython, ["-m", "pip", "freeze", "--disable-pip-version-check"], { stdio: ["ignore", "pipe", "inherit"] })
    .split(/\r?\n/).filter((line) => /^[\w.-]+==/.test(line)).join("\n");
  const hash = createHash("sha256").update([pyVersion, requirements, frozen].join("\0")).digest("hex").slice(0, 12);
  const built = join(cache, `python-${pyVersion}-${hash}`);

  if (!existsSync(built)) {
    const zip = await download(
      `https://www.python.org/ftp/python/${pyVersion}/python-${pyVersion}-embed-amd64.zip`,
      join(cache, `python-${pyVersion}-embed-amd64.zip`),
    );
    const work = `${built}.tmp`;
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    run(TAR, ["-xf", zip, "-C", work]);
    const pth = readdirSync(work).find((f) => f.endsWith("._pth"));
    const stdlib = readdirSync(work).find((f) => /^python\d+\.zip$/.test(f));
    if (!pth || !stdlib) fail("Bản Python embeddable không có file ._pth như mong đợi");
    writeFileSync(join(work, pth), [stdlib, ".", "Lib\\site-packages", "..\\..\\python", "import site", ""].join("\r\n"));

    const constraints = join(cache, `constraints-${hash}.txt`);
    writeFileSync(constraints, frozen);
    run(venvPython, [
      "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location",
      "--target", join(work, "Lib", "site-packages"), "-c", constraints,
      "faster-whisper", "-r", join(root, "python", "olvroc", "requirements.txt"),
    ]);
    const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    for (const dll of VC_RUNTIME) {
      if (!existsSync(join(work, dll)) && existsSync(join(system32, dll))) copyFileSync(join(system32, dll), join(work, dll));
    }
    renameSync(work, built);
  }
  cpSync(built, join(app, "runtime", "python"), { recursive: true, filter: notCache });
}

async function copyFfmpeg(): Promise<void> {
  step("FFmpeg");
  const zip = await download(FFMPEG_URL, join(cache, "ffmpeg-release-essentials.zip"));
  const unpacked = join(cache, "ffmpeg");
  if (!existsSync(unpacked)) {
    mkdirSync(unpacked, { recursive: true });
    run(TAR, ["-xf", zip, "-C", unpacked]);
  }
  const top = readdirSync(unpacked).find((d) => d.startsWith("ffmpeg-"));
  if (!top) fail(`Không thấy thư mục ffmpeg trong ${zip}`);
  const dest = join(app, "runtime", "ffmpeg");
  mkdirSync(dest, { recursive: true });
  for (const exe of ["ffmpeg.exe", "ffprobe.exe"]) copyFileSync(join(unpacked, top, "bin", exe), join(dest, exe));
  copyFileSync(join(unpacked, top, "LICENSE"), join(dest, "LICENSE.txt"));
  copyFileSync(join(unpacked, top, "README.txt"), join(dest, "README.txt"));
  console.log(`  ${top}`);
}

/** Every open-source part the app ships with and where its licence is. */
function writeNotices(packages: Map<string, string>): void {
  const npm = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string; license?: string };
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    const text = file ? readFileSync(join(dir, file), "utf8").trim() : `License: ${pkg.license ?? "không ghi"}`;
    return `${name} ${pkg.version ?? ""}\n${"-".repeat(60)}\n${text}`;
  });
  writeWindowsText(join(app, "THIRD-PARTY-NOTICES.txt"), [
    "Story Studio dùng các phần mềm mã nguồn mở dưới đây, mỗi phần theo giấy phép của nó.",
    "",
    "- Node.js: runtime\\node\\LICENSE.txt",
    "- Python: runtime\\python\\LICENSE.txt; các thư viện Python: giấy phép trong runtime\\python\\Lib\\site-packages\\*.dist-info",
    "- FFmpeg (GPL): runtime\\ffmpeg\\LICENSE.txt. Bản build của https://www.gyan.dev/ffmpeg/builds/, mã nguồn ở https://ffmpeg.org",
    "- OlvRoc, dựa trên VieNeu-TTS (Apache-2.0): python\\olvroc\\LICENSE và python\\olvroc\\NOTICE",
    "- Font Be Vietnam Pro (SIL Open Font License): assets\\fonts\\OFL.txt",
    "- Model Whisper (MIT) do faster-whisper tải về ở lần đầu nhận dạng giọng nói",
    "",
    "Các gói npm nằm trong server\\server.mjs:",
    "",
    ...npm.map((s) => `${s}\n`),
  ].join("\n"));
}

/** A quick run of what the installed app runs, from outside the repo so nothing of it is borrowed; -B leaves no __pycache__ behind. */
function smokeTest(): void {
  step("Kiểm tra bản build");
  const python = join(app, "runtime", "python", "python.exe");
  const cwd = tmpdir();
  run(python, ["-B", "-c", "import faster_whisper, onnxruntime, ctranslate2, av, olvroc"], { cwd });
  console.log("  Python: đủ thư viện");
  const voices = run(python, ["-B", join(app, "python", "olvroc_tts.py"), "--voices"], {
    cwd, stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, OLVROC_MODEL_DIR: join(app, "models", "olvroc") },
  });
  console.log(`  OlvRoc: ${(JSON.parse(voices) as unknown[]).length} giọng`);
  const ffmpeg = run(join(app, "runtime", "ffmpeg", "ffmpeg.exe"), ["-hide_banner", "-version"], { cwd, stdio: ["ignore", "pipe", "inherit"] });
  console.log(`  ${ffmpeg.split("\n")[0]}`);
  // The edition must be fixed in the bundle, not read from the customer's environment.
  if (readFileSync(join(app, "server", "server.mjs"), "utf8").includes("STUDIO_EDITION")) fail("server.mjs vẫn đọc STUDIO_EDITION lúc chạy");
}

function findInnoSetup(): string | null {
  const candidates = [
    process.env.ISCC,
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "", "Inno Setup 6", "ISCC.exe"),
    join(process.env.ProgramFiles ?? "", "Inno Setup 6", "ISCC.exe"),
  ];
  return candidates.find((f): f is string => Boolean(f) && existsSync(f!)) ?? null;
}

async function buildInstaller(): Promise<string | null> {
  step("Bộ cài");
  const iscc = findInnoSetup();
  if (!iscc) {
    console.log("  Chưa có Inno Setup 6 nên chưa đóng bộ cài. Cài bằng: winget install JRSoftware.InnoSetup rồi chạy lại.");
    return null;
  }
  let language = "compiler:Default.isl";
  try {
    language = await download(VIETNAMESE_ISL_URL, join(cache, "Vietnamese.isl"));
  } catch (err) {
    console.warn(`  Không tải được bản tiếng Việt của Inno Setup (${err instanceof Error ? err.message : err}), bộ cài dùng tiếng Anh`);
  }
  // ISCC reads a script's Vietnamese text only from UTF-8 with a BOM.
  const script = join(release, "story-studio.iss");
  writeWindowsText(script, readFileSync(join(root, "installer", "story-studio.iss"), "utf8"));
  run(iscc, ["/Qp", `/DAppVersion=${version}`, `/DSourceDir=${app}`, `/DOutputDir=${release}`, `/DLanguage=${language}`, script]);
  return join(release, `StoryStudio-Setup-${version}.exe`);
}

preflight();
rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
await buildClient();
const packages = await buildServer();
copyAppFiles();
copyNode();
await buildPython();
await copyFfmpeg();
writeNotices(packages);
smokeTest();
const installer = await buildInstaller();

console.log(`\n✔ Thư mục ứng dụng: ${app} (${mb(sizeOf(app))})`);
if (installer) console.log(`✔ Bộ cài: ${installer} (${mb(statSync(installer).size)})`);
