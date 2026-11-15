/* In-app updates while the app is open (CRITIQUE §22): push is not configured in Phase 1, so the tabs layout polls the
   cheapest read there is, the member's unread notifications (GET /notifications?unread=1&limit=10), every 30 s while
   the app is in the foreground, and once more when it comes back to it. A new notification that names a programme or a
   session (`data.programId`, `data.programmeId`, `data.sessionId`, `data.workoutId`) refreshes what is on screen under
   the keys me, workouts and programme (lib/useLoad invalidate); Train then compares the programme version with the one
   last seen on this device for its "NEW" pill. A meal plan or the coach's note on a logged meal (`data.mealPlanId`,
   `data.mealLogId`) refreshes `nutrition` (Fuel); a new message (`data.conversationId`, `data.messageId`) refreshes
   `me`, so the Coach tab's unread dot shows without a restart. The coach's other updates refresh the data that shows
   them: a coaching plan (`planId`: Train › Plan and Home's tasks), a check-in request, a habit, a goal or milestone, a
   report or booking, a consultation and a coach's note (the keys in MORE_KEYS). Every screen that refreshes on focus
   (useFocusRefresh) also reloads itself when a new notification arrives while it is on screen, so the screen the
   member has open follows the bell. Screens read the unread count and the latest notifications with useUpdates(),
   and may listen for new ones (onUpdate). What was seen is forgotten whenever the saved copies are (sign-in,
   sign-out, a session that ended): the next member's first poll only primes again. */
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { get } from '@/lib/api';
import { onClearCache } from '@/lib/cache';
import { invalidate } from '@/lib/useLoad';

export type AppNotification = { id: string; title?: string; body?: string; kind?: string; data?: Record<string, unknown>; created_at?: string; read_at?: string | null };
export type Updates = { unread: number | null; latest: AppNotification[]; at: number | null };

const POLL_MS = 30_000;
const PLAN_KEYS = ['programId', 'programmeId', 'sessionId', 'workoutId'];
const NUTRITION_KEYS = ['mealPlanId', 'mealLogId'];
const MESSAGE_KEYS = ['conversationId', 'messageId'];
/** What else a notification names, and the cached data (lib/useLoad keys) that shows it. */
const MORE_KEYS: Array<[string[], string[]]> = [
  [['planId'], ['me', 'programme', 'fuel.tasks']],
  [['checkinId'], ['me', 'home.checkins', 'progress-checkins']],
  [['habitId'], ['habits', 'home.habits']],
  [['goalId', 'milestoneId'], ['home.goals', 'progress-goals', 'milestones']],
  [['reportId', 'bookingId'], ['me', 'reports', 'bookings', 'tests', 'entitlements']],
  [['appointmentId'], ['me', 'appointments', 'appointments-past']],
  [['noteId'], ['notes', 'home.notes']],
];
const names = (n: AppNotification, keys: string[]) => !!n.data && typeof n.data === 'object' && keys.some((k) => k in (n.data as object));

let state: Updates = { unread: null, latest: [], at: null };
const seen = new Set<string>();
let primed = false;
const listeners = new Set<() => void>();
const updateListeners = new Set<(fresh: AppNotification[]) => void>();

function publish(next: Updates) { state = next; listeners.forEach((l) => l()); }

/** One poll; new notifications (not seen before in this run) go to the listeners. The first poll only primes. */
export async function pollUpdates(): Promise<void> {
  try {
    const r = await get<{ items?: AppNotification[]; unread?: number }>('/notifications?unread=1&limit=10');
    const items = Array.isArray(r?.items) ? r.items : [];
    const fresh = primed ? items.filter((n) => n?.id && !seen.has(n.id)) : [];
    items.forEach((n) => n?.id && seen.add(n.id));
    primed = true;
    publish({ unread: typeof r?.unread === 'number' ? r.unread : items.length, latest: items, at: Date.now() });
    if (fresh.length) {
      const keys = new Set<string>();
      if (fresh.some((n) => names(n, PLAN_KEYS))) ['me', 'workouts', 'programme'].forEach((k) => keys.add(k));
      if (fresh.some((n) => names(n, NUTRITION_KEYS))) keys.add('nutrition');
      if (fresh.some((n) => names(n, MESSAGE_KEYS))) keys.add('me');
      for (const [named, cached] of MORE_KEYS) if (fresh.some((n) => names(n, named))) cached.forEach((k) => keys.add(k));
      if (keys.size) invalidate([...keys]);
      updateListeners.forEach((l) => l(fresh));
    }
  } catch { /* offline or signed out: try again at the next tick */ }
}

/** Forget what was seen (sign-out, another member). */
export function resetUpdates(): void { seen.clear(); primed = false; publish({ unread: null, latest: [], at: null }); }
onClearCache(resetUpdates);

/** Runs the poll while `active` (a signed-in member on the tabs) and the app is in the foreground. Mount once. */
export function useUpdatesPoller(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) { void pollUpdates(); timer = setInterval(() => { void pollUpdates(); }, POLL_MS); } };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    if (AppState.currentState !== 'background') start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => { stop(); sub.remove(); };
  }, [active]);
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;

/** The unread count (null until the first answer) and the latest unread notifications. */
export function useUpdates(): Updates {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Calls `fn` with notifications that arrived since the last poll. Returns the unsubscribe. */
export function onUpdate(fn: (fresh: AppNotification[]) => void): () => void {
  updateListeners.add(fn);
  return () => { updateListeners.delete(fn); };
}
