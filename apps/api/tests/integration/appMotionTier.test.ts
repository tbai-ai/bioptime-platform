/* Motion v2 (wave 1, M03): the client app's device tier rule. src/fx/motion/tierRule.ts is pure (no import statement at
   all), so it is loaded here as it is, through a computed file URL that keeps it out of the API's typecheck, as
   appRound8.test.ts loads src/motion/depthMath.ts. tier.ts builds the input (Android: expo-device's totalMemory in GiB,
   which is the kernel's MemTotal and so 0.4-0.7 GiB under the size on the box, and Platform.Version as the API level)
   and keeps the stored override and the frame-time demotion on top. No server is needed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLATFORM = fileURLToPath(new URL('../../../../', import.meta.url));
const SRC = path.join(PLATFORM, 'apps/mobile/src');
const load = (spec: string): Promise<any> => import(spec);
const mobile = (rel: string): Promise<any> => load(pathToFileURL(path.join(SRC, rel)).href);
const source = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');

type Os = 'ios' | 'android' | 'web' | 'other';
const input = (os: Os, gb: number | null, api: number | null, coarse = false, saveData = false) => ({ os, gb, api, coarse, saveData });

test('tier rule: Android takes its tier from RAM and API level; iOS from RAM; the web from its pointer and Save-Data', async () => {
  const { tierFor } = await mobile('fx/motion/tierRule.ts');
  assert.equal(typeof tierFor, 'function');
  const table: Array<[string, ReturnType<typeof input>, 'A' | 'B' | 'C']> = [
    ['Android 7.4 GiB, API 34 (an 8 GB phone)', input('android', 7.4, 34), 'A'],
    ['Android 5.5 GiB, API 34 (a 6 GB phone)', input('android', 5.5, 34), 'A'],
    ['Android 5.5 GiB, API 30 (an old graphics stack keeps it out of A)', input('android', 5.5, 30), 'B'],
    ['Android 3.6 GiB, API 30 (a 4 GB phone)', input('android', 3.6, 30), 'B'],
    ['Android 3.6 GiB, API 27', input('android', 3.6, 27), 'C'],
    ['Android 2.0 GiB, API 36 (the 2 GB test emulator)', input('android', 2.0, 36), 'C'],
    ['Android, memory unknown, API 36', input('android', null, 36), 'C'],
    ['iOS 3.6 GiB', input('ios', 3.6, null), 'A'],
    ['iOS 3.0 GiB', input('ios', 3.0, null), 'B'],
    ['web, fine pointer', input('web', null, null), 'A'],
    ['web, coarse pointer', input('web', null, null, true), 'B'],
    ['web, Save-Data', input('web', null, null, false, true), 'C'],
    ['web, coarse pointer and Save-Data', input('web', null, null, true, true), 'C'],
  ];
  const wrong = table.filter(([, i, want]) => tierFor(i) !== want).map(([name, i, want]) => `${name}: got ${tierFor(i)}, want ${want}`);
  assert.deepEqual(wrong, []);
  // the thresholds sit where the comment says: just under 5.2 / 3.3 GiB drops a tier, API 31 / 28 are the floors
  assert.equal(tierFor(input('android', 5.19, 36)), 'B');
  assert.equal(tierFor(input('android', 5.2, 31)), 'A');
  assert.equal(tierFor(input('android', 3.29, 36)), 'C');
  assert.equal(tierFor(input('android', 3.3, 28)), 'B');
  assert.equal(tierFor(input('android', 8, null)), 'C', 'an unknown API level never reaches the upper tiers');
});

test('tier rule: tierRule.ts stays pure (no import at all), and tier.ts feeds it from RAM and API level, not the year class', () => {
  const rule = source('fx/motion/tierRule.ts');
  assert.doesNotMatch(rule, /^\s*import\s/m, 'tierRule.ts is loaded by file URL in node: it may not import anything');
  assert.doesNotMatch(rule, /\brequire\(/);
  const tier = source('fx/motion/tier.ts');
  assert.match(tier, /tierFor\(/, 'deviceTier() calls the pure rule');
  assert.match(tier, /totalMemory/, 'Android memory comes from expo-device totalMemory');
  assert.match(tier, /Platform\.Version/, 'the Android API level comes from Platform.Version');
  assert.doesNotMatch(tier, /deviceYearClass/, 'the year class never returned above 2016, so every Android phone was C');
  assert.ok(tier.includes("const OVERRIDE_KEY = 'bp.fx.motionTier';"), 'the stored override stays');
});
