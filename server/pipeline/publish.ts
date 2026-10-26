import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { config, paths } from "../config.js";
import { pictureCover, probeVideoSize, stillFrame } from "../lib/ffmpeg.js";
import { badgeLines } from "../lib/badge.js";
import { coverLines } from "../lib/cover.js";
import { readFontMetrics } from "../lib/font.js";
import { assTime, buildAss, type AssLayer } from "../lib/subtitles.js";
import { COVER_ACCENT, COVER_FONT, FADE_SHARE, PICTURE_SHARE, youtubeCoverLines } from "../lib/youtube-cover.js";
import {
  VIDEO_FORMATS, storyNameOf, type AiProvider, type Background, type Brand, type FitMode, type FullVideo, type JobOutput, type PublishKit,
} from "../types.js";
import { drawCoverArt, findCoverArt } from "./cover-art.js";
import { errorText, makeWriter, withRetry, type Writer } from "./rewrite.js";
import { jsonObject } from "./write.js";
import type { StepReporter } from "./run-job.js";

/**
 * The AI reads the whole story so titles can name what it is really about;
 * a very long one is cut in the middle, keeping the set-up and the ending.
 */
const STORY_HEAD_CHARS = 28000;
const STORY_TAIL_CHARS = 8000;
/** Of each part, its opening and its ending (the cliffhanger the hook can tease). */
const PART_EDGE_CHARS = 300;
/** Share of the step spent on the texts; the rest is the covers. */
const TEXT_SHARE = 0.3;

const kitSchema = z.object({
  niche: z.object({
    genre: z.string().trim().min(1),
    audience: z.string().trim().default(""),
    similar: z.array(z.string().trim().min(1)).default([]),
    insight: z.string().trim().default(""),
  }).nullish(),
  titles: z.array(z.string().trim().min(1)).min(1),
  storyName: z.string().trim().default(""),
  coverText: z.string().trim().min(1),
  caption: z.string().trim().min(1),
  hashtags: z.array(z.string()).min(1),
  partHooks: z.array(z.string().trim()).default([]),
  youtube: z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    tags: z.array(z.string().trim().min(1)).default([]),
  }).nullish(),
  coverImage: z.string().trim().default(""),
  coverLabel: z.string().trim().default(""),
  coverLines: z.array(z.string().trim()).default([]),
});

/** The YouTube cover's fields alone, asked for a kit written before them. */
const coverSchema = kitSchema.pick({ coverImage: true, coverLabel: true, coverLines: true }).extend({ coverImage: z.string().trim().min(1) });

/** "#Truyện ma", "truyenma" → "#Truyệnma", "#truyenma"; duplicates and blanks dropped. */
export function cleanHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/^#+/, "").replace(/[\s#,]+/g, "");
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(`#${tag}`);
  }
  return out.slice(0, 15);
}

export function parseKit(text: string, by: string, partCount: number, youtube: boolean): PublishKit {
  const k = kitSchema.parse(jsonObject(text, "gợi ý đăng bài"));
  return {
    by,
    niche: k.niche ? { ...k.niche, similar: k.niche.similar.slice(0, 8) } : null,
    titles: k.titles.slice(0, 5),
    storyName: k.storyName || null,
    coverText: k.coverText,
    caption: k.caption,
    hashtags: cleanHashtags(k.hashtags),
    partHooks: Array.from({ length: partCount }, (_, i) => k.partHooks[i] ?? ""),
    youtube: youtube && k.youtube ? { ...k.youtube, tags: k.youtube.tags.slice(0, 20) } : null,
    ...coverOf(k),
  };
}

function coverOf(k: { coverImage: string; coverLabel: string; coverLines: string[] }) {
  const lines = k.coverLines.filter(Boolean);
  return { coverImage: k.coverImage || null, coverLabel: k.coverLabel || null, coverLines: lines.length ? lines : null };
}

export function parseCover(text: string): Pick<PublishKit, "coverImage" | "coverLabel" | "coverLines"> {
  return coverOf(coverSchema.parse(jsonObject(text, "chữ trên ảnh bìa YouTube")));
}

/** Plain suggestions from the job title, for when the AI cannot be reached. */
function fallbackKit(title: string, partCount: number, youtube: boolean): PublishKit {
  return {
    by: null,
    niche: null,
    titles: [title],
    coverText: title,
    caption: title,
    hashtags: ["#truyenaudio", "#kechuyen", "#truyenhay"],
    partHooks: Array.from({ length: partCount }, () => ""),
    youtube: youtube ? { title, description: title, tags: ["truyện audio", "kể chuyện"] } : null,
  };
}

