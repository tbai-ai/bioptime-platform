/* Live steps from this phone's pedometer (expo-sensors Pedometer), off unless the member turned on "Count my steps on
   this phone" (the consent screen row or Profile › Settings; a device setting, not a consent kind).
   - iOS: today's total from the motion coprocessor (getStepCountAsync from midnight), read again every minute while a
     screen shows it, plus live increments (watchStepCount).
   - Android: no history is offered, so steps are counted while Bioptime is open (watchStepCount) and added to today's
     buffer on this device (`bp.fx.steps.buffer`); the card says so.
   - Web: not available ("Works on your phone").
   Sync: PUT /me/progress/daily {metric 'steps', date, value, source 'device', provider 'phone'} when the screen loses
   focus, when the app goes to the background and every 15 minutes; the server keeps the larger value per source and day,
   so sending the same total twice changes nothing. A failed sync keeps the buffer for the next try. Distance is shown
   only as an approximation (steps × 0.75 m).
   One member's choice: the switch, the unsent buffer and what was sent last are dropped whenever the saved copies are
   (sign-in, sign-out, a session that ended: lib/cache onClearCache), so the next person on this phone is asked again
   and never gets the last one's steps. A counter that stops after that (the screens unmounting on sign-out) neither
   sends nor saves what it held.
   The day: a count belongs to the India day it was counted on. At 00:00 India time (and when the app comes back to the
   front on a later day) a counter that runs starts again from the new day's own count (Android: 0, or what this phone
   buffered for that day; iOS: the motion history from midnight), after sending and buffering the old day's under the
   old day's date; until then `steps` is null, never the day before's total under "today".
   The newest live count of the day, from whichever counter runs (Home's, Bio's), is kept here too (useLiveStepsToday),
   so a screen that shows today's steps without a counter of its own (/goals) shows the same figure. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { Pedometer } from 'expo-sensors';
import { api } from '@/lib/api';
import { cacheGeneration, onClearCache } from '@/lib/cache';
import { istDate } from '@/lib/format';
import { peekSetting, setSetting, useDeviceSetting } from './settings';

export type StepStatus = 'off' | 'unavailable' | 'denied' | 'starting' | 'counting';
export type StepCounter = {
  status: StepStatus;
  /** Today's steps on this phone, or null when not counting (and while a new day's count is starting). */
  steps: number | null;
  /** The India day (YYYY-MM-DD) the counter counts for: `steps` is always that day's. */
  day: string;
  /** About steps × 0.75 m, in km (label it approximate). */
  approxKm: number | null;
  /** iOS reads the day's history; Android counts only while the app is open. */
  history: boolean;
  enable: () => Promise<boolean>;
  disable: () => Promise<void>;
};

const SYNC_MS = 15 * 60_000;
const IOS_REFRESH_MS = 60_000;
const STRIDE_M = 0.75;

/** The day the count belongs to: the app's dates are India time (lib/format istDate). */
const today = (): string => istDate();
function midnight(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
/** Milliseconds until the next 00:00 India time (UTC+5:30), plus a second so the new day has begun. */
function untilNextDay(): number {
  const DAY = 86_400_000, IST = 330 * 60_000;
  const now = Date.now();
  return Math.ceil((now + IST + 1) / DAY) * DAY - IST - now + 1000;
}

let lastSent: { date: string; value: number } | null = null;

/** The newest count of the day on this phone, from whichever counter runs; null when none has counted. */
let lastLive: { date: string; steps: number } | null = null;
const liveListeners = new Set<() => void>();
function noteLive(date: string, steps: number): void {
  if (lastLive && lastLive.date === date && lastLive.steps >= steps) return;
  lastLive = { date, steps };
  liveListeners.forEach((l) => { try { l(); } catch { /* one listener does not stop the others */ } });
}
function onLive(listener: () => void): () => void { liveListeners.add(listener); return () => { liveListeners.delete(listener); }; }
const peekLive = () => lastLive;
/** Today's live count on this phone from the counter that runs (Home's, Bio's), for a screen with none of its own
 *  (/goals): null while counting is off, on the web, or when nothing has been counted today. */
function liveOn(live: { date: string; steps: number } | null, enabled: boolean): number | null {
  return enabled && Platform.OS !== 'web' && live && live.date === today() ? live.steps : null;
}
export function useLiveStepsToday(): number | null {
  const live = useSyncExternalStore(onLive, peekLive, peekLive);
  const enabled = useDeviceSetting('steps.enabled') === true;
  return liveOn(live, enabled);
}

onClearCache(() => {
  lastSent = null;
  lastLive = null;
  void setSetting('steps.enabled', null);
  void setSetting('steps.buffer', null);
});

/** Sends today's count once it is higher than what was sent last; quiet on failure. */
export async function syncSteps(date: string, value: number): Promise<void> {
  if (!value || (lastSent && lastSent.date === date && lastSent.value >= value)) return;
  try {
    await api('PUT', '/me/progress/daily', { metric: 'steps', date, value, source: 'device', provider: 'phone' });
    lastSent = { date, value };
  } catch { /* offline, or the server has no daily progress yet: the buffer stays for the next try */ }
}

/** Asks for the motion permission and turns step counting on. Says why when it could not: 'unavailable' (a browser, or
 *  a phone with no step counter: nothing to allow, so no permission is asked) or 'denied' (the permission was refused). */
async function turnOn(): Promise<'on' | 'unavailable' | 'denied'> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    if (!(await Pedometer.isAvailableAsync())) return 'unavailable';
    const p = await Pedometer.requestPermissionsAsync();
    if (!p.granted) return 'denied';
  } catch { return 'unavailable'; }
  await setSetting('steps.enabled', true);
  return 'on';
}

