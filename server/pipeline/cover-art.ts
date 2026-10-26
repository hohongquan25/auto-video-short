import { GoogleGenAI, Modality } from "@google/genai";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { storyNameOf, type PublishKit } from "../types.js";

/**
 * The picture on the left of a YouTube cover, drawn by Gemini from the
 * AI's description of the story's main character. Kept in the job's folder,
 * so redrawing the covers reuses it until it is removed.
 */

/** However the story looks, so the picture melts into the white page of the cover. */
const STYLE = "Photorealistic cinematic portrait photograph, upper body, the subject centred and facing the camera, soft studio light, " +
  "plain seamless pure white background, sharp focus, rich detail. No text, letters, captions, logos, watermarks or frames.";

const FILES = ["cover-art.png", "cover-art.jpg"];

/** The picture already drawn for the job in `dir`, if any. */
export const findCoverArt = (dir: string): string | null => FILES.map((f) => join(dir, f)).find((f) => existsSync(f)) ?? null;

export const removeCoverArt = (dir: string): void => {
  for (const f of FILES) rmSync(join(dir, f), { force: true });
};

/** What Gemini is asked to draw: the AI's description, or for a kit without one, the story's name and premise. */
export function coverArtPrompt(kit: PublishKit): string {
  const who = kit.coverImage?.trim() ||
    `The main character of the Vietnamese audio story "${storyNameOf(kit)}"${kit.niche ? ` (${kit.niche.genre})` : ""}: ${kit.caption}`;
  return `${who}\n\n${STYLE}`;
}

/** Nano Banana 2.1, then 2 and 2 Lite: the cheapest of Gemini's image models (about 0.034 USD a 1K picture) first. */
const MODELS = ["gemini-nano-banana-2.1", "gemini-3.1-flash-image", "gemini-3.1-flash-lite-image"];

/** Gemini's errors in a few words, with what to do when the key cannot draw at all. */
function explain(err: unknown, model: string): Error {
  const text = err instanceof Error ? err.message : String(err);
  if (/limit:\s*0|free.?tier/i.test(text)) {
    return new Error("khoá Gemini chưa bật thanh toán nên không tạo được ảnh (gói miễn phí không có), hãy dùng khoá của dự án có tín dụng Google AI Pro");
  }
  if (/API key not valid|API_KEY_INVALID/i.test(text)) return new Error("GEMINI_IMAGE_API_KEY không đúng");
  if (unknownModel(err)) return new Error(`Google không có model "${model}", sửa GEMINI_IMAGE_MODEL`);
  return err instanceof Error ? err : new Error(text);
}

const unknownModel = (err: unknown) => /\b404\b|NOT_FOUND|is not found|not supported for generateContent/i.test(String(err));

/** A passing fault on Google's side, worth one more try. */
const passing = (err: unknown) => /\b(500|502|503|504)\b|UNAVAILABLE|INTERNAL|overloaded|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(err));

/**
 * Draw the picture for `kit` into `dir`; returns its file and the model
 * that drew it. Throws when there is no key or Gemini draws nothing.
 */
export async function drawCoverArt(kit: PublishKit, dir: string, signal: AbortSignal): Promise<{ file: string; model: string }> {
  if (!config.geminiImageApiKey) throw new Error("chưa có GEMINI_IMAGE_API_KEY (xem .env.example)");
  const ai = new GoogleGenAI({ apiKey: config.geminiImageApiKey });
  const models = config.geminiImageModel ? [config.geminiImageModel] : MODELS;
  for (const [i, model] of models.entries()) {
    try {
      return { file: await drawWith(ai, model, kit, dir, signal), model };
    } catch (err) {
      if (signal.aborted || i === models.length - 1 || !unknownModel(err)) throw explain(err, model);
    }
  }
  throw new Error("unreachable");
}

async function drawWith(ai: GoogleGenAI, model: string, kit: PublishKit, dir: string, signal: AbortSignal): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: coverArtPrompt(kit),
        // Text too, so a refusal comes with its reason.
        config: { responseModalities: [Modality.TEXT, Modality.IMAGE], imageConfig: { aspectRatio: "3:4", imageSize: "1K" }, abortSignal: signal },
      });
      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const image = parts.find((p) => p.inlineData?.data)?.inlineData;
      if (!image?.data) {
        const why = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason;
        const said = parts.map((p) => p.text ?? "").join(" ").trim().slice(0, 200);
        throw new Error(`Gemini không vẽ ảnh${why ? ` (${why})` : ""}${said ? `: ${said}` : ", có thể do bộ lọc nội dung"}`);
      }
      removeCoverArt(dir);
      const file = join(dir, image.mimeType === "image/jpeg" ? FILES[1] : FILES[0]);
      writeFileSync(file, Buffer.from(image.data, "base64"));
      return file;
    } catch (err) {
      if (signal.aborted || attempt >= 2 || !passing(err)) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
