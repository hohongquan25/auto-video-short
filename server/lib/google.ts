import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import { config } from "../config.js";
import { getGoogleState, saveGoogleState } from "../store.js";
import { driveFolderUrl, sheetUrl, type GoogleStatus } from "../types.js";

/**
 * Google Drive and Sheets over their REST APIs. Signs in with a service
 * account key, or with the refresh token of an account connected through
 * OAuth from the browser (/api/google/connect).
 */

const TOKEN_URI = "https://oauth2.googleapis.com/token";
/** Full Drive access, so files can go into a folder the app did not make; it covers Sheets too. */
const SCOPE = "https://www.googleapis.com/auth/drive";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Files in Shared Drives are only found with this. */
const ALL_DRIVES = "supportsAllDrives=true";
/** Upload chunk size; Google requires a multiple of 256 KiB. */
const CHUNK_BYTES = 32 * 1024 * 1024;
const RETRY_DELAYS = [2000, 5000, 15000, 30000];
const JSON_HEADERS = { "Content-Type": "application/json" };

export class GoogleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Google is busy or the network dropped: worth another try. */
const isTransient = (err: unknown) =>
  !(err instanceof GoogleError) || err.status === 429 || err.status >= 500;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(t);
    reject(signal.reason);
  }, { once: true });
});

// ── Signing in ──────────────────────────────────────────────────────────────

type Credentials =
  | { kind: "service"; email: string; privateKey: string }
  | { kind: "oauth"; clientId: string; clientSecret: string; refreshToken: string | null };

/** Whether Google is set up at all; finished jobs are then uploaded. */
export const googleConfigured = () =>
  Boolean(config.googleServiceAccountFile || (config.googleClientId && config.googleClientSecret));

function credentials(): Credentials | null {
  if (config.googleServiceAccountFile) {
    let key: { client_email?: string; private_key?: string };
    try {
      key = JSON.parse(readFileSync(config.googleServiceAccountFile, "utf8"));
    } catch (err) {
      throw new GoogleError(401, `Không đọc được file service account ${config.googleServiceAccountFile}: ${(err as Error).message}`);
    }
    if (!key.client_email || !key.private_key) throw new GoogleError(401, "File service account thiếu client_email hoặc private_key");
    return { kind: "service", email: key.client_email, privateKey: key.private_key };
  }
  if (config.googleClientId && config.googleClientSecret) {
    return {
      kind: "oauth", clientId: config.googleClientId, clientSecret: config.googleClientSecret,
      refreshToken: getGoogleState().refreshToken ?? null,
    };
  }
  return null;
}

function serviceJwt(email: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({ iss: email, scope: SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600 })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url")}`;
}

interface TokenReply { access_token: string; expires_in: number; refresh_token?: string }

async function tokenRequest(params: Record<string, string>, signal?: AbortSignal): Promise<TokenReply> {
  const res = await fetch(TOKEN_URI, { method: "POST", body: new URLSearchParams(params), signal });
  const data = await res.json().catch(() => ({})) as Partial<TokenReply> & { error?: string; error_description?: string };
  if (res.ok && data.access_token) return data as TokenReply;
  if (data.error === "invalid_grant" && params.grant_type === "refresh_token") {
    throw new GoogleError(401, "Kết nối Google đã hết hạn hoặc bị thu hồi, hãy bấm \"Kết nối Google\" lại");
  }
  throw new GoogleError(res.status >= 500 ? res.status : 401, `Google từ chối đăng nhập: ${data.error_description ?? data.error ?? `HTTP ${res.status}`}`);
}

let token: { value: string; expiresAt: number; owner: string } | null = null;

async function accessToken(signal?: AbortSignal): Promise<string> {
  const c = credentials();
  if (!c) throw new GoogleError(401, "Chưa cấu hình Google (xem mục Google Drive trong .env.example)");
  if (c.kind === "oauth" && !c.refreshToken) {
    throw new GoogleError(401, "Chưa kết nối tài khoản Google: bấm \"Kết nối Google\" ở mục Hệ thống");
  }
  const owner = c.kind === "service" ? c.email : c.refreshToken!;
  if (token?.owner === owner && token.expiresAt > Date.now() + 60_000) return token.value;
  const reply = c.kind === "service"
    ? await tokenRequest({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceJwt(c.email, c.privateKey) }, signal)
    : await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refreshToken!, client_id: c.clientId, client_secret: c.clientSecret }, signal);
  token = { value: reply.access_token, expiresAt: Date.now() + reply.expires_in * 1000, owner };
  return token.value;
}

