/* Last-good copies of what the member has already seen, so the app still shows something sensible without a network.
   Nothing here is a source of truth; every screen refreshes from the API when it can and says when it could not. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';

const PREFIX = 'bp.cache.';

export async function readCache<T>(key: string): Promise<{ data: T; at: string } | null> {
  try { const raw = await AsyncStorage.getItem(PREFIX + key); return raw ? (JSON.parse(raw) as { data: T; at: string }) : null; } catch { return null; }
}
export async function writeCache<T>(key: string, data: T): Promise<void> {
  try { await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ data, at: new Date().toISOString() })); } catch { /* storage full or unavailable */ }
}
/* What the app holds in memory for one member (useLoad's prefetched answers) goes with the saved copies: those holders
   register here, and every clearCache (sign-in, sign-out, a dead session) drops them at once. `cacheGeneration` counts
   the clears, so an answer asked for before one (another member's) is never shown or saved after it. */
const memoryResets = new Set<() => void>();
let generation = 0;
export function onClearCache(fn: () => void): void { memoryResets.add(fn); }
export function cacheGeneration(): number { return generation; }

export async function clearCache(): Promise<void> {
  generation++;
  memoryResets.forEach((fn) => fn());
  try { const keys = await AsyncStorage.getAllKeys(); await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX))); } catch { /* ignore */ }
  await clearImageCaches();
}
/** Decoded images the image component may still hold (progress photos are private): its memory cache, and its disk cache
 *  in case anything was ever written there. Runs with clearCache (sign-in, sign-out, a dead session) and after a photo is
 *  deleted. On the web both calls are no-ops; the browser keeps nothing, as the server sends no-store. */
export async function clearImageCaches(): Promise<void> {
  try { await Image.clearMemoryCache(); } catch { /* not available on this platform */ }
  try { await Image.clearDiskCache(); } catch { /* not available on this platform */ }
}
