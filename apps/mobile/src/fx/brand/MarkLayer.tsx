/* The Thread's shared state and its root layer (motion v2, K17). The Bioptime mark travels splash → sign-in tile → Home
   ring; this file holds the hand-off between those screens (re-exported by ./MarkHandoff, which the destinations use)
   and draws the mark while no screen does.
   - recordMarkHandoff(frame, target, source): the source's mark is at `frame` (page points) and `target` will take it.
     From the splash ('splash', the default) the splash keeps drawing its own mark until a destination takes it; it is
     on offer for motionValues.mark.cap (2.5 s) and then cancelled, the one window both ends share (M45). From the
     sign-in ('signin', the sign-in → Home replace) the MarkLayer below draws it at that frame above the navigator
     until Home's mark takes it, for motionValues.mark.fresh (1.5 s), then fades out over mark.layerFadeMs.
   - willTakeMark(target): a destination says from its first render that it will take the mark, so a record that comes
     after it mounted (Home mounted early under the splash, M46) still reaches it.
   - cancelMarkHandoff(): nothing will fly; a destination that waited, or comes late, enters with its column instead.
   - handoffTaken: 1 from the UI frame a destination draws the mark at the source's place (the source then hides its
     own in that frame); at tier C it rises 0 → 1 over the crossfade instead. markLayerShown: 1 while the layer draws.
   Kept apart from MarkHandoff so the splash can import it without a cycle (MarkHandoff reads the page-active flag,
   which reads the splash's state). */
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, makeMutable, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { markInFlight } from '@/fx/motion/gestureState';
import { Spinner } from '@/fx/motion/Spinner';
import { ease, motionValues, timing } from '@/fx/motion/tokens';
import { MarkPaths } from './MarkPaths';

export type HandoffTarget = 'signin' | 'home';
export type HandoffSource = 'splash' | 'signin';
export type HandoffFrame = { x: number; y: number; w: number; h: number };
export type Waiting = { frame: HandoffFrame; target: HandoffTarget; source: HandoffSource; at: number };

const mv = motionValues.mark;

