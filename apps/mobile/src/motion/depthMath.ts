/* The pure maths of the 3D layer: where the brand mark's depth copies go, where a mote is, how a card leans while a list
   scrolls, and a screen's entrance pose. No React Native here (only the numbers in ./values.ts and the colours already
   in ../theme.ts), so the same functions run as worklets on the UI thread and in Node tests. Every pose is flat at rest:
   no shift, no turn, scale 1, full opacity, or null where the caller then draws no transform at all. */
import { colors } from '../theme';
import { motion } from './values';

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;

/* ---------- the brand mark's depth copies ---------- */

/** Where to put a copy `depth` points behind the mark's face when the mark is turned `rx` / `ry` degrees, seen through a
 *  camera `camera` points away. A point that far behind the face shows on screen shifted by depth·sin(angle) against the
 *  turn; the copies are drawn inside the turned mark, whose own foreshortening (cos(angle)) applies to them too, so they
 *  are moved depth·tan(angle) along it to land there, and shrink by camera / (camera + depth). Angles are held to ±60°.
 *  Flat (0, 0): no shift. */
export function layerOffset(depth: number, rx: number, ry: number, camera: number): { x: number; y: number; scale: number } {
  'worklet';
  const lim = (deg: number) => Math.max(-60, Math.min(60, deg)) * RAD;
  return { x: -depth * Math.tan(lim(ry)), y: depth * Math.tan(lim(rx)), scale: camera / (camera + depth) };
}

/** How far behind the face copy `index` (1 nearest .. layers) sits, for a mark `size` points wide. */
export function layerDepth(index: number, size: number): number {
  'worklet';
  return (motion.mark.base + index * motion.mark.gap) * size;
}

/** How strongly the copies show for a turn: 0 when flat, 1 from `motion.mark.revealDeg` (both axes, summed). */
export function revealAmount(rx: number, ry: number): number {
  'worklet';
  return Math.min(1, (Math.abs(rx) + Math.abs(ry)) / motion.mark.revealDeg);
}

/* ---------- the motes ---------- */

export type Mote = { x: number; y: number; size: number; color: string; ax: number; ay: number; kx: number; ky: number; kz: number; px: number; py: number; pz: number };

/** The app's own colours the motes use: white (twice as often), the muted grey-blue, the brand red. */
export const MOTE_PALETTE: readonly string[] = [colors.text, colors.text, colors.info, colors.brand];

/** The motes for a seed: the same seed gives the same field every time (a small deterministic generator, no Math.random).
 *  Positions are shares of the band (0..1); the drift frequencies are whole numbers, so a drift cycle ends where it began. */
export function makeMotes(count: number, seed: number): Mote[] {
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Array.from({ length: count }, () => ({
    x: 0.04 + rand() * 0.92,
    y: 0.08 + rand() * 0.84,
    size: 1.5 + rand() * 2.2,
    color: MOTE_PALETTE[Math.floor(rand() * MOTE_PALETTE.length)],
    ax: 6 + rand() * 12,
    ay: 3 + rand() * 6,
    kx: 1 + Math.floor(rand() * 2),
    ky: 1 + Math.floor(rand() * 2),
    kz: 1 + Math.floor(rand() * 2),
    px: rand(), py: rand(), pz: rand(),
  }));
}

/** Where a mote is at drift time `t` (in cycles) with the mark turned `rx` / `ry` degrees: its offset from its place, its
 *  depth (0 far .. 1 near), scale and opacity. Nearer motes are bigger and brighter and shift further with the turn. */
export function motePose(mote: Mote, t: number, rx: number, ry: number): { x: number; y: number; z: number; scale: number; opacity: number } {
  'worklet';
  const z = 0.5 + 0.5 * Math.sin(TAU * (mote.kz * t + mote.pz));
  const par = (z - 0.5) * 2 * motion.motes.parallax;
  return {
    x: mote.ax * Math.sin(TAU * (mote.kx * t + mote.px)) + par * Math.sin(ry * RAD),
    y: mote.ay * Math.sin(TAU * (mote.ky * t + mote.py)) - par * Math.sin(rx * RAD),
    z,
    scale: 0.55 + 0.9 * z,
    opacity: 0.12 + 0.43 * z,
  };
}

/* ---------- scroll depth on cards ---------- */

/** The lean for a scroll speed in points per millisecond (positive: the content moves up), -1..1. */
export function leanFor(velocity: number): number {
  'worklet';
  if (!Number.isFinite(velocity)) return 0;
  return Math.max(-1, Math.min(1, velocity / motion.scroll.velocityFull));
}

/** A card's pose for a lean and its place on screen (`centre`: its middle, in points from the top of the visible area;
 *  `viewport`: the visible height). Null when there is no lean: the card then rests with no transform, wherever it is. */
export function cardPose(lean: number, centre: number, viewport: number): { translateY: number; rotateX: number; scale: number } | null {
  'worklet';
  const a = Math.abs(lean);
  if (a < 0.001 || viewport <= 0) return null;
  const p = Math.max(-1, Math.min(1, (centre / viewport - 0.5) * 2)); // -1 top of the screen .. 1 bottom
  return {
    translateY: lean * motion.scroll.shift * (0.4 + 0.3 * (p + 1)), // trails the scroll; lower cards trail more
    rotateX: -p * a * motion.scroll.tilt, // a shallow drum: the top card tips back at the top, the bottom one at the bottom
    scale: 1 - a * motion.scroll.scale * Math.abs(p),
  };
}

/* ---------- screen entrance ---------- */

/** The entrance's pose at progress `v` (0 just mounted .. 1 at rest). */
export function screenPose(v: number): { opacity: number; translateX: number; rotateY: number; scale: number } {
  'worklet';
  const k = 1 - v;
  return { opacity: Math.min(1, v * 1.4), translateX: k * motion.screen.shiftFrom, rotateY: k * motion.screen.rotateYFrom, scale: motion.screen.scaleFrom + (1 - motion.screen.scaleFrom) * v };
}
