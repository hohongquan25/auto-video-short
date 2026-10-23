// Ghép workflow trong repo (khoá bí mật để chữ DAN_..., không có credential) với bản đang chạy trên n8n:
// điền lại khoá bí mật và gắn credential như bản đang chạy, để nhập vào n8n mà không phải sửa tay.
// Chạy trong container n8n (chỉ cần Node), do cap-nhat.sh gọi:
//   node ghep-workflow.mjs <thư mục làm việc>
// Thư mục làm việc có: live/ (n8n export:workflow --all --separate), credentials.json (n8n export:credentials --all),
// new/ (các file workflow trong repo). Kết quả ghi vào out/: workflow đã ghép, publish.txt, unpublish.txt,
// và telegram-credential.json khi cần tạo credential Telegram cho trang quản lý.
// Thêm --webhook: hỏi Telegram webhook của bot đang trỏ về đâu (sau khi n8n khởi động lại).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("Cần thư mục làm việc");

/** Trang quản lý thay workflow hỏi Telegram mỗi phút: hai cái không chạy cùng lúc được. */
const HUB = "ssTeleQuanLy0001";

if (process.argv[3] === "--webhook") {
  const hub = join(dir, "out", `${HUB}.json`);
  if (!readFileSync(join(dir, "out", "publish.txt"), "utf8").split("\n").includes(HUB)) process.exit(0);
  const config = JSON.parse(readFileSync(hub, "utf8")).nodes.find((n) => n.name === "Cấu hình");
  const token = config.parameters.assignments.assignments.find((a) => a.name === "bot_token").value;
  const info = (await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json()).result ?? {};
  console.log(`Webhook Telegram: ${info.url ? info.url.replace(/\/webhook\/.*/, "/webhook/…") : "chưa có (trang quản lý chưa nhận được tin)"}`);
  if (info.pending_update_count) console.log(`Tin đang chờ: ${info.pending_update_count}`);
  if (info.last_error_message) console.log(`Lỗi gần nhất: ${info.last_error_message} (${new Date(info.last_error_date * 1000).toISOString()})`);
  process.exit(0);
}
const REPLACED = ["ssTeleNutBam0001"];
const TELEGRAM_CREDENTIAL = { id: "ssTelegramBot001", name: "Telegram bot Story Studio" };

/** Chỗ để chữ trong repo → tên ô có giá trị thật trong các node "Cấu hình…" của bản đang chạy, và dạng hợp lệ. */
const SECRETS = {
  DAN_BOT_TOKEN: { names: ["bot_token", "telegram_bot_token"], valid: /^\d+:[\w-]{20,}$/ },
  DAN_CHAT_ID: { names: ["chat_id", "telegram_chat_id"], valid: /^-?\d+$/ },
  DAN_CLIENT_KEY_TIKTOK: { names: ["client_key"], valid: /^\S+$/ },
  DAN_CLIENT_SECRET_TIKTOK: { names: ["client_secret"], valid: /^\S+$/ },
};

const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const list = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).flatMap((f) => [readJson(join(d, f))].flat()) : []);
// Chỉ các workflow của repo (id bắt đầu bằng "ss"): workflow khác của bạn không ảnh hưởng.
const live = list(join(dir, "live")).filter((w) => String(w.id).startsWith("ss"));
const fresh = list(join(dir, "new"));
const credentials = existsSync(join(dir, "credentials.json")) ? [readJson(join(dir, "credentials.json"))].flat() : [];
const liveById = new Map(live.map((w) => [w.id, w]));
const isSecret = (v) => typeof v === "string" && /^DAN_[A-Z_]+$/.test(v);

// ── Khoá bí mật ────────────────────────────────────────────────────────────────
const values = {};
for (const w of live) {
  for (const n of w.nodes ?? []) {
    for (const a of n.parameters?.assignments?.assignments ?? []) {
      for (const [key, s] of Object.entries(SECRETS)) {
        const v = String(a.value ?? "").trim();
        if (s.names.includes(a.name) && v && !isSecret(v) && s.valid.test(v)) (values[key] ??= new Set()).add(v);
      }
    }
  }
}
for (const [key, set] of Object.entries(values)) {
  if (set.size > 1) throw new Error(`Bản đang chạy có ${set.size} giá trị khác nhau cho ${key}, sửa cho giống nhau rồi chạy lại`);
}
const secret = (key) => values[key] && [...values[key]][0];
const fill = (x) => {
  if (Array.isArray(x)) return x.map(fill);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fill(v)]));
  return isSecret(x) && secret(x) ? secret(x) : x;
};
const unresolved = (x, out = new Set()) => {
  if (Array.isArray(x)) x.forEach((v) => unresolved(v, out));
  else if (x && typeof x === "object") Object.values(x).forEach((v) => unresolved(v, out));
  else if (isSecret(x)) out.add(x);
  return out;
};

