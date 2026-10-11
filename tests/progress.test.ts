import { describe, expect, it } from "vitest";
import { creepProgress } from "../server/lib/progress.js";

describe("creepProgress", () => {
  it("moves linearly toward the target while the work is on schedule", () => {
    expect(creepProgress(0.2, 0.6, 0, 10)).toBeCloseTo(0.2);
    expect(creepProgress(0.2, 0.6, 5, 10)).toBeCloseTo(0.4);
  });

  it("keeps slowing past the estimate and never reaches the target", () => {
    const late = [10, 30, 300].map((t) => creepProgress(0, 1, t, 10));
    expect(late[0]).toBeLessThan(late[1]);
    expect(late[1]).toBeLessThan(late[2]);
    expect(late[2]).toBeLessThan(1);
  });

  it("stays put when the target is not ahead", () => {
    expect(creepProgress(0.5, 0.4, 100, 10)).toBe(0.5);
  });
});
