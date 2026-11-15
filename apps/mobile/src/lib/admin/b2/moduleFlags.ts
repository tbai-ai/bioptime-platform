/* Where each switch sits on Admin › Modules, and what the switch dialogs say: the web page's rules
   (apps/dashboard/src/pages/admin/moduleFlags.ts and pages/admin/Modules.tsx) kept word for word, so the app shows the
   same order, the same "In the portal" column and the same computed dialog bodies as the portal.
   The web computes the "In the portal" counts and the part-switch sentences from its module registry
   (apps/dashboard/src/modules/*: the pages, links, client-record tabs, cards and settings each module adds to the portal).
   The app has no copy of that registry, so PORTAL_REGISTRY below carries the same figures: per module its title and,
   per contribution, the sub-flag it names (null when none), read from the portal's module files on 29 October 2026.
   When a module adds a page or a link to the portal, this list changes with it (the figures describe the portal, which
   is what the page says). Nothing here is shown unless GET /admin/modules lists the switch. */
import { label } from '../../format';

/** Part switch → the module it narrows. */
export const PART_FLAGS: ReadonlyMap<string, string> = new Map([
  ['support_requests', 'support'],
  ['help_centre', 'support'],
  ['imports', 'support'],
  ['public_webinars', 'sessions'],
]);

/** Stored switches outside the module registry that the portal still reads directly: what each one shows or hides. */
export const STORED_SWITCH_READS: ReadonlyMap<string, string> = new Map([
  ['progressPhotos', 'Progress: the member’s Photos tab and the coach’s view of shared photos'],
  ['phone_sign_in', 'Sign-in: the “Sign in with a phone code” link on the member sign-in page, the phone code page itself, and Confirm this number on the member’s Profile'],
]);

/** Stored switches outside the module registry that narrow a module the way a part does. Switch → module. */
export const STORED_SWITCH_NARROWS: ReadonlyMap<string, string> = new Map([
  ['progressPhotos', 'progress'],
]);

/** What happens to the private files a module stored while the module is off, for every module that stores them. */
export const FILES_WHILE_OFF: ReadonlyMap<string, string> = new Map([
  ['progress', 'the link still opens a member’s own progress photos for them, but none for coaches'],
  ['support', 'the link still opens a data export already made, for its member'],
  ['nutrition', 'the link still opens a member’s own meal photos for them, but none for coaches'],
  ['messaging', 'files on messages stay listed by name in conversations, but the link opens none of them'],
]);

/** The background jobs that keep running while their module is off, keyed "<module>.<job>", in registry order. */
export const JOBS_WHILE_OFF: ReadonlyMap<string, string> = new Map([
  ['habits.habit_followup_privacy', 'coach follow-ups that name a habit the member wrote themselves are closed within minutes once the member stops sharing health information with their coach'],
  ['progress.photo_retention', 'progress photos kept longer than the photo retention period in the module settings are deleted (with no period set, photos stay until the member deletes them)'],
  ['messaging.attachments_cleanup', 'files added to a message but not sent within 24 hours are deleted'],
  ['ai.draft_retention', 'Coach AI drafts kept longer than the draft retention period in the module settings are deleted'],
  ['growth.privacy_retention', 'discovery calls and corporate enquiries are deleted 180 days after they are closed (or after a year with no change), newsletter sign-ups never confirmed 30 days after their link expired, and addresses that left the newsletter 30 days after they unsubscribed'],
]);

/** The JOBS_WHILE_OFF sentences of one module. */
export function jobsWhileOff(moduleKey: string | null): string[] {
  return [...JOBS_WHILE_OFF].filter(([key]) => key.slice(0, key.indexOf('.')) === moduleKey).map(([, what]) => what);
}

export type FlagLike = { key: string; module: string | null };

export function isPartFlag(f: FlagLike): boolean { return PART_FLAGS.has(f.key); }

/** The module a switch belongs to: the one a part narrows, else the module the API names; null outside the modules. */
export function moduleOfFlag(f: FlagLike): string | null { return PART_FLAGS.get(f.key) ?? f.module ?? null; }

/** Module registry order; inside a module its own switch, then its parts by key; switches outside the modules last, by key. */
export function sortFlags<T extends FlagLike>(flags: readonly T[], moduleOrder: readonly string[]): T[] {
  const rank = (f: T) => { const m = moduleOfFlag(f); const i = m ? moduleOrder.indexOf(m) : -1; return i === -1 ? moduleOrder.length : i; };
  return [...flags].sort((a, b) => rank(a) - rank(b) || Number(isPartFlag(a)) - Number(isPartFlag(b)) || a.key.localeCompare(b.key));
}

