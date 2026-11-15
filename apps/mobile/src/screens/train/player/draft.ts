/* The sets of a session that is not logged yet, kept on this device (TC-01): closing the player before "Log session"
   keeps what the member ticked and typed (each set's tick, reps, seconds and load), and opening the same session again
   shows it, in this run (memory) and after a restart (AsyncStorage). A draft belongs to one session on one date (its
   id and scheduled date): it goes once the session is logged (in the player, from Train's quick mark or on another
   device) or its programme is closed, and otherwise only when it is old (MAX_AGE after the later of its last change
   and the end of its session's own day), never by the `today` of the copy on screen, so a session logged the next
   morning, after midnight, on its later date or from a copy saved offline still has its sets. It is kept under
   bp.cache. with the member's other saved copies, so a sign-in, a sign-out or a session that ended takes it with them
   (lib/cache). One storage key holds every draft: a change is written t.change after the last one, in an idle moment,
   and at once when the player goes or the app leaves the foreground. Nothing here runs in a tick's frame, and nothing
   on screen moves for it: the player draws the kept sets as its own rows. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { t } from '@/fx';
import { cacheGeneration, onClearCache } from '@/lib/cache';
import type { SetRow } from './SetLogger';

export type Draft = {
  /** The weight unit its loads are written in. */
  unit: 'kg' | 'lb';
  /** Each exercise's set rows, by session item id. */
  rows: Record<string, SetRow[]>;
  /** When it was last changed (ms since epoch). */
  at: number;
};

const STORE = 'bp.cache.player.drafts';
/** How long a draft is kept after the later of its last change and the end of its session's day. */
const MAX_AGE = 36 * 3_600_000;
/** The programme's days are India's (UTC+05:30), as the server's dates are. */
const IST = 330 * 60_000;

const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
let ready = false;
let loading: Promise<void> | null = null;
let dirty = false;
let pending: ReturnType<typeof setTimeout> | null = null;
let cancelIdle: (() => void) | null = null;

/** A session's draft key: its id and its scheduled date. */
export const draftKey = (id: string, date: string) => `${id}@${date}`;

const isDraft = (v: unknown): v is Draft => !!v && typeof v === 'object' && typeof (v as Draft).at === 'number' && !!(v as Draft).rows && typeof (v as Draft).rows === 'object';

/** The end of the session's day (the scheduled date in its key, IST) in ms, or 0 when the key holds no date. */
function dayEnd(key: string): number {
  const m = /@(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1) - IST : 0;
}
/** Whether a draft is old: MAX_AGE has passed since its last change and since the end of its session's day. */
const stale = (key: string, d: Draft, now: number) => now - Math.max(d.at, dayEnd(key)) >= MAX_AGE;

/** Reads the stored drafts once (the press-in on a session and the player start it). What this run already holds wins. */
export function loadDrafts(): Promise<void> {
  if (!loading) {
    const generation = cacheGeneration();
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE);
        // a clear meanwhile (another member): what was stored was theirs
        if (raw && generation === cacheGeneration()) {
          const now = Date.now();
          let old = false;
          for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
            if (!isDraft(v) || stale(k, v, now)) old = true;
            else if (!drafts.has(k)) drafts.set(k, v);
          }
          if (old) schedule(); // the stored key is written again without the old drafts
        }
      } catch { /* storage unavailable, or a value from an older build: no drafts */ }
      ready = true;
      listeners.forEach((l) => l());
    })();
  }
  return loading;
}

function idle(job: () => void): () => void {
  const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  if (w.requestIdleCallback) {
    const h = w.requestIdleCallback(job, { timeout: t.premount });
    return () => w.cancelIdleCallback?.(h);
  }
  const timer = setTimeout(job, 0);
  return () => clearTimeout(timer);
}

function stopWrite() {
  if (pending) { clearTimeout(pending); pending = null; }
  cancelIdle?.();
  cancelIdle = null;
}

async function write(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  const generation = cacheGeneration();
  await loadDrafts(); // the stored drafts of other sessions are read before the key is written over
  if (generation !== cacheGeneration()) return;
  try {
    if (drafts.size) await AsyncStorage.setItem(STORE, JSON.stringify(Object.fromEntries(drafts)));
    else await AsyncStorage.removeItem(STORE);
  } catch { /* storage full or unavailable: kept for this run */ }
}

function schedule() {
  dirty = true;
  stopWrite();
  pending = setTimeout(() => { pending = null; cancelIdle = idle(() => { cancelIdle = null; void write(); }); }, t.change);
}

/** Writes a change that is still waiting, now (the player goes, the app leaves the foreground). */
export function flushDrafts(): void {
  stopWrite();
  void write();
}

/** The draft of a session, or null; one that has grown old (stale) goes. */
export function readDraft(key: string): Draft | null {
  const d = drafts.get(key);
  if (!d) return null;
  if (stale(key, d, Date.now())) { drafts.delete(key); schedule(); return null; }
  return d;
}

/** Keeps the draft of a session (old drafts of other sessions go with it), or with null drops it. */
export function putDraft(key: string, draft: Draft | null): void {
  if (!draft) {
    if (!drafts.delete(key)) return;
  } else {
    const now = Date.now();
    for (const [k, v] of drafts) if (k !== key && stale(k, v, now)) drafts.delete(k);
    drafts.set(key, draft);
  }
  schedule();
}

const subscribe = (l: () => void) => { listeners.add(l); void loadDrafts(); return () => { listeners.delete(l); }; };
/** Whether the stored drafts have been read (before that, only this run's are known). */
export function useDraftsReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => false);
}

// the next member on this phone never sees another's sets
onClearCache(() => { drafts.clear(); dirty = false; stopWrite(); });
