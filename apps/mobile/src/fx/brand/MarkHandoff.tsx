/* The mark hand-off, The Thread (PREMIUM §1.7 "Exit and morph"; motion v2 M45, M46): the Bioptime mark seems to travel
   from one screen into the next: the splash's mark into the sign-in's 64 pt tile (mark 40) or, when a session was
   restored, into the Home header ring (mark 24); the sign-in tile's into the Home ring (the MarkLayer draws it across
   the replace). The source records where its mark is on screen (recordMarkHandoff, ./MarkLayer); the destination wraps
   its own mark in <MarkHandoff>, which declares itself from its first render (willTakeMark), tells the splash once it
   has laid out (its screen has drawn), and, once a hand-off is on offer for its target, waits for its page to be laid
   out and active and then for mark.startFrames quiet frames in a row (no mount or long task in them), measures itself
   again and flies the mark home from the source's place and size on spring.mark (critically damped, no overshoot); its
   last frame tells the splash the mark has landed. The Home ring
   flight arcs (it lifts first, then slides: x follows p^1.6) when it travels sideways more than mark.arcMinDx; the
   splash → tile flight is straight. Tier C crossfades the two marks over mark.crossfadeC instead of flying; from the
   sign-in (sign-in → Home) it starts as soon as Home is laid out and active (a crossfade in place does not move, so
   it needs no quiet frames) and the sign-in's mark leaves in half the time (ease.cubicOut) while Home's comes in over
   the whole of it: the mark is never absent, and the sign-in's no longer sits over Home's words (SMA-2).
   The source keeps its mark drawn until the destination draws it at the same place (handoffTaken, set on the UI thread
   in that frame), so the mark never blinks. If no destination takes it within the cap (the splash: mark.cap 2.5 s,
   tier C mark.waitC), the hand-off is cancelled: the source's mark fades and the destination's mark enters with its
   column (opacity and scale .9 → 1, mark.lateFadeMs), once, never disappearing and coming back. Without a hand-off (any
   later visit, a deep link, reduced motion) it renders its child as is. Put a MarkPaths inside, so both ends are the
   same artwork and only position and scale change. A destination that would fade its mark in with the rest of the
   screen asks `hasMarkHandoff` first and leaves the mark out of that fade. */
