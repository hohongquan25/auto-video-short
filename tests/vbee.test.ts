import { describe, expect, it } from "vitest";
import { vbeeSpeed } from "../server/lib/vbee.js";

describe("vbeeSpeed", () => {
  it("maps the UI rate percentage to Vbee's speed multiplier", () => {
    expect(vbeeSpeed("+0%")).toBe(1);
    expect(vbeeSpeed("+10%")).toBe(1.1);
    expect(vbeeSpeed("-30%")).toBe(0.7);
  });

  it("clamps to the range Vbee accepts", () => {
    expect(vbeeSpeed("+150%")).toBe(1.9);
    expect(vbeeSpeed("-90%")).toBe(0.25);
  });
});