/* ---------- the portal's module registry, as figures ---------- */

/** One module of the portal registry: its title and, per contribution, the sub-flag each item names (null for none). */
export type PortalModuleInfo = {
  key: string;
  title: string;
  routes: Array<string | null>;
  nav: Array<string | null>;
  clientTabs: Array<string | null>;
  cards: Array<string | null>;
  /** The settings the module declares, with the label and hint the portal shows in place of the server's wording. */
  settings: Array<{ key: string; label?: string; hint?: string }>;
};

const none = (n: number): Array<string | null> => Array.from({ length: n }, () => null);

/** apps/dashboard/src/modules/index.ts PORTAL_MODULES, in order (M1 to M11, then LabStack operations, growth, referrals). */
export const PORTAL_REGISTRY: PortalModuleInfo[] = [
  { key: 'habits', title: 'Habits', routes: none(1), nav: none(1), clientTabs: none(2), cards: none(1), settings: [{ key: 'habit_followup_missed_days', label: 'Coach follow-up after missed habit days', hint: 'Due days without any check-in before the assigned coach gets one follow-up for that habit. A habit the member added themselves gets one only while they share health information with their coach. Empty: no follow-ups. An owner decision; nothing is assumed.' }] },
  { key: 'progress', title: 'Progress', routes: none(2), nav: none(2), clientTabs: none(2), cards: none(1), settings: [{ key: 'progress_photo_retention_days', label: 'Progress photo retention (days)', hint: 'How long progress photos are kept after they are added. Empty: until the member deletes them. An owner decision; nothing is assumed.' }] },
  { key: 'billing', title: 'Billing', routes: none(2), nav: none(2), clientTabs: none(1), cards: none(1), settings: [
    { key: 'billing_entity', hint: 'The legal entity, GSTIN and registered address, exactly as the owner and counsel confirm them, for example {"legalName": "…", "gstin": "…", "address": "…"}; an optional sacCode is printed on each line. Until legalName, gstin and address are all set, members get receipts labelled “not a tax invoice”.' },
    { key: 'gst_rate_bp', hint: 'GST for new orders in basis points (1800 is 18%, the rate applied so far). Orders and their documents keep the rate they were priced with. The rate is an owner decision.' },
  ] },
  { key: 'support', title: 'Support', routes: [null, 'help_centre', 'support_requests', null, 'help_centre', 'support_requests', null, 'support_requests', 'help_centre', 'imports', 'imports'], nav: [null, null, null, 'help_centre', 'imports'], clientTabs: ['support_requests'], cards: none(1), settings: [] },
  { key: 'nutrition', title: 'Nutrition', routes: none(4), nav: none(3), clientTabs: none(1), cards: none(1), settings: [] },
  { key: 'workouts', title: 'Workouts', routes: none(7), nav: none(3), clientTabs: none(2), cards: none(3), settings: [] },
  { key: 'labFollowups', title: 'Lab follow-ups', routes: none(1), nav: none(1), clientTabs: none(2), cards: none(3), settings: [] },
  { key: 'sessions', title: 'Live sessions', routes: none(5), nav: none(3), clientTabs: none(2), cards: none(3), settings: [] },
  { key: 'messaging', title: 'Attachments and announcements', routes: none(3), nav: none(3), clientTabs: [], cards: none(1), settings: [] },
  { key: 'learning', title: 'Learning', routes: none(11), nav: none(4), clientTabs: none(2), cards: none(2), settings: [] },
  { key: 'ai', title: 'Coach AI', routes: none(3), nav: none(3), clientTabs: none(1), cards: [], settings: [{ key: 'ai_draft_retention_days', label: 'Coach AI draft retention (days)', hint: 'How long Coach AI drafts are kept before they are deleted. Empty: not decided, and Coach AI refuses every request until it is. An owner decision; nothing is assumed.' }] },
  { key: 'labstackOps', title: 'LabStack operations', routes: [], nav: [], clientTabs: [], cards: [], settings: [] },
  { key: 'growth', title: 'Growth', routes: none(6), nav: none(4), clientTabs: [], cards: none(1), settings: [] },
  { key: 'referrals', title: 'Referrals', routes: none(2), nav: none(2), clientTabs: [], cards: [], settings: [] },
];

export const MODULE_ORDER: string[] = PORTAL_REGISTRY.map((m) => m.key);

