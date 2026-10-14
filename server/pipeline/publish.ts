import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { paths } from "../config.js";
import { probeVideoSize, stillFrame } from "../lib/ffmpeg.js";
import { badgeLines } from "../lib/badge.js";
import { coverLines } from "../lib/cover.js";
import { assTime, buildAss, type AssLayer } from "../lib/subtitles.js";
import {
  VIDEO_FORMATS, type AiProvider, type Background, type Brand, type FitMode, type FullVideo, type JobOutput, type PublishKit,
} from "../types.js";
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
  coverText: z.string().trim().min(1),
  caption: z.string().trim().min(1),
  hashtags: z.array(z.string()).min(1),
  partHooks: z.array(z.string().trim()).default([]),
  youtube: z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    tags: z.array(z.string().trim().min(1)).default([]),
  }).nullish(),
});

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
    coverText: k.coverText,
    caption: k.caption,
    hashtags: cleanHashtags(k.hashtags),
    partHooks: Array.from({ length: partCount }, (_, i) => k.partHooks[i] ?? ""),
    youtube: youtube && k.youtube ? { ...k.youtube, tags: k.youtube.tags.slice(0, 20) } : null,
  };
}

/** Plain suggestions from the job title, for when the AI cannot be reached. */
function fallbackKit(title: string, partCount: number, youtube: boolean): PublishKit {
  return {
    by: null,
    niche: null,
    titles: [title],
    coverText: title,
    caption: title,
    hashtags: ["#truyenaudio", "#kechuyen", "#truyenhay", "#fyp"],
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
- Hashtag gồm ba tầng: hai đến ba hashtag lớn của thể loại; bốn đến năm hashtag của ngách mà các video cùng ngách đang dùng; hai đến ba hashtag riêng của truyện (tên truyện, địa danh, nhân vật hay yếu tố đặc trưng); thêm #fyp hoặc #xuhuong. Viết tiếng Việt không dấu, không khoảng trắng. Ưu tiên hashtag đang thật sự được dùng, không bịa hashtag không ai tìm.
- Mô tả chứa những từ khoá người xem ngách này hay tìm, đọc tự nhiên chứ không nhồi từ khoá.
- Câu nhử của mỗi phần dựa vào diễn biến của chính phần đó, gợi tò mò về điều sắp xảy ra.

Sau khi tìm hiểu xong, câu trả lời cuối cùng chỉ gồm DUY NHẤT một JSON hợp lệ, không markdown, không lời dẫn, theo mẫu:
{"niche": {"genre": "thể loại và ngách cụ thể", "audience": "ai hay nghe ngách này, nghe vào lúc nào", "similar": ["tên vài truyện, series hoặc kênh cùng ngách đang được xem nhiều"], "insight": "một đến hai câu: video thành công trong ngách này đặt tên, viết mô tả và dùng hashtag ra sao"},
 "titles": ["ba tiêu đề khác nhau, mỗi tiêu đề dưới 70 ký tự"],
 "coverText": "chữ in to trên ảnh bìa: từ ba đến bảy chữ, gắn với chi tiết đắt nhất của truyện, không dấu câu thừa",
 "caption": "mô tả một đến hai câu khơi gợi tò mò, có từ khoá của ngách, có thể kèm một đến hai emoji, không chứa hashtag",
 "hashtags": ["mười đến mười ba hashtag theo ba tầng ở trên"],
 "partHooks": ["đúng ${n} câu theo thứ tự các phần, mỗi câu dưới 120 ký tự"],
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
  /** The job's chosen library videos; each cover is a frame from one of them. */
  backgrounds: Background[];
  fit: FitMode;
  brand: Brand;
  r: StepReporter;
}): Promise<PublishKit> {
  const { title, script, outputs, provider, partsDir, kitFile, backgrounds, fit, brand, r } = opts;
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
      r.log(`${kit.by} gợi ý: "${kit.titles[0]}" · ${kit.hashtags.join(" ")}`, "success");
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
    ...o.parts.map((video): { o: JobOutput; video: FullVideo; label: string | null } => ({ o, video, label: `Phần ${video.index}` })),
    ...(o.fullVideo ? [{ o, video: o.fullVideo, label: o.parts.length ? "Trọn bộ" : null }] : []),
  ]);
  for (const [i, { o, video, label }] of videos.entries()) {
    signal.throwIfAborted();
    const cover = video.file.replace(/\.mp4$/, ".jpg");
    const file = join(partsDir, cover);
    if (!existsSync(file)) {
      r.detail(`Vẽ ảnh bìa ${i + 1}/${videos.length}: ${VIDEO_FORMATS[o.format].label}${label ? ` · ${label}` : ""}`);
      // "original" videos take their frame from the footage, so match the video as rendered.
      const size = VIDEO_FORMATS[o.format].size ?? await probeVideoSize(join(partsDir, video.file));
      const layers: AssLayer[] = [coverLines({ text: kit.coverText, label, accent: brand.color }, size.width, size.height, assTime)];
      if (channel) layers.push(badgeLines({ text: channel, position: brand.position, color: brand.color, durationSec: 10, fadeIn: false }, size.width, size.height, assTime));
      const assFile = file.replace(/\.jpg$/, ".cover.ass");
      writeFileSync(assFile, buildAss([], size.width, size.height, layers));
      // Each cover from the next background, at a different moment away from its very start and end.
      const bg = backgrounds[i % backgrounds.length];
      const at = bg.durationSec > 2 ? (0.1 + ((i * 0.29) % 0.8)) * bg.durationSec : 0;
      try {
        await stillFrame(join(paths.backgrounds, bg.file), at, file, { look: bg, frame: { ...size, fit }, subtitles: assFile }, signal);
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