export function useStepCounter(active = true): StepCounter {
  const enabled = useDeviceSetting('steps.enabled') === true;
  const [status, setStatus] = useState<StepStatus>(Platform.OS === 'web' ? 'unavailable' : enabled ? 'starting' : 'off');
  // the India day the counter is on (moved on at 00:00 India time, or when the app returns on a later day) and the
  // count with the day it was counted on: the count shows only while the two are the same day
  const [day, setDay] = useState<string>(today);
  const [count, setCount] = useState<{ date: string; value: number } | null>(null);
  const countRef = useRef<{ date: string; value: number } | null>(null);
  countRef.current = count;

  // the day moves on at 00:00 India time, and when the app comes back to the front on a later day, whether this counter
  // runs or not (Home's stops while another tab is in front): a count of an earlier day is never shown as today's
  useEffect(() => {
    if (Platform.OS === 'web' || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => { setDay(today()); if (timer) clearTimeout(timer); timer = setTimeout(check, untilNextDay()); };
    check();
    const appState = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => { if (timer) clearTimeout(timer); appState.remove(); };
  }, [enabled]);

  useEffect(() => {
    if (Platform.OS === 'web') { setStatus('unavailable'); return; }
    if (!enabled) {
      setStatus('off'); setCount(null);
      // a phone with no step counter says so before anyone taps (never "allow it in the settings": there is nothing to allow)
      let here = true;
      Pedometer.isAvailableAsync().then((ok) => { if (here && !ok) setStatus('unavailable'); }, () => undefined);
      return () => { here = false; };
    }
    if (!active) return;
    const date = today();
    if (date !== day) { setDay(date); return; } // a later day than the one it was on: start again on this one
    // (a new day ends this run: it sends and buffers the old day's count under the old day's date as it goes)
    let alive = true;
    let sub: { remove: () => void } | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const gen = cacheGeneration(); // the member this counter counts for: a sign-in or sign-out since ends it
    const same = () => cacheGeneration() === gen;
    const put = (value: number) => { if (!alive) return; setCount({ date, value }); if (same()) noteLive(date, value); };
    /** This day's count (null before the first reading of this run, or when what is held is another day's). */
    const held = () => { const c = countRef.current; return c && c.date === date ? c.value : null; };
    void (async () => {
      try {
        if (!(await Pedometer.isAvailableAsync())) { if (alive) setStatus('unavailable'); return; }
        const perm = await Pedometer.getPermissionsAsync();
        if (!perm.granted) { if (alive) setStatus('denied'); return; }
      } catch { if (alive) setStatus('unavailable'); return; }
      if (!alive) return;
      if (Platform.OS === 'ios') {
        let base = 0;
        let delta = 0;
        const read = async () => {
          try { base = (await Pedometer.getStepCountAsync(midnight(), new Date())).steps; delta = 0; put(base); } catch { /* keep the last reading */ }
        };
        await read();
        sub = Pedometer.watchStepCount((r) => { delta = r.steps; put(base + delta); });
        timer = setInterval(() => { void read(); }, IOS_REFRESH_MS);
      } else {
        const buffer = peekSetting('steps.buffer');
        const start = buffer && buffer.date === date ? buffer.steps : 0;
        put(start);
        let saved = start;
        sub = Pedometer.watchStepCount((r) => {
          const value = start + r.steps;
          put(value);
          if (value - saved >= 20 && same()) { saved = value; void setSetting('steps.buffer', { date, steps: value, at: new Date().toISOString() }); }
        });
      }
      if (alive) setStatus('counting');
    })();
    const sync = () => { const v = held(); if (v != null && same()) void syncSteps(date, v); };
    const keep = () => { const v = held(); if (Platform.OS === 'android' && v != null && same()) void setSetting('steps.buffer', { date, steps: v, at: new Date().toISOString() }); };
    const every = setInterval(sync, SYNC_MS);
    const appState = AppState.addEventListener('change', (s) => { if (s !== 'active') { sync(); keep(); } });
    return () => {
      alive = false;
      sub?.remove();
      if (timer) clearInterval(timer);
      clearInterval(every);
      appState.remove();
      sync();
      keep();
    };
  }, [enabled, active, day]);

  const enable = useCallback(async () => {
    const r = await turnOn();
    if (r !== 'on') setStatus(r);
    return r === 'on';
  }, []);
  const disable = useCallback(async () => { await setSetting('steps.enabled', false); }, []);

  const counting = status === 'counting' && count && count.date === day ? count.value : null;
  return {
    status,
    steps: counting,
    day,
    approxKm: counting == null ? null : Math.round((counting * STRIDE_M) / 100) / 10,
    history: Platform.OS === 'ios',
    enable,
    disable,
  };
}
