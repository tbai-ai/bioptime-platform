/* The feature flags that are on for the signed-in person: GET /public/config → features. The app shows a module's
   entries only while its flag is in that list (the server refuses the module's routes otherwise). Nothing is fetched
   until some registered entry wants to show, so with no module entries the app makes the same requests as before. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { get } from './api';
import { useAuth } from './auth';
import { readCache, writeCache } from './cache';
import { onServerChange, serverEpoch } from './config';

const CACHE_KEY = 'features';
const FRESH_MS = 60_000;
let cached: { who: string; epoch: number; at: number; promise: Promise<Set<string>> } | null = null;

/** The enabled flags for this person on the server in use, fetched at most once a minute; the last-good copy when the
 *  network is gone (not kept as fresh: the next ask tries the server again), else none. A change of server (lib/config
 *  onServerChange) makes the next ask fetch them from the new one. */
export function loadFeatures(who: string): Promise<Set<string>> {
  const epoch = serverEpoch();
  if (cached && cached.who === who && cached.epoch === epoch && Date.now() - cached.at < FRESH_MS) return cached.promise;
  const entry: { who: string; epoch: number; at: number; promise: Promise<Set<string>> } = { who, epoch, at: Date.now(), promise: Promise.resolve(new Set<string>()) };
  entry.promise = get<{ features?: string[] }>('/public/config').then(
    (c) => { const list = c?.features ?? []; void writeCache(`${CACHE_KEY}.${who}`, list); return new Set(list); },
    async () => { entry.at = 0; return new Set((await readCache<string[]>(`${CACHE_KEY}.${who}`))?.data ?? []); },
  );
  cached = entry;
  return entry.promise;
}

/** Forget the cached flags (sign-in as someone else, pull to refresh). */
export function refreshFeatures(): void { cached = null; }

/** The enabled flags, or null while loading or when nothing asked (`active` false). */
export function useFeatures(active: boolean): Set<string> | null {
  const { user, config } = useAuth();
  const who = user?.id ?? 'signed-out';
  // asked again when the server changes, and when the app reads the server's settings again (it answers again after
  // being unreachable; a cached answer still fresh is reused)
  const epoch = useSyncExternalStore(onServerChange, serverEpoch, serverEpoch);
  const [features, setFeatures] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void loadFeatures(who).then((f) => { if (alive) setFeatures(f); });
    return () => { alive = false; };
  }, [active, who, epoch, config]);
  return active ? features : null;
}
