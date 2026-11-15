/* Whether the OS asks for reduced motion. Starts from reanimated's useReducedMotion (the setting when the app started)
   and follows the setting if it changes while the app runs (one shared AccessibilityInfo listener for the whole app).
   While it is true every primitive in src/motion renders its content in the final, static state straight away. */
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

let live: boolean | null = null; // null until a live reading or a change arrives
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

function publish(value: boolean) {
  if (live === value) return;
  live = value;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!unsubscribe) {
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => publish(!!v));
    unsubscribe = () => sub.remove();
    AccessibilityInfo.isReduceMotionEnabled().then((v) => publish(!!v), () => { /* keep the launch value */ });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && unsubscribe) { unsubscribe(); unsubscribe = null; }
  };
}

const snapshot = () => live;

export function useReduceMotion(): boolean {
  const atLaunch = useReducedMotion();
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return current ?? atLaunch;
}
