import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../server/config.js";
import { drawCoverArt, findCoverArt } from "../server/pipeline/cover-art.js";
import type { PublishKit } from "../server/types.js";

const gemini = vi.hoisted(() => ({ calls: [] as string[], answer: (_model: string): unknown => null }));
vi.mock("@google/genai", () => ({
  Modality: { TEXT: "TEXT", IMAGE: "IMAGE" },
  GoogleGenAI: class {
    models = {
      generateContent: async ({ model }: { model: string }) => {
        gemini.calls.push(model);
        return gemini.answer(model);
      },
    };
  },
}));

const kit: PublishKit = {
  by: "AI", niche: null, titles: ["T"], storyName: "Lời khai của kẻ mù", coverText: "", caption: "C", hashtags: [], partHooks: [], youtube: null,
  coverImage: "A blind old man",
};
const picture = (mimeType: string, data: string) => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: Buffer.from(data).toString("base64") } }] } }] });
const signal = new AbortController().signal;

describe("cover picture", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cover-art-"));
    gemini.calls = [];
    Object.assign(config, { geminiImageApiKey: "key", geminiImageModel: undefined });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("tries the next model while Google does not know the name, and keeps the picture by its type", async () => {
    gemini.answer = (model) => {
      if (model === "gemini-nano-banana-2.1") throw new Error('{"error":{"code":404,"message":"models/gemini-nano-banana-2.1 is not found","status":"NOT_FOUND"}}');
      return picture("image/jpeg", "jpg bytes");
    };
    const { file, model } = await drawCoverArt(kit, dir, signal);
    expect(gemini.calls).toEqual(["gemini-nano-banana-2.1", "gemini-3.1-flash-image"]);
    expect(model).toBe("gemini-3.1-flash-image");
    expect(file.endsWith("cover-art.jpg")).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("jpg bytes");
    expect(findCoverArt(dir)).toBe(file);
    // A new picture replaces the old, whatever its type.
    gemini.answer = () => picture("image/png", "png bytes");
    const again = await drawCoverArt(kit, dir, signal);
    expect(findCoverArt(dir)).toBe(again.file);
    expect(again.file.endsWith("cover-art.png")).toBe(true);
  });

  it("says what to do when the key's project pays for nothing, without trying other models", async () => {
    gemini.answer = () => {
      throw new Error("429 RESOURCE_EXHAUSTED: Quota exceeded for metric: generate_content_free_tier_requests, limit: 0");
    };
    await expect(drawCoverArt(kit, dir, signal)).rejects.toThrow(/chưa bật thanh toán/);
    expect(gemini.calls).toHaveLength(1);
  });

  it("gives Gemini's reason when it draws nothing, and needs a key", async () => {
    gemini.answer = () => ({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [{ text: "I can't draw that." }] } }] });
    await expect(drawCoverArt(kit, dir, signal)).rejects.toThrow(/IMAGE_SAFETY.*I can't draw that/);
    Object.assign(config, { geminiImageApiKey: undefined });
    await expect(drawCoverArt(kit, dir, signal)).rejects.toThrow(/GEMINI_IMAGE_API_KEY/);
    expect(findCoverArt(dir)).toBeNull();
  });
});
