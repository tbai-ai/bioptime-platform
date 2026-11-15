/* Nothing moves across text being read (motion.md §10.10): while the Bioptime mark flies into a screen (The Thread:
   the splash into the sign-in tile, the splash or the sign-in into Home's ring), a block of text under its path holds
   back until the mark has passed above it, then enters.
   The flight is read where it is drawn: the hand-off's source frame (MarkLayer peekMarkHandoff, taken when the source
   records it), the flight's geometry and its progress (markFlight, markFlightP: the mark's centre moves by dx × p (or
   p^mark.arcPow on an arc) and dy × p, and it scales 1 → s about its centre). On the UI thread, every frame of the
   flight, the rest of the mark's way (the box around its box now and its box at home) is compared with the block's
   resting box (measured once, from an untransformed wrapper); the first frame they no longer meet (the mark has passed
   above it, or beside it on its way off), the block is clear and enters: opacity 0 → 1 and, with `rise`, up from CLEAR_RISE over CLEAR_MS on the expo curve. It is also
   let go when the mark lands, when the hand-off is cancelled, or after motionValues.mark.cap (never stuck).
   Off (it renders its children at rest) when no flight to `target` is expected at its first render, at tier C (the
   marks crossfade in place there, nothing travels) and with reduced motion or in the pre-rendered HTML. While the
   launch sting's opaque lockup still covers it (native, gestureState.warmUnder) the held block draws at
   reveal.warmOpacity, as a waiting Reveal does, so its text is rasterized under the black.
   `useMarkClear` gives the `clear` flag (0 | 1, set on the UI thread) so a screen can start the rest of its entrance
   from the same moment (the sign-in provides it as its column's page-active edge). */
import React, { useEffect, useState } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useSharedValue, withTiming, type AnimatedRef, type SharedValue } from 'react-native-reanimated';
import { measureView } from '@/fx/motion/measured';
import { scheduleOnRN } from 'react-native-worklets';
import { hasMarkHandoff, markFlight, markFlightP, markLateFor, onMarkLanded, peekMarkHandoff, subscribeMarkHandoff, type HandoffFrame, type HandoffTarget } from '@/fx/brand/MarkLayer';
import { warmUnder } from '@/fx/motion/gestureState';
import { useMotion } from '@/fx/motion/tier';
import { ease, motionValues, timing } from '@/fx/motion/tokens';

/** The held block's rise and its entrance once the mark has passed (m56.clearRise 16 pt over m56.clearMs 320 ms). */
const CLEAR_RISE = motionValues.screens.m56.clearRise;
const CLEAR_MS = motionValues.screens.m56.clearMs;
const WARM = Platform.OS === 'web' ? 0 : motionValues.reveal.warmOpacity;

export type MarkClearState = {
  /** Put on an untransformed view around the block: its resting box is what the mark must pass. */
  ref: AnimatedRef<Animated.View>;
  /** 0 while the block holds, 1 from the frame the mark is above it (or it is let go). */
  clear: SharedValue<number>;
  /** 0 → 1: the block's entrance once clear. */
  p: SharedValue<number>;
  /** Whether a flight is being waited for at all (false: everything at rest). */
  on: boolean;
};

/** `enabled` false: the block never waits (a screen that is not the flight's destination). */
export function useMarkClear(target: HandoffTarget, enabled: boolean): MarkClearState {
  const { tier, still } = useMotion();
  const [on] = useState(() => enabled && !still && tier !== 'C' && hasMarkHandoff(target));
  const ref = useAnimatedRef<Animated.View>();
  const clear = useSharedValue(on ? 0 : 1);
  const p = useSharedValue(on ? 0 : 1);
  const from = useSharedValue<HandoffFrame | null>(on ? peekMarkHandoff(target)?.frame ?? null : null);
  const box = useSharedValue<HandoffFrame | null>(null); // the block's resting box, measured once in the flight

  // the source's frame, as it records the hand-off; a cancelled hand-off lets the block go
  const release = () => {
    if (clear.get() === 1) return;
    clear.set(1);
    p.set(withTiming(1, timing(CLEAR_MS, ease.expo)));
  };
  useEffect(() => {
    if (!on) return;
    const check = () => {
      const w = peekMarkHandoff(target);
      if (w) from.set(w.frame);
      else if (markLateFor(target)) release();
    };
    const off = subscribeMarkHandoff(check);
    const landed = onMarkLanded(release);
    const cap = setTimeout(release, motionValues.mark.cap);
    check();
    return () => { off(); landed(); clearTimeout(cap); };
    // once, for the flight this block waits for
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, target]);

  // every frame of the flight: is the rest of the mark's way clear of the block? The way left is inside the box around
  // the mark's box now and its box at home (x and y each move one way only: y follows p, x p or p^arcPow), so the block
  // is clear once that box no longer meets the block's resting box
  useAnimatedReaction(() => {
    if (clear.get() === 1) return 0;
    const g = markFlight.get();
    const f = from.get();
    if (!g || !f) return 0;
    const k = markFlightP.get();
    let b = box.get();
    if (!b) {
      const m = measureView(ref);
      if (!m || m.height <= 0 || m.width <= 0) return 0;
      b = { x: m.pageX, y: m.pageY, w: m.width, h: m.height };
      box.set(b);
    }
    const kx = g.arc ? Math.pow(Math.max(0, k), motionValues.mark.arcPow) : k;
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const sc = 1 + (g.s - 1) * k;
    const nowL = cx + g.dx * kx - (f.w * sc) / 2;
    const nowR = cx + g.dx * kx + (f.w * sc) / 2;
    const nowT = cy + g.dy * k - (f.h * sc) / 2;
    const nowB = cy + g.dy * k + (f.h * sc) / 2;
    const endL = cx + g.dx - (f.w * g.s) / 2;
    const endR = cx + g.dx + (f.w * g.s) / 2;
    const endT = cy + g.dy - (f.h * g.s) / 2;
    const endB = cy + g.dy + (f.h * g.s) / 2;
    const l = Math.min(nowL, endL);
    const r = Math.max(nowR, endR);
    const t = Math.min(nowT, endT);
    const bt = Math.max(nowB, endB);
    const meets = l < b.x + b.w && r > b.x && t < b.y + b.h && bt > b.y;
    return meets ? 0 : 1;
  }, (now) => {
    if (now !== 1 || clear.get() === 1) return;
    clear.set(1);
    p.set(withTiming(1, timing(CLEAR_MS, ease.expo)));
  });

  return { ref, clear, p, on };
}

/** A block of text that holds back while the mark flies over it (see above). `rise`: it enters with a rise as well. */
export function MarkClear({ state, rise = true, style, children }: { state: MarkClearState; rise?: boolean; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const { p } = state;
  const a = useAnimatedStyle(() => {
    const v = p.get();
    if (v >= 1) return { opacity: 1, transform: [] };
    const opacity = Math.max(WARM * warmUnder.get(), v);
    return rise ? { opacity, transform: [{ translateY: CLEAR_RISE * (1 - v) }] } : { opacity, transform: [] };
  }, [rise]);
  return <Animated.View ref={state.ref} collapsable={false} style={style}>
    <Animated.View style={a}>{children}</Animated.View>
  </Animated.View>;
}
