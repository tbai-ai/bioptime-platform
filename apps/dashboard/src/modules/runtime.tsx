/* Reading the module registry (src/modules/index.ts) at run time: which flags are on for the signed-in person, and
   which of the modules' routes, navigation items, client-record tabs and cards may show.

   Nothing is fetched while no registered module contributes to the place being drawn, so with empty modules the portal
   makes the same requests and draws the same pages as before. A module's contributions show only while its flag (and
   any sub-flag the item names) is in GET /public/config → features, and the person holds the permission named. A page
   or navigation link that names `whileOff` also shows while its flags are off when that check resolves true (asked
   once per signed-in person and minute; the rules are in ./whileOff.ts); nothing changes for items that do not name it.
   LabStack operations are confined to the admin workspace behind labstack.manage, whatever the module declares. */
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { RequirePermission, useAuth } from '../lib/auth';
import { Empty, Skeleton } from '../ui';
import { PORTAL_MODULES } from './index';
import type { ModuleCard, ModuleClientTab, ModuleNavItem, ModuleRoute, PortalModule, Workspace } from './types';
import { checksKey, createWhileOffCache, pageState, shownWith, type WhileOff, type WhileOffAnswers } from './whileOff';

/* ---------- the flags that are on for this person ---------- */

let cached: { who: string; at: number; promise: Promise<Set<string>> } | null = null;
const FRESH_MS = 60_000;

/** The enabled flags, fetched once per signed-in person and reused for a minute. */
export function loadFeatures(who: string): Promise<Set<string>> {
  if (cached && cached.who === who && Date.now() - cached.at < FRESH_MS) return cached.promise;
  const promise = api.get<{ features?: string[] }>('/public/config').then((c) => new Set(c?.features ?? []), () => new Set<string>());
  cached = { who, at: Date.now(), promise };
  return promise;
}
/** Forget the cached flags (after an administrator switches one on /admin/modules), and the whileOff answers with them. */
export function refreshFeatures(): void { cached = null; whileOffCache.clear(); }

/** The enabled flags, or null while loading. Fetches only when `active` (something registered wants to show). */
export function useFeatures(active: boolean): Set<string> | null {
  const { user } = useAuth();
  const who = user?.id ?? 'signed-out';
  const [features, setFeatures] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void loadFeatures(who).then((f) => { if (alive) setFeatures(f); });
    return () => { alive = false; };
  }, [active, who]);
  return active ? features : null;
}

/* ---------- shown while off ---------- */

const whileOffCache = createWhileOffCache(FRESH_MS);
const NO_ANSWERS: WhileOffAnswers = new Map();

/** The answers of these whileOff checks for the signed-in person, asked under the flag set `features` (a refreshed set
 *  asks again) and cached for a minute like the flags; empty until they arrive. Nothing is asked for no checks. */
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

/* ---------- rules every contribution passes ---------- */

export function featureOf(m: PortalModule): string { return m.feature ?? m.key; }

const LABSTACK_MODULE = 'labstackOps';
const LABSTACK_PERMISSION = 'labstack.manage';

function flagsOn(features: Set<string> | null, m: PortalModule, sub?: string): boolean {
  return !!features && features.has(featureOf(m)) && (!sub || features.has(sub));
}

function permitted(can: (p: string) => boolean, permission?: string | string[], any?: boolean): boolean {
  if (!permission) return true;
  const list = ([] as string[]).concat(permission);
  return any ? list.some((p) => can(p)) : list.every((p) => can(p));
}

/** LabStack operations stay in the admin workspace and need labstack.manage, on top of what the item asks. */
function labstackAllowed(m: PortalModule, workspace: Workspace, can: (p: string) => boolean): boolean {
  return m.key !== LABSTACK_MODULE || (workspace === 'admin' && can(LABSTACK_PERMISSION));
}

/** Does this module contribute anything to the portal? */
export function moduleHasUi(m: PortalModule): boolean {
  return !!(m.routes?.length || m.nav?.length || m.clientTabs?.length || m.cards?.length || m.settings?.length);
}
/** Does any registered module contribute anything to the portal? */
export function hasModuleUi(): boolean { return PORTAL_MODULES.some(moduleHasUi); }

/* ---------- navigation ---------- */