export function storyExcerpt(script: string): string {
  if (script.length <= STORY_HEAD_CHARS + STORY_TAIL_CHARS) return script;
  return `${script.slice(0, STORY_HEAD_CHARS)}\n\n[… lược bớt đoạn giữa …]\n\n${script.slice(-STORY_TAIL_CHARS)}`;
}

const partEdges = (text: string) =>
  text.length <= PART_EDGE_CHARS * 2 ? text : `${text.slice(0, PART_EDGE_CHARS)} […] ${text.slice(-PART_EDGE_CHARS)}`;

export const KIT_SYSTEM = "Bạn là chuyên gia tăng trưởng nội dung TikTok và YouTube cho các kênh truyện audio tiếng Việt. " +
  "Bạn hiểu thuật toán đề xuất, biết cách đặt tiêu đề khiến người xem dừng lướt, và chỉ dùng hashtag, từ khoá mà người xem thật sự tìm.";

/** The JSON fields of the YouTube cover; `name` is the story's short name when it is already known. */
const coverFields = (name: string | null) => `"coverImage": "bằng tiếng Anh, 40 đến 80 từ, tả nhân vật chính hoặc nhân vật gây ấn tượng nhất của truyện để AI vẽ hình bên trái ảnh bìa YouTube: giới tính, tuổi, người Việt Nam, kiểu tóc, trang phục đúng thời đại và bối cảnh truyện, biểu cảm hợp không khí truyện, có thể cầm một đồ vật đắt giá của truyện; chỉ tả người và đồ vật, không tả nền, không có chữ, không máu me",
 "coverLabel": "dòng chữ nhỏ trên ảnh bìa YouTube nói thể loại, viết hoa, dưới 32 ký tự, dạng như TRUYỆN AUDIO NGÔN TÌNH FULL hay TRUYỆN MA AUDIO FULL",
 "coverLines": ["${name ? `tên truyện ${name.toLocaleUpperCase("vi")}` : "storyName viết hoa"}, chia thành hai đến năm dòng ngắn để in to trên ảnh bìa YouTube: ngắt ở chỗ đọc tự nhiên, không tách đôi một từ ghép, giữ đủ các chữ và đúng thứ tự, ví dụ ĐẠI TIỂU THƯ, HÀO MÔN, VẢ MẶT, THÁI TỬ GIA, KIÊU NGẠO"]`;

/** Only the YouTube cover's texts, for a story whose kit was written before they were asked for. */
export function coverPrompt(opts: { name: string; story: string }): string {
  return `Truyện audio "${opts.name}" được đăng thành một video dài trên YouTube.

Toàn bộ truyện:
<truyen>
${opts.story}
</truyen>

Đọc kỹ truyện, rồi viết chữ và mô tả hình cho ảnh bìa YouTube của nó. Câu trả lời chỉ gồm DUY NHẤT một JSON hợp lệ, không markdown, không lời dẫn, theo mẫu:
{${coverFields(opts.name)}}`;
}

