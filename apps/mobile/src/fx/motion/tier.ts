/* How much motion this device and this person get (PREMIUM §1.9, AMENDED §1 "Lite/tiers").
   - The rule lives in ./tierRule (pure, tested by file): Android A with ≥ 5.2 GiB reported (a 6 GB phone) on API 31+,
     B with ≥ 3.3 GiB (a 4 GB phone) on API 28+, else C; iOS A with ≥ 3.5 GB, else B; the web A, B with a coarse
     pointer, C with Save-Data. Tier C also follows the device setting "Reduce effects".
   - Calm: the OS asks for reduced motion (src/motion useCalmMotion, which also counts Save-Data): every component draws
     its rest state at every tier.
   - Override: `bp.fx.motionTier` (F's device settings; E2E and support) wins over everything and stops the probe.
   - Demotion: once Home is in front after the launch sting has released, <DemotionProbe /> counts long frames for 3 s
     (never a sting frame, never while the page is inactive); above 12 % the tier drops by one for 7 days
     (`bp.fx.motionDemotion`). It never runs under a webdriver, so E2E stays deterministic.
   `lite` (BUILD's useLiteMotion) is `calm || tier === 'C'`. On the web the first render already knows the override and
   the demotion (localStorage is read synchronously), so a test page never changes tier after its first frame. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useCalmMotion, prefersSaveData } from '@/motion/useCalmMotion';
import { useInStaticHtml } from '@/motion/staticHtml';
import { useDeviceSetting, type MotionTier } from '@/fx/device/settings';
import { tierFor } from './tierRule';

export type { MotionTier };

const OVERRIDE_KEY = 'bp.fx.motionTier';
const DEMOTION_KEY = 'bp.fx.motionDemotion';
const DEMOTION_DAYS = 7;
const PROBE_MS = 3000;
const LONG_FRAME = 1.6;
const LONG_SHARE = 0.12;

const isTier = (v: unknown): v is MotionTier => v === 'A' || v === 'B' || v === 'C';
const lower = (tier: MotionTier): MotionTier => (tier === 'A' ? 'B' : 'C');
const rank = { A: 0, B: 1, C: 2 } as const;

/** The web's coarse-pointer query, made once: deviceTier is every useFx's store snapshot, read on each render of each
 *  component that asks, and a new matchMedia per read showed up in tab-switch profiles. */
let coarseQuery: MediaQueryList | null | undefined;
function coarsePointer(): boolean {
  if (coarseQuery === undefined) coarseQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
  return !!coarseQuery?.matches;
}

/** The tier the hardware earns, before any setting (the pure rule in ./tierRule). */
export function deviceTier(): MotionTier {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return 'A'; // the pre-rendered HTML; the browser answers right after
    return tierFor({ os: 'web', gb: null, api: null, coarse: coarsePointer(), saveData: prefersSaveData() });
  }
  const gb = Device.totalMemory ? Device.totalMemory / 1024 ** 3 : null;
  const api = Platform.OS === 'android' && typeof Platform.Version === 'number' ? Platform.Version : null;
  const os = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'other';
  return tierFor({ os, gb, api, coarse: true, saveData: false });
}

/* ---------- the stored demotion (and, on the web, a synchronous first read of the override) ---------- */

type Demotion = { tier: MotionTier; until: number };

function parseTier(raw: string | null): MotionTier | null {
  if (raw == null) return null;
  if (isTier(raw)) return raw; // a bare letter (set by hand)
  try { const v = JSON.parse(raw); return isTier(v) ? v : null; } catch { return null; }
}

function parseDemotion(raw: string | null): Demotion | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Demotion>;
    return isTier(v.tier) && typeof v.until === 'number' && v.until > Date.now() ? { tier: v.tier, until: v.until } : null;
  } catch { return null; }
}

function readWebSync(key: string): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

let demotion: Demotion | null = parseDemotion(readWebSync(DEMOTION_KEY));
const webOverride: MotionTier | null = parseTier(readWebSync(OVERRIDE_KEY));
const listeners = new Set<() => void>();
const publish = () => { listeners.forEach((l) => l()); };

