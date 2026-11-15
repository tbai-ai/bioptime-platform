/* The press feel shared by every pressable in the kit: the earlier app's scale ladder (large cards .98, CTAs and option rows
   .97, grid tiles .96, chips .94, send .93, icon buttons and steppers .90), in 90 ms on the expo curve and back with
   the release spring. Press answers on the frame the finger lands (PRESS_PROPS on the web: no press delay); cards and
   rows inside scrollers wait motionValues.press.scrollDelay instead (SCROLL_PRESS_PROPS), so a scroll that starts on
   them never flashes the pressed state. usePress returns its progress (0 at rest … 1 pressed, on the UI thread): the
   pressed colours, borders and glow layers are interpolated from it in the same animated style as the scale, never
   from React state. Reduced motion keeps the press colour changes (a short linear fade that plays) and drops the
   scale. useStateMix is the same idea for a selected or focused state: a 0…1 mix that glides over t.stateMix. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { ease, motionValues, spring, t, timing, useFx } from './effects';
import { calmFade } from './motion/tokens';

export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The touch reach above and below a control `h` tall, so it measures motionValues.touch.min (44 pt; 48 dp on Android)
 *  to the finger: native passes it as hitSlop; the web pads by it with a matching negative margin (the row keeps its
 *  height). 0 for a control already that tall. */
export function touchSlopY(h: number): number {
  const min = Platform.OS === 'android' ? motionValues.touch.minAndroid : motionValues.touch.min;
  return Math.max(0, Math.ceil((min - h) / 2));
}

/** Spread on every standalone pressable: the web answers on the touch-down frame instead of after RN-web's 50 ms press
 *  delay (native already answers at once). */
export const PRESS_PROPS: { delayPressIn?: number; unstable_pressDelay?: number } = Platform.OS === 'web' ? { delayPressIn: 0, unstable_pressDelay: 0 } : {};

/** Cards and rows inside scrollers: press-in waits motionValues.press.scrollDelay (the web: scrollDelayWeb, since the
 *  browser cancels a touch that turns into a scroll within a frame or two), so a scroll that starts on them takes the
 *  touch before any pressed frame is drawn, and a tap still shows its press within 100 ms (both platforms). */
export const SCROLL_PRESS_PROPS: { delayPressIn?: number; unstable_pressDelay?: number } = Platform.OS === 'web'
  ? { delayPressIn: motionValues.press.scrollDelayWeb, unstable_pressDelay: motionValues.press.scrollDelayWeb }
  : { unstable_pressDelay: motionValues.press.scrollDelay };

/** The web, for a card or row inside a scroller whose press comes from usePress(…, { scroll: true }): the press answers on
 *  the touch itself (no press delay) and usePress holds its pressed frame scrollDelayWeb on the animation clock instead.
 *  RN-web's press delay is a timer, and Chrome holds timers back for about 100 ms after a touchstart, so the 40 ms delay
 *  drew the first pressed frame 103-131 ms after the touch (release T4-16; Home's tiles, which answer on the touch, took
 *  12 ms). A scroll that starts meanwhile ends the press before anything is drawn, as the delay did. Native: as
 *  SCROLL_PRESS_PROPS. */
const SCROLL_PRESS_NOW: { delayPressIn?: number; unstable_pressDelay?: number } = Platform.OS === 'web' ? PRESS_PROPS : SCROLL_PRESS_PROPS;

/** A 0…1 state mix (off → on) for colour crossfades: feed it to interpolateColor for fills, borders and text.
 *  Glides over `ms` on ease.css; under reduced motion it is a short linear crossfade that still plays. */
export function useStateMix(on: boolean, ms: number = t.stateMix): SharedValue<number> {
  const { calm } = useFx();
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.set(withTiming(on ? 1 : 0, calm ? calmFade() : timing(ms, ease.css)));
  }, [on, ms, calm, v]);
  return v;
}

export const PRESS = { card: 0.98, cta: 0.97, tile: 0.96, chip: 0.94, send: 0.93, icon: 0.9 } as const;
export type PressKind = keyof typeof PRESS;

/** The press transform for a progress `p` (0 rest … 1 pressed) towards scale `to`, sinking `sink` points. A worklet:
 *  components that animate their own pressed colours call it inside their useAnimatedStyle. */
