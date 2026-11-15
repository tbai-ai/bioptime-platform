/* Expo Router's module-wide `router` (imported by screens and the kit and called outside render: a timer, a sheet's
   close, the pager's pre-mount of a neighbour tab) and its module-wide container ref (behind canGoBack, canDismiss and
   setParams) belong to the one React root that bound them last. Android recreates the activity while this JS runtime
   keeps running (a font size, display size, bold text or app language change; "Don't keep activities"; the system taking
   the activity back), and the two roots overlap: the new activity's root can mount before the old one goes, whose
   teardown then unbinds both after the new root had bound them. Every later `router.*` threw "The imperative router is
   unavailable before the first render has finished" (in the release app a FATAL JavascriptException, ACC-F1) and the
   container ref stayed empty.
   RootRouter (mounted once, in the root layout) records each mounted root and when its navigator is ready, and the
   router's navigation methods always go to the newest root whose navigator is ready, through that root's own router,
   whatever Expo Router has bound or unbound meanwhile (its binding is kept aside, and used as before only until the
   first root here is ready: a cold start's first frames). The container ref is put back to that root when a teardown
   left it empty. With no ready root (between one activity's end and the next one's first frames) nothing throws: a call
   that goes somewhere (navigate, push, replace, dismissTo, linkTo) waits and runs on the next root once its navigator is
   ready; one that acts on the stack in place (back, dismiss, setParams, a prefetch) has no stack to act on and is
   dropped; canGoBack and canDismiss answer false. setTransitionMode and reload stay Expo Router's own.
   The new root opens on the entry route, which takes the session to Home: a member who changed the text size with the
   player or a Profile section open lost their place (GA1-m2). The route the ready root shows (the tab under it and the
   route on top) is kept here, and a root that becomes ready after another one had been (a recreation in the same
   runtime; a cold start begins with none) puts it back once, after the entry has taken the session into the tabs: the
   tab, then the route on top of it. Signed out (the sign-in on screen) there is nothing to put back. Open sheets are
   the screens' own state and are not kept. */
