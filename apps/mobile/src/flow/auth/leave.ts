/* How a pre-main screen leaves (motion v2 M52, M56, M57, C05): one flow exit, then the navigation.
   - The column (every part of AuthScreen but the tile's mark) leaves like a FlowSwap step: opacity 1 → 0 and y 0 →
     flowSwap.exitY over flowSwap.exitMs on ease.exit; leaving the auth stack (Home, the setup) the backdrop photo,
     orbs and hairline fade with it so the next screen starts on the flow black. Reduced motion: a 150 ms crossfade;
     tier C: an m52.cFadeMs fade. The navigation runs once, from the exit's last frame or its fallback (doneOnce).
   - The Thread (M56): towards Home the tile's mark first lifts (m56.liftScale over m56.liftMs) and is handed to the
     root MarkLayer at its lifted place (recordMarkHandoff, source 'signin'); the tile hides its own mark one frame
     after the layer draws it, so the mark stays out of the column's fade and Home's ring takes it across the replace.
     Tier C: no lift and no flight, but the mark is still handed over at its place (the layer holds it at full opacity
     until Home's ring takes it, crossfading over mark.crossfadeC), so the Thread is never lost between the screens.
     Reduced motion: the mark fades with the column.
   - homeReady(): Home's first loads (prefetchHome) after the session has committed, waited for at most
     m52.prefetchCap, so Home opens from their answers rather than a skeleton (A22). */
import { useCallback, useEffect, useRef } from 'react';
import { Dimensions } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedRef, useSharedValue, withTiming, type AnimatedRef, type SharedValue } from 'react-native-reanimated';
import { measureView } from '@/fx/motion/measured';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { markLayerShown, recordMarkHandoff } from '@/fx/brand/MarkHandoff';
import { doneOnce } from '@/fx/motion/once';
import { useMotion } from '@/fx/motion/tier';
import { calmFade, ease, motionValues, t, timing } from '@/fx/motion/tokens';
import { prefetchHome } from '@/screens/home/data';

const S = motionValues.screens;

/** Home's first loads, waited for at most m52.prefetchCap (never rejects). Call it once the session has committed. */
export function homeReady(): Promise<void> {
  return new Promise<void>((resolve) => {
    const cap = setTimeout(resolve, S.m52.prefetchCap);
    void prefetchHome({ workouts: true }).then(() => { clearTimeout(cap); resolve(); });
  });
}

export type LeaveOptions = {
  /** Hand the tile's mark to Home (the sign-in towards Home). */
  mark?: boolean;
  /** Leaving the auth stack: the backdrop, the orbs and the hairline fade too. */
  backdrop?: boolean;
  /** The mark is handed over no sooner than this (ms): the Verified veil is still fading over it. */
  recordAfter?: number;
  /** Under a veil that is lifting (the Verified moment): the column fades in this long (ease.css) instead, so it is
   *  gone by the time the veil is, and never shows again on its way out. */
  underVeil?: number;
};

export type AuthLeave = {
  /** 0 → 1: the column leaves. */
  p: SharedValue<number>;
  /** 0 → 1: the backdrop leaves (only when leaving the auth stack). */
  bg: SharedValue<number>;
  /** 0 → 1: the tile's mark lifts. */
  lift: SharedValue<number>;
  /** 1 once the root MarkLayer draws the mark (the tile hides its own). */
  hide: SharedValue<number>;
  /** 1 while the mark is being handed over (it is then out of the column's fade). */
  flying: SharedValue<number>;
  /** The tile's mark (AuthScreen's LogoTile sets it). */
  markRef: AnimatedRef<Animated.View>;
  /** Exit, then `navigate` (once). */
  go: (navigate: () => void, opts?: LeaveOptions) => void;
};

type Frame = { x: number; y: number; w: number; h: number };

export function useAuthLeave(): AuthLeave {
  const { calm, tier } = useMotion();
  const p = useSharedValue(0);
  const bg = useSharedValue(0);
  const lift = useSharedValue(0);
  const hide = useSharedValue(0);
  const flying = useSharedValue(0);
  const markRef = useAnimatedRef<Animated.View>();
  const started = useRef(false);
  const pending = useRef<{ cancel: () => void } | null>(null);
  const recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    pending.current?.cancel();
    if (recordTimer.current) clearTimeout(recordTimer.current);
  }, []);

  // the layer draws the mark: the tile lets its own go one frame later (the layer is on screen by then)
  const hideNextFrame = useCallback(() => { requestAnimationFrame(() => { hide.value = 1; }); }, [hide]);
  useAnimatedReaction(() => (flying.value === 1 && markLayerShown.value === 1 ? 1 : 0), (on, was) => {
    if (on === 1 && was !== 1) scheduleOnRN(hideNextFrame);
  });

  const go = useCallback((navigate: () => void, opts: LeaveOptions = {}) => {
    if (started.current) return;
    started.current = true;
    const veil = opts.underVeil != null && !calm;
    const ms = calm ? t.calm : veil ? (opts.underVeil as number) : tier === 'C' ? S.m52.cFadeMs : motionValues.flowSwap.exitMs;
    const once = doneOnce(navigate, ms + motionValues.overlay.fallbackExtra);
    pending.current = once;
    const done = once.done;
    const cfg = calm ? calmFade() : veil ? timing(ms, ease.css) : tier === 'C' ? timing(ms, ease.linear) : timing(ms, ease.exit);
    p.value = withTiming(1, cfg, (f) => { 'worklet'; if (f) scheduleOnRN(done); });
    if (opts.backdrop) bg.value = withTiming(1, calm ? calmFade() : timing(ms, ease.css));
    if (!opts.mark || calm) return;
    // the mark is measured at rest, then lifts about its centre; the layer takes it at the lifted place (tier C: at
    // rest, at once: no lift, the crossfade at Home is the whole hand-off)
    const tierC = tier === 'C';
    const after = tierC ? opts.recordAfter ?? 0 : Math.max(S.m56.liftMs, opts.recordAfter ?? 0);
    const record = (f: Frame | null) => {
      // nothing to hand over (no measure, or the tile is scrolled out of view): the mark fades with the column
      if (!f || !(f.w > 0) || f.y + f.h <= 0 || f.y >= Dimensions.get('window').height) { flying.value = 0; return; }
      const s = tierC ? 1 : S.m56.liftScale;
      const lifted = { x: f.x + (f.w - f.w * s) / 2, y: f.y + (f.h - f.h * s) / 2, w: f.w * s, h: f.h * s };
      if (after <= 0) { recordMarkHandoff(lifted, 'home', 'signin'); return; }
      recordTimer.current = setTimeout(() => { recordTimer.current = null; recordMarkHandoff(lifted, 'home', 'signin'); }, after);
    };
    flying.value = 1;
    scheduleOnUI(() => {
      'worklet';
      const m = measureView(markRef);
      if (!tierC) lift.value = withTiming(1, timing(S.m56.liftMs, ease.expo));
      scheduleOnRN(record, m ? { x: m.pageX, y: m.pageY, w: m.width, h: m.height } : null);
    });
  }, [calm, tier, p, bg, lift, flying, markRef]);

  return { p, bg, lift, hide, flying, markRef, go };
}
