/* Whether the decorative 3D layers (the depth copies behind the brand mark, the drifting motes, the scroll depth on
   cards) should stand down: the OS asks for reduced motion, or, on the web, the browser asks to save data. The app has
   no way to read the phone's low-power setting without a new native module, so that one is not covered here; the
   layers it would switch off already come to rest on their own (the motes slow to a stop, the stack shows only while
   the mark moves) and do no work once settled. */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { useReduceMotion } from './useReduceMotion';

/** The browser's Save-Data preference (navigator.connection.saveData); false off the web or where it is not offered. */
export function prefersSaveData(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const connection = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

const subscribe = () => () => {};
const onServer = () => false; // the pre-rendered page and its hydration agree; the browser's answer follows right after

export function useCalmMotion(): boolean {
  const reduce = useReduceMotion();
  const saveData = useSyncExternalStore(subscribe, prefersSaveData, onServer);
  return reduce || saveData;
}
