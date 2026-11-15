/* The device tier rule, pure (no imports at all: a node test loads this file by its URL). tier.ts builds the input from
   expo-device and Platform and calls tierFor; the stored override and the frame-time demotion sit on top of it there.
   Android: expo-device's totalMemory is the kernel's MemTotal, about 0.4-0.7 GiB under the size on the box, so the
   thresholds sit at 5.2 GiB (a 6 GB phone) and 3.3 GiB (a 4 GB phone); the API level keeps old graphics stacks out of
   the upper tiers. An unknown memory size counts as below 3.3. */
export type TierInput = { os: 'ios' | 'android' | 'web' | 'other'; gb: number | null; api: number | null; coarse: boolean; saveData: boolean };

export function tierFor(input: TierInput): 'A' | 'B' | 'C' {
  const { os, gb, api, coarse, saveData } = input;
  if (os === 'web') {
    if (saveData) return 'C';
    return coarse ? 'B' : 'A';
  }
  if (os === 'ios') return gb != null && gb >= 3.5 ? 'A' : 'B';
  // Android (and any other native platform)
  const mem = gb ?? 0;
  const level = api ?? 0;
  if (mem >= 5.2 && level >= 31) return 'A';
  if (mem >= 3.3 && level >= 28) return 'B';
  return 'C';
}
