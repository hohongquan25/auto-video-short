import { describe, expect, it } from "vitest";
import { olvrocTempo } from "../server/lib/olvroc.js";
import { voiceProvider } from "../server/types.js";

describe("olvrocTempo", () => {
  it("maps the UI rate percentage to an atempo factor", () => {
    expect(olvrocTempo("+0%")).toBe(1);
    expect(olvrocTempo("+10%")).toBe(1.1);
    expect(olvrocTempo("-30%")).toBe(0.7);
  });

  it("clamps to the 0.5–2 range of a single atempo filter", () => {
    expect(olvrocTempo("+150%")).toBe(2);
    expect(olvrocTempo("-90%")).toBe(0.5);
  });
});

describe("voiceProvider", () => {
  it("tells the providers apart by id", () => {
    expect(voiceProvider("vi-VN-HoaiMyNeural")).toBe("edge");
    expect(voiceProvider("olvroc:Hải Đăng")).toBe("olvroc");
  });
});
