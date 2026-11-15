/* The cold start's sting as an overlay above the navigator (PREMIUM §1.7 "Exit and morph", §1.3B "no black gap"). The
   entry route asks for it once per launch (startSplash) and waits on black while it plays; as the exit starts the
   sting releases the route (`released`), which redirects to the sign-in or Home underneath, and the sting fades its
   black and words over that screen while its mark waits for the next screen's MarkHandoff to take it. Once nothing of
   it is left on screen it unmounts (`done`). Deep links never pass the entry route, so they never see it.
   A restored session (motion v2 C10, M46): as soon as the session is known during the sting, Home's first loads start
   (prefetchHome: /me, the progress summary and the workouts, which Home then takes instead of asking again), and at
   motionValues.mark.earlyMountAt of the sting `useSplashEarly()` turns true, so the entry route mounts Home under the
   lockup while the sting still runs (Home stays inactive, usePageActive 0, until the sting releases). The sign-in is
   never mounted early. The sting releases only once that Home has drawn, and fades once the released screen has
   drawn and settled (SplashSting); `done` comes in an idle moment after the mark has landed in its new place. */
import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { t } from '@/fx/motion/tokens';
import { prefetchHome } from '@/screens/home/data';
import { SplashSting } from './SplashSting';
import type { HandoffTarget } from './MarkLayer';

export type SplashState = 'idle' | 'running' | 'released' | 'done';

let state: SplashState = 'idle';
let early = false;
const listeners = new Set<() => void>();
function notify() { listeners.forEach((l) => l()); }
function set(next: SplashState) {
  if (state === next) return;
  state = next;
  notify();
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;
const earlySnapshot = () => early;

/** The entry route's cold start: play the sting (once per launch). False when it already played. */
export function startSplash(): boolean {
  if (state !== 'idle') return false;
  set('running');
  return true;
}

/** Where the sting is: the entry route redirects once it is `released` or `done`. */
export function useSplashState(): SplashState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** True once the running sting has passed motionValues.mark.earlyMountAt (a separate signal: SplashState keeps its four
 *  values). The entry route mounts Home then for a restored session. */
export function useSplashEarly(): boolean {
  return useSyncExternalStore(subscribe, earlySnapshot, earlySnapshot);
}

/** Calls `fn` once the launch sting has left the screen (`done`, or it never ran: `idle`), at once when it has; returns
 *  the cancel. For work that would otherwise land in the hand-off's frames (a neighbour page's pre-mount). */
export function whenSplashGone(fn: () => void): () => void {
  if (state === 'idle' || state === 'done') { fn(); return () => undefined; }
  let live = true;
  const l = () => { if (live && (state === 'idle' || state === 'done')) { live = false; listeners.delete(l); fn(); } };
  listeners.add(l);
  return () => { live = false; listeners.delete(l); };
}

/** Mount once above the navigator (the client app's root layout). */
export function SplashHost({ ready, target, onFirstFrame }: { ready: boolean; target: HandoffTarget; onFirstFrame?: () => void }) {
  const now = useSplashState();
  // a restored session: Home's first loads start while the sting plays (after the auth state has committed, in an
  // effect, so a clearCache before it cannot drop them)
  const prefetched = useRef(false);
  const restored = ready && target === 'home';
  useEffect(() => {
    if (!restored || prefetched.current || (now !== 'running' && now !== 'released')) return;
    prefetched.current = true;
    void prefetchHome({ workouts: true });
  }, [restored, now]);
  if (now !== 'running' && now !== 'released') return null;
  return <SplashSting
    overlay
    ready={ready}
    target={target}
    onFirstFrame={onFirstFrame}
    onEarly={() => { if (!early && state === 'running') { early = true; notify(); } }}
    onDone={() => set('released')}
    onGone={() => whenIdle(() => set('done'))}
  />;
}

/** The overlay leaves (and every reader of the sting's state hears it) in an idle moment after the mark has landed, so
 *  its unmount never lands in a frame of the hand-off; at most t.premount later. */
function whenIdle(fn: () => void): void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (g.requestIdleCallback) g.requestIdleCallback(fn, { timeout: t.premount });
  else setTimeout(fn, 0);
}
