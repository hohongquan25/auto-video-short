/**
 * Where the progress bar should be `elapsedSec` into a wait expected to take
 * `etaSec`: linear up to 90% of the way to `target`, then slowing down so a
 * piece of work that runs late never reaches or passes `target`.
 */
export function creepProgress(from: number, target: number, elapsedSec: number, etaSec: number): number {
  if (target <= from) return from;
  const f = etaSec > 0 ? elapsedSec / etaSec : 1;
  const share = f <= 0.9 ? f : 0.9 + 0.09 * (1 - Math.exp(-(f - 0.9) * 3));
  return from + (target - from) * Math.max(0, share);
}
