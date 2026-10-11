/**
 * Group consecutive audio segments into parts whose total duration lies in
 * [minSec, maxSec]. Segments are never reordered or split. Returns arrays of
 * segment indices.
 *
 * When the narration is shorter than minSec, a single part is returned.
 * A single segment longer than maxSec becomes its own (oversized) part.
 */
export function packParts(durations: number[], gapSec: number, minSec: number, maxSec: number): number[][] {
  if (durations.length === 0) return [];
  const len = (idx: number[]) => idx.reduce((s, i) => s + durations[i] + gapSec, 0);
  const target = (minSec + maxSec) / 2;

  const parts: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < durations.length; i++) {
    const withNext = len(current) + durations[i] + gapSec;
    if (current.length > 0 && withNext > maxSec) {
      parts.push(current);
      current = [];
    }
    current.push(i);
    if (len(current) >= target) {
      parts.push(current);
      current = [];
    }
  }
  if (current.length > 0) parts.push(current);

  // Fix a too-short final part: merge it into the previous one if that fits,
  // otherwise rebalance the boundary between the last two parts.
  if (parts.length >= 2 && len(parts[parts.length - 1]) < minSec) {
    const last = parts.pop()!;
    const prev = parts.pop()!;
    const merged = [...prev, ...last];
    if (len(merged) <= maxSec) {
      parts.push(merged);
    } else {
      let best = prev.length;
      let bestScore = Infinity;
      for (let cut = 1; cut < merged.length; cut++) {
        const a = len(merged.slice(0, cut));
        const b = len(merged.slice(cut));
        const score = Math.abs(a - b) + (a > maxSec || b > maxSec ? 1e6 : 0) + (a < minSec || b < minSec ? 1e3 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = cut;
        }
      }
      parts.push(merged.slice(0, best), merged.slice(best));
    }
  }
  return parts;
}