/** Google only accepts a loopback redirect for "Desktop app" clients, so the callback is always on this machine. */
const redirectUri = () => `http://127.0.0.1:${config.port}/api/google/callback`;

/** The Google consent page that starts connecting an account. */
export function oauthUrl(state: string): string {
  const c = credentials();
  if (c?.kind !== "oauth") throw new GoogleError(400, "Cần GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET để kết nối tài khoản Google");
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: c.clientId, redirect_uri: redirectUri(), response_type: "code", scope: SCOPE,
    // Offline + consent: Google only returns a refresh token when the user is asked again.
    access_type: "offline", prompt: "consent", state,
  })}`;
}

/** Trade the code from the consent page for a refresh token and keep it. Returns the account's email. */
export async function finishOauth(code: string): Promise<string> {
  const c = credentials();
  if (c?.kind !== "oauth") throw new GoogleError(400, "Chưa cấu hình OAuth client");
  const reply = await tokenRequest({
    grant_type: "authorization_code", code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(),
  });
  if (!reply.refresh_token) throw new GoogleError(400, "Google không trả refresh token, hãy kết nối lại");
  const before = getGoogleState();
  // Saved first: asking for the account below signs in with it.
  saveGoogleState({ refreshToken: reply.refresh_token });
  token = { value: reply.access_token, expiresAt: Date.now() + reply.expires_in * 1000, owner: reply.refresh_token };
  const account = await accountEmail();
  // The folder and sheet made for another account are not reachable from this one.
  const keep = before.account === account ? {} : { folderId: undefined, sheetId: undefined };
  saveGoogleState({ ...keep, account });
  return account;
}

// ── Requests ────────────────────────────────────────────────────────────────

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    return (JSON.parse(text) as { error: { message: string } }).error.message;
  } catch {
    return text.slice(0, 200) || `HTTP ${res.status}`;
  }
}

/** A Google API call, retried while Google is busy or the network is down. */
async function call(url: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await accessToken(init.signal)}`, ...init.headers } });
      if (res.ok) return res;
      throw new GoogleError(res.status, await errorMessage(res));
    } catch (err) {
      if (!isTransient(err) || init.signal?.aborted || attempt >= RETRY_DELAYS.length) throw err;
      await sleep(RETRY_DELAYS[attempt], init.signal);
    }
  }
}

const getJson = async <T>(url: string, signal?: AbortSignal) => (await (await call(url, { signal })).json()) as T;

const sendJson = async <T>(method: string, url: string, body: unknown, signal?: AbortSignal) =>
  (await (await call(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body), signal })).json()) as T;

async function accountEmail(signal?: AbortSignal): Promise<string> {
  return (await getJson<{ user: { emailAddress: string } }>(`${DRIVE_API}/about?fields=user(emailAddress)`, signal)).user.emailAddress;
}

// ── Drive ───────────────────────────────────────────────────────────────────

export async function createFolder(name: string, parentId: string | null, signal?: AbortSignal): Promise<string> {
  const body = { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) };
  return (await sendJson<{ id: string }>("POST", `${DRIVE_API}/files?${ALL_DRIVES}&fields=id`, body, signal)).id;
}

/** Move a file to the trash; one already gone is fine. */
export async function trashFile(id: string, signal?: AbortSignal): Promise<void> {
  try {
    await sendJson("PATCH", `${DRIVE_API}/files/${id}?${ALL_DRIVES}&fields=id`, { trashed: true }, signal);
  } catch (err) {
    if (!(err instanceof GoogleError && err.status === 404)) throw err;
  }
}

async function moveToFolder(id: string, folderId: string, signal?: AbortSignal): Promise<void> {
  const { parents = [] } = await getJson<{ parents?: string[] }>(`${DRIVE_API}/files/${id}?${ALL_DRIVES}&fields=parents`, signal);
  await sendJson("PATCH", `${DRIVE_API}/files/${id}?${ALL_DRIVES}&addParents=${folderId}&removeParents=${parents.join(",")}&fields=id`, {}, signal);
}

