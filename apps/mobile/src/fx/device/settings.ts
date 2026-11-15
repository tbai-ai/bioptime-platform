/* Settings that live on this device only (BUILD_PLAN §1.3, CRITIQUE §44): units, haptics, video autoplay, the last tab
   and segment, step counting and its unsent buffer, "Reduce effects", the splash and brief markers, the motion tier
   override and the programme versions each member last saw. Nothing here is member data the server should hold, and nothing is a
   secret. AsyncStorage under `bp.fx.*`; every read and write is in try/catch, and a value is kept in memory so a
   component can read it synchronously (the default until storage answers). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

const PREFIX = 'bp.fx.';

export type MotionTier = 'A' | 'B' | 'C';
export type StepBuffer = { date: string; steps: number; at: string };

/** The fixed keys and their value types. */
export type DeviceSettings = {
  'units.weight': 'kg' | 'lb';
  'units.height': 'cm' | 'in';
  haptics: boolean;
  videoAutoplay: boolean;
  lastTab: string;
  'steps.enabled': boolean;
  'steps.buffer': StepBuffer;
  /** Forces the lightest effects tier (Settings row "Reduce effects"). */
  reduceEffects: boolean;
  /** When the full splash sting last played (ms since epoch): a cold start within 10 minutes gets the short one. */
  splashAt: number;
  /** A forced motion tier (E2E and support); absent: the device decides. */
  motionTier: MotionTier;
  /** The programme versions each member last saw on Train, by member id, then programme id (the "NEW" pill and toast):
   *  per member, so another member signing in on this phone is never told of a plan that is not new to them, and per
   *  programme, so a new programme at version 1 is new. */
  seenProgrammes: Record<string, Record<string, number>>;
};
export type DeviceSettingKey = keyof DeviceSettings;

const DEFAULTS: Partial<DeviceSettings> = {
  'units.weight': 'kg', 'units.height': 'cm', haptics: true, videoAutoplay: true, 'steps.enabled': false, reduceEffects: false,
};
const FIXED_KEYS: DeviceSettingKey[] = ['units.weight', 'units.height', 'haptics', 'videoAutoplay', 'lastTab', 'steps.enabled', 'steps.buffer', 'reduceEffects', 'splashAt', 'motionTier', 'seenProgrammes'];

const memory = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;
let loading: Promise<void> | null = null;

function publish() { version += 1; listeners.forEach((l) => l()); }

/** Reads every fixed key once (the root layout starts it); later reads come from memory. */
export function loadDeviceSettings(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      try {
        const pairs = await AsyncStorage.multiGet(FIXED_KEYS.map((k) => PREFIX + k));
        for (const [k, raw] of pairs) {
          if (raw == null) continue;
          try { memory.set(k.slice(PREFIX.length), JSON.parse(raw)); } catch { /* a value from an older build: ignore it */ }
        }
      } catch { /* storage unavailable: defaults */ }
      publish();
    })();
  }
  return loading;
}

/** The value now (memory, else the default). */
export function peekSetting<K extends DeviceSettingKey>(key: K): DeviceSettings[K] | undefined {
  return (memory.has(key) ? memory.get(key) : DEFAULTS[key]) as DeviceSettings[K] | undefined;
}

export async function setSetting<K extends DeviceSettingKey>(key: K, value: DeviceSettings[K] | null): Promise<void> {
  if (value == null) memory.delete(key); else memory.set(key, value);
  publish();
  try {
    if (value == null) await AsyncStorage.removeItem(PREFIX + key);
    else await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* storage full or unavailable: kept for this run */ }
}

/** Keys with a part of their own (`segment.<tab>`, `briefSeen.<date>`): read and written as plain strings. */
export async function readKeyed(group: 'segment' | 'briefSeen', part: string): Promise<string | null> {
  const k = `${group}.${part}`;
  if (memory.has(k)) return memory.get(k) as string;
  try { const v = await AsyncStorage.getItem(PREFIX + k); if (v != null) memory.set(k, v); return v; } catch { return null; }
}
export async function writeKeyed(group: 'segment' | 'briefSeen', part: string, value: string): Promise<void> {
  memory.set(`${group}.${part}`, value);
  try { await AsyncStorage.setItem(PREFIX + `${group}.${part}`, value); } catch { /* kept for this run */ }
}

const subscribe = (l: () => void) => { listeners.add(l); void loadDeviceSettings(); return () => { listeners.delete(l); }; };

/** A setting that follows changes made anywhere in the app. The default (or undefined) until storage has answered.
 *  The value itself is the store's snapshot (not a version counter read beside it), so the React Compiler cannot keep a
 *  stale value: a memoised read would depend only on `key`. Values are kept by reference in memory, so a snapshot only
 *  changes when the setting does. */
export function useDeviceSetting<K extends DeviceSettingKey>(key: K): DeviceSettings[K] | undefined {
  return useSyncExternalStore(subscribe, () => peekSetting(key), () => DEFAULTS[key] as DeviceSettings[K] | undefined);
}

/** Whether storage has answered at least once (a value read before that is the default). */
export function deviceSettingsLoaded(): boolean { return version > 0; }