export function kitPrompt(opts: {
  title: string; channel: string | null; story: string; partTexts: string[]; youtube: boolean; webSearch: boolean;
}): string {
  const { title, channel, story, partTexts, youtube, webSearch } = opts;
  const n = partTexts.length;
  const parts = partTexts.map((t, i) => `<phan so="${i + 1}">\n${partEdges(t)}\n</phan>`).join("\n");
  const where = n > 1 ? `${n} video nối tiếp nhau trên TikTok` : "một video TikTok";
  const research = webSearch
    ? `2. Tìm trên web (TikTok, YouTube, Facebook, các trang truyện audio) những truyện, series và kênh CÙNG NGÁCH đang được nhiều người xem. Ghi nhận họ đặt tiêu đề thế nào, viết mô tả ra sao, dùng hashtag và từ khoá nào. Tìm vài lượt với từ khoá khác nhau (tên thể loại, bối cảnh, yếu tố đặc trưng). Không bịa số liệu.`
    : `2. Dựa trên hiểu biết của bạn về các truyện, series và kênh CÙNG NGÁCH đang được nhiều người xem: họ đặt tiêu đề thế nào, viết mô tả ra sao, dùng hashtag và từ khoá nào.`;
  return `Truyện audio "${title}"${channel ? ` của kênh "${channel}"` : ""} sẽ được đăng thành ${where}${youtube ? ", và cả truyện thành một video dài trên YouTube" : ""}.

Toàn bộ truyện:
<truyen>
${story}
</truyen>

Đầu và cuối của từng phần:
${parts}

Làm lần lượt các bước:

1. Đọc kỹ truyện. Xác định thể loại và NGÁCH cụ thể (không chỉ "truyện ma" mà ví dụ "truyện ma dân gian vùng cao Tây Bắc"), người nghe của ngách này, và những yếu tố riêng của truyện: nhân vật, địa danh, đồ vật, hiện tượng bí ẩn, câu hỏi lớn mà truyện đặt ra.

${research}

3. Viết gợi ý đăng bài theo các yêu cầu:
- Tiêu đề phải có ý nghĩa với truyện: gắn với một chi tiết có thật trong truyện (nhân vật, địa danh, đồ vật, hiện tượng) và nói đúng điều truyện kể, đồng thời để lại một câu hỏi khiến người xem phải nghe mới biết đáp án. Không dùng tiêu đề chung chung đặt cho truyện nào cũng được, không giật tít sai sự thật, không tiết lộ kết truyện. Học cách đặt tên của các video thành công cùng ngách nhưng không chép.
- Hashtag: đúng năm hashtag liên quan nhất, vì TikTok chỉ nhận tối đa năm. Gồm một đến hai hashtag lớn của thể loại; hai hashtag của ngách mà các video cùng ngách đang dùng; một đến hai hashtag riêng của truyện (tên truyện, địa danh, nhân vật hay yếu tố đặc trưng). Không dùng hashtag chung chung như #fyp, #xuhuong. Viết tiếng Việt không dấu, không khoảng trắng. Ưu tiên hashtag đang thật sự được dùng, không bịa hashtag không ai tìm.
- Mô tả chứa những từ khoá người xem ngách này hay tìm, đọc tự nhiên chứ không nhồi từ khoá.
- Câu nhử của mỗi phần dựa vào diễn biến của chính phần đó, gợi tò mò về điều sắp xảy ra.

Sau khi tìm hiểu xong, câu trả lời cuối cùng chỉ gồm DUY NHẤT một JSON hợp lệ, không markdown, không lời dẫn, theo mẫu:
{"niche": {"genre": "thể loại và ngách cụ thể", "audience": "ai hay nghe ngách này, nghe vào lúc nào", "similar": ["tên vài truyện, series hoặc kênh cùng ngách đang được xem nhiều"], "insight": "một đến hai câu: video thành công trong ngách này đặt tên, viết mô tả và dùng hashtag ra sao"},
 "titles": ["ba tiêu đề khác nhau, mỗi tiêu đề dưới 70 ký tự"],
 "storyName": "tên ngắn của truyện, dùng làm tên video khi đăng TikTok và để đặt tên file video: từ ba đến tám chữ, dưới 40 ký tự, nói đúng nội dung truyện, viết có dấu; bỏ tên kênh, số lượt xem, thời lượng, số tập, chữ FULL, tên thể loại và lời giật tít",
 "coverText": "chữ in to trên ảnh bìa: từ ba đến bảy chữ, gắn với chi tiết đắt nhất của truyện, không dấu câu thừa",
 "caption": "mô tả một đến hai câu khơi gợi tò mò, có từ khoá của ngách, có thể kèm một đến hai emoji, không chứa hashtag",
 "hashtags": ["đúng năm hashtag theo yêu cầu ở trên"],
 "partHooks": ["đúng ${n} câu theo thứ tự các phần, mỗi câu dưới 120 ký tự"],${youtube ? `\n ${coverFields(null)},` : ""}
 "youtube": ${youtube ? `{"title": "tiêu đề YouTube dưới 100 ký tự, có ý nghĩa với truyện và có từ khoá người xem ngách này hay tìm", "description": "ba đến năm đoạn ngắn: giới thiệu truyện có từ khoá của ngách, không khí, lời mời nghe hết và đăng ký kênh", "tags": ["mười đến mười lăm từ khoá tìm kiếm tiếng Việt của ngách và của riêng truyện"]}` : "null"}}`;
}

/**
 * Write the post texts with the job's AI (cached in `kitFile`) and draw a
 * cover for every video in `outputs`, setting each video's `cover`. The AI
 * first searches the web for the story's niche; if that fails it writes
 * without searching, and if the AI cannot be reached at all the job title
 * stands in.
 */
