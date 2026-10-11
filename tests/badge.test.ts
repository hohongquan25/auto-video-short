import { describe, expect, it } from "vitest";
import { assColor, textWidth } from "../server/lib/badge.js";

describe("textWidth", () => {
  it("measures Vietnamese letters like their base letters", () => {
    expect(textWidth("Gác trọ Audio", 100)).toBeCloseTo(textWidth("Gac tro Audio", 100));
    expect(textWidth("đ", 100)).toBeCloseTo(textWidth("d", 100));
  });

  it("is wider for wide letters", () => {
    expect(textWidth("mmm", 100)).toBeGreaterThan(textWidth("iii", 100));
  });
});

describe("assColor", () => {
  it("turns #RRGGBB into ASS blue-green-red order", () => {
    expect(assColor("#FFB020")).toBe("&H20B0FF&");
  });
});
