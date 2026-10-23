import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const google = vi.hoisted(() => ({ state: { refreshToken: "refresh-1" } as Record<string, string | undefined> }));
vi.mock("../server/store.js", () => ({
  getGoogleState: () => ({ ...google.state }),
  saveGoogleState: (patch: Record<string, string | undefined>) => {
    google.state = JSON.parse(JSON.stringify({ ...google.state, ...patch }));
  },
}));

const { config, googleId } = await import("../server/config.js");
const { a1, columnLetter, finishOauth, uploadFile, uploadedBytes } = await import("../server/lib/google.js");
const { PENDING, SHEET_HEADER, jobVideos, sheetRows } = await import("../server/pipeline/upload.js");
import type { DriveUpload, Job, PublishKit } from "../server/types.js";

describe("google ids", () => {
  it("takes the id out of a folder or sheet link, or the id itself", () => {
    expect(googleId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing", "X")).toBe("1AbCdEfGhIjKlMn");
    expect(googleId("https://docs.google.com/spreadsheets/d/1ZyXwVuTsRqPoN_-123/edit#gid=0", "X")).toBe("1ZyXwVuTsRqPoN_-123");
    expect(googleId("1AbCdEfGhIjKlMn", "X")).toBe("1AbCdEfGhIjKlMn");
    expect(googleId(undefined, "X")).toBeUndefined();
    expect(() => googleId("thư mục của tôi", "GOOGLE_DRIVE_FOLDER_ID")).toThrow(/GOOGLE_DRIVE_FOLDER_ID/);
  });
});

describe("sheet ranges", () => {
  it("names columns like a spreadsheet", () => {
    expect([1, 18, 26, 27, 52, 53].map(columnLetter)).toEqual(["A", "R", "Z", "AA", "AZ", "BA"]);
  });

  it("quotes the tab name", () => {
    expect(a1("Videos", "A:A")).toBe("'Videos'!A:A");
    expect(a1("Kênh's", "A1")).toBe("'Kênh''s'!A1");
  });

  it("reads how much of an upload arrived", () => {
    expect(uploadedBytes("bytes=0-1048575")).toBe(1048576);
    expect(uploadedBytes(null)).toBe(0);
  });
});

describe("sheet rows", () => {
  const kit: PublishKit = {
    by: "Claude", niche: null, titles: ["Cô giáo và ngôi trường bên sông"], coverText: "NGÔI TRƯỜNG BÊN SÔNG",
    caption: "Một đêm mưa…", hashtags: ["#truyenma", "#truyenmamientay", "#kechuyen", "#truyenaudio", "#cogiaotre", "#ngoitruongbensong"],
    partHooks: ["Tiếng gõ cửa lúc nửa đêm", "Ai đứng sau tấm bảng?"],
    youtube: { title: "Ngôi trường bên sông | Truyện ma", description: "Mô tả", tags: ["truyện ma", "kể chuyện"] },
  };
  const video = (file: string) => ({ file, textFile: file.replace(".mp4", ".txt"), durationSec: 150.4, cover: file.replace(".mp4", ".jpg") });
  const job = {
    id: "20261015-101010-abcdef", title: "Ngôi trường bên sông", publish: kit,
    outputs: [
      { format: "tiktok", parts: [{ index: 1, ...video("tiktok/part-01.mp4") }, { index: 2, ...video("tiktok/part-02.mp4") }], fullVideo: null },
      { format: "youtube", parts: [], fullVideo: video("youtube/full.mp4") },
    ],
  } as unknown as Job;
  const drive: DriveUpload = {
    rootId: "root", folderId: "folder-1", sheetId: "sheet-1",
    files: {
      "tiktok/part-01.mp4": { id: "v1", size: 1, mtimeMs: 1 },
      "tiktok/part-01.jpg": { id: "c1", size: 1, mtimeMs: 1 },
    },
  };

  it("gives every video a stable id", () => {
    expect(jobVideos(job).map((v) => v.id)).toEqual([
      "20261015-101010-abcdef-tiktok-p01", "20261015-101010-abcdef-tiktok-p02", "20261015-101010-abcdef-youtube-full",
    ]);
  });

  it("fills the app's columns, up to status", () => {
    const rows = sheetRows(job, drive, "2026-10-15T10:00:00.000Z");
    const row = (i: number) => Object.fromEntries(rows[i].map((v, c) => [SHEET_HEADER[c], v]));
    expect(rows[0]).toHaveLength(SHEET_HEADER.indexOf("status"));
    expect(row(0)).toMatchObject({
      format: "tiktok", kind: "part", part: 1, total_parts: 2, duration_sec: 150,
      video_file_id: "v1", video_url: "https://drive.google.com/file/d/v1/view", cover_file_id: "c1",
      post_title: "", folder_url: "https://drive.google.com/drive/folders/folder-1",
    });
    // TikTok: the story's name and part, then the five hashtags TikTok takes; no hook or description.
    expect(row(0).post_description).toBe("Cô giáo và ngôi trường bên sông | Phần 1/2\n\n#truyenma #truyenmamientay #kechuyen #truyenaudio #cogiaotre");
    // Not uploaded yet: no Drive links.
    expect(row(1)).toMatchObject({ video_file_id: "", video_url: "" });
    expect(row(2)).toMatchObject({
      format: "youtube", kind: "full", part: "", post_title: "Ngôi trường bên sông | Truyện ma", post_description: "Mô tả", tags: "truyện ma, kể chuyện",
    });
    expect(PENDING).toBe("pending");
  });

  it("lists only the hashtags TikTok takes on TikTok rows, and all of them on YouTube rows", () => {
    const rows = sheetRows(job, drive, "2026-10-15T10:00:00.000Z");
    const hashtags = rows.map((r) => r[SHEET_HEADER.indexOf("hashtags")]);
    expect(hashtags).toEqual([
      "#truyenma #truyenmamientay #kechuyen #truyenaudio #cogiaotre",
      "#truyenma #truyenmamientay #kechuyen #truyenaudio #cogiaotre",
      "#truyenma #truyenmamientay #kechuyen #truyenaudio #cogiaotre #ngoitruongbensong",
    ]);
  });
});

describe("connecting an account", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the refresh token and the account, and forgets another account's folder", async () => {
    Object.assign(config, { googleServiceAccountFile: undefined, googleClientId: "client", googleClientSecret: "secret" });
    google.state = { account: "old@gmail.com", folderId: "old-folder", sheetId: "old-sheet" };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes("oauth2.googleapis.com")) {
        expect(new URLSearchParams(String(init.body)).get("grant_type")).toBe("authorization_code");
        return Response.json({ access_token: "new-token", expires_in: 3600, refresh_token: "refresh-new" });
      }
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer new-token");
      return Response.json({ user: { emailAddress: "me@gmail.com" } });
    }));

    expect(await finishOauth("code-1")).toBe("me@gmail.com");
    expect(google.state).toEqual({ refreshToken: "refresh-new", account: "me@gmail.com" });
    google.state = { refreshToken: "refresh-1" };
  });
});

