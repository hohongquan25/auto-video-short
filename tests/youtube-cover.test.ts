import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "../server/config.js";
import { readFontMetrics } from "../server/lib/font.js";
import { assTime } from "../server/lib/subtitles.js";
import { COVER_ACCENT, COVER_FONT, nameLayout, splitLines, youtubeCoverLines } from "../server/lib/youtube-cover.js";

const font = readFontMetrics(join(config.fontsDir, COVER_FONT.file));

describe("cover font", () => {
  it("measures Vietnamese capitals by their own glyphs, however they are typed", () => {
    expect(font.width("Ể", 100)).toBeCloseTo(font.width("E", 100));
    expect(font.width("Ể".normalize("NFD"), 100)).toBeCloseTo(font.width("Ể", 100));
    expect(font.width("ĐẠI", 100)).toBeCloseTo(font.width("Đ", 100) + font.width("Ạ", 100) + font.width("I", 100));
    expect(font.width("W", 100)).toBeGreaterThan(font.width("I", 100));
    expect(font.width("KIÊU NGẠO", 120)).toBeCloseTo(font.width("KIÊU NGẠO", 60) * 2);
    expect(font.capHeight(100)).toBeGreaterThan(30);
  });
});

describe("youtube cover name", () => {
  const box = { width: 1000, height: 760 };
  const maxCap = 160;

  it("splits words into lines whose widest is as narrow as can be", () => {
    const lines = splitLines(["A", "BB", "CCC", "DDDD"], 2, (s) => s.length);
    expect(lines).toEqual(["A BB", "CCC DDDD"]);
    expect(splitLines(["A", "BB", "CCC"], 3, (s) => s.length)).toEqual(["A", "BB", "CCC"]);
  });

  it("keeps the AI's lines while they hold the name's words", () => {
    const name = "Đại tiểu thư hào môn vả mặt thái tử gia kiêu ngạo";
    const given = ["Đại tiểu thư", "hào môn", "vả mặt", "thái tử gia", "kiêu ngạo"];
    expect(nameLayout(name, given, font, box, maxCap).lines).toEqual(["ĐẠI TIỂU THƯ", "HÀO MÔN", "VẢ MẶT", "THÁI TỬ GIA", "KIÊU NGẠO"]);
    // Renamed since: the lines no longer fit the name, so it is split here.
    const own = nameLayout("Lời khai của kẻ mù", given, font, box, maxCap).lines;
    expect(own.join(" ")).toBe("LỜI KHAI CỦA KẺ MÙ");
  });

  it("sets the name as big as fits, and leaves no short word alone on a line", () => {
    const layouts = ["Ba tiếng gõ cửa lúc nửa đêm", "Lời khai của kẻ mù", "Người đàn bà áo trắng ở bến đò"].map((name) => nameLayout(name, null, font, box, maxCap));
    for (const { fontSize, lines } of layouts) {
      expect(Math.max(...lines.map((l) => font.width(l, fontSize)))).toBeLessThanOrEqual(box.width + 0.01);
      expect(font.capHeight(fontSize)).toBeLessThanOrEqual(maxCap + 0.01);
      expect(lines.every((l) => l.includes(" ") || l.length > 3)).toBe(true);
    }
    expect(layouts[1].lines).toEqual(["LỜI KHAI", "CỦA KẺ MÙ"]);
    // A long word may stand alone.
    expect(layouts[2].lines).toEqual(["NGƯỜI", "ĐÀN BÀ", "ÁO TRẮNG", "Ở BẾN ĐÒ"]);
    // A one-word name is as big as the capitals may be.
    expect(font.capHeight(nameLayout("Ma", null, font, box, maxCap).fontSize)).toBeCloseTo(maxCap);
  });
});

describe("youtube cover", () => {
  const spec = { name: "Lời khai của kẻ mù", lines: ["Lời khai", "của kẻ mù"], label: "Truyện ma audio full", part: null, channel: "Gác trọ Audio", accent: COVER_ACCENT };

  it("sets the name in its font, the lines taking turns in pink and near-black", () => {
    const { style, events } = youtubeCoverLines(spec, 1920, 1080, font, assTime);
    expect(style).toContain(`Style: YtCover,${COVER_FONT.name},`);
    const line = (text: string) => events.find((e) => e.endsWith(`}${text}`))!;
    expect(line("LỜI KHAI")).toContain("\\1c&H631EE9&");
    expect(line("CỦA KẺ MÙ")).toContain("\\1c&H161616&");
  });

  it("has the genre line and the channel, and a pill only for a part", () => {
    const whole = youtubeCoverLines(spec, 1920, 1080, font, assTime).events.join("\n");
    expect(whole).toContain("}TRUYỆN MA AUDIO FULL");
    expect(whole).toContain("}GÁC TRỌ AUDIO");
    expect(whole).not.toContain("PHẦN");
    const part = youtubeCoverLines({ ...spec, part: "Phần 2", channel: null }, 1920, 1080, font, assTime).events.join("\n");
    expect(part).toContain("}PHẦN 2");
    expect(part).not.toContain("GÁC TRỌ");
  });
});