export function portalModule(key: string | null): PortalModuleInfo | undefined { return PORTAL_REGISTRY.find((m) => m.key === key); }

/** Does the module add anything to the portal (pages, links, tabs, cards or settings)? */
export function moduleHasUi(m: PortalModuleInfo | undefined): boolean {
  return !!m && !!(m.routes.length || m.nav.length || m.clientTabs.length || m.cards.length || m.settings.length);
}

/** The portal's title for a module, or the key as a label. */
export function moduleTitle(key: string | null): string { return portalModule(key)?.title ?? (key ? label(key) : '—'); }

const PART_NAMES: Array<[string, string]> = [['page', 'pages'], ['link', 'links'], ['client-record tab', 'client-record tabs'], ['card', 'cards'], ['setting', 'settings']];
/** "2 pages, 1 link": the counts in PART_NAMES order, zeros left out. */
export function countText(counts: number[]): string {
  return counts.map((n, i) => (n ? `${n} ${n === 1 ? PART_NAMES[i]![0] : PART_NAMES[i]![1]}` : '')).filter(Boolean).join(', ');
}

export const NOT_READ = 'Not read by the portal';

/** What a module adds to the portal, as the "In the portal" column reads it. */
export function portalParts(key: string | null): string {
  const m = portalModule(key);
  if (!m || !moduleHasUi(m)) return '—';
  return countText([m.routes.length, m.nav.length, m.clientTabs.length, m.cards.length, m.settings.length]);
}

/** What a part switch narrows in the portal: the module's pages, links, tabs and cards that name it, or NOT_READ. */
export function partPortalParts(moduleKey: string | null, flagKey: string): string {
  const m = portalModule(moduleKey);
  const count = (items?: Array<string | null>) => (items ?? []).filter((x) => x === flagKey).length;
  return (m && countText([count(m.routes), count(m.nav), count(m.clientTabs), count(m.cards)])) || NOT_READ;
}

/* ---------- the page's sentences ---------- */

export type Audience = { roles?: string[]; packageIds?: string[] };
export type Flag = { key: string; enabled: boolean; audience: Audience; description: string; updatedAt: string | null; updatedBy?: string | null; module: string | null; stored: boolean };
export type ApiModuleInfo = { key: string; feature: string; jobs: string[]; events: string[]; fileKinds: string[]; adherence: boolean; demoSeed: boolean; ungated?: string[] };
export type Setting = { key: string; module: string; label: string; hint: string; kind: 'days' | 'basis_points' | 'seller'; min?: number; max?: number; nullable: boolean; value: unknown };

export const ROLES = ['member', 'coach', 'admin', 'owner'];

const OFF_REMINDERS = 'The reminder queue skips its reminders while it is off, and they are not sent later; those due after it is back on go out as usual.';
const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
const OFF_FILES = `Private files open through a file link of their own, not through the module's routes, and a page already open can still use it; the link follows each module's own file rule: ${[...FILES_WHILE_OFF].map(([key, what]) => `with ${moduleTitle(key)} off, ${what}`).join('; ')}.`;
const jobKeyModule = (key: string) => key.slice(0, key.indexOf('.'));
const OFF_JOBS = `Its background jobs stop, except the clean-up that privacy needs, which keeps running: ${[...JOBS_WHILE_OFF].map(([key, what]) => `with ${moduleTitle(jobKeyModule(key))} off, ${what}`).join('; ')}.`;
/** The long note under the switches: what switching a module off does today. */
export const OFF_DETAIL = `Switching a module off: its server routes refuse requests at once, apart from the few that let people see or withdraw a consent or delete their own records, and the file links described below. The portal and the app hide its pages, links, tabs and cards; a portal or app already open may keep showing some of them until it is reloaded, and the module's routes refuse what they ask for. ${OFF_FILES} ${OFF_JOBS} Its event handlers do not run while it is off, and events dealt with in that time are not passed to them later. ${OFF_REMINDERS} Switching off deletes nothing it stored.`;

export const AUDIENCE_NOTE = 'An audience narrows a switch that is on: to some roles, or to members with an active programme of chosen packages (coaches and administrators are not narrowed by packages). A part switch narrows one piece of its module and works only while the module\'s own switch is on too.';

/** The switch's title: its module's title, else the key as words. */
export function flagTitle(f: Flag): string {
  return f.module ? moduleTitle(f.module) : label(f.key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase());
}

/** The "In the portal" column for one switch. */
export function inPortalText(f: Flag): string {
  const part = isPartFlag(f), parent = moduleOfFlag(f);
  return part ? partPortalParts(parent, f.key) : f.module ? portalParts(f.module) : STORED_SWITCH_READS.get(f.key) ?? NOT_READ;
}