let waiting: Waiting | null = null;
/** The splash is running towards this destination (it records the frame as its exit starts). */
let expected: HandoffTarget | null = null;
/** A hand-off that was cancelled: its destination's mark enters with its column (opacity and a small scale). */
let late: { target: HandoffTarget; at: number } | null = null;
const declared = new Set<HandoffTarget>();
let version = 0;
const listeners = new Set<() => void>();
function emit() { version++; listeners.forEach((l) => l()); }
export function subscribeMarkHandoff(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
const snapshot = () => version;

/** 1 once a destination draws the handed-off mark at the source's place (tier C: 0 → 1 over the crossfade). */
export const handoffTaken: SharedValue<number> = makeMutable(0);
/** 1 while the MarkLayer draws a handed-off mark (the sign-in's), else 0. */
export const markLayerShown: SharedValue<number> = makeMutable(0);

const freshFor = (w: Waiting) => (w.source === 'signin' ? mv.fresh : mv.cap);

/* A mark handed over to Home holds the data motion of Home's cards (gestureState.markInFlight) until it lands, the
   hand-off is cancelled, or (never stuck) its window has passed. */
let flightTimer: ReturnType<typeof setTimeout> | null = null;
function setInFlight(on: boolean, windowMs = 0) {
  if (flightTimer) { clearTimeout(flightTimer); flightTimer = null; }
  markInFlight.set(on ? 1 : 0);
  if (on) flightTimer = setTimeout(() => { flightTimer = null; markInFlight.set(0); }, windowMs);
}

/** The sting, as its black starts to fade over a Home a mark is about to fly into: Home's data motion is held from that
 *  frame (the flight itself is recorded a few frames later, once the mark has been measured), with the same window, so
 *  nothing that waited under the lockup starts in between; false lets it go (no flight after all). */
export function holdMarkFlight(on: boolean): void { setInFlight(on, mv.cap + mv.quietCapMs); }

/** The source calls this with its mark's page frame as it exits. */
export function recordMarkHandoff(frame: HandoffFrame, target: HandoffTarget, source: HandoffSource = 'splash'): void {
  setInFlight(target === 'home', (source === 'signin' ? mv.fresh : mv.cap) + mv.quietCapMs);
  cancelAnimation(handoffTaken);
  handoffTaken.set(0);
  cancelAnimation(markFlightP);
  markFlight.set(null);
  markFlightP.set(0);
  waiting = { frame, target, source, at: Date.now() };
  expected = null;
  late = null;
  emit();
}

/** The splash is on its way to `target` (or no longer, with null): an early destination waits for it. Internal. */
export function expectMarkHandoff(target: HandoffTarget | null): void {
  if (expected === target) return;
  expected = target;
  emit();
}

/** Whether a fresh hand-off waits for `target`, or the splash is heading there (without taking it). */
export function hasMarkHandoff(target: HandoffTarget): boolean {
  return !!peekMarkHandoff(target) || expected === target;
}

/** A destination declares from its first render that it will take the mark for `target`. */
export function willTakeMark(target: HandoffTarget): void {
  declared.add(target);
}

/** Whether a destination for `target` has declared itself since the last record. Internal. */
export function markDeclared(target: HandoffTarget): boolean {
  return declared.has(target);
}

/** Nothing will fly: the waiting hand-off (and the splash's expectation) is dropped; destinations enter with their column. */
export function cancelMarkHandoff(): void {
  setInFlight(false);
  const target = waiting?.target ?? expected;
  if (target) late = { target, at: Date.now() };
  waiting = null;
  expected = null;
  emit();
}

/** The hand-off waiting for `target`, without taking it (a render may run twice or be thrown away). Internal. */
export function peekMarkHandoff(target: HandoffTarget): Waiting | null {
  const w = waiting;
  return w && w.target === target && Date.now() - w.at <= freshFor(w) ? w : null;
}

/** Takes the hand-off for the mark that is about to fly; false when another mark took it or it was cancelled. Internal. */
export function claimMarkHandoff(w: Waiting): boolean {
  if (waiting !== w) return false;
  waiting = null;
  declared.clear();
  emit();
  return true;
}

/** Whether `target`'s hand-off was cancelled lately (its mark enters with its column). Internal. */
export function markLateFor(target: HandoffTarget): boolean {
  return !!late && late.target === target && Date.now() - late.at <= mv.cap;
}

/** The splash's expectation, for an early destination. Internal. */
export function expectedMarkTarget(): HandoffTarget | null {
  return expected;
}

/** Re-renders on every hand-off change. Internal. */
export function useMarkHandoffVersion(): number {
  return useSyncExternalStore(subscribeMarkHandoff, snapshot, snapshot);
}

/* ---------- the flight: the source's own mark flies ---------- */

/** Where the source's mark flies, in page points: from its centre to the destination's (dx, dy), the size ratio (s), and
 *  whether it arcs (x follows p^mark.arcPow). Set on the UI thread by the destination as the flight starts. */
export type FlightGeom = { dx: number; dy: number; s: number; arc: boolean };
type FlightTransform = ({ translateX: number } | { translateY: number } | { scale: number })[];
export const markFlight: SharedValue<FlightGeom | null> = makeMutable<FlightGeom | null>(null);
/** The flight's progress, 0 → 1 on spring.mark. */
export const markFlightP: SharedValue<number> = makeMutable(0);

/** The transform of a source mark in flight, or null when none flies (a worklet): pass markFlight.get() and
 *  markFlightP.get() read in the animated style itself, so the style runs again on every frame of the flight. The mark
 *  stays in its own top-level layer (the splash overlay, this layer), so no transform, clip or fade of the destination's
 *  screen (a tilted tile, a header entering) ever touches it; the destination draws its own mark in the frame it
 *  arrives. */
export function flightTransform(g: FlightGeom | null, p: number): FlightTransform | null {
  'worklet';
  if (!g) return null;
  const kx = g.arc ? Math.pow(Math.max(0, p), mv.arcPow) : p;
  return [{ translateX: g.dx * kx }, { translateY: g.dy * p }, { scale: 1 + (g.s - 1) * p }];
}

let flyingSources = 0;
/** The splash overlay draws its own mark until the hand-off lands, so it can fly it. Internal (SplashSting). */
export function registerFlyingSource(): () => void {
  flyingSources += 1;
  let on = true;
  return () => { if (on) { on = false; flyingSources -= 1; } };
}
/** Whether this hand-off's source flies its own mark (else the destination flies a copy of its own, as a fallback for
 *  a source that is a plain view). Internal (MarkHandoff). */
export function sourceFlies(w: Waiting): boolean {
  return w.source === 'signin' || (w.source === 'splash' && flyingSources > 0);
}

/* ---------- the destination's readiness, the landing, quiet frames ---------- */

const laidOut = new Map<HandoffTarget, number>();
/** A destination's mark has laid out (on) or unmounted (off). Internal (MarkHandoff). */
export function markLaidOut(target: HandoffTarget, on: boolean): void {
  const n = Math.max(0, (laidOut.get(target) ?? 0) + (on ? 1 : -1));
  if (n) laidOut.set(target, n); else laidOut.delete(target);
  emit();
}
/** Whether a destination's mark for `target` is mounted and laid out (its screen has drawn). Internal. */
export function isMarkLaidOut(target: HandoffTarget): boolean {
  return (laidOut.get(target) ?? 0) > 0;
}

const landed = new Set<() => void>();
/** Called once the handed-off mark is at home (the flight's or the crossfade's last frame, or shown in place). */
export function onMarkLanded(fn: () => void): () => void { landed.add(fn); return () => { landed.delete(fn); }; }
/** The destination's mark is home. Internal (MarkHandoff). */
export function notifyMarkLanded(): void { setInFlight(false); [...landed].forEach((fn) => fn()); }

/** A frame that comes at most this long after the one before is quiet: no long JS task or UI-thread mount (three
 *  display frames at 60 Hz): motionValues.mark.quietFrameMs. */
const QUIET_FRAME_MS = mv.quietFrameMs;
/** The longest a hand-off step waits for quiet frames before it goes on anyway: motionValues.mark.quietCapMs. */
export const QUIET_CAP_MS = mv.quietCapMs;

/** Calls `fn` once `frames` frames in a row have each come at most QUIET_FRAME_MS after the one before, or after
 *  `capMs`, whichever is first. Measured on the JS frame clock, which both a long JS task and a long mount on the UI
 *  thread delay (React Native delivers requestAnimationFrame from the UI thread's frame callback). Returns the cancel.
 *  The Thread waits on it so the mark never starts to move, and the splash never starts to fade, inside a stall. */
export function afterQuietFrames(frames: number, capMs: number, fn: () => void): () => void {
  let live = true;
  let raf = 0;
  let last = -1;
  let quiet = 0;
  const t0 = Date.now();
  const tick = () => {
    if (!live) return;
    const now = Date.now();
    if (last >= 0) quiet = now - last <= QUIET_FRAME_MS ? quiet + 1 : 0;
    last = now;
    if (quiet >= frames || now - t0 >= capMs) { live = false; fn(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { live = false; cancelAnimationFrame(raf); };
}

/* ---------- the layer ---------- */

/** Draws a handed-off mark from the sign-in above the navigator until Home's mark takes it (handoffTaken), or fades it
 *  after mark.fresh. While it waits longer than mark.loaderAfter (a slow network: Home's first answers on their way), the
 *  splash's ring loader fades in under it, so a still mark on black never reads as stuck (SB-5); it leaves with the
 *  hand-off (the mark's flight or crossfade) or the layer's fade. Mount once in the root layout, after the ToastHost. */
export function MarkLayer(): React.JSX.Element | null {
  useMarkHandoffVersion();
  const [, setGone] = useState(0);
  const keep = useRef<Waiting | null>(null); // drawn until the destination draws it (claiming clears `waiting` a frame earlier)
  const w = waiting && waiting.source === 'signin' ? waiting : null;
  if (w && keep.current !== w) keep.current = w;
  const drawn = keep.current;
  const out = useSharedValue(0);

  const clear = useCallback((which: Waiting | null) => {
    if (!which || keep.current !== which) return;
    keep.current = null;
    markLayerShown.set(0);
    setGone((n) => n + 1);
  }, []);
  const taken = useCallback(() => { const d = keep.current; if (d && waiting !== d) clear(d); }, [clear]);
  // the destination drew the mark at the layer's place (the layer is transparent from that frame): let it go
  useAnimatedReaction(() => handoffTaken.get() >= 1, (on, was) => { if (on && !was) scheduleOnRN(taken); });

  useEffect(() => {
    if (!drawn) return;
    cancelAnimation(out);
    out.set(0);
    markLayerShown.set(1);
    const timer = setTimeout(() => {
      if (handoffTaken.get() > 0) return;
      const gone = () => { if (waiting === drawn) cancelMarkHandoff(); clear(drawn); };
      out.set(withTiming(1, timing(mv.layerFadeMs, ease.css), (f) => { 'worklet'; if (f) scheduleOnRN(gone); }));
    }, Math.max(0, drawn.at + mv.fresh - Date.now()));
    return () => clearTimeout(timer);
  }, [drawn, out, clear]);

  // the loader cue: only after a wait (a fast answer never shows it)
  const cue = useSharedValue(0);
  const [cueOn, setCueOn] = useState(false);
  useEffect(() => {
    cancelAnimation(cue);
    cue.set(0);
    setCueOn(false);
    if (!drawn) return;
    const timer = setTimeout(() => {
      if (handoffTaken.get() > 0 || markFlightP.get() > 0) return;
      setCueOn(true);
      cue.set(withTiming(1, timing(mv.loaderFadeMs, ease.css)));
    }, Math.max(0, drawn.at + mv.loaderAfter - Date.now()));
    return () => clearTimeout(timer);
  }, [drawn, cue]);

  const style = useAnimatedStyle(() => {
    const opacity = (1 - Math.min(1, handoffTaken.get())) * (1 - out.get());
    const tf = flightTransform(markFlight.get(), markFlightP.get());
    return tf ? { opacity, transform: tf } : { opacity, transform: [] };
  });
  const cueStyle = useAnimatedStyle(() => ({
    opacity: cue.get() * (1 - Math.min(1, handoffTaken.get())) * (1 - Math.min(1, markFlightP.get())) * (1 - out.get()),
  }));
  if (!drawn) return null;
  const f = drawn.frame;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    {cueOn ? <Animated.View style={[styles.loader, { left: f.x + f.w / 2 - LOADER / 2, top: f.y + f.h + LOADER_GAP }, cueStyle]}>
      <Spinner variant="splash" size={LOADER} />
    </Animated.View> : null}
    <Animated.View style={[styles.mark, { left: f.x, top: f.y, width: f.w, height: f.h }, style]}>
      <MarkPaths width={f.w} />
    </Animated.View>
  </View>;
}

/** The loader's size (the splash's ring) and its gap under the mark (the splash's loader row). */
const LOADER = 48;
const LOADER_GAP = 24;

const styles = StyleSheet.create({
  mark: { position: 'absolute' },
  loader: { position: 'absolute', width: LOADER, height: LOADER },
});
