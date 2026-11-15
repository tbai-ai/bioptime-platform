/* The motion budget for decorative loops (PREMIUM §1.11; the website's 5 s motion budget). A loop that only decorates
   (orbs, the score halo, the nav chevron's nudge, the hero card's idle sway, the device-tilt sensor, the live dot, the
   Store marquee, the onboarding particles) runs for MOTION_BUDGET_MS after its screen comes into focus or after the
   last touch anywhere in the app, then rests where it is; the next touch, scroll, key or return to the app wakes it
   again. So an idle screen requests no frames: the phone can sleep its GPU, battery is spared, and Android's
   accessibility tooling (uiautomator) sees the screen settle. Loops that show live state while it is live (a playing
   timer or clip, typing dots while sending, box breathing while it runs, a skeleton while loading, a spinner) are not
   budgeted. Reduced motion and tier C never start the decorative loops at all (each component's own `still` rule).
   - wakeMotion(): what the app calls on any interaction (the root view's touch start on iOS and Android; pointer, wheel,
     key and scroll events on the web, set up here). Wakes are coalesced to one a second, so a fling or a held key does
     not re-render every loop on every event.
   - useMotionBudget(run, ms, active): `run` while within the budget; false once it is spent, until the next wake. With
     `active` (the page-active value) the budget counts down only while the page is active and starts again on its
     0 → 1 edge; the loop itself stops and resumes on that value on the UI thread (useLoopClock's `active`), so nothing
     loops on a page nobody can see and a page in front again resumes on its first active frame. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/** How long a decorative loop runs after focus or the last touch (ms). */
export const MOTION_BUDGET_MS = 5000;
const COALESCE_MS = 1000;

let wakes = 0;
let lastWake = 0;
const listeners = new Set<() => void>();

/** Any interaction: decorative loops whose screen is in front run again for the budget. */
export function wakeMotion(): void {
  const now = Date.now();
  if (now - lastWake < COALESCE_MS) return;
  lastWake = now;
  wakes += 1;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => wakes;

// the web has no root touch handler to lean on: listen on the document (capture, passive), once
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  for (const type of ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const) document.addEventListener(type, wakeMotion, { capture: true, passive: true });
  document.addEventListener('scroll', wakeMotion, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wakeMotion(); });
} else if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (s) => { if (s === 'active') wakeMotion(); });
}

/** `run` while the motion budget lasts: true for MOTION_BUDGET_MS after `run` turns true (the screen came into focus,
 *  the loop became allowed) or after the last wake, then false until the next wake. With `active` (the page-active
 *  value) the budget only counts down while the page is active: a page that goes inactive keeps what it had left (its
 *  loop is held on the UI thread meanwhile), so it resumes on the very frame it is active again, with a fresh budget. */
export function useMotionBudget(run: boolean, ms: number = MOTION_BUDGET_MS, active?: SharedValue<number>): boolean {
  const woke = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [awake, setAwake] = useState(run);
  const [shown, setShown] = useState(() => (active ? active.get() === 1 : true));
  useAnimatedReaction(() => (active ? active.get() : 1), (now, was) => {
    if (was != null && now !== was) scheduleOnRN(setShown, now === 1);
  });
  useEffect(() => {
    if (!run) return;
    if (!shown) return; // held: the budget left is kept for the page's return
    setAwake(true);
    const timer = setTimeout(() => setAwake(false), ms);
    return () => clearTimeout(timer);
  }, [run, woke, ms, shown]);
  return run && awake;
}

/* The finger on the screen, for work that waits until nobody is touching (src/fx/device/collect): whether one is down
   and when the last one went down or came up (ms). Touches end in onTouchEnd, or in onTouchCancel when a native scroll
   or gesture takes them over. */
let fingers = 0;
let lastTouch = 0;
type TouchEvent = { nativeEvent: { touches?: ArrayLike<unknown> } };
function touchStart(e: TouchEvent): void {
  fingers = Math.max(1, e.nativeEvent.touches?.length ?? 1);
  lastTouch = Date.now();
  wakeMotion();
}
function touchEnd(e: TouchEvent): void {
  fingers = e.nativeEvent.touches?.length ?? 0;
  lastTouch = Date.now();
}
/** Whether a finger is on the screen (iOS and Android; always false on the web, which has no root handler). */
export const touching = (): boolean => fingers > 0;
/** When a finger last went down or came up (ms since the epoch; 0 before the first touch). */
export const lastTouchAt = (): number => lastTouch;

/** Props for the app's root view on iOS and Android: a touch anywhere wakes the budgeted loops (it never claims the
 *  touch) and is noted for `touching` / `lastTouchAt`. The web listens on the document instead. */
export const wakeOnTouch = Platform.OS === 'web' ? {} : { onTouchStart: touchStart, onTouchEnd: touchEnd, onTouchCancel: touchEnd };
