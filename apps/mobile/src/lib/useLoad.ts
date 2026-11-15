import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';
import { cacheGeneration, onClearCache, readCache, writeCache } from './cache';

/* Loads that more than one place asks for (the tabs layout and Home both need GET /me): a key names one payload, and
   `prefetch` starts it early (or for a neighbouring tab after idle) so the screen that opts in (`shared`) takes the
   answer instead of asking again. Keys in use: me, workouts, programme, nutrition, reports. A prefetched answer is
   used once, within FRESH_MS, and never after a sign-in or sign-out (clearCache drops them: another member's answer
   must not reach the next member's Home). */
const FRESH_MS = 15_000;
const prefetched = new Map<string, { at: number; promise: Promise<unknown> }>();
onClearCache(() => prefetched.clear());
/** The reloads of every mounted useLoad, by key, so an update from the coach can refresh what is on screen. */
const mounted = new Map<string, Set<() => void>>();

export function prefetch<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const p = prefetched.get(key);
  if (p && Date.now() - p.at < FRESH_MS) return p.promise as Promise<T>;
  const promise = loader();
  prefetched.set(key, { at: Date.now(), promise });
  promise.catch(() => { prefetched.delete(key); }); // the screen that takes it writes the last-good copy
  return promise;
}

function takePrefetched<T>(key: string): Promise<T> | null {
  const p = prefetched.get(key);
  if (!p) return null;
  prefetched.delete(key);
  return Date.now() - p.at < FRESH_MS ? (p.promise as Promise<T>) : null;
}

/** Forget prefetched answers for these keys and reload every screen that shows one (quietly: the data stays on screen
 *  until the new answer arrives). */
export function invalidate(keys: string[]): void {
  for (const k of keys) { prefetched.delete(k); mounted.get(k)?.forEach((reload) => reload()); }
}

/** Calls `fn` whenever `invalidate` names `key`: for a holder of that data that is not a useLoad (the tabs layout keeps
 *  GET /me for the onboarding check and the Coach tab's unread dot). Returns the unsubscribe. */
export function onInvalidate(key: string, fn: () => void): () => void {
  const set = mounted.get(key) ?? new Set();
  set.add(fn);
  mounted.set(key, set);
  return () => { set.delete(fn); if (!set.size && mounted.get(key) === set) mounted.delete(key); };
}

/** The same JSON as before (a refetch that found nothing new): the screen keeps the object it has and draws nothing again. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/** Load from the API with a last-good copy from the device for when the network is gone. `shared`: take an answer
 *  prefetched under the same key for the first load. */
export function useLoad<T>(key: string | null, fn: () => Promise<T>, deps: unknown[] = [], opts?: { shared?: boolean }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState<string | null>(null); // ISO time of the cached copy being shown
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const first = useRef(!!opts?.shared);

  const load = useCallback(async () => {
    setLoading(true);
    const gen = cacheGeneration(); // a sign-in or sign-out while this is on its way: the answer belongs to someone else
    try {
      const early = first.current && key ? takePrefetched<T>(key) : null;
      first.current = false;
      const d = await (early ?? fnRef.current());
      if (gen !== cacheGeneration()) return;
      setData((prev) => (prev !== null && sameJson(prev, d) ? prev : d)); setError(null); setStale(null);
      if (key) void writeCache(key, d);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, null);
      if (gen !== cacheGeneration()) return;
      if (err.offline && key) {
        const cached = await readCache<T>(key);
        if (cached) { setData(cached.data); setStale(cached.at); setError(null); setLoading(false); return; }
      }
      setError(err);
    } finally { setLoading(false); }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const reload = () => { void load(); };
    const set = mounted.get(key) ?? new Set();
    set.add(reload);
    mounted.set(key, set);
    return () => { set.delete(reload); if (!set.size) mounted.delete(key); };
  }, [key, load]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load, ...deps]);
  return { data, error, loading, stale, reload: load, setData };
}
