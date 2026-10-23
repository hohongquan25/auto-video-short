// Download the OlvRoc model files listed in python/olvroc/model_files.json into
// models/olvroc (kept out of git). Each file is pinned to one upstream revision and
// checked against its SHA-256 before and after renaming; files already in place are kept.
//   pnpm setup:olvroc          fp32 backbone + codec (~520 MB)
//   pnpm setup:olvroc --int8   also the int8 backbone for OLVROC_PRECISION=int8 (~170 MB)
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "python", "olvroc", "model_files.json"), "utf8"));
const modelDir = join(root, "models", "olvroc");
const wanted = new Set(["fp32", "codec", ...(process.argv.includes("--int8") ? ["int8"] : [])]);

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function sha256File(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/** Same-length replacements, so names inside the .onnx graphs stay valid. */
function rename(buf) {
  let out = buf;
  for (const [from, to] of manifest.rename) {
    const a = Buffer.from(from);
    const b = Buffer.from(to);
    const parts = [];
    let start = 0;
    for (let i = out.indexOf(a); i !== -1; i = out.indexOf(a, i + a.length)) {
      parts.push(out.subarray(start, i), b);
      start = i + a.length;
    }
    parts.push(out.subarray(start));
    out = Buffer.concat(parts);
  }
  return out;
}

async function download(url, size) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} khi tải ${url}`);
  const chunks = [];
  let got = 0;
  let shown = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    got += chunk.length;
    if (got - shown >= 20 * 1048576 || got === size) {
      shown = got;
      process.stdout.write(`\r  ${mb(got)} / ${mb(size)}   `);
    }
  }
  process.stdout.write("\n");
  return Buffer.concat(chunks);
}

let fetched = 0;
for (const f of manifest.files.filter((f) => wanted.has(f.source))) {
  const src = manifest.sources[f.source];
  const dest = join(modelDir, f.source, f.name);
  const label = `${f.source}/${f.name}`;
  if (existsSync(dest) && statSync(dest).size === f.size && (await sha256File(dest)) === f.sha256) {
    console.log(`✓ ${label}`);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const path = src.folder ? `${src.folder}/${f.remote}` : f.remote;
  console.log(`↓ ${label} (${mb(f.size)})`);
  const tmp = `${dest}.part`;
  try {
    const data = await download(`https://huggingface.co/${src.repo}/resolve/${src.revision}/${path}`, f.size);
    if (sha256(data) !== f.remoteSha256) throw new Error(`${label}: SHA-256 không khớp, file tải về bị hỏng hoặc đã bị thay`);
    const local = /\.(onnx|json)$/.test(f.name) ? rename(data) : data;
    if (sha256(local) !== f.sha256) throw new Error(`${label}: SHA-256 sau khi đổi tên không khớp`);
    writeFileSync(tmp, local);
    renameSync(tmp, dest);
    fetched++;
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp);
    console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
console.log(`\nModel OlvRoc đã sẵn sàng trong ${modelDir}${fetched ? ` (tải mới ${fetched} file)` : ""}.`);