import React, { useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { measureView } from '../motion/measured';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { ease, motionValues, spring, timing } from '@/fx/motion/tokens';
import { useMotion } from '@/fx/motion/tier';
import { usePageActive } from '@/fx/nav/pageReady';
import {
  afterQuietFrames, claimMarkHandoff, expectedMarkTarget, handoffTaken, markFlight, markFlightP, markLaidOut, markLateFor, notifyMarkLanded,
  peekMarkHandoff, QUIET_CAP_MS, sourceFlies, subscribeMarkHandoff, willTakeMark, type HandoffTarget, type Waiting,
} from './MarkLayer';

export {
  cancelMarkHandoff, handoffTaken, hasMarkHandoff, markLayerShown, recordMarkHandoff, willTakeMark,
  type HandoffFrame, type HandoffSource, type HandoffTarget,
} from './MarkLayer';

const mv = motionValues.mark;

type Start = { dx: number; dy: number; s: number; arc: boolean };

export function MarkHandoff({ target, children, style }: { target: HandoffTarget; children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const { still, tier } = useMotion();
  const active = usePageActive();
  // from the first render: declare, and see whether a hand-off is on offer, on its way (the splash still running) or late
  const [init] = useState(() => {
    if (still) return { offer: null as Waiting | null, wait: false, late: false };
    willTakeMark(target);
    const offer = peekMarkHandoff(target);
    if (offer || expectedMarkTarget() === target) return { offer, wait: true, late: false };
    return { offer: null, wait: false, late: markLateFor(target) };
  });
  const [offer, setOffer] = useState<Waiting | null>(init.offer);
  const waiting = useRef(init.wait); // true until this mark flies, shows at home or enters late
  const [laidOut, setLaidOut] = useState(false);
  const [isActive, setActive] = useState(false);
  const ref = useAnimatedRef<Animated.View>();
  const start = useSharedValue<Start | null>(null);
  const p = useSharedValue(1);
  const shown = useSharedValue(init.wait ? 0 : 1); // 0 while the source still draws the mark
  const enter = useSharedValue(init.late ? 0 : 1); // the late entrance (opacity and scale)
  const crossfade = tier === 'C';

  useAnimatedReaction(() => active.get() >= 1, (on, was) => { if (on !== was) scheduleOnRN(setActive, on); });

  const showHome = () => { waiting.current = false; shown.set(1); notifyMarkLanded(); };
  const enterLate = () => {
    waiting.current = false;
    enter.set(0);
    shown.set(1);
    enter.set(withTiming(1, timing(mv.lateFadeMs, ease.expo)));
    notifyMarkLanded();
  };

  // a late mark (the hand-off was cancelled before this mark drew) enters once, with its column
  useEffect(() => {
    if (init.late) enter.set(withTiming(1, timing(mv.lateFadeMs, ease.expo)));
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // waiting: a record that comes after the first render (Home mounted early under the splash), or a cancel
  useEffect(() => {
    if (!init.wait) return;
    return subscribeMarkHandoff(() => {
      if (!waiting.current) return;
      const o = peekMarkHandoff(target);
      if (o) { setOffer(o); return; }
      if (expectedMarkTarget() === target) return;
      if (markLateFor(target)) enterLate(); else showHome(); // cancelled, or another mark took it
    });
    // the subscription lives as long as the mark
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fly = (o: Waiting) => {
    if (!waiting.current) return;
    waiting.current = false;
    const flies = sourceFlies(o);
    if (!claimMarkHandoff(o)) { if (markLateFor(target)) enterLate(); else showHome(); return; }
    const from = o.frame;
    const quick = crossfade && o.source === 'signin';
    scheduleOnUI(() => {
      'worklet';
      const m = measureView(ref);
      if (!m || m.width <= 0) { start.set(null); p.set(1); shown.set(1); handoffTaken.set(1); scheduleOnRN(notifyMarkLanded); return; }
      if (crossfade) {
        start.set(null);
        p.set(1);
        shown.set(0);
        if (quick) {
          shown.set(withTiming(1, timing(mv.crossfadeC, ease.css), (f) => { 'worklet'; if (f) scheduleOnRN(notifyMarkLanded); }));
          handoffTaken.set(withTiming(1, timing(mv.crossfadeC / 2, ease.cubicOut)));
          return;
        }
        shown.set(withTiming(1, timing(mv.crossfadeC, ease.css)));
        handoffTaken.set(withTiming(1, timing(mv.crossfadeC, ease.css), (f) => { 'worklet'; if (f) scheduleOnRN(notifyMarkLanded); }));
        return;
      }
      if (flies) {
        // the source's own mark (in its top-level layer) flies here; this mark draws in the frame it arrives and the
        // source's goes in that same frame
        const fx = m.pageX + m.width / 2 - (from.x + from.w / 2);
        markFlight.set({ dx: fx, dy: m.pageY + m.height / 2 - (from.y + from.h / 2), s: m.width / from.w, arc: Math.abs(fx) > mv.arcMinDx });
        markFlightP.set(0);
        markFlightP.set(withSpring(1, spring.mark, () => {
          'worklet';
          shown.set(1);
          handoffTaken.set(1);
          scheduleOnRN(notifyMarkLanded);
        }));
        return;
      }
      const dx = from.x + from.w / 2 - (m.pageX + m.width / 2);
      start.set({ dx, dy: from.y + from.h / 2 - (m.pageY + m.height / 2), s: from.w / m.width, arc: Math.abs(dx) > mv.arcMinDx });
      p.set(0);
      shown.set(1);
      handoffTaken.set(1); // the source hides its mark in this frame
      p.set(withSpring(1, spring.mark, (f) => { 'worklet'; if (f) scheduleOnRN(notifyMarkLanded); }));
    });
  };

  // the flight starts once the destination is laid out and its page is active, and then mark.startFrames quiet frames
  // in a row (no mount or long task in them: the mark never starts to move inside a stall), at most QUIET_CAP_MS later
  useEffect(() => {
    if (!offer || !laidOut || !isActive || !waiting.current) return;
    if (crossfade && offer.source === 'signin') { fly(offer); return; }
    return afterQuietFrames(mv.startFrames, QUIET_CAP_MS, () => fly(offer));
    // fly reads refs and shared values only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer, laidOut, isActive]);

  // the destination's readiness, for the splash (it releases and fades once this screen has drawn its mark)
  useEffect(() => {
    if (!laidOut) return;
    markLaidOut(target, true);
    return () => markLaidOut(target, false);
  }, [laidOut, target]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!laidOut && width > 0 && height > 0) setLaidOut(true); // a detached page reports 0×0
  };

  const animated = useAnimatedStyle(() => {
    const opacity = shown.get() * enter.get();
    const s0 = start.get();
    const v = p.get();
    if (s0 && v < 1) {
      const k = 1 - v;
      const kx = s0.arc ? 1 - Math.pow(Math.max(0, v), mv.arcPow) : k;
      return { opacity, transform: [{ translateX: s0.dx * kx }, { translateY: s0.dy * k }, { scale: s0.s + (1 - s0.s) * v }] };
    }
    const e = enter.get();
    if (e < 1) return { opacity, transform: [{ scale: mv.lateScaleFrom + (1 - mv.lateScaleFrom) * e }] };
    return { opacity, transform: [] };
  });

  return <Animated.View ref={ref} onLayout={onLayout} collapsable={false} style={[style, animated]}>{children}</Animated.View>;
}
