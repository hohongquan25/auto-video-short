/** Split text into sentences, keeping the terminal punctuation. */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const parts = normalized.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) ?? [normalized];
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** Split a sentence that alone exceeds maxChars at commas, then at spaces. */
function splitLongSentence(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];
  const out: string[] = [];
  let current = "";
  const pieces = sentence.split(/(?<=[,;:])\s+|\s+/);
  for (const piece of pieces) {
    const next = current ? `${current} ${piece}` : piece;
    if (next.length > maxChars && current) {
      out.push(current);
      current = piece;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Group text into chunks of at most maxChars, breaking only between sentences
 * (or inside a sentence that is itself longer than maxChars). Paragraph breaks
 * in the input are treated as preferred split points.
 */
export function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const paragraph of text.split(/\n\s*\n/)) {
    for (const sentence of splitSentences(paragraph)) {
      for (const piece of splitLongSentence(sentence, maxChars)) {
        const next = current ? `${current} ${piece}` : piece;
        if (next.length > maxChars) {
          flush();
          current = piece;
        } else {
          current = next;
        }
      }
    }
    if (current.length > maxChars * 0.6) flush();
  }
  flush();
  return chunks;
}