if (Platform.OS !== 'web') {
  AsyncStorage.getItem(DEMOTION_KEY).then((raw) => { demotion = parseDemotion(raw); publish(); }, () => { /* none */ });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const demotionSnapshot = () => demotion;
const serverDemotion = (): Demotion | null => null;

async function storeDemotion(tier: MotionTier) {
  demotion = { tier, until: Date.now() + DEMOTION_DAYS * 86400000 };
  publish();
  try { await AsyncStorage.setItem(DEMOTION_KEY, JSON.stringify(demotion)); } catch { /* kept for this run */ }
}

/* ---------- hooks ---------- */

/** The effective tier: the override, else "Reduce effects" (C), else the device tier lowered by a stored demotion. */
export function useMotionTier(): MotionTier {
  const override = useDeviceSetting('motionTier');
  const reduceEffects = useDeviceSetting('reduceEffects');
  // the stored demotion as the store's snapshot (a module variable read beside a version counter could be kept stale
  // by the React Compiler's memoisation)
  const stored = useSyncExternalStore(subscribe, demotionSnapshot, serverDemotion);
  const device = useSyncExternalStore(subscribe, deviceTier, () => 'A' as MotionTier);
  const forced = isTier(override) ? override : webOverride;
  if (forced) return forced;
  if (reduceEffects === true) return 'C';
  const d = stored && stored.until > Date.now() ? stored.tier : null;
  return d && rank[d] > rank[device] ? d : device;
}

export type MotionState = {
  tier: MotionTier;
  /** Reduced motion (or Save-Data): rest states only, at every tier. */
  calm: boolean;
  /** BUILD's useLiteMotion: calm, or tier C. No blur, idle loops or previews. */
  lite: boolean;
  /** This component is part of the web build's pre-rendered HTML: draw it at rest, play no entrance. */
  inHtml: boolean;
  /** calm || inHtml: render the final state from the first frame. */
  still: boolean;
};

export function useMotion(): MotionState {
  const tier = useMotionTier();
  const calm = useCalmMotion();
  const inHtml = useInStaticHtml(Platform.OS === 'web');
  return { tier, calm, lite: calm || tier === 'C', inHtml, still: calm || inHtml };
}

/** BUILD_PLAN's name for the light mode: calm, or tier C. */
export function useLiteMotion(): boolean {
  return useMotion().lite;
}

function underWebdriver(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  return (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
}

/** Counts long frames for 3 s while `active` and drops the tier by one for 7 days when more than 12 % are long. Runs at
 *  most once per launch; never under a webdriver, an override, calm, or at tier C. The count starts on the first frame
 *  after the launch sting has released (never a sting frame) on which the page around it is active. */
let probed = false;
let splashReleasedAt: number | null = null;
export function useDemotionProbe(active: boolean): void {
  const tier = useMotionTier();
  const calm = useCalmMotion();
  const override = useDeviceSetting('motionTier');
  // read when first needed: the launch sting imports this file, and both modules below read the sting's state
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const splash = (require('@/fx/brand/SplashHost') as typeof import('@/fx/brand/SplashHost')).useSplashState();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pageActive = (require('@/fx/nav/pageReady') as typeof import('@/fx/nav/pageReady')).usePageActive();
  const released = splash !== 'running';
  const eligible = active && released && !probed && !calm && tier !== 'C' && !isTier(override) && !webOverride && !underWebdriver();
  const wasRunning = useRef(splash === 'running');
  useEffect(() => {
    if (splash === 'running') { wasRunning.current = true; return; }
    if (wasRunning.current && splashReleasedAt == null) splashReleasedAt = Date.now();
  }, [splash]);

  const finish = (long: number, total: number) => {
    frame.setActive(false);
    if (total >= 30 && long / total > LONG_SHARE) void storeDemotion(lower(tier));
  };
  const began = (at: number) => {
    if (__DEV__) console.log(`[motion] demotion probe started at ${at}; launch sting ${splash}, released at ${splashReleasedAt ?? 'n/a (not seen running here)'}`);
  };
  const counts = useSharedValue({ min: 1000 / 60, long: 0, total: 0, t0: -1, done: false });
  const frame = useFrameCallback((info) => {
    'worklet';
    const s = counts.get();
    if (s.done) return;
    if (pageActive.get() !== 1) return; // hold until the page is in front
    if (s.t0 < 0) {
      counts.set({ min: s.min, long: 0, total: 0, t0: info.timestamp, done: false });
      scheduleOnRN(began, Date.now());
      return;
    }
    const dt = info.timeSincePreviousFrame;
    if (dt == null) return;
    const min = dt >= 4 ? Math.min(s.min, dt) : s.min; // the refresh interval, measured
    const next = { min, long: s.long + (dt > LONG_FRAME * min ? 1 : 0), total: s.total + 1, t0: s.t0, done: info.timestamp - s.t0 >= PROBE_MS };
    counts.set(next);
    if (next.done) scheduleOnRN(finish, next.long, next.total);
  }, false);

  useEffect(() => {
    if (!eligible) return;
    probed = true;
    frame.setActive(true);
    return () => { frame.setActive(false); };
    // one probe per launch, started when Home first becomes active after the sting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible]);
}

/** Mount on Home for its first show after sign-in (S2). Renders nothing. */
export function DemotionProbe({ active = true }: { active?: boolean }) {
  useDemotionProbe(active);
  return null;
}
