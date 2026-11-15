/* Unmounted screens stayed in memory for good through a reference cycle in react-native-worklets 0.13; this breaks it
   (fix-MEM, 6 Nov 2026: G1-2, G2-2, T2-05). Nothing else changes: no motion, no timing, no look.
   - The cycle: worklets caches the clone of each worklet it serializes, and of the closure list and the plain objects in
     it, in serializableMappingCache, keyed by the JS object with a strong value. The clone holds every JS-thread
     function the worklet captured (a scheduleOnRN target, a callback) through a strong C++ handle. That function's
     scope is the component's scope, which holds the worklet again. A strong C++ handle is a GC root, so neither Hermes
     heap can ever free the circle, and with it the component's animated refs: each holds the shadow node of its view
     and the whole subtree under it. Every dormant page unmount, overlay close and player close left its tree behind
     (native heap +50 MB per round of the gate's session walk on the 2 GB emulator; a forced GC freed nothing).
   - The break: only the cache entries whose clone reaches a JS-thread function are held through a WeakRef. worklets
     already does this for those functions themselves (cloneNonWorkletFunction), and its cache reader already follows a
     WeakRef (getFromCache): an entry whose clone was collected is serialized again on its next use, as on a first use.
     Shared values, shareables, synchronizables, custom mappings (animated refs, guards), module-level worklets
     (withTiming, measureView) and every entry that reaches no JS-thread function keep their strong entry, so a
     UI-thread state object (makeShareable: a handler's context, a style's remote state) keeps its identity.
   - Native only (the web runs worklets on its one JS runtime, with no C++ handles) and worklets 0.13 only: another
     version logs a warning and is left alone, so an upgrade checks whether this is still needed (and still right).
   Imported first by the root layout, before any screen serializes a worklet. */
import { Platform } from 'react-native';
import { isWorkletFunction, serializableMappingCache } from 'react-native-worklets';

type Cache = { set: (key: object, ref?: unknown) => void; get: (key: object) => unknown };
type Marked = { __closure?: unknown; __remoteFunction?: unknown; _isReanimatedSharedValue?: unknown; __shareableRef?: unknown; __synchronizableRef?: unknown };

/** Deeper than this, an entry is taken to reach a JS-thread function (held weakly: never wrong, only re-serialized). */
const MAX_DEPTH = 8;

/** A shared value, a shareable or a synchronizable: worklets maps these itself, and they must keep their identity. */
const isShared = (o: Marked) => !!(o._isReanimatedSharedValue || o.__shareableRef || o.__synchronizableRef);

const isPlain = (v: object) => Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype;

/** Whether serializing `v` makes a remote function (a JS-thread function held from C++), memoized per object. */
function reachesJS(v: unknown, cache: Cache, seen: WeakMap<object, boolean>, depth: number): boolean {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return false;
  const o = v as Marked;
  const known = seen.get(o);
  if (known !== undefined) return known;
  if (depth > MAX_DEPTH) return true;
  let r = false;
  if (typeof v === 'function') {
    if (isWorkletFunction(v)) {
      seen.set(o, false); // a worklet that captures itself
      r = reachesJS(o.__closure, cache, seen, depth + 1);
    } else if (o.__remoteFunction) {
      r = true;
    } else {
      // a JS-thread function becomes a remote function, unless worklets maps it to its own clone (an animated ref, a
      // guard), which it keeps with a strong entry
      const mapped = cache.get(o);
      r = mapped === undefined || mapped instanceof WeakRef;
    }
  } else if (!isShared(o) && isPlain(v)) {
    seen.set(o, false); // a cycle inside the object
    const values = Array.isArray(v) ? v : Object.values(v);
    r = values.some((x) => reachesJS(x, cache, seen, depth + 1));
  }
  seen.set(o, r);
  return r;
}

function install() {
  if (Platform.OS === 'web' || typeof WeakRef === 'undefined') return;
  const version: string = require('react-native-worklets/package.json').version;
  if (!/^0\.13\./.test(version)) {
    console.warn(`[fx] workletCycles: react-native-worklets ${version}: the cycle break is written for 0.13 and is off; check whether it is still needed.`);
    return;
  }
  const cache = serializableMappingCache as unknown as Cache;
  const set = cache.set;
  const seen = new WeakMap<object, boolean>();
  cache.set = (key: object, ref?: unknown) => {
    // a clone (not the "is a clone" flag, not an entry already weak) of a worklet, a closure list or a plain object
    if (ref !== null && typeof ref === 'object' && !(ref instanceof WeakRef)
      && ((typeof key === 'function' && isWorkletFunction(key)) || (typeof key === 'object' && key !== null && !isShared(key as Marked) && isPlain(key)))
      && reachesJS(key, cache, seen, 0)) {
      set.call(cache, key, new WeakRef(ref));
      return;
    }
    set.call(cache, key, ref);
  };
}

install();
