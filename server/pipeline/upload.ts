import { statSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { formatBytes } from "../lib/format.js";
import {
  a1, appendRows, columnLetter, createFolder, driveTargets, ensureTab, readRange, trashFile, uploadFile, writeRanges, type Cell,
} from "../lib/google.js";
import {
  driveFileUrl, driveFolderUrl, postFor, type DriveUpload, type FullVideo, type Job, type VideoFormat,
} from "../types.js";
import type { StepReporter } from "./run-job.js";

/**
 * One row per video. The columns up to "status" are the app's and are
 * rewritten when a job is uploaded again; "status" and after belong to n8n
 * (or whoever posts the videos) and are only ever filled in on a new row.
 */
export const SHEET_HEADER = [
  "id", "uploaded_at", "job_id", "title", "format", "kind", "part", "total_parts", "duration_sec",
  "video_file_id", "video_url", "cover_file_id", "cover_url",
  "post_title", "post_description", "tags", "hashtags", "folder_url",
  "status", "scheduled_at", "posted_at", "post_url", "note",
];
const APP_COLUMNS = SHEET_HEADER.indexOf("status");
/** What a new row's status starts as; n8n posts the rows still "pending". */
export const PENDING = "pending";
/** Status of a row whose video is no longer part of the job (e.g. after re-rendering with other part lengths). */
export const REMOVED = "removed";
/** Share of the step spent sending files; the rest is the sheet. */
const FILES_SHARE = 0.95;

export interface JobVideo {
  /** Stable across uploads of the same job, so its row is found again. */
  id: string;
  format: VideoFormat;
  part: { index: number; total: number } | null;
  video: FullVideo;
}

export function jobVideos(job: Job): JobVideo[] {
  return job.outputs.flatMap((o) => [
    ...o.parts.map((p) => ({ format: o.format, part: { index: p.index, total: o.parts.length }, video: p as FullVideo })),
    ...(o.fullVideo ? [{ format: o.format, part: null, video: o.fullVideo }] : []),
  ]).map((v) => ({ ...v, id: `${job.id}-${v.format}-${v.part ? `p${String(v.part.index).padStart(2, "0")}` : "full"}` }));
}

/** The app's columns of each video's row. */
export function sheetRows(job: Job, drive: DriveUpload, uploadedAt: string): Cell[][] {
  return jobVideos(job).map(({ id, format, part, video }) => {
    const post = job.publish ? postFor(job.publish, format, part) : null;
    const file = drive.files[video.file];
    const cover = video.cover ? drive.files[video.cover] : undefined;
    return [
      id, uploadedAt, job.id, job.title, format, part ? "part" : "full", part?.index ?? "", part?.total ?? "",
      Math.round(video.durationSec),
      file?.id ?? "", file ? driveFileUrl(file.id) : "", cover?.id ?? "", cover ? driveFileUrl(cover.id) : "",
      post?.title ?? "", post?.description ?? "", post?.tags.join(", ") ?? "", job.publish?.hashtags.join(" ") ?? "",
      driveFolderUrl(drive.folderId),
    ];
  });
}

/** "tiktok/part-01.mp4" → "tiktok-part-01.mp4": the job's Drive folder is flat. */
const driveName = (path: string) => path.replace(/[\\/]/g, "-");

/**
 * Update the rows of videos already listed, add the others as pending, and
 * mark the job's rows whose video is gone as removed. Returns how many rows
 * were added and updated.
 */
async function syncSheet(job: Job, drive: DriveUpload, signal: AbortSignal): Promise<{ added: number; updated: number; removed: number }> {
  const tab = config.googleSheetTab;
  await ensureTab(drive.sheetId, tab, SHEET_HEADER, signal);
  const existing = await readRange(drive.sheetId, a1(tab, `A:${columnLetter(APP_COLUMNS + 1)}`), signal);
  const rowOf = new Map(existing.map((r, i) => [r[0] ?? "", i + 1]));
  const rows = sheetRows(job, drive, new Date().toISOString());
  const ids = new Set(rows.map((r) => String(r[0])));

  const updates = rows.filter((r) => rowOf.has(String(r[0]))).map((r) => {
    const n = rowOf.get(String(r[0]))!;
    return { range: a1(tab, `A${n}:${columnLetter(APP_COLUMNS)}${n}`), values: [r] };
  });
  const removed = existing
    .map((r, i) => ({ id: r[0] ?? "", status: r[APP_COLUMNS] ?? "", n: i + 1 }))
    .filter((r) => r.id.startsWith(`${job.id}-`) && !ids.has(r.id) && r.status === PENDING)
    .map((r) => ({ range: a1(tab, `${columnLetter(APP_COLUMNS + 1)}${r.n}`), values: [[REMOVED]] }));
  await writeRanges(drive.sheetId, [...updates, ...removed], signal);

  const added = rows.filter((r) => !rowOf.has(String(r[0]))).map((r) => [...r, PENDING]);
  await appendRows(drive.sheetId, tab, added, signal);
  return { added: added.length, updated: updates.length, removed: removed.length };
}

/**
 * Upload a finished job's videos and covers to its own Drive folder and list
 * each video in the Google Sheet. Progress is kept in `job.drive`, so a
 * retry only sends files that are new or changed since.
 */
export async function uploadToDrive(job: Job, partsDir: string, r: StepReporter): Promise<void> {
  const { signal } = r;
  r.detail("Đang kết nối Google Drive…");
  const targets = await driveTargets(signal);
  if (!job.drive || job.drive.rootId !== targets.folderId) {
    const name = `${job.title} · ${job.id}`;
    job.drive = { rootId: targets.folderId, folderId: await createFolder(name, targets.folderId, signal), sheetId: targets.sheetId, files: {} };
    r.log(`Đã tạo thư mục Drive "${name}": ${driveFolderUrl(job.drive.folderId)}`);
  }
  const drive = job.drive;
  drive.sheetId = targets.sheetId;

  const paths = jobVideos(job).flatMap(({ video }) => [video.file, ...(video.cover ? [video.cover] : [])]);
  const sizes = paths.map((p) => statSync(join(partsDir, p)));
  const total = sizes.reduce((s, st) => s + st.size, 0);
  let done = 0;
  let sent = 0;
  let sentBytes = 0;
  for (const [i, path] of paths.entries()) {
    const { size, mtimeMs } = sizes[i];
    const before = drive.files[path];
    if (before?.size !== size || before.mtimeMs !== mtimeMs) {
      const started = Date.now();
      const label = `Tải lên ${i + 1}/${paths.length}: ${driveName(path)}`;
      r.detail(`${label} (${formatBytes(size)})`);
      const id = await uploadFile({
        file: join(partsDir, path),
        name: driveName(path),
        mimeType: path.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
        parentId: drive.folderId,
        replaceId: before?.id,
        signal,
        onProgress: (bytes) => {
          const speed = bytes / Math.max(0.001, (Date.now() - started) / 1000);
          r.detail(`${label} · ${Math.round((bytes / size) * 100)}% · ${formatBytes(speed)}/s`);
          r.progress(FILES_SHARE * ((done + bytes) / total));
        },
      });
      drive.files[path] = { id, size, mtimeMs };
      sent++;
      sentBytes += size;
    }
    done += size;
    r.progress(FILES_SHARE * (done / total));
  }

  // Files of videos no longer in the job, e.g. parts of an earlier cut.
  const stale = Object.keys(drive.files).filter((p) => !paths.includes(p));
  for (const p of stale) {
    await trashFile(drive.files[p].id, signal);
    delete drive.files[p];
  }
  const unchanged = paths.length - sent;
  r.log(
    `Đã tải lên ${sent} file (${formatBytes(sentBytes)})` +
      (unchanged ? `, ${unchanged} file không đổi nên giữ nguyên` : "") +
      (stale.length ? `, chuyển ${stale.length} file cũ vào thùng rác` : ""),
    "success",
  );

  r.detail("Đang ghi vào Google Sheet…");
  const { added, updated, removed } = await syncSheet(job, drive, signal);
  r.log(
    `Google Sheet: thêm ${added} dòng chờ đăng` + (updated ? `, cập nhật ${updated} dòng` : "") +
      (removed ? `, đánh dấu ${removed} dòng "${REMOVED}"` : ""),
    "success",
  );
  r.progress(1);
}
