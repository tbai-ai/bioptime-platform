/* The app's module registry: the entries each module adds to the Home, Plan and Me tabs, gathered from
   src/lib/modules/<key>.ts (one file per module, empty until its builder fills it). An entry shows only while its flag is
   on for the signed-in member (lib/features.ts), or, for an entry that names `whileOff`, while that check resolves true
   with the flag off (asked once per member and minute, again after refreshFeatures; rules in ./whileOff.ts). With no
   entries the tabs look and load exactly as before, and nothing changes for entries that do not name `whileOff`. */
import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { useFeatures } from './features';
import { checksKey, createWhileOffCache, shownWith, type WhileOff, type WhileOffAnswers } from './whileOff';
import { entries as habits } from './modules/habits';
import { entries as progress } from './modules/progress';
import { entries as billing } from './modules/billing';
import { entries as support } from './modules/support';
import { entries as nutrition } from './modules/nutrition';
import { entries as workouts } from './modules/workouts';
import { entries as labFollowups } from './modules/labFollowups';
import { entries as sessions } from './modules/sessions';
import { entries as messaging } from './modules/messaging';
import { entries as learning } from './modules/learning';
import { entries as ai } from './modules/ai';
import { entries as labstackOps } from './modules/labstackOps';
import { entries as growth } from './modules/growth';
import { entries as referrals } from './modules/referrals';

export type ModuleKey = 'habits' | 'progress' | 'billing' | 'support' | 'nutrition' | 'workouts' | 'labFollowups' | 'sessions' | 'messaging' | 'learning' | 'ai' | 'labstackOps' | 'growth' | 'referrals';
export type Placement = 'home' | 'plan' | 'me';

/** One link in a tab: `route` is an expo-router path ('/habits'); `icon` an Ionicons name. The module's flag (its key) must
 *  be on, and `feature` too when the entry names a sub-flag. `whileOff`: shown while those flags are off when it
 *  resolves true, for example a member's granted consent on record so it can be withdrawn (the server still enforces
 *  everything). */
export type ModuleEntry = { key: ModuleKey; feature?: string; title: string; sub?: string; route: string; icon?: string; placement: Placement; whileOff?: WhileOff };

// LabStack operations never reach the member app, whatever its list says
export const MODULE_ENTRIES: ModuleEntry[] = [...habits, ...progress, ...billing, ...support, ...nutrition, ...workouts, ...labFollowups, ...sessions, ...messaging, ...learning, ...ai, ...labstackOps, ...growth, ...referrals].filter((e) => e.key !== 'labstackOps');

const whileOffCache = createWhileOffCache(60_000);
const NO_ANSWERS: WhileOffAnswers = new Map();

/** The answers of these whileOff checks for the signed-in member, asked under the flag set `features`: a minute at most,
 *  like the flags, and again once refreshFeatures (or a new sign-in) brings a new set. Empty until they arrive. */
function useWhileOff(checks: WhileOff[], features: Set<string> | null): WhileOffAnswers {
  const { user } = useAuth();
  const who = user?.id ?? 'signed-out';
  const key = checksKey(checks);
  const [got, setGot] = useState<{ who: string; key: string; features: Set<string> | null; answers: WhileOffAnswers } | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void whileOffCache.loadAll(who, checks, features).then((answers) => { if (alive) setGot({ who, key, features, answers }); });
    return () => { alive = false; };
  }, [who, key, features]); // the key names the checks
  return got && got.who === who && got.key === key && got.features === features ? got.answers : NO_ANSWERS;
}

/** The entries for one tab, in registry order (empty while the flags load): flag on, or off with a whileOff that said yes. */
export function useModuleEntries(placement: Placement): ModuleEntry[] {
  const candidates = MODULE_ENTRIES.filter((e) => e.placement === placement);
  const features = useFeatures(candidates.length > 0);
  const on = (e: ModuleEntry) => !!features && features.has(e.key) && (!e.feature || features.has(e.feature));
  const answers = useWhileOff(features ? candidates.filter((e) => e.whileOff && !on(e)).map((e) => e.whileOff!) : [], features);
  return features ? candidates.filter((e) => shownWith(on(e), e.whileOff, answers)) : [];
}
