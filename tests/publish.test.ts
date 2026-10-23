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
    expect(kit.storyName).toBeNull();
  });

  it("keeps the short name the AI gave the story", () => {
    const reply = '{"titles":["A"],"storyName":" Ba tiếng gõ cửa ","coverText":"B","caption":"C","hashtags":["x"]}';
    expect(parseKit(reply, "AI", 0, false).storyName).toBe("Ba tiếng gõ cửa");
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

  it("asks for the five hashtags TikTok takes, without generic ones, and a short name for TikTok", () => {
    const prompt = kitPrompt({ title: "T", channel: null, story: "s", partTexts: ["p1"], youtube: true, webSearch: false });
    expect(prompt).toContain("đúng năm hashtag");
    expect(prompt).toContain("Không dùng hashtag chung chung như #fyp, #xuhuong");
    expect(prompt).not.toContain("mười đến mười ba hashtag");
    expect(prompt).toContain("dùng làm tên video khi đăng TikTok");
  });
});

describe("post texts", () => {
  const kit: PublishKit = {
    by: "AI", niche: null, titles: ["Ba tiếng gõ cửa lúc nửa đêm: ai đứng ngoài hiên?"], storyName: "Ba tiếng gõ cửa",
    coverText: "", caption: "Mô tả", hashtags: ["#a", "#b", "#c", "#d", "#e", "#f", "#g"], partHooks: ["Nhử 1", "Nhử 2"],
    youtube: { title: "YT", description: "Dài", tags: ["t"] },
  };

  it("names a TikTok part by the story's short name and its part, then at most five hashtags", () => {
    expect(postFor(kit, "tiktok", { index: 1, total: 2 })).toEqual({ title: null, description: "Ba tiếng gõ cửa | Phần 1/2\n\n#a #b #c #d #e", tags: [] });
    expect(postFor(kit, "original", { index: 2, total: 2 })).toEqual({ title: null, description: "Ba tiếng gõ cửa | Phần 2/2\n\n#a #b #c #d #e", tags: [] });
  });

  it("leaves the part hook and the description out of TikTok posts", () => {
    for (const part of [{ index: 1, total: 2 }, { index: 2, total: 2 }, null]) {
      const { description } = postFor(kit, "tiktok", part);
      expect(description).not.toContain("Nhử");
      expect(description).not.toContain("Mô tả");
    }
  });

  it("marks the whole story as trọn bộ", () => {
    expect(postFor(kit, "tiktok", null).description).toBe("Ba tiếng gõ cửa (trọn bộ)\n\n#a #b #c #d #e");
  });

  it("is only the name when there are no hashtags", () => {
    expect(postFor({ ...kit, hashtags: [] }, "tiktok", null)).toEqual({ title: null, description: "Ba tiếng gõ cửa (trọn bộ)", tags: [] });
  });

  it("takes the name from the best title when the kit has no short name", () => {
    expect(postFor({ ...kit, storyName: null }, "tiktok", { index: 1, total: 2 }).description).toBe("Ba tiếng gõ cửa lúc nửa đêm | Phần 1/2\n\n#a #b #c #d #e");
    // Kits written before the short name was asked for have none at all.
    expect(postFor({ ...kit, storyName: undefined }, "tiktok", null).description).toBe("Ba tiếng gõ cửa lúc nửa đêm (trọn bộ)\n\n#a #b #c #d #e");
    // A title that is all noise stays as it is.
    expect(postFor({ ...kit, storyName: null, titles: ["[FULL]"], hashtags: [] }, "tiktok", null).description).toBe("[FULL] (trọn bộ)");
  });

  it("keeps the YouTube texts as they are", () => {
    expect(postFor(kit, "youtube", null)).toEqual({ title: "YT", description: "Dài", tags: ["t"] });
    expect(postFor(kit, "youtube", { index: 2, total: 3 })).toEqual({ title: "YT | Phần 2/3", description: "Dài", tags: ["t"] });
  });

  it("gives a YouTube video without the AI's YouTube texts a full description", () => {
    const plain = { ...kit, youtube: null };
    expect(postFor(plain, "youtube", null).description).toBe("Ba tiếng gõ cửa lúc nửa đêm: ai đứng ngoài hiên? (trọn bộ)\n\nMô tả\n\n#a #b #c #d #e #f #g");
    expect(postFor(plain, "youtube", { index: 2, total: 2 }).description).toBe("Ba tiếng gõ cửa lúc nửa đêm: ai đứng ngoài hiên? | Phần 2/2\n\nNhử 2\n\n#a #b #c #d #e #f #g");
  });
});
