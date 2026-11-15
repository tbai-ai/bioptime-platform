/* Which stack screens draw their own chrome (src/fx/StackHeader). The kit's Overlay, FlowScreen and SheetScreen mark
   their screen; a screen with a header of its own calls useOwnChrome() once. The mark is set in a layout effect, in
   the same frame the screen first draws, and removed when the screen goes. */
import { NavigationRouteContext } from 'expo-router/react-navigation';
import { useContext, useLayoutEffect, useSyncExternalStore } from 'react';

const own = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => { listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** This screen draws its own header (or none on purpose): the stack's header for its route is not drawn. Outside a
 *  stack screen (a sheet drawn at the root, a tab page) it does nothing. `on` = false gives the header back. */
export function useOwnChrome(on = true): void {
  const route = useContext(NavigationRouteContext);
  const key = route?.key;
  useLayoutEffect(() => {
    if (!on || !key) return;
    own.add(key);
    emit();
    return () => { own.delete(key); emit(); };
  }, [on, key]);
}

/** useOwnChrome as an element, for a screen body that is not a component of its own. */
export function OwnChrome({ on = true }: { on?: boolean }): null {
  useOwnChrome(on);
  return null;
}

/** Whether the screen with this route key draws its own chrome (read by the stack header). */
export function useHasOwnChrome(routeKey: string): boolean {
  return useSyncExternalStore(subscribe, () => own.has(routeKey), () => false);
}

/* An overlay route's code can still be loading on its first open on the web: the stack's header then draws the
   overlay's own header over its skeleton (src/fx/StackHeader), and records it here, so the Overlay that replaces it
   starts at rest instead of entering a second time. */
const loadingShown = new Set<string>();

/** The stack header drew an overlay's loading state for this route key (call it after a paint, and only while the
 *  screen has not taken its own chrome). */
export function markLoadingShown(routeKey: string): void { if (!own.has(routeKey)) loadingShown.add(routeKey); }

/** Whether the stack header drew an overlay's loading state for the route around this component. */
export function useLoadingWasShown(): boolean {
  const route = useContext(NavigationRouteContext);
  return !!route?.key && loadingShown.has(route.key);
}