export async function preparePublish(opts: {
  title: string;
  script: string;
  outputs: JobOutput[];
  provider: AiProvider;
  partsDir: string;
  kitFile: string;
  /** Where the picture on the YouTube covers is kept. */
  artDir: string;
  /** The job's chosen library videos; each cover is a frame from one of them. */
  backgrounds: Background[];
  fit: FitMode;
  brand: Brand;
  r: StepReporter;
}): Promise<PublishKit> {
  const { title, script, outputs, provider, partsDir, kitFile, artDir, backgrounds, fit, brand, r } = opts;
  const { signal } = r;
  const split = outputs.reduce<JobOutput | null>((best, o) => (o.parts.length > (best?.parts.length ?? 0) ? o : best), null);
  const partCount = split?.parts.length ?? 0;
  const youtube = outputs.some((o) => o.format === "youtube");
  const channel = brand.enabled && brand.text.trim() ? brand.text.trim() : null;

  // ── Texts ──
  let kit: PublishKit;
  if (existsSync(kitFile)) {
    kit = JSON.parse(readFileSync(kitFile, "utf8")) as PublishKit;
    kit.niche ??= null;
    r.log("Dùng lại gợi ý tiêu đề, mô tả và hashtag từ lần chạy trước");
  } else {
    const partTexts = (split?.parts ?? []).map((p) => readFileSync(join(partsDir, p.textFile), "utf8"));
    const story = storyExcerpt(script);
    const attempt = (writer: Writer, webSearch: boolean) => {
      r.detail(webSearch
        ? `${writer.name} đang tìm hiểu ngách truyện và các video cùng ngách…`
        : `${writer.name} đang viết tiêu đề, mô tả và hashtag…`);
      r.expect(TEXT_SHARE, webSearch ? 120 : 40);
      const prompt = kitPrompt({ title, channel, story, partTexts, youtube, webSearch });
      return withRetry(
        async () => parseKit(await writer.write(prompt), writer.name, partCount, youtube),
        signal,
        (err, n, total, delayMs) => r.log(`Gợi ý đăng bài lỗi "${errorText(err)}", thử lại lần ${n}/${total} sau ${delayMs / 1000}s`, "warn"),
      );
    };
    try {
      try {
        kit = await attempt(makeWriter(provider, KIT_SYSTEM, signal, { webSearch: true }), true);
      } catch (err) {
        if (signal.aborted) throw err;
        r.log(`Không tìm web được (${errorText(err)}), AI viết gợi ý theo hiểu biết sẵn có`, "warn");
        kit = await attempt(makeWriter(provider, KIT_SYSTEM, signal), false);
      }
      if (kit.niche) r.log(`Ngách truyện: ${kit.niche.genre}${kit.niche.similar.length ? ` · cùng ngách: ${kit.niche.similar.join(", ")}` : ""}`);
      r.log(`${kit.by} gợi ý: "${kit.titles[0]}"${kit.storyName ? ` · tên file "${kit.storyName}"` : ""} · ${kit.hashtags.join(" ")}`, "success");
    } catch (err) {
      if (signal.aborted) throw err;
      kit = fallbackKit(title, partCount, youtube);
      r.log(`AI không viết được gợi ý (${errorText(err)}), dùng tên truyện làm tiêu đề. Bấm "Tạo lại gợi ý" để thử lại.`, "warn");
    }
    writeFileSync(kitFile, JSON.stringify(kit, null, 2));
  }
  r.progress(TEXT_SHARE);

  // ── Covers ──
  const videos = outputs.flatMap((o) => [
    ...o.parts.map((video): { o: JobOutput; video: FullVideo; label: string | null; part: boolean } => ({ o, video, label: `Phần ${video.index}`, part: true })),
    ...(o.fullVideo ? [{ o, video: o.fullVideo, label: o.parts.length ? "Trọn bộ" : null, part: false }] : []),
  ]);
  const coverOfVideo = (video: FullVideo) => video.file.replace(/\.mp4$/, ".jpg");
  // The YouTube covers show a picture of the story; without one they are drawn like the others.
  const drawsYoutube = videos.some(({ o, video }) => o.format === "youtube" && !existsSync(join(partsDir, coverOfVideo(video))));
  const art = drawsYoutube ? await youtubeArt(kit, { kitFile, artDir, provider, script, r }) : null;
  const font = art && readFontMetrics(join(config.fontsDir, COVER_FONT.file));
  for (const [i, { o, video, label, part }] of videos.entries()) {
    signal.throwIfAborted();
    const cover = coverOfVideo(video);
    const file = join(partsDir, cover);
    if (!existsSync(file)) {
      r.detail(`Vẽ ảnh bìa ${i + 1}/${videos.length}: ${VIDEO_FORMATS[o.format].label}${label ? ` · ${label}` : ""}`);
      // "original" videos take their frame from the footage, so match the video as rendered.
      const size = VIDEO_FORMATS[o.format].size ?? await probeVideoSize(join(partsDir, video.file));
      const assFile = file.replace(/\.jpg$/, ".cover.ass");
      try {
        if (o.format === "youtube" && art && font) {
          const layer = youtubeCoverLines({
            name: storyNameOf(kit), lines: kit.coverLines ?? null, label: kit.coverLabel || "Truyện audio full",
            part: part ? label : null, channel, accent: COVER_ACCENT,
          }, size.width, size.height, font, assTime);
          writeFileSync(assFile, buildAss([], size.width, size.height, [layer]));
          const pictureWidth = Math.round(size.width * PICTURE_SHARE);
          await pictureCover(art, file, { ...size, pictureWidth, fadeWidth: pictureWidth * FADE_SHARE, subtitles: assFile, fontsDir: config.fontsDir }, signal);
        } else {
          const layers: AssLayer[] = [coverLines({ text: kit.coverText, label, accent: brand.color }, size.width, size.height, assTime)];
          if (channel) layers.push(badgeLines({ text: channel, position: brand.position, color: brand.color, durationSec: 10, fadeIn: false }, size.width, size.height, assTime));
          writeFileSync(assFile, buildAss([], size.width, size.height, layers));
          // Each cover from the next background, at a different moment away from its very start and end.
          const bg = backgrounds[i % backgrounds.length];
          const at = bg.durationSec > 2 ? (0.1 + ((i * 0.29) % 0.8)) * bg.durationSec : 0;
          await stillFrame(join(paths.backgrounds, bg.file), at, file, { look: bg, frame: { ...size, fit }, subtitles: assFile }, signal);
        }
      } finally {
        rmSync(assFile, { force: true });
      }
    }
    video.cover = cover;
    r.progress(TEXT_SHARE + ((i + 1) / videos.length) * (1 - TEXT_SHARE));
  }
  r.log(`Đã vẽ ${videos.length} ảnh bìa`);
  return kit;
}

