import { describe, expect, it } from "vitest";
import { packParts } from "../server/lib/pack.js";

const total = (d: number[], idx: number[], gap: number) => idx.reduce((s, i) => s + d[i] + gap, 0);

describe("packParts", () => {
  it("keeps every part within [min, max] for a long story of ~1 min segments", () => {
    const durations = Array.from({ length: 60 }, (_, i) => 50 + (i % 7) * 5);
    const parts = packParts(durations, 0.4, 120, 300);
    expect(parts.flat()).toEqual(durations.map((_, i) => i));
    for (const p of parts) {
      const t = total(durations, p, 0.4);
      expect(t).toBeGreaterThanOrEqual(120);
      expect(t).toBeLessThanOrEqual(300);
    }
  });

  it("returns a single part when the whole narration is shorter than min", () => {
    expect(packParts([30, 40], 0.4, 120, 300)).toEqual([[0, 1]]);
  });

  it("merges a short tail into the previous part when it fits", () => {
    const parts = packParts([100, 100, 30], 0, 120, 300);
    expect(parts).toEqual([[0, 1, 2]]);
  });

  it("rebalances a short tail that cannot be merged", () => {
    const durations = [60, 60, 60, 60, 60, 30];
    const parts = packParts(durations, 0, 120, 300);
    expect(parts.flat()).toEqual([0, 1, 2, 3, 4, 5]);
    for (const p of parts) {
      const t = total(durations, p, 0);
      expect(t).toBeGreaterThanOrEqual(120);
      expect(t).toBeLessThanOrEqual(300);
    }
  });

  it("handles empty input", () => {
    expect(packParts([], 0.4, 120, 300)).toEqual([]);
  });
});
