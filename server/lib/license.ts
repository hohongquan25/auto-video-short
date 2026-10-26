import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { getLicenseState, saveLicenseState } from "../store.js";
import { LICENSE_PUBLIC_KEY } from "./license-key.js";

/**
 * What a licence key says. The seller signs it with the private key only they
 * hold (`pnpm license issue`), and the app checks it with the public key in
 * license-key.ts, so a key cannot be made or changed without that private key.
 */
export interface License {
  /** The customer, as the seller wrote them down. */
  name: string;
  /** The machine code the key was made for. */
  machine: string;
  /** The last day the key works, YYYY-MM-DD; null when it never ends. */
  expires: string | null;
  /** The day the key was made, YYYY-MM-DD. */
  issued: string;
}

export interface LicenseStatus {
  ok: boolean;
  /** This machine's code, which the customer sends to get a key. */
  machine: string;
  license: License | null;
  error: string | null;
}

const PREFIX = "SS1-";

const b64url = (data: Buffer) => data.toString("base64url");

/** "SS1-<payload>.<signature>", the payload being the licence as short-keyed JSON. */
export function encodeLicense(license: License, sign: (data: Buffer) => Buffer): string {
  const payload = Buffer.from(JSON.stringify({ n: license.name, m: license.machine, e: license.expires, i: license.issued }));
  return `${PREFIX}${b64url(payload)}.${b64url(sign(payload))}`;
}

export const publicKeyFrom = (spkiBase64: string): KeyObject =>
  createPublicKey({ key: Buffer.from(spkiBase64, "base64"), format: "der", type: "spki" });

/** The licence a key holds; throws when it is not a key or was not signed by `publicKey`. */
export function decodeLicense(key: string, publicKey: KeyObject): License {
  // Keys travel through chat apps, which may wrap or pad them.
  const compact = key.replace(/\s+/g, "");
  const match = compact.match(/^SS1-([\w-]+)\.([\w-]+)$/);
  if (!match) throw new Error("Khoá không đúng định dạng, hãy dán lại đầy đủ khoá bắt đầu bằng SS1-");
  const payload = Buffer.from(match[1], "base64url");
  if (!verify(null, payload, publicKey, Buffer.from(match[2], "base64url"))) {
    throw new Error("Khoá không hợp lệ: có thể bị sửa hoặc thiếu ký tự khi sao chép");
  }
  const p = JSON.parse(payload.toString("utf8")) as { n: string; m: string; e: string | null; i: string };
  return { name: p.n, machine: p.m, expires: p.e, issued: p.i };
}

/** Today on this machine's clock, YYYY-MM-DD. */
export function localDay(at = new Date()): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/** Why `license` does not work on `machine` on `today`, or null when it does. */
export function licenseProblem(license: License, machine: string, today: string): string | null {
  if (license.machine !== machine) return `Khoá này dành cho máy ${license.machine}, không phải máy này (${machine})`;
  if (license.expires && today > license.expires) return `Khoá đã hết hạn từ ngày ${license.expires.split("-").reverse().join("/")}`;
  return null;
}

/** The Windows install's own id, which stays the same until Windows is reinstalled. */
function machineSecret(): string {
  if (process.platform === "win32") {
    const reg = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
    const out = execFileSync(reg, ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], {
      encoding: "utf8", windowsHide: true,
    });
    const guid = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1];
    if (guid) return guid;
  }
  for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      return readFileSync(file, "utf8").trim();
    } catch {
      // try the next one
    }
  }
  return hostname();
}

let code: string | null = null;

/** This machine's code, e.g. "7F3A-91C2-04BE-D5E1": a hash, so it says nothing about the machine itself. */
export function machineCode(): string {
  code ??= createHash("sha256").update(`story-studio:${machineSecret()}`).digest("hex").slice(0, 16).toUpperCase()
    .match(/.{4}/g)!.join("-");
  return code;
}

/** A clock this far behind the latest time the app saw has been turned back. */
const CLOCK_SLACK_MS = 2 * 86_400_000;
/** The latest time seen is saved at most this often. */
const LAST_SEEN_EVERY_MS = 3_600_000;

let cached: { key: string; license: License } | null = null;

/** Whether this copy may be used now; read on every request, so it is cheap after the first. */
export function licenseStatus(): LicenseStatus {
  const machine = machineCode();
  const state = getLicenseState();
  if (!state.key) return { ok: false, machine, license: null, error: null };
  let license: License;
  try {
    if (cached?.key !== state.key) cached = { key: state.key, license: decodeLicense(state.key, publicKeyFrom(LICENSE_PUBLIC_KEY)) };
    license = cached.license;
  } catch (err) {
    return { ok: false, machine, license: null, error: err instanceof Error ? err.message : String(err) };
  }
  const now = Date.now();
  const lastSeen = state.lastSeen ? Date.parse(state.lastSeen) : 0;
  if (license.expires && now < lastSeen - CLOCK_SLACK_MS) {
    return { ok: false, machine, license, error: "Đồng hồ của máy đang chậm hơn thực tế, hãy chỉnh lại ngày giờ cho đúng" };
  }
  const problem = licenseProblem(license, machine, localDay());
  if (!problem && now - lastSeen > LAST_SEEN_EVERY_MS) saveLicenseState({ ...state, lastSeen: new Date(now).toISOString() });
  return { ok: !problem, machine, license, error: problem };
}

/** Check `key` and keep it when it works on this machine today; throws the reason when it does not. */
export function activateLicense(key: string): LicenseStatus {
  const compact = key.replace(/\s+/g, "");
  const license = decodeLicense(compact, publicKeyFrom(LICENSE_PUBLIC_KEY));
  const problem = licenseProblem(license, machineCode(), localDay());
  if (problem) throw new Error(problem);
  saveLicenseState({ ...getLicenseState(), key: compact });
  return licenseStatus();
}