/**
 * The picture for the YouTube covers: the one drawn before, else a new one
 * by Gemini. A kit written before the AI was asked to describe the story's
 * character gets that description first. Null, with the reason logged, when
 * there is no picture.
 */
async function youtubeArt(
  kit: PublishKit, opts: { kitFile: string; artDir: string; provider: AiProvider; script: string; r: StepReporter },
): Promise<string | null> {
  const { kitFile, artDir, provider, script, r } = opts;
  const { signal } = r;
  const found = findCoverArt(artDir);
  if (found) return found;
  if (!config.geminiImageApiKey) {
    r.log("Chưa có GEMINI_IMAGE_API_KEY nên ảnh bìa YouTube chưa có hình minh hoạ, vẫn vẽ như trước (xem .env.example)", "warn");
    return null;
  }
  if (!kit.coverImage) {
    const writer = makeWriter(provider, KIT_SYSTEM, signal);
    r.detail(`${writer.name} đang tả nhân vật và viết chữ cho ảnh bìa YouTube…`);
    try {
      Object.assign(kit, parseCover(await writer.write(coverPrompt({ name: storyNameOf(kit), story: storyExcerpt(script) }))));
      writeFileSync(kitFile, JSON.stringify(kit, null, 2));
    } catch (err) {
      if (signal.aborted) throw err;
      r.log(`AI chưa tả được nhân vật cho ảnh bìa YouTube (${errorText(err)}), Gemini vẽ theo tên và mô tả của truyện`, "warn");
    }
  }
  r.detail("Gemini đang vẽ hình minh hoạ cho ảnh bìa YouTube…");
  try {
    const { file, model } = await drawCoverArt(kit, artDir, signal);
    r.log(`Gemini (${model}) đã vẽ hình minh hoạ cho ảnh bìa YouTube`, "success");
    return file;
  } catch (err) {
    if (signal.aborted) throw err;
    r.log(`Không vẽ được hình minh hoạ cho ảnh bìa YouTube: ${errorText(err)}. Ảnh bìa YouTube vẫn vẽ như trước.`, "warn");
    return null;
  }
}