export function pressTransform(p: number, to: number, sink: number, calm: boolean) {
  'worklet';
  if (calm || p === 0) return [];
  const s = 1 - (1 - to) * p;
  return sink ? [{ translateY: sink * Math.max(0, Math.min(1, p)) }, { scale: s }] : [{ scale: s }];
}

/** Work a press starts that its first pressed frame need not wait for (a prefetch, a picture warm-up): on the web it
 *  runs once that frame has been painted (a frame, then a task), since the one thread would otherwise draw the press
 *  only after it; elsewhere at once (the UI thread draws the press on its own). */
export function afterPaint(fn: () => void): void {
  if (Platform.OS !== 'web') { fn(); return; }
  requestAnimationFrame(() => setTimeout(fn, 0));
}

/** The web: `set` runs once the next frame has been painted (a frame, then a task), with the latest value given
 *  meanwhile; elsewhere it runs at once. */
function useAfterPaint(set: (v: boolean) => void): (v: boolean) => void {
  const latest = useRef(false);
  const queued = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return useCallback((v: boolean) => {
    if (Platform.OS !== 'web') { set(v); return; }
    latest.current = v;
    if (queued.current) return;
    queued.current = true;
    requestAnimationFrame(() => setTimeout(() => { queued.current = false; if (alive.current) set(latest.current); }, 0));
  }, [set]);
}

/** How a press is used. `scroll`: a card or row inside a scroller; spread the returned `scrollProps` on its Pressable
 *  (instead of SCROLL_PRESS_PROPS), so a scroll that starts on it never flashes the pressed state and a tap shows it within
 *  100 ms on every platform (on the web the hold is on the animation clock, not a timer: SCROLL_PRESS_NOW). */
export type PressOptions = { scroll?: boolean };

/** The web's hold before a scroller's card shows its press (a number the press worklets capture). */
const WEB_SCROLL_HOLD = Platform.OS === 'web' ? motionValues.press.scrollDelayWeb : 0;

/** An easing that stays at 0 for the first `k` of the run, then plays `inner` over the rest: the press's hold and its
 *  90 ms in one timing, so the pressed frame is not a frame later still (a delay and a timing each start on a frame of
 *  their own). A worklet. */
function heldEasing(k: number, inner: (x: number) => number): (x: number) => number {
  'worklet';
  return (x: number) => {
    'worklet';
    return x <= k ? 0 : inner((x - k) / (1 - k));
  };
}

/** `sink`: points the element settles downwards while pressed (the primary red sinks 1 pt). */
export function usePress(kind: PressKind | number = 'cta', sink = 0, options?: PressOptions) {
  const { calm } = useFx();
  const progress = useSharedValue(0);
  const [pressed, setPressedNow] = useState(false);
  const to = typeof kind === 'number' ? kind : PRESS[kind];
  const hold = options?.scroll ? WEB_SCROLL_HOLD : 0;
  // the shared value first (the UI thread draws the change on the next frame), React state after. On the web the one
  // thread would draw that frame only after the re-render the state asks for (T4-16: a card's press landed 108-130 ms
  // after the touch), so there the state follows once the pressed frame has been painted (the latest value wins)
  const setPressed = useAfterPaint(setPressedNow);
  const onPressIn = useCallback(() => {
    const cfg = calm ? calmFade(t.press) : timing(t.press);
    progress.set(hold
      ? withTiming(1, { ...cfg, duration: hold + cfg.duration, easing: heldEasing(hold / (hold + cfg.duration), cfg.easing) })
      : withTiming(1, cfg));
    setPressed(true);
  }, [calm, progress, setPressed, hold]);
  const onPressOut = useCallback(() => { progress.set(calm ? withTiming(0, calmFade(t.press)) : withSpring(0, spring.release)); setPressed(false); }, [calm, progress, setPressed]);
  const style = useAnimatedStyle(() => ({ transform: pressTransform(progress.get(), to, sink, calm) }));
  const scrollProps = options?.scroll ? SCROLL_PRESS_NOW : PRESS_PROPS;
  return { pressed, style, onPressIn, onPressOut, progress, to, calm, scrollProps };
}