import React, { useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { router, useGlobalSearchParams, usePathname, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { navigationRef } from 'expo-router/build/global-state/navigationRef';
import { unboundRouter } from 'expo-router/build/global-state/router';
import { NavigationContainerRefContext } from 'expo-router/react-navigation';

type Imperative = ReturnType<typeof useRouter>;
type Container = NonNullable<React.ContextType<typeof NavigationContainerRefContext>>;
/** One mounted root: its own router (the one its container binds), its container's navigation object, and whether
 *  its navigator is ready. */
type Root = { router: Imperative; container: Container | undefined; ready: boolean };

/** Calls that go somewhere: with no ready root they wait for the next one. */
const GOES = ['navigate', 'push', 'replace', 'dismissTo', 'linkTo'] as const;
/** Calls that act on the stack on screen: with none, there is nothing to act on. */
const IN_PLACE = ['back', 'goBack', 'dismiss', 'dismissAll', 'setParams', 'prefetch'] as const;
/** Questions about the stack on screen: with none, no. */
const ASKS = ['canGoBack', 'canDismiss'] as const;
type Key = (typeof GOES)[number] | (typeof IN_PLACE)[number] | (typeof ASKS)[number];
type Call = (...args: unknown[]) => unknown;
/** A router's method by name (Expo Router's own router also has goBack, which its public type leaves out). */
const method = (r: object, key: Key): Call => (r as Record<Key, Call>)[key];

/** The roots mounted now, oldest first (two only while Android swaps activities). */
const roots: Root[] = [];
/** Whether a root's navigator has been ready here once (from then on this layer decides every call). */
let seenReady = false;
/** Navigations asked for while no root was ready, in order; the next ready root runs them. */
const waiting: Array<(to: Imperative) => void> = [];
/** What Expo Router last put in the router for each method: its root's binding, or its unbound methods (they throw). */
const held = {} as Record<Key, Call>;
/** The route the ready root shows: the tab (with its query) and the route on top of the tabs, if any. */
let shown: { tab: string | null; top: string | null } = { tab: null, top: null };
/** What a recreated root puts back (taken from `shown` as it became ready), and that root. */
let restore: { root: Root; to: { tab: string | null; top: string | null } } | null = null;

/** A route's address: its path and, as a query, the parameters that are not part of the path ([id] segments). */
function hrefOf(pathname: string, segments: readonly string[], params: Record<string, string | string[] | undefined>): string {
  const inPath = new Set(segments.filter((s) => s.startsWith('[')).map((s) => s.replace(/^\[(\.\.\.)?|\]$/g, '')));
  const query = Object.entries(params).filter(([k, v]) => !inPath.has(k) && v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(Array.isArray(v) ? v[0] : v))}`);
  return query.length ? `${pathname}?${query.join('&')}` : pathname;
}

/** The newest root whose navigator is ready. */
function readyRoot(): Root | undefined {
  for (let i = roots.length - 1; i >= 0; i--) if (roots[i].ready) return roots[i];
  return undefined;
}

/** The container ref back on `root` when a teardown left it empty (canGoBack, canDismiss and setParams read it). */
function heal(root: Root): void {
  if (root.container && navigationRef.current == null) (navigationRef as { current: unknown }).current = root.container;
}

/** Runs the navigations that waited, on `to`. A plain function on purpose: the React Compiler rewrote this hand-over
 *  inside the component (it read the emptied list instead of the taken one, so nothing ran). */
function runWaiting(to: Imperative): void {
  for (const go of waiting.splice(0, waiting.length)) {
    try { go(to); } catch (e) { console.warn('A navigation that waited for the app to be ready could not run:', e); }
  }
}

function call(key: Key, args: unknown[]): unknown {
  const root = readyRoot();
  if (root) {
    heal(root);
    return method(root.router, key)(...args);
  }
  // before any root here is ready (a cold start's first frames): Expo Router's own binding, as before, where it has one
  const bound = held[key];
  if (!seenReady && bound && bound !== (unboundRouter ? method(unboundRouter, key) : undefined)) return bound(...args);
  if ((ASKS as readonly string[]).includes(key)) return false;
  if ((GOES as readonly string[]).includes(key)) waiting.push((to) => { method(to, key)(...args); });
  return undefined;
}

for (const key of [...GOES, ...IN_PLACE, ...ASKS] as Key[]) {
  held[key] = method(router, key);
  const fn: Call = (...args) => call(key, args);
  // Expo Router's bridge binds and unbinds by assigning these; the assignment is kept aside and the call goes through here
  Object.defineProperty(router, key, { configurable: true, enumerable: true, get: () => fn, set: (next: Call) => { held[key] = next; } });
}

/** A root's navigator is ready: calls go to it from now on (and the ones that waited run on it). */
function markReady(root: Root): void {
  root.ready = true;
  if (seenReady && (shown.tab || shown.top)) restore = { root, to: { ...shown } };
  seenReady = true;
  heal(root);
  if (readyRoot() === root) runWaiting(root.router);
}

/** Mount once, in the root layout (inside Expo Router's root, outside anything that can return early). */
export function RootRouter(): null {
  const own = useRouter();
  const container = useContext(NavigationContainerRefContext);
  const navReady = !!useRootNavigationState()?.key;
  const entry = useRef<Root>({ router: own, container, ready: false });
  useLayoutEffect(() => { entry.current.router = own; entry.current.container = container; }, [own, container]);

  useEffect(() => {
    const me = entry.current;
    roots.push(me);
    return () => {
      me.ready = false;
      const i = roots.indexOf(me);
      if (i >= 0) roots.splice(i, 1);
      // a root that went after a newer one had mounted (Android's activity swap): the container ref back on the newer one
      const live = readyRoot();
      if (live) heal(live);
    };
  }, []);

  useEffect(() => { if (navReady) markReady(entry.current); }, [navReady]);

  // the route on screen (GA1-m2): recorded while this root is the one in use; a recreated root puts the last one back
  const segments = useSegments();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const group = segments[0] ?? '';
  const href = hrefOf(pathname, segments, params);
  useEffect(() => {
    const me = entry.current;
    if (!navReady || readyRoot() !== me) return;
    if (restore && restore.root !== me) restore = null; // a root that is gone
    if (restore) {
      if (group === '(auth)') { restore = null; return; } // signed out meanwhile: nothing to put back
      if (group !== '(tabs)') return; // still at the entry
      const { tab, top } = restore.to;
      restore = null;
      const moved = !!tab && tab !== href;
      if (moved) me.router.replace(tab as never);
      // the route on top goes on once the tab is in place (in the same tick the tab's switch was lost under it)
      if (top) { if (moved) requestAnimationFrame(() => me.router.push(top as never)); else me.router.push(top as never); }
      return;
    }
    if (group === '(tabs)') shown = { tab: href, top: null };
    else if (group === '(auth)' || !group) shown = { tab: null, top: null };
    else shown = { ...shown, top: href };
  }, [navReady, href, group]);

  return null;
}
