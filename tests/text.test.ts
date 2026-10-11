import { describe, expect, it } from "vitest";
import { chunkText, splitSentences } from "../server/lib/text.js";

describe("splitSentences", () => {
  it("splits on Vietnamese sentence punctuation and keeps it", () => {
    expect(splitSentences("Trời tối. Anh ấy đi đâu? Không ai biết!")).toEqual([
      "Trời tối.",
      "Anh ấy đi đâu?",
      "Không ai biết!",
    ]);
  });

  it("keeps trailing text without punctuation", () => {
    expect(splitSentences("Câu một. câu hai không có dấu")).toEqual(["Câu một.", "câu hai không có dấu"]);
  });
});

describe("chunkText", () => {
  it("never exceeds maxChars and preserves all words", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Đây là câu số ${i} trong câu chuyện dài.`).join(" ");
    const chunks = chunkText(text, 200);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
    expect(chunks.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it("splits a single overlong sentence", () => {
    const sentence = `${"chữ ".repeat(120).trim()}.`;
    const chunks = chunkText(sentence, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });
});
