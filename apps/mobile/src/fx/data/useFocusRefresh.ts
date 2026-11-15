/* How coach updates reach a screen that is already open: refetch when the screen gains focus again (not on its first
   focus, which loaded it), and when the app comes back to the foreground (at most every 15 s). Push is not configured
   in Phase 1; useUpdates() polls for new notifications while the app is open. `refreshing` is for pull to refresh
   (true only while a pull asked for it, so a quiet focus refetch shows no spinner). The refocus refetch waits until the
   pager has come to rest on the page (src/fx/nav/pageReady usePageSettled; outside the pager at once), so its
   re-render never lands in the transition's frames. A new notification that arrives while the screen is on screen (useUpdates' poll) reloads it too, so a coach's
   change to the plan, a check-in request, a habit, a goal or a report shows on the screen the member has open, not only
   on the bell. */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { usePageSettledStore } from '../nav/pageReady';
import { onUpdate } from './useUpdates';

const FOREGROUND_GAP_MS = 15_000;

export function useFocusRefresh(reload: () => Promise<unknown> | void): { refreshing: boolean; onRefresh: () => void } {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const firstFocus = useRef(true);
  const focused = useRef(false);
  const lastForeground = useRef(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  // read without re-rendering the screen: the page coming to rest only runs a pending refetch
  const settled = usePageSettledStore();
  const pending = useRef(false);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    if (firstFocus.current) firstFocus.current = false;
    else if (settled.get()) void reloadRef.current();
    else pending.current = true;
    return () => { focused.current = false; pending.current = false; };
  }, [settled]));
  // a refocus waits for the pages to come to rest
  useEffect(() => settled.subscribe(() => {
    if (!settled.get() || !pending.current || !focused.current) return;
    pending.current = false;
    void reloadRef.current();
  }), [settled]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || !focused.current) return;
      if (Date.now() - lastForeground.current < FOREGROUND_GAP_MS) return;
      lastForeground.current = Date.now();
      void reloadRef.current();
    });
    return () => sub.remove();
  }, []);

  // a coach update while this screen is the one on screen
  useEffect(() => onUpdate(() => { if (focused.current) void reloadRef.current(); }), []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.resolve(reloadRef.current()).finally(() => setRefreshing(false));
  }, []);
  return { refreshing, onRefresh };
}
