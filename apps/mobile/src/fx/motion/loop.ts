/* The clock behind the kit's few loops (orbs, halo, live dot, spinners, typing dots, marquee): 0 → 1 every `ms`,
   linear, on the UI thread, only while `run` and, when given, while `active` (the page-active value, see
   src/fx/nav/pageReady) is 1. Starting and stopping on `active` happens on the UI thread (a reaction), so a loop stops
   the frame its page goes inactive and resumes from where it was the frame the page is active again. A pause keeps
   its place and the loop resumes from there, so a screen coming back into focus does not jump. */
import { useContext, useEffect } from 'react';
import { useIsFocused } from 'expo-router';
import { cancelAnimation, useAnimatedReaction, useSharedValue, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { pageScrollMoving } from './gestureState';
import { ease } from './tokens';

/** A clock running 0 → 1 every `ms` while `run` (and `active` is 1); a pause keeps its place and the loop resumes from
 *  there. A `decorative` loop (orbs, the live dot, the marquee; not a spinner or the typing dots, which show live
 *  state) also holds while a tab page scrolls (pageScrollMoving, src/fx/motion/gestureState). */
export function useLoopClock(ms: number, run: boolean, active?: SharedValue<number>, decorative = false): SharedValue<number> {
  const clock = useSharedValue(0);
  const always = useSharedValue(1);
  const on = active ?? always;
  useAnimatedReaction(() => (run && on.get() === 1 && (!decorative || pageScrollMoving.get() === 0) ? ms : 0), (go, was) => {
    if (go === was) return;
    if (go === 0) { cancelAnimation(clock); return; }
    const from = clock.get() % 1;
    const lap = withRepeat(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: go, easing: ease.linear })), -1, false);
    clock.set(from);
    clock.set(withSequence(withTiming(1, { duration: go * (1 - from), easing: ease.linear }), lap));
  });
  useEffect(() => () => cancelAnimation(clock), [clock]);
  return clock;
}

/** src/fx/nav/pageReady, read when first needed: the launch sting (src/fx/brand) draws Orbs and a Spinner and
 *  pageReady reads the sting's state, so a static import here would close a require cycle. */
export function pageReadyModule(): typeof import('@/fx/nav/pageReady') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/fx/nav/pageReady');
}

/** Where a decorative loop or a loader may run: inside the tab pager, `active` is the page's active value (the UI-thread
 *  gate for useLoopClock and useMotionBudget) and decides alone (`visible` true), so a loop stops the frame its page
 *  goes inactive and resumes the frame it is in front again. Outside the pager (a flow, an overlay, the launch sting's
 *  own orbs and spinner) it is always 1 and the screen must be focused. */
export function useLoopGate(): { active: SharedValue<number>; visible: boolean } {
  const page = useContext(pageReadyModule().PageActiveContext);
  const focused = useIsFocused();
  const always = useSharedValue(1);
  return { active: page ?? always, visible: page ? true : focused };
}