// ── Credential ─────────────────────────────────────────────────────────────────
/** Loại credential một node cần, hoặc null nếu không cần. */
function needs(node) {
  const p = node.parameters ?? {};
  switch (node.type) {
    case "n8n-nodes-base.telegramTrigger": return "telegramApi";
    case "n8n-nodes-base.youTube": return "youTubeOAuth2Api";
    case "n8n-nodes-base.googleSheets": return p.authentication === "serviceAccount" ? "googleApi" : "googleSheetsOAuth2Api";
    case "n8n-nodes-base.googleDrive": return p.authentication === "serviceAccount" ? "googleApi" : "googleDriveOAuth2Api";
    case "n8n-nodes-base.httpRequest": return p.authentication === "predefinedCredentialType" ? p.nodeCredentialType : null;
    default: return null;
  }
}
const ref = (c) => ({ id: c.id, name: c.name });
/** Credential `type` đang được dùng ở bản đang chạy, hoặc có trong danh sách credential: chỉ lấy khi có đúng một. */
function only(type) {
  const used = new Map();
  for (const w of live) for (const n of w.nodes ?? []) if (n.credentials?.[type]) used.set(n.credentials[type].id, n.credentials[type]);
  if (used.size === 1) return [...used.values()][0];
  if (used.size > 1) return null;
  const all = credentials.filter((c) => c.type === type);
  return all.length === 1 ? ref(all[0]) : null;
}
/** Trang quản lý lấy credential như workflow nó thay thế. */
const REPLACES = { [HUB]: REPLACED[0] };
/** Credential `type` mà các node cùng loại trong workflow `w` đang dùng, khi chỉ có một. */
function sibling(w, node, type) {
  const used = new Map();
  for (const n of w?.nodes ?? []) if (n.type === node.type && n.credentials?.[type]) used.set(n.credentials[type].id, n.credentials[type]);
  return used.size === 1 ? [...used.values()][0] : null;
}

let createTelegram = false;
const out = join(dir, "out");
mkdirSync(out, { recursive: true });
const publish = [];
const report = [];
for (const w of fresh) {
  const before = liveById.get(w.id);
  const merged = fill(w);
  const left = [...unresolved(merged)];
  if (left.length) throw new Error(`${w.name}: không tìm thấy giá trị cho ${left.join(", ")} trong bản đang chạy`);
  const missing = [];
  for (const n of merged.nodes) {
    const type = needs(n);
    if (!type || n.credentials?.[type]) continue;
    const same = before?.nodes?.find((x) => x.name === n.name)?.credentials?.[type];
    let c = same ?? sibling(before ?? liveById.get(REPLACES[w.id]), n, type) ?? only(type);
    if (!c && type === "telegramApi") {
      createTelegram = true;
      c = TELEGRAM_CREDENTIAL;
    }
    if (c) n.credentials = { ...n.credentials, [type]: ref(c) };
    else missing.push(`${n.name} (${type})`);
  }
  const wasActive = Boolean(before?.active || before?.activeVersionId);
  // Nhập vào thì workflow bị tắt: thiếu credential ở workflow đang bật (hoặc trang quản lý) thì dừng trước khi nhập.
  if (missing.length && (wasActive || w.id === HUB)) {
    throw new Error(`${w.name}: không biết gắn credential nào cho ${missing.join(", ")}. Chưa nhập gì, n8n giữ nguyên`);
  }
  // Giữ thẻ, meta và dữ liệu tĩnh của bản đang chạy; phần còn lại theo repo.
  const result = { ...merged };
  for (const k of ["tags", "meta", "staticData"]) if (before?.[k] !== undefined) result[k] = before[k];
  writeFileSync(join(out, `${w.id}.json`), JSON.stringify(result, null, 2));
  // Trang quản lý và workflow YouTube bật khi đủ credential; workflow khác giữ như trước.
  const on = !missing.length && (wasActive || w.id === HUB || w.id === "ssYouTubeDangVd1");
  if (on) publish.push(w.id);
  report.push(`${on ? "▶ bật " : "■ tắt "} ${w.name}${missing.length ? ` · thiếu credential: ${missing.join(", ")}` : ""}`);
}

if (createTelegram) {
  if (!secret("DAN_BOT_TOKEN")) throw new Error("Cần tạo credential Telegram nhưng không tìm thấy bot token trong bản đang chạy");
  writeFileSync(join(out, "telegram-credential.json"), JSON.stringify([{
    ...TELEGRAM_CREDENTIAL, type: "telegramApi", data: { accessToken: secret("DAN_BOT_TOKEN"), baseUrl: "https://api.telegram.org" },
  }]));
}
// Chỉ tắt workflow cũ còn đang bật (lần cập nhật sau nó đã tắt rồi).
const unpublish = publish.includes(HUB) ? REPLACED.filter((id) => liveById.get(id)?.active || liveById.get(id)?.activeVersionId) : [];
writeFileSync(join(out, "publish.txt"), publish.join("\n"));
writeFileSync(join(out, "unpublish.txt"), unpublish.join("\n"));
console.log(report.join("\n"));
if (createTelegram) console.log(`+ tạo credential "${TELEGRAM_CREDENTIAL.name}" từ bot token đang dùng`);
for (const id of unpublish) console.log(`■ tắt  ${liveById.get(id).name} (trang quản lý thay thế)`);
