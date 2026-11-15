/* The Quiz Deck (motion v2 M58, M59): overlapped steps that follow the finger.
   - When `index` changes, the step that was in front stays mounted (absolute, inert from its first exit frame: no
     touches, hidden from assistive technology) and leaves while the new one enters in the same frame, so there is
     never a frame with neither. 'quiz': it leaves x → −m58.exitShare × W × dir on spring.quiz with its opacity gone
     by m58.exitOpacityBy, and the new step enters from +W × dir on spring.quiz (dimmed while it is far). 'slides':
     the old words leave x → ∓20 (or on from where the finger left them) with their opacity gone by t.swapOut, and
     the new words enter from ±20 with their opacity over 500 ms (the earlier app's carousel), m53.inAt in. It
     unmounts once it has left.
   - `drag` follows the finger: the step in front moves by drag.x (the screen's Pan writes it, rubber band included).
     A committed release changes `index` with drag.v set to the release speed: the leaving step continues from where
     the finger left it, carrying that speed, and the entering one starts with it. A release that does not commit
     springs drag.x back (the screen's job).
   - `track` (optional) follows the x of the step in front (the quiz's ghost numeral follows it at 0.4).
   - Tier C: an m58.cMs opacity crossfade, no travel. Reduced motion: a 150 ms crossfade (calmFade).
   Each step keeps a slot (0 | 1) whose shared values it reads from its first frame, so a step that turns into the
   leaving one keeps drawing where it was until the transition takes it over on the UI thread. */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { useMotion } from '@/fx/motion/tier';
import { doneOnce } from '@/fx/motion/once';
import { calmFade, ease, motionValues, spring, t, timing } from '@/fx/motion/tokens';

const Q = motionValues.screens.m58;
/** The slides' text entrance: x ±20, opacity over 500 ms (the earlier app's carousel; Slides' existing values),
 *  starting m53.inAt after the old words begin to leave (the in-place swap rule). */
export const SLIDE_ENTER = { x: 20, ms: 500, at: motionValues.screens.m53.inAt } as const;

export type DeckDrag = { x: SharedValue<number>; v: SharedValue<number> };

export function useDeckDrag(): DeckDrag {
  return { x: useSharedValue(0), v: useSharedValue(0) };
}

type Prev = { index: number; node: React.ReactNode; slot: 0 | 1 };
type State = { index: number; slot: 0 | 1; prev: Prev | null; dir: number; n: number };

