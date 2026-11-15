/* "Shown while off": a module page or navigation link may carry `whileOff`, a check that keeps it reachable while the
   module's flag (or the item's sub-flag) is off for the signed-in person, for example a consent on record that must stay
   withdrawable. The rules live here, free of React, so they can be tested as they are; runtime.tsx draws with them.
   - A check is asked only for an item whose flags are off and that the person may otherwise open (LabStack and
     permission rules first), and at most once per signed-in person and minute, like the flags. A new person, a new set of
     flags (scope) or clear() asks again.
   - Only a resolved `true` counts as yes: false, any other value, a rejection or a thrown error all count as no.
   - An item whose flags are on shows as before, and its check is never asked. Items without `whileOff` are unaffected.
   The app keeps an identical copy in apps/mobile/src/lib/whileOff.ts. The server still enforces everything. */

export type WhileOff = () => Promise<boolean>;
export type WhileOffAnswers = ReadonlyMap<WhileOff, boolean>;

type Entry = { who: string; scope: unknown; at: number; promise: Promise<boolean> };

function ask(fn: WhileOff): Promise<boolean> {
  try { return Promise.resolve(fn()).then((v) => v === true, () => false); }
  catch { return Promise.resolve(false); }
}

/** A per-person cache of whileOff answers, each kept for `freshMs`. `scope`, when given, must match too (the flag set the
 *  answer was asked under, so a refreshed set asks again). */
export function createWhileOffCache(freshMs: number, now: () => number = Date.now) {
  const entries = new Map<WhileOff, Entry>();
  const load = (who: string, fn: WhileOff, scope?: unknown): Promise<boolean> => {
    const c = entries.get(fn);
    if (c && c.who === who && c.scope === scope && now() - c.at < freshMs) return c.promise;
    const promise = ask(fn);
    entries.set(fn, { who, scope, at: now(), promise });
    return promise;
  };
  /** Every check's answer for one person, by check (each check asked once). */
  const loadAll = (who: string, fns: WhileOff[], scope?: unknown): Promise<Map<WhileOff, boolean>> =>
    Promise.all([...new Set(fns)].map((fn) => load(who, fn, scope).then((v) => [fn, v] as const))).then((pairs) => new Map(pairs));
  return { load, loadAll, clear: (): void => { entries.clear(); } };
}

const ids = new WeakMap<WhileOff, number>();
let nextId = 1;
/** A stable key naming a list of checks (an effect's dependency): '' for none. */
export function checksKey(fns: WhileOff[]): string {
  return fns.map((fn) => { let id = ids.get(fn); if (!id) { id = nextId++; ids.set(fn, id); } return id; }).join(',');
}

/** Does an item show? Its flags are on, or they are off and its whileOff answered yes (not answered yet: no). */
export function shownWith(on: boolean, whileOff: WhileOff | undefined, answers: WhileOffAnswers): boolean {
  return on || (!!whileOff && answers.get(whileOff) === true);
}

/** A module page: 'loading' while the flags (or, with its flags off, its whileOff answer) are still coming, 'show', or
 *  'none' (the portal's "no such page"). `allowed` is the LabStack rule, which whileOff never overrides; the page's
 *  permission is checked after this, as before. */
export function pageState(p: { flagsLoaded: boolean; on: boolean; allowed: boolean; whileOff?: WhileOff; answers: WhileOffAnswers }): 'loading' | 'show' | 'none' {
  if (!p.flagsLoaded) return 'loading';
  if (!p.allowed) return 'none';
  if (p.on) return 'show';
  if (!p.whileOff) return 'none';
  const a = p.answers.get(p.whileOff);
  return a === undefined ? 'loading' : a ? 'show' : 'none';
}
