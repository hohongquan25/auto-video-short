import { describe, expect, it } from "vitest";
import { formatPlan } from "../server/types.js";

describe("formatPlan", () => {
  it("renders the chosen formats in a fixed order", () => {
    expect(formatPlan(["original", "tiktok"]).map((p) => p.format)).toEqual(["tiktok", "original"]);
  });

  it("gives YouTube one long video only when TikTok is chosen too", () => {
    expect(formatPlan(["youtube", "tiktok"])).toEqual([
      { format: "tiktok", whole: false },
      { format: "youtube", whole: true },
    ]);
    expect(formatPlan(["youtube"])).toEqual([{ format: "youtube", whole: false }]);
    expect(formatPlan(["youtube", "original"]).every((p) => !p.whole)).toBe(true);
  });
});
