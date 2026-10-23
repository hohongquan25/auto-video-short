import { describe, expect, it } from "vitest";
import { Playlist, type Clip } from "../server/lib/playlist.js";

const clip = (id: string, durationSec: number, speed = 1): Clip => ({ id, durationSec, speed });
const videoSec = (shots: { clip: Clip; lengthSec: number }[]) => shots.reduce((s, x) => s + x.lengthSec / x.clip.speed, 0);
const ids = (shots: { clip: Clip }[]) => shots.map((s) => s.clip.id);

describe("Playlist", () => {
  it("fills the time asked for, across clips", () => {
    const p = new Playlist([clip("a", 60), clip("b", 90), clip("c", 30)], "seed");
    const shots = p.take(150);
    expect(videoSec(shots)).toBeCloseTo(150);
    expect(new Set(ids(shots)).size).toBe(shots.length);
  });

  it("uses every clip once before repeating any", () => {
    const clips = ["a", "b", "c", "d"].map((id) => clip(id, 40));
    const p = new Playlist(clips, "x");
    const first = [...p.take(40), ...p.take(40), ...p.take(40), ...p.take(40)];
    expect(new Set(ids(first)).size).toBe(4);
    expect(p.repeats).toBe(0);
    p.take(40);
    expect(p.repeats).toBe(1);
  });

  it("carries on inside a long clip instead of starting it over", () => {
    const p = new Playlist([clip("long", 1000)], "s");
    const [one] = p.take(100);
    const [two] = p.take(100);
    expect(one.startSec).toBe(0);
    expect(two.startSec).toBeCloseTo(100);
  });

  it("measures time after the clip's speed", () => {
    const p = new Playlist([clip("fast", 100, 2)], "s");
    const [shot] = p.take(30);
    expect(shot.lengthSec).toBeCloseTo(60);
    // 100 s at 2x lasts 50 s, so 60 s needs the clip twice.
    const more = p.take(60);
    expect(videoSec(more)).toBeCloseTo(60);
    expect(p.repeats).toBe(1);
  });

  it("never plays the same clip twice in a row across a reshuffle", () => {
    const p = new Playlist([clip("a", 10), clip("b", 10)], "loop");
    const order = ids(p.take(200));
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
  });

  it("skips a leftover too short to show", () => {
    const p = new Playlist([clip("a", 61), clip("b", 61)], "s");
    p.take(60);
    // 1 s of the first clip is left: the next part starts on the other clip instead.
    const [next] = p.take(30);
    expect(next.startSec).toBe(0);
  });

  it("picks the same footage again for the same seed", () => {
    const clips = ["a", "b", "c", "d", "e"].map((id) => clip(id, 20));
    const run = (seed: string) => ids(new Playlist(clips, seed).take(300));
    expect(run("job1:tiktok")).toEqual(run("job1:tiktok"));
  });

  it("still fills the time with clips shorter than a normal shot", () => {
    const p = new Playlist([clip("tiny", 1)], "s");
    expect(videoSec(p.take(10))).toBeCloseTo(10);
  });
});
