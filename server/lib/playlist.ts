/** A library video as the playlist sees it. */
export interface Clip {
  id: string;
  /** Length of the file itself. */
  durationSec: number;
  /** Playback speed; a clip lasts durationSec / speed in the video. */
  speed: number;
}

/** A stretch of one clip, in the clip's own seconds (before its speed is applied). */
export interface Shot<C extends Clip = Clip> {
  clip: C;
  startSec: number;
  lengthSec: number;
}

/** Leftovers shorter than this (in video seconds) are skipped rather than shown as a flash. */
const MIN_SHOT_SEC = 3;

/** Deterministic 0..1 generator, so a resumed render picks the same clips again. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hands out background footage in a shuffled order. Each `take` carries on
 * where the previous one stopped, so consecutive parts show different
 * footage; only once every clip has been used is the list reshuffled and
 * played again.
 */
export class Playlist<C extends Clip> {
  private readonly random: () => number;
  private order: C[] = [];
  private index = 0;
  private offsetSec = 0;
  private readonly minShotSec: number;
  /** How many times the whole list has been played through and started over. */
  repeats = 0;

  constructor(private readonly clips: C[], seed: string) {
    if (clips.length === 0) throw new Error("Playlist needs at least one clip");
    this.random = seededRandom(seed);
    // A library of only very short clips still has to fill the time.
    this.minShotSec = Math.min(MIN_SHOT_SEC, Math.max(...clips.map((c) => c.durationSec / c.speed)));
    this.order = this.shuffle(null);
  }

  /** The clip the next take starts with. */
  get first(): C {
    return this.order[this.index];
  }

  /** Shots that together last `sec` seconds of video. */
  take(sec: number): Shot<C>[] {
    const shots: Shot<C>[] = [];
    let left = sec;
    while (left > 1e-6) {
      const clip = this.order[this.index];
      const remaining = (clip.durationSec - this.offsetSec) / clip.speed;
      if (remaining < Math.min(this.minShotSec, left)) {
        this.advance();
        continue;
      }
      const use = Math.min(left, remaining);
      shots.push({ clip, startSec: this.offsetSec, lengthSec: use * clip.speed });
      this.offsetSec += use * clip.speed;
      left -= use;
    }
    return shots;
  }

  private advance(): void {
    this.offsetSec = 0;
    if (++this.index < this.order.length) return;
    this.repeats++;
    this.order = this.shuffle(this.order[this.order.length - 1]);
    this.index = 0;
  }

  /** A fresh order that does not start with `last`, so a clip never plays twice in a row. */
  private shuffle(last: C | null): C[] {
    const out = [...this.clips];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (last && out.length > 1 && out[0] === last) [out[0], out[1]] = [out[1], out[0]];
    return out;
  }
}