/** The module navigation items to show in a workspace, in registry order: flags on, or off with a whileOff that said
 *  yes; LabStack and permission rules either way. */
export function useModuleNav(workspace: Workspace): ModuleNavItem[] {
  const { can } = useAuth();
  const candidates = PORTAL_MODULES.flatMap((m) => (m.nav ?? []).filter((n) => n.workspace === workspace).map((n) => ({ m, n })));
  const features = useFeatures(candidates.length > 0);
  const allowed = candidates.filter(({ m, n }) => labstackAllowed(m, workspace, can) && permitted(can, n.permission, n.any));
  const answers = useWhileOff(features ? allowed.filter(({ m, n }) => n.whileOff && !flagsOn(features, m, n.feature)).map(({ n }) => n.whileOff!) : [], features);
  return allowed.filter(({ m, n }) => shownWith(flagsOn(features, m, n.feature), features ? n.whileOff : undefined, answers)).map(({ n }) => n);
}

/* ---------- routes ---------- */

export type ModuleRouteEntry = ModuleRoute & { key: string; module: PortalModule };

/** The module pages of a workspace, for App.tsx to mount (each behind ModuleRouteGate). */
export function moduleRoutes(workspace: Workspace): ModuleRouteEntry[] {
  return PORTAL_MODULES.flatMap((m) => (m.routes ?? []).filter((r) => r.workspace === workspace && (m.key !== LABSTACK_MODULE || workspace === 'admin')).map((r) => ({ ...r, key: `${m.key}:${r.path}`, module: m })));
}

/** A module page: shown while its flag is on, or while it is off and the page's whileOff says yes (a skeleton while that
 *  is asked), and the permission is held; otherwise the portal's "no such page". */
export function ModuleRouteGate({ entry }: { entry: ModuleRouteEntry }) {
  const { can } = useAuth();
  const features = useFeatures(true);
  const on = flagsOn(features, entry.module, entry.feature);
  const allowed = labstackAllowed(entry.module, entry.workspace, can);
  const answers = useWhileOff(features && !on && allowed && entry.whileOff ? [entry.whileOff] : [], features);
  const state = pageState({ flagsLoaded: !!features, on, allowed, whileOff: entry.whileOff, answers });
  if (state === 'loading') return <Skeleton rows={6} />;
  if (state === 'none') return <Empty title="No such page" body="Use the sections on the left." />;
  return entry.permission ? <RequirePermission permission={entry.permission} any={entry.any}>{entry.element}</RequirePermission> : <>{entry.element}</>;
}

/* ---------- client-record tabs ---------- */

/** The module tabs for the client record in the coach or admin workspace. */
export function useModuleTabs(workspace: 'coach' | 'admin'): ModuleClientTab[] {
  const { can } = useAuth();
  const candidates = PORTAL_MODULES.flatMap((m) => (m.clientTabs ?? []).filter((t) => !t.workspaces || t.workspaces.includes(workspace)).map((t) => ({ m, t })));
  const features = useFeatures(candidates.length > 0);
  return candidates.filter(({ m, t }) => flagsOn(features, m, t.feature) && labstackAllowed(m, workspace, can) && permitted(can, t.permission, t.any)).map(({ t }) => t);
}

/* ---------- home cards ---------- */

const PLACEMENT_WORKSPACE: Record<ModuleCard['placement'], Workspace> = { clientHome: 'client', coachToday: 'coach', adminOverview: 'admin' };

/** The module cards for one home page. */
export function useModuleCards(placement: ModuleCard['placement']): ModuleCard[] {
  const { can } = useAuth();
  const candidates = PORTAL_MODULES.flatMap((m) => (m.cards ?? []).filter((c) => c.placement === placement).map((c) => ({ m, c })));
  const features = useFeatures(candidates.length > 0);
  return candidates.filter(({ m, c }) => flagsOn(features, m, c.feature) && labstackAllowed(m, PLACEMENT_WORKSPACE[placement], can) && permitted(can, c.permission, c.any)).map(({ c }) => c);
}

/** Draws module cards into a page's existing grid; nothing at all when there are none. */
export function ModuleCards({ cards }: { cards: ModuleCard[] }) {
  if (!cards.length) return null;
  return <>{cards.map((c) => <div key={c.id} className={`span${c.span ?? 6}`}>{c.render()}</div>)}</>;
}
