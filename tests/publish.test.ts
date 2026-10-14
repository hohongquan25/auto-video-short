import { describe, expect, it } from "vitest";
import { balancedLines, coverText, wrapLines } from "../server/lib/cover.js";
import { cleanHashtags, kitPrompt, parseKit, storyExcerpt } from "../server/pipeline/publish.js";
import { postFor, type PublishKit } from "../server/types.js";

describe("cover text", () => {
  it("spreads words evenly instead of leaving one alone on the last line", () => {
    const text = "CÔ GIÁO TRẺ VÀ NGÔI TRƯỜNG BỎ HOANG BÊN SÔNG";
    const greedy = wrapLines(text, 113, 907);
    const balanced = balancedLines(text, 113, 907);
    expect(greedy.at(-1)).toBe("SÔNG");
    expect(balanced).toHaveLength(greedy.length);
    expect(balanced.join(" ")).toBe(text);
    expect(balanced.at(-1)!.split(" ").length).toBeGreaterThan(1);
  });

  it("shrinks a long hook to four lines at most", () => {
    const { lines, fontSize } = coverText("một câu chuyện rất dài về những điều kỳ lạ xảy ra trong ngôi làng nhỏ ven sông mỗi đêm trăng tròn", 1080, 1920);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(fontSize).toBeLessThan(113);
    expect(lines.join(" ")).toBe(lines.join(" ").toLocaleUpperCase("vi"));
  });
});

describe("publish kit", () => {
  it("normalises hashtags", () => {
    expect(cleanHashtags(["truyen ma", "#TruyenMa", "##fyp", "", "#"])).toEqual(["#truyenma", "#fyp"]);
  });

  it("reads the AI reply around a code fence and pads the part hooks", () => {
    const reply = '```json\n{"titles":["A"],"coverText":"B","caption":"C","hashtags":["x"],"partHooks":["h1"],"youtube":null}\n```';
    const kit = parseKit(reply, "AI", 3, false);
    expect(kit.partHooks).toEqual(["h1", "", ""]);
    expect(kit.hashtags).toEqual(["#x"]);
    expect(kit.youtube).toBeNull();
    expect(kit.niche).toBeNull();
  });

  it("keeps the niche the AI found", () => {
    const reply = 'Đã tìm xong.\n{"niche":{"genre":"truyện ma vùng cao","similar":["Kênh A"]},"titles":["A"],"coverText":"B","caption":"C","hashtags":["x"]}';
    expect(parseKit(reply, "AI", 0, false).niche).toEqual({ genre: "truyện ma vùng cao", audience: "", similar: ["Kênh A"], insight: "" });
  });

  it("sends the whole story, or its start and end when very long", () => {
    expect(storyExcerpt("ngắn")).toBe("ngắn");
    const long = "a".repeat(30000) + "GIỮA" + "b".repeat(30000) + "KẾT";
    const excerpt = storyExcerpt(long);
    expect(excerpt).not.toContain("GIỮA");
    expect(excerpt.endsWith("KẾT")).toBe(true);
  });

  it("asks to search the web only when it can", () => {
    const base = { title: "T", channel: null, story: "s", partTexts: ["p1", "p2"], youtube: false };
    expect(kitPrompt({ ...base, webSearch: true })).toContain("Tìm trên web");
    expect(kitPrompt({ ...base, webSearch: false })).not.toContain("Tìm trên web");
    expect(kitPrompt({ ...base, webSearch: true })).toContain("đúng 2 câu");
  });

  it("builds TikTok posts from the title, hook and hashtags, and YouTube posts from the YouTube texts", () => {
    const kit: PublishKit = {
      by: "AI", niche: null, titles: ["Tên"], coverText: "", caption: "Mô tả", hashtags: ["#a", "#b"], partHooks: ["Nhử 1", ""],
      youtube: { title: "YT", description: "Dài", tags: ["t"] },
    };
    expect(postFor(kit, "tiktok", { index: 1, total: 2 })).toEqual({ title: null, description: "Tên | Phần 1/2\n\nNhử 1\n\n#a #b", tags: [] });
    expect(postFor(kit, "tiktok", { index: 2, total: 2 }).description).toBe("Tên | Phần 2/2\n\nMô tả\n\n#a #b");
    expect(postFor(kit, "youtube", null)).toEqual({ title: "YT", description: "Dài", tags: ["t"] });
  });
});