describe("uploadFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "story-upload-"));
  afterEach(() => vi.unstubAllGlobals());

  it("asks Google how much arrived after a dropped connection and sends only the rest", async () => {
    Object.assign(config, { googleServiceAccountFile: undefined, googleClientId: "client", googleClientSecret: "secret" });
    const file = join(dir, "part-01.mp4");
    writeFileSync(file, "0123456789");
    const puts: { range: string | null; body: string | null }[] = [];
    let chunkTries = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "token", expires_in: 3600 });
      if (url.includes("uploadType=resumable")) {
        expect(init.method).toBe("POST");
        expect(JSON.parse(String(init.body))).toEqual({ name: "tiktok-part-01.mp4", parents: ["folder-1"] });
        return new Response(null, { status: 200, headers: { location: "https://upload.example/session" } });
      }
      const range = new Headers(init.headers).get("content-range");
      puts.push({ range, body: init.body ? Buffer.from(init.body as Uint8Array).toString() : null });
      if (range === "bytes */10") return new Response(null, { status: 308, headers: { range: "bytes=0-3" } });
      if (chunkTries++ === 0) throw new TypeError("fetch failed");
      return Response.json({ id: "file-1" });
    }));

    const progress: number[] = [];
    const id = await uploadFile({
      file, name: "tiktok-part-01.mp4", mimeType: "video/mp4", parentId: "folder-1",
      signal: new AbortController().signal, onProgress: (b) => progress.push(b),
    });

    expect(id).toBe("file-1");
    expect(puts).toEqual([
      { range: "bytes 0-9/10", body: "0123456789" },
      { range: "bytes */10", body: null },
      { range: "bytes 4-9/10", body: "456789" },
    ]);
    expect(progress).toEqual([4]);
  }, 10_000);

  it("signs in as a service account with a signed JWT", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const keyFile = join(dir, "sa.json");
    writeFileSync(keyFile, JSON.stringify({
      client_email: "bot@project.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    }));
    Object.assign(config, { googleServiceAccountFile: keyFile });
    const file = join(dir, "cover.jpg");
    writeFileSync(file, "jpg");
    let assertion = "";
    let auth = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes("oauth2.googleapis.com")) {
        assertion = new URLSearchParams(String(init.body)).get("assertion") ?? "";
        return Response.json({ access_token: "sa-token", expires_in: 3600 });
      }
      if (url.includes("uploadType=resumable")) {
        auth = new Headers(init.headers).get("authorization") ?? "";
        return new Response(null, { status: 200, headers: { location: "https://upload.example/s2" } });
      }
      return Response.json({ id: "file-2" });
    }));

    await uploadFile({ file, name: "cover.jpg", mimeType: "image/jpeg", parentId: "f", signal: new AbortController().signal, onProgress: () => {} });

    const [head, claims, sig] = assertion.split(".");
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      iss: "bot@project.iam.gserviceaccount.com", aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/drive",
    });
    expect(createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, sig, "base64url")).toBe(true);
    expect(auth).toBe("Bearer sa-token");
    rmSync(dir, { recursive: true, force: true });
  });
});