export function audienceText(a: Audience, packages: Array<{ id: string; name: string }>): string {
  const parts: string[] = [];
  if (a.roles?.length) parts.push(a.roles.map(label).join(', '));
  if (a.packageIds?.length) parts.push(`members of ${a.packageIds.map((id) => packages.find((p) => p.id === id)?.name ?? id).join(', ')}`);
  return parts.length ? parts.join(' · ') : 'Everyone';
}

export function settingText(s: Setting): string {
  if (s.value === null || s.value === undefined) return 'Not decided';
  if (s.kind === 'seller') return Object.entries(s.value as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(' · ');
  if (s.kind === 'basis_points') return `${s.value} (${Number(s.value) / 100}%)`;
  return `${s.value} days`;
}

/** The label and hint the portal shows for a module setting: the module's own declaration wins over the server's. */
export function declaredSetting(key: string): { label?: string; hint?: string } | undefined {
  return PORTAL_REGISTRY.flatMap((m) => m.settings).find((x) => x.key === key);
}

/** What the switch-off dialog says: a module, a part of one, or a stored switch outside the modules. */
export function offBody(f: Flag): string {
  if (isPartFlag(f)) return `What it covers in ${moduleTitle(moduleOfFlag(f))} stops: its server routes refuse requests and the portal hides anything it shows for it. The rest of ${moduleTitle(moduleOfFlag(f))} keeps working. Nothing is deleted.`;
  if (f.module) return `Its server routes refuse requests (apart from the few listed under the switches), the portal and the app hide it, and its background jobs and event handlers stop${jobsWhileOff(f.module).length ? `, except the clean-up that privacy needs, which keeps running: ${jobsWhileOff(f.module).join('; ')}` : ''}. ${f.module && FILES_WHILE_OFF.has(f.module) ? `Its private files keep their own link: ${sentence(FILES_WHILE_OFF.get(f.module)!)} ` : ''}${OFF_REMINDERS} Nothing it stored is deleted.`;
  return 'Whatever reads this switch treats it as off. Nothing is deleted.';
}

/** And the switch-on dialog. A part's routes and portal items need the module's switch as well (the server checks
 *  both), so a part switched on while its module is off brings nothing back by itself. */
export function onBody(f: Flag, flags: Flag[]): string {
  if (isPartFlag(f)) {
    const m = moduleTitle(moduleOfFlag(f)), moduleOn = flags.some((x) => x.key === moduleOfFlag(f) && x.enabled);
    const inPortal = partPortalParts(moduleOfFlag(f), f.key);
    const read = inPortal !== NOT_READ;
    return moduleOn
      ? read
        ? `What it covers in ${m} works again for the people both this switch and ${m} reach: its server routes answer and the portal shows what needs it (${inPortal}); a portal already open may show it only once it is reloaded. The rest of ${m} is unchanged.`
        : `What it covers in ${m} works again for the people both this switch and ${m} reach: its server routes answer. No portal page reads this switch, so the portal looks the same either way. The rest of ${m} is unchanged.`
      : `This switch alone brings nothing back: what it covers also needs ${m} switched on, and ${m} is off now. Until ${m} is on too, its server routes keep refusing requests${read ? ' and the portal keeps hiding it' : ''}.${read ? '' : ' No portal page reads this switch, so the portal looks the same either way.'}`;
  }
  if (f.module) {
    const narrowedOff = flags.filter((x) => !x.enabled && (isPartFlag(x) ? moduleOfFlag(x) === f.module : STORED_SWITCH_NARROWS.get(x.key) === f.module)).map((x) => flagTitle(x));
    const except = narrowedOff.length ? `, except what ${narrowedOff.join(', ')} ${narrowedOff.length === 1 ? 'covers: that switch is off, and what it covers stays' : 'cover: those switches are off, and what they cover stays'} off until it is switched on too` : '';
    const pm = portalModule(f.module);
    const shows = moduleHasUi(pm) ? ` and the portal shows its pages, links, tabs and cards, for the switch's audience${except}. A portal or app already open may show them only once it is reloaded` : ` for the switch's audience${except}. It adds nothing to the portal yet`;
    return `Its server routes answer again${shows}. Its background jobs and event handlers run again; events dealt with while it was off are not passed to them, and reminders it skipped are not sent.`;
  }
  return 'Whatever reads this switch treats it as on. Nothing else changes.';
}
