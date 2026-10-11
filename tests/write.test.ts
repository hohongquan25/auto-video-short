import { describe, expect, it } from "vitest";
import { charsForMinutes, parseOutline } from "../server/pipeline/write.js";

describe("parseOutline", () => {
  const json = '{"title":"Ngôi trường bên sông","characters":["Lan: cô giáo trẻ"],"chapters":[{"title":"Về làng","summary":"Lan nhận lớp."},{"title":"Tiếng đọc bài","summary":"Đêm đầu tiên."}]}';

  it("reads JSON wrapped in a code fence or a sentence", () => {
    const outline = parseOutline(`Đây là dàn ý:\n\`\`\`json\n${json}\n\`\`\``);
    expect(outline.title).toBe("Ngôi trường bên sông");
    expect(outline.chapters).toHaveLength(2);
  });

  it("defaults a missing character list and rejects an outline without chapters", () => {
    expect(parseOutline('{"title":"A","chapters":[{"title":"1","summary":"x"},{"title":"2","summary":"y"}]}').characters).toEqual([]);
    expect(() => parseOutline('{"title":"A","chapters":[]}')).toThrow();
    expect(() => parseOutline("Xin lỗi, tôi không thể")).toThrow();
  });
});

describe("charsForMinutes", () => {
  it("scales with the voice speed", () => {
    expect(charsForMinutes(10, "+0%")).toBe(8400);
    expect(charsForMinutes(10, "+50%")).toBe(12600);
  });
});