/** "bytes=0-1048575" → 1048576 bytes received; no header means none yet. */
export function uploadedBytes(range: string | null): number {
  const m = range?.match(/-(\d+)$/);
  return m ? Number(m[1]) + 1 : 0;
}

/**
 * Send a file to a resumable upload session in chunks. After a network error
 * Google is asked how much arrived, and the upload goes on from there.
 */
async function sendChunks(session: string, file: string, size: number, signal: AbortSignal, onProgress: (sent: number) => void): Promise<string> {
  const fh = await open(file, "r");
  try {
    let offset = 0;
    for (let failures = 0; ;) {
      let res: Response;
      try {
        if (failures > 0) {
          res = await fetch(session, { method: "PUT", headers: { "Content-Range": `bytes */${size}` }, signal });
        } else {
          const len = Math.min(CHUNK_BYTES, size - offset);
          const chunk = Buffer.alloc(len);
          await fh.read(chunk, 0, len, offset);
          res = await fetch(session, { method: "PUT", headers: { "Content-Range": `bytes ${offset}-${offset + len - 1}/${size}` }, body: chunk, signal });
        }
        if (res.ok) return ((await res.json()) as { id: string }).id;
        if (res.status !== 308) throw new GoogleError(res.status, await errorMessage(res));
      } catch (err) {
        if (!isTransient(err) || signal.aborted || failures >= RETRY_DELAYS.length) throw err;
        await sleep(RETRY_DELAYS[failures++], signal);
        continue;
      }
      failures = 0;
      offset = uploadedBytes(res.headers.get("range"));
      onProgress(offset);
    }
  } finally {
    await fh.close();
  }
}

/** Upload a file into `parentId`, or over `replaceId`'s content so its id and link stay the same. Returns the file id. */
export async function uploadFile(opts: {
  file: string;
  name: string;
  mimeType: string;
  parentId: string;
  /** A Drive file from an earlier upload; when it is gone, a new file is made. */
  replaceId?: string;
  signal: AbortSignal;
  onProgress: (sentBytes: number) => void;
}): Promise<string> {
  const { file, name, mimeType, parentId, replaceId, signal, onProgress } = opts;
  const { size } = await stat(file);
  if (size === 0) throw new Error(`File rỗng: ${file}`);
  const start = async (replace: boolean) => {
    const res = await call(
      `${UPLOAD_API}/files${replace ? `/${replaceId}` : ""}?uploadType=resumable&${ALL_DRIVES}`,
      {
        method: replace ? "PATCH" : "POST",
        headers: { ...JSON_HEADERS, "X-Upload-Content-Type": mimeType, "X-Upload-Content-Length": String(size) },
        body: JSON.stringify(replace ? { name } : { name, parents: [parentId] }),
        signal,
      },
    );
    const session = res.headers.get("location");
    if (!session) throw new Error("Google không trả địa chỉ tải lên");
    return session;
  };
  let session: string;
  try {
    session = await start(Boolean(replaceId));
  } catch (err) {
    if (!(replaceId && err instanceof GoogleError && err.status === 404)) throw err;
    session = await start(false);
  }
  return sendChunks(session, file, size, signal, onProgress);
}

// ── Sheets ──────────────────────────────────────────────────────────────────

/** A range on a named tab: a1("Videos", "A:A") → 'Videos'!A:A */
export const a1 = (tab: string, range: string) => `'${tab.replace(/'/g, "''")}'!${range}`;