export function Deck({ index, dir, width, drag, mode, track, children, style }: {
  index: number; dir: number; width: number; drag: DeckDrag; mode: 'quiz' | 'slides';
  track?: SharedValue<number>; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const { calm, inHtml, tier } = useMotion();
  const still = calm || inHtml;
  // slot 0 holds the first step at rest; slot 1 is unused (transparent) until a step enters into it
  const x0 = useSharedValue(0), x1 = useSharedValue(0);
  const o0 = useSharedValue(1), o1 = useSharedValue(0);
  const f0 = useSharedValue(1), f1 = useSharedValue(0); // 1: this slot follows the finger
  const [s, setS] = useState<State>({ index, slot: 0, prev: null, dir, n: 0 });
  const last = useRef<React.ReactNode>(children);
  if (s.index !== index) {
    // what was drawn for the old step becomes the leaving layer (same key: it keeps its state and its slot)
    setS({ index, slot: s.slot === 0 ? 1 : 0, prev: { index: s.index, node: last.current, slot: s.slot }, dir, n: s.n + 1 });
  } else {
    last.current = children;
  }
  const s_cur = { index: s.index, slot: s.slot, node: s.index === index ? children : last.current };

  const prevSlot = s.prev?.slot ?? null;
  const dropPrev = useCallback(() => setS((x) => (x.prev && x.prev.slot === prevSlot ? { ...x, prev: null } : x)), [prevSlot]);
  const pending = useRef<{ cancel: () => void } | null>(null);

  // the transition, on the UI thread, in the frame after the new step's first commit
  useLayoutEffect(() => {
    if (s.n === 0) return;
    pending.current?.cancel();
    const inSlot = s.slot;
    const d = s.dir;
    const W = width;
    const fade = still || tier === 'C';
    const quiz = mode === 'quiz';
    const once = s.prev ? doneOnce(dropPrev, t.flow + motionValues.overlay.fallbackExtra) : null;
    pending.current = once;
    const gone = once ? once.done : () => undefined;
    scheduleOnUI(() => {
      'worklet';
      const xIn = inSlot === 0 ? x0 : x1, xOut = inSlot === 0 ? x1 : x0;
      const oIn = inSlot === 0 ? o0 : o1, oOut = inSlot === 0 ? o1 : o0;
      const fIn = inSlot === 0 ? f0 : f1, fOut = inSlot === 0 ? f1 : f0;
      const v = drag.v.value;
      const from = xOut.value + drag.x.value * fOut.value; // where the leaving step is drawn now
      cancelAnimation(xOut); cancelAnimation(oOut); cancelAnimation(xIn); cancelAnimation(oIn); cancelAnimation(drag.x);
      fOut.value = 0;
      drag.x.value = 0;
      drag.v.value = 0;
      fIn.value = 1;
      if (fade) {
        const cfg = still ? calmFade() : timing(Q.cMs, ease.linear);
        xOut.value = withTiming(0, cfg);
        oOut.value = withTiming(0, cfg, (f) => { 'worklet'; if (f) scheduleOnRN(gone); });
        xIn.value = 0;
        oIn.value = 0;
        oIn.value = withTiming(1, cfg);
        return;
      }
      // the leaving step goes on from where it is, with the finger's speed
      xOut.value = from;
      xOut.value = withSpring(quiz || Math.abs(from) > SLIDE_ENTER.x ? -d * Q.exitShare * W : -d * SLIDE_ENTER.x, { ...spring.quiz, velocity: v });
      // the quiz's step is gone by m58.exitOpacityBy; the slides' words, an in-place swap, by t.swapOut
      // (the words fall away fast, on the expo curve, so they are nearly gone when the new ones start)
      oOut.value = withTiming(0, quiz ? timing(Q.exitOpacityBy, ease.linear) : timing(t.swapOut, ease.expo), (f) => { 'worklet'; if (f) scheduleOnRN(gone); });
      if (quiz) {
        xIn.value = d * W;
        oIn.value = 1;
        xIn.value = withSpring(0, { ...spring.quiz, velocity: v });
      } else {
        // the new words start a moment in (m53.inAt), so the two never read as one block
        xIn.value = d * SLIDE_ENTER.x;
        oIn.value = 0;
        xIn.value = withDelay(SLIDE_ENTER.at, withTiming(0, timing(SLIDE_ENTER.ms, ease.expo)));
        oIn.value = withDelay(SLIDE_ENTER.at, withTiming(1, timing(SLIDE_ENTER.ms, ease.expo)));
      }
    });
    return () => { /* a newer transition cancels this one's drop (above) */ };
    // the transition runs once per index change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.n]);

  // the x of the step in front, for what follows it (the quiz's ghost numeral)
  const curSlot = s.slot;
  useAnimatedReaction(() => (curSlot === 0 ? x0.value : x1.value) + drag.x.value, (x) => { if (track) track.value = x; }, [curSlot, track]);

  const layers: React.ReactNode[] = [];
  if (s.prev) layers.push(<DeckLayer key={'s' + s.prev.slot + ':' + s.prev.index} leaving x={s.prev.slot === 0 ? x0 : x1} o={s.prev.slot === 0 ? o0 : o1} f={s.prev.slot === 0 ? f0 : f1} drag={drag} width={width} quiz={mode === 'quiz'}>{s.prev.node}</DeckLayer>);
  layers.push(<DeckLayer key={'s' + s_cur.slot + ':' + s_cur.index} x={s_cur.slot === 0 ? x0 : x1} o={s_cur.slot === 0 ? o0 : o1} f={s_cur.slot === 0 ? f0 : f1} drag={drag} width={width} quiz={mode === 'quiz'}>{s_cur.node}</DeckLayer>);
  return <Animated.View style={[styles.deck, style]}>{layers}</Animated.View>;
}

function DeckLayer({ children, leaving, x, o, f, drag, width, quiz }: {
  children: React.ReactNode; leaving?: boolean; x: SharedValue<number>; o: SharedValue<number>; f: SharedValue<number>;
  drag: DeckDrag; width: number; quiz: boolean;
}) {
  // an entering step's slot is transparent (o 0) until the transition places it, so its first frame never flashes
  const a = useAnimatedStyle(() => {
    const X = x.value + drag.x.value * f.value;
    // the entering quiz step is dimmed while it is far (as the earlier deck was), never below 1 − exitShare
    const far = quiz && !leaving ? Math.min(1, Math.abs(x.value) / Math.max(1, width)) * Q.exitShare : 0;
    const opacity = o.value * (1 - far);
    return X === 0 ? { opacity, transform: [] } : { opacity, transform: [{ translateX: X }] };
  }, [leaving, quiz, width]);
  const inert = leaving ? { pointerEvents: 'none' as const, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true } : null;
  return <Animated.View style={[leaving ? styles.leaving : styles.front, a]} {...inert}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  deck: { position: 'relative' },
  front: {},
  leaving: { position: 'absolute', left: 0, right: 0, top: 0 },
});
