/* The tab pager's page lifecycle, as seen from inside a page.
   - usePageReady: a tab page tells the pager it has drawn (PREMIUM §1.3A "never a black frame"). On a first visit the
     pager mounts the page and slides it in only once its screen has laid out (the tab header with its skeleton or
     content), so the page that moves in is never an empty one while its code or first render is still on the way.
     TabScreen reports it; a page that never does is slid in after a short cap anyway.
   - usePageActive (the page-active contract): a shared value, 1 while the page is the one in front (focused and
     settled, or the target of a tap or a drag from the frame its first moving frame draws), 0 for a pre-mounted, parked
     or detached page, and for every page while the launch sting (SplashHost) is running. Every entrance, data sweep and
     decorative loop starts on its 0 → 1 edge, so nothing animates where nobody can see it. Outside the pager (an
     overlay, a flow, a sheet) it is 1, except 0 while the sting runs. The loops read PageActiveContext, which is the
     same flag except while pages move: then only the focused page's loops run (a page a drag reveals starts its
     entrance at once and its loops once it has landed).
   - usePageSettled: true once the pager has come to rest on this page (outside the pager: after the first commit).
     Heavy sections (src/fx/nav/Deferred) and the refocus refetch (useFocusRefresh) wait for it.
   - usePageMotion: { offset, width } for the page around this component, where offset d = slot − pos in pages (0 at
     rest, > 0 while the page is still to the right of the screen); null outside the pager. ScreenHeader's title layer
     lags the page with it (M35). */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSplashState } from '../brand/SplashHost';
import { motionValues } from '../motion/tokens';

export const PageReadyContext = createContext<(() => void) | null>(null);

/** The pager's "this page has drawn" call for the page around this component (null outside the pager). */
export function usePageReady(): (() => void) | null {
  return useContext(PageReadyContext);
}

/** The page's active flag (0 | 1) as the decorative loops read it (useLoopGate, MorphSource), provided by the pager's
 *  Page. It equals usePageActive() except while the pages move: then only the focused page's loops run (the page a
 *  drag reveals plays its entrance at once, and starts its loops when it has landed), so a moving page redraws less. */
export const PageActiveContext = createContext<SharedValue<number> | null>(null);

/** The page's active flag (0 | 1) for entrances and data sweeps (usePageActive), provided by the pager's Page. */
export const PageEnterContext = createContext<SharedValue<number> | null>(null);

/** Whether the pager has settled on the page, as a small store (provided by the pager's Page): its value never
 *  changes identity, so a page coming to rest re-renders only the components that read it. */
export type SettledStore = { get: () => boolean; subscribe: (listener: () => void) => () => void };
export const PageSettledContext = createContext<SettledStore | null>(null);

/** A settled store the pager's Page drives: set(focused, atRest). Coming to rest is told at once; leaving it is told
 *  `quietMs` later (and not at all when the page is back at rest by then), so a page that starts to move away does
 *  not re-render what reads it in the frames of the switch (readers that render meanwhile still read the truth). */
export function createSettledStore(quietMs: number): SettledStore & { set: (focused: boolean, atRest: boolean) => void } {
  let value = false;
  let told = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const tell = () => { timer = null; if (told === value) return; told = value; listeners.forEach((l) => l()); };
  return {
    get: () => value,
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    set: (focused, atRest) => {
      value = focused && atRest;
      if (value) { if (timer) { clearTimeout(timer); timer = null; } tell(); return; }
      if (told && !timer) timer = setTimeout(tell, quietMs);
    },
  };
}
const ALWAYS: SettledStore = { get: () => true, subscribe: () => () => undefined };
const NONE = () => () => undefined;

/* Whether a tab page is being scrolled (TabScreen tells it from its scroll's drag and momentum events): the pager holds
   its idle work (pre-mounting a neighbour, unmounting a dormant page) until the scroll has ended, so a page never mounts
   under a finger that is scrolling. Each report lasts at most a moment, so a lost end event never holds it for long. */
let scrollHold = 0;
/** TabScreen: a scroll began (or momentum continues) when `on`, else it ended (a short grace follows). Additive. */
export function markPageScrolling(on: boolean): void {
  scrollHold = Date.now() + (on ? 3000 : motionValues.pager.scrollIdleHold);
}
/* A finger on the pages holds the same idle work (the pager's pan tells it from its touch down to its finalize): a
   queued mount, unmount or detach that fires as the finger lands would lay out or drop a page in the first frames of
   a swipe. Kept apart from the scroll's hold, so a touch ending never shortens a scroll's. */
let touchHold = 0;
/** The pager: a finger is down on the pages when `on`, else it lifted (a short grace follows). Additive. */
export function markPageTouch(on: boolean): void {
  touchHold = Date.now() + (on ? 3000 : 300);
}
/** Whether a tab page has been scrolling or touched within the last moment (see markPageScrolling, markPageTouch). */
export function pageScrolling(): boolean {
  const now = Date.now();
  return now < scrollHold || now < touchHold;
}

/** The tab name of the pager page around this component (null outside the pager): a page's own memory, such as its
 *  scroll offset, kept across the page being unmounted and mounted again (src/fx/FxScreen TabScreen). Additive. */
export const PageNameContext = createContext<string | null>(null);

export type PageMotion = { offset: SharedValue<number>; width: number }; // offset d = slot − pos (signed pages)

export const PageMotionContext = createContext<PageMotion | null>(null);

/** 1 while the page around this component can be seen and is the one in front, else 0 (see the header). Outside the
 *  pager: 0 while the launch sting runs, else 1 (a stable shared value per hook call). */
export function usePageActive(): SharedValue<number> {
  const enter = useContext(PageEnterContext);
  const loops = useContext(PageActiveContext);
  const page = enter ?? loops;
  const splash = useSplashState();
  const running = splash === 'running';
  const own = useSharedValue(running ? 0 : 1);
  useEffect(() => { if (!page) own.value = running ? 0 : 1; }, [page, running, own]);
  return page ?? own;
}

/** True once the pager has come to rest on this page; outside the pager, true after the first commit. */
export function usePageSettled(): boolean {
  const page = useContext(PageSettledContext);
  const [committed, setCommitted] = useState(false);
  useEffect(() => { if (page === null) setCommitted(true); }, [page]);
  const settled = useSyncExternalStore(page ? page.subscribe : NONE, page ? page.get : () => false, page ? page.get : () => false);
  return page ? settled : committed;
}

/** The settled store of the page around this component, for a hook that acts when the page comes to rest without
 *  re-rendering its screen (src/fx/data/useFocusRefresh); outside the pager it is always settled. */
export function usePageSettledStore(): SettledStore {
  const page = useContext(PageSettledContext);
  return useMemo(() => page ?? ALWAYS, [page]);
}

/** The page's offset from the screen (in pages) and the page width; null outside the pager. */
export function usePageMotion(): PageMotion | null {
  return useContext(PageMotionContext);
}