/** Spreadsheet column letter of a 1-based index (1 → A, 27 → AA). */
export function columnLetter(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export type Cell = string | number;

export async function readRange(sheetId: string, range: string, signal?: AbortSignal): Promise<string[][]> {
  const url = `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}`;
  return (await getJson<{ values?: string[][] }>(url, signal)).values ?? [];
}

/** Make the tab if the sheet lacks it, and give it a header row if it is empty. */
export async function ensureTab(sheetId: string, tab: string, header: string[], signal?: AbortSignal): Promise<void> {
  const { sheets } = await getJson<{ sheets: { properties: { title: string } }[] }>(`${SHEETS_API}/${sheetId}?fields=sheets.properties.title`, signal);
  if (!sheets.some((s) => s.properties.title === tab)) {
    await sendJson("POST", `${SHEETS_API}/${sheetId}:batchUpdate`, { requests: [{ addSheet: { properties: { title: tab } } }] }, signal);
  }
  if ((await readRange(sheetId, a1(tab, "1:1"), signal)).length === 0) {
    await writeRanges(sheetId, [{ range: a1(tab, `A1:${columnLetter(header.length)}1`), values: [header] }], signal);
  }
}

/** Values are stored as given (RAW), so "+0%" or "#tag" are never read as formulas. */
export async function writeRanges(sheetId: string, data: { range: string; values: Cell[][] }[], signal?: AbortSignal): Promise<void> {
  if (data.length) await sendJson("POST", `${SHEETS_API}/${sheetId}/values:batchUpdate`, { valueInputOption: "RAW", data }, signal);
}

export async function appendRows(sheetId: string, tab: string, rows: Cell[][], signal?: AbortSignal): Promise<void> {
  if (!rows.length) return;
  const url = `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(a1(tab, "A1"))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  await sendJson("POST", url, { values: rows }, signal);
}

// ── Targets ─────────────────────────────────────────────────────────────────

/**
 * The Drive folder jobs are uploaded into and the sheet they are listed in.
 * With OAuth, whichever is not configured is made in the account's Drive
 * the first time it is needed and remembered.
 */
export async function driveTargets(signal?: AbortSignal): Promise<{ folderId: string; sheetId: string }> {
  const state = getGoogleState();
  let folderId = config.googleDriveFolderId ?? state.folderId;
  let sheetId = config.googleSheetId ?? state.sheetId;
  if ((!folderId || !sheetId) && credentials()?.kind === "service") {
    throw new GoogleError(400, "Service account cần GOOGLE_DRIVE_FOLDER_ID (thư mục trong Shared Drive) và GOOGLE_SHEET_ID (bảng tính đã chia sẻ quyền sửa cho service account)");
  }
  if (!folderId) {
    folderId = await createFolder("Story Studio", null, signal);
    saveGoogleState({ folderId });
  }
  if (!sheetId) {
    const sheet = await sendJson<{ spreadsheetId: string }>("POST", SHEETS_API, {
      properties: { title: "Story Studio - Video" },
      sheets: [{ properties: { title: config.googleSheetTab } }],
    }, signal);
    sheetId = sheet.spreadsheetId;
    await moveToFolder(sheetId, folderId, signal);
    saveGoogleState({ sheetId });
  }
  return { folderId, sheetId };
}

/** Sign in and check the configured folder and sheet can be reached. */
export async function googleStatus(): Promise<GoogleStatus> {
  const status: GoogleStatus = {
    ok: false, auth: null, canConnect: false, account: null, folderUrl: null, sheetUrl: null, error: null,
  };
  if (!googleConfigured()) return { ...status, error: "Chưa cấu hình" };
  try {
    const c = credentials()!;
    status.auth = c.kind;
    status.canConnect = c.kind === "oauth";
    status.account = c.kind === "service" ? c.email : getGoogleState().account ?? null;
    const signal = AbortSignal.timeout(15_000);
    if (c.kind === "oauth") status.account = await accountEmail(signal);
    const state = getGoogleState();
    const folderId = config.googleDriveFolderId ?? state.folderId;
    const sheetId = config.googleSheetId ?? state.sheetId;
    if (folderId) {
      await getJson(`${DRIVE_API}/files/${folderId}?${ALL_DRIVES}&fields=id`, signal)
        .catch((err) => { throw new Error(`Không mở được thư mục Drive: ${(err as Error).message}`); });
      status.folderUrl = driveFolderUrl(folderId);
    }
    if (sheetId) {
      await getJson(`${SHEETS_API}/${sheetId}?fields=spreadsheetId`, signal)
        .catch((err) => { throw new Error(`Không mở được Google Sheet: ${(err as Error).message}`); });
      status.sheetUrl = sheetUrl(sheetId);
    }
    if (c.kind === "service" && (!folderId || !sheetId)) {
      throw new Error("Service account cần cả GOOGLE_DRIVE_FOLDER_ID và GOOGLE_SHEET_ID");
    }
    status.ok = true;
  } catch (err) {
    status.error = (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 300);
  }
  return status;
}
