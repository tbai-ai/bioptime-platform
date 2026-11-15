/* Small worklet helpers for timelines driven by one clock (the splash sting, staggered rows): where a segment is at a
   time, and CSS-style keyframes where each interval has its own easing (as CSS applies a timing function per keyframe
   interval). Pure maths, safe on the UI thread and in Node. */

type Ease = (x: number) => number;

export function clamp01(x: number): number {
  'worklet';
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** Progress 0..1 of a segment that starts at `start` and lasts `duration`, at time `now` (all ms). */
export function seg(now: number, start: number, duration: number): number {
  'worklet';
  if (duration <= 0) return now >= start ? 1 : 0;
  return clamp01((now - start) / duration);
}

/** Linear mix. */
export function mix(from: number, to: number, p: number): number {
  'worklet';
  return from + (to - from) * p;
}

/** A value through keyframes at offsets 0..1 (`at` ascending, same length as `values`), each interval eased by `easing`. */
export function keyframes(p: number, at: readonly number[], values: readonly number[], easing?: Ease): number {
  'worklet';
  if (p <= at[0]) return values[0];
  for (let i = 1; i < at.length; i += 1) {
    if (p <= at[i]) {
      const local = (p - at[i - 1]) / (at[i] - at[i - 1]);
      return mix(values[i - 1], values[i], easing ? easing(local) : local);
    }
  }
  return values[values.length - 1];
}

/** A triangle 0 → 1 → 0 over p 0..1 (a sheen's opacity). */
export function hump(p: number): number {
  'worklet';
  return p <= 0 || p >= 1 ? 0 : 1 - Math.abs(2 * p - 1);
}
