/**
 * The seller's licence tool.
 *
 *   pnpm license keygen                                      once: make the key pair
 *   pnpm license issue <mã máy> --name "Tên khách" [--days 365 | --until 2027-12-31]
 *   pnpm license show <khoá>                                 what a key says, for support
 *
 * The private key stays on this computer (STORY_STUDIO_LICENSE_KEY, else
 * ~/.story-studio/license-private.pem): whoever has it can make keys. Losing
 * it means rebuilding the app with a new key pair and re-issuing every key.
 * Each issued key is also written to licenses.csv next to it.
 */
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { decodeLicense, encodeLicense, localDay, publicKeyFrom, type License } from "../server/lib/license.js";
import { LICENSE_PUBLIC_KEY } from "../server/lib/license-key.js";

const privateKeyFile = process.env.STORY_STUDIO_LICENSE_KEY ?? join(homedir(), ".story-studio", "license-private.pem");
const ledgerFile = join(dirname(privateKeyFile), "licenses.csv");
const publicKeyModule = join(import.meta.dirname, "..", "server", "lib", "license-key.ts");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function keygen(force: boolean): void {
  if (existsSync(privateKeyFile) && !force) {
    fail(`Đã có khoá bí mật ở ${privateKeyFile}. Tạo khoá mới thì mọi khoá đã cấp sẽ hết dùng được với bản build mới; chắc chắn thì thêm --force.`);
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(dirname(privateKeyFile), { recursive: true });
  writeFileSync(privateKeyFile, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  writeFileSync(publicKeyModule, readFileSync(publicKeyModule, "utf8").replace(/LICENSE_PUBLIC_KEY = ".*";/, `LICENSE_PUBLIC_KEY = "${spki}";`));
  console.log(`Đã tạo khoá bí mật: ${privateKeyFile}`);
  console.log("Hãy sao lưu file này ra nơi an toàn (USB, ổ cứng khác) và không gửi cho ai.");
  console.log(`Khoá công khai đã ghi vào ${publicKeyModule}; build lại bộ cài để dùng nó.`);
}

/** YYYY-MM-DD `days` days from today, the last day the key works. */
function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days - 1);
  return localDay(d);
}

function issue(machineArg: string | undefined, opts: { name?: string; days?: string; until?: string }): void {
  if (!existsSync(privateKeyFile)) fail(`Chưa có khoá bí mật ở ${privateKeyFile}, chạy: pnpm license keygen`);
  if (!LICENSE_PUBLIC_KEY) fail("server/lib/license-key.ts chưa có khoá công khai, chạy: pnpm license keygen");
  const machine = (machineArg ?? "").trim().toUpperCase();
  if (!/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(machine)) fail(`Mã máy "${machineArg ?? ""}" không đúng, ví dụ: 7F3A-91C2-04BE-D5E1`);
  const name = opts.name?.trim();
  if (!name) fail('Thiếu tên khách: --name "Tên khách"');
  if (opts.days && opts.until) fail("Chỉ dùng một trong --days hoặc --until");
  if (opts.until && !/^\d{4}-\d{2}-\d{2}$/.test(opts.until)) fail(`--until "${opts.until}" không đúng, ví dụ: 2027-12-31`);
  const days = opts.days ? Number(opts.days) : null;
  if (days !== null && !(Number.isInteger(days) && days > 0)) fail(`--days "${opts.days}" phải là số ngày, ví dụ: 365`);

  const license: License = { name, machine, expires: opts.until ?? (days ? daysFromToday(days) : null), issued: localDay() };
  const privateKey = createPrivateKey(readFileSync(privateKeyFile));
  const key = encodeLicense(license, (data) => sign(null, data, privateKey));
  // A key that does not open with the app's public key would be useless to the customer.
  decodeLicense(key, publicKeyFrom(LICENSE_PUBLIC_KEY));

  if (!existsSync(ledgerFile)) writeFileSync(ledgerFile, "﻿Ngày cấp,Khách,Mã máy,Hết hạn,Khoá\n");
  const csv = (s: string) => `"${s.replace(/"/g, '""')}"`;
  appendFileSync(ledgerFile, [license.issued, license.name, machine, license.expires ?? "không hết hạn", key].map(csv).join(",") + "\n");

  console.log(`Khách: ${name} · máy ${machine} · ${license.expires ? `dùng đến hết ngày ${license.expires}` : "không hết hạn"}`);
  console.log("Gửi khoá này cho khách (dán vào ô Khoá bản quyền khi mở Story Studio):\n");
  console.log(key);
  console.log(`\nĐã ghi vào ${ledgerFile}`);
}

function show(key: string | undefined): void {
  if (!key) fail("Thiếu khoá cần đọc");
  const license = decodeLicense(key, publicKeyFrom(LICENSE_PUBLIC_KEY));
  console.log(`Khách: ${license.name}`);
  console.log(`Mã máy: ${license.machine}`);
  console.log(`Ngày cấp: ${license.issued}`);
  console.log(`Hết hạn: ${license.expires ?? "không hết hạn"}`);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { name: { type: "string" }, days: { type: "string" }, until: { type: "string" }, force: { type: "boolean" } },
});
const [command, arg] = positionals;
try {
  if (command === "keygen") keygen(values.force ?? false);
  else if (command === "issue") issue(arg, values);
  else if (command === "show") show(arg);
  else fail('Dùng: pnpm license keygen | pnpm license issue <mã máy> --name "Tên khách" [--days 365] | pnpm license show <khoá>');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
