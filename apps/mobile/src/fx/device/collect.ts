/* Memory on a small phone (T2-05 / G1-2 / G2-2, release gate r5): both JavaScript heaps are collected once the app is
   quiet after a heavy screen has gone (a photo overlay closed: the workout player or a library exercise; a tab page
   unmounted as dormant).
   - Why: Hermes collects a closed screen late. It sees only its own heap, not the native memory the screen's objects
     hold (each view's shadow node and the subtree under it, a clip's player), so on a 2 GB phone a session kept
     45-90 MB more than it needed between collections (gate r4: 545-612 MB through a tier-C session against the 520 MB
     budget; five player opens +64 MB). The worklets cycle that kept such screens for good is broken at startup
     (../workletCycles); this only brings their collection forward. Measured on the 2 GB emulator (tier C): ten player
     opens grew PSS by 17 MB with it and 60 MB without it (gate-r5 measure/memab_*).
   - What: the UI runtime first (its copies of a closed screen's worklets hold that screen's functions on the JS side),
     then the JS runtime, each with Hermes' own gc() (19-27 ms on the UI thread, 44-56 ms on the JS thread there).
   - When: AFTER_MS after the screen has gone (an overlay's closing flight and the page under it have settled by then),
     once no finger is on the screen and none has gone down or up for QUIET_MS (a fling's momentum is over); a busy
     moment is tried again RETRY_MS later, TRIES times at most, and then left to Hermes. Each new call starts the wait
     again, so a run of closes collects once. Nothing moves then: tier C runs no decorative loop, nothing is touched.
   - Where: iOS and Android hardware of tier C only (under 3.3 GiB, ../motion/tierRule), whatever the motion setting;
     a larger phone and the web never collect. Nothing that looks or moves changes. */
import { Platform } from 'react-native';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { lastTouchAt, touching } from '../motion/budget';
import { deviceTier } from '../motion/tier';

/** After the screen has gone (ms). */
const AFTER_MS = 1500;
/** No finger down or up for this long (ms). */
const QUIET_MS = 1000;
/** A busy moment: tried again this much later (ms), at most TRIES times. */
const RETRY_MS = 700;
const TRIES = 10;

const ON = Platform.OS !== 'web' && deviceTier() === 'C';
let timer: ReturnType<typeof setTimeout> | null = null;

type Collectable = { gc?: () => void };

/** The JS runtime's collection (after the UI runtime's). */
function collectJS(): void {
  const g = globalThis as unknown as Collectable;
  if (typeof g.gc === 'function') g.gc();
}

/** The UI runtime's collection, then the JS runtime's (a module-level worklet, run on the UI thread). */
const collectBoth = () => {
  'worklet';
  const g = globalThis as unknown as Collectable;
  if (typeof g.gc === 'function') g.gc();
  scheduleOnRN(collectJS);
};

/** A heavy screen has gone: collect both heaps at the next quiet moment (see the header). */
export function collectWhenQuiet(): void {
  if (!ON) return;
  if (timer) clearTimeout(timer);
  let tries = 0;
  const attempt = () => {
    timer = null;
    if (touching() || Date.now() - lastTouchAt() < QUIET_MS) {
      tries += 1;
      if (tries < TRIES) timer = setTimeout(attempt, RETRY_MS);
      return;
    }
    scheduleOnUI(collectBoth);
  };
  timer = setTimeout(attempt, AFTER_MS);
}
