/* Where each switch sits on /admin/modules. A module's own switch comes first, then its part switches: each part narrows
   one piece of the module and works only while the module's own switch is on too (the server checks both). The API
   lists the parts as switches of their own (module null), so the module each one belongs to is named here. Switches
   outside the modules (older stored ones) come last. */

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

/** Stored switches outside the module registry that narrow a module the way a part does: the server checks them on top
 *  of the module's own switch (progressPhotos in api/http/routes/progress.ts and api/domain/progress.ts photoFileAccess),
 *  so switching the module on leaves what they cover off while they are off. Switch → module. */
export const STORED_SWITCH_NARROWS: ReadonlyMap<string, string> = new Map([
  ['progressPhotos', 'progress'],
]);

/** What happens to the private files a module stored while the module is off, for every module that stores them. Files
 *  open through the shared file link (POST /api/files/:id/token, then GET /api/files/download), not through the module's
 *  routes, and that link applies each file kind's own rule (api/domain/files.ts resolverFor): Nutrition's meal photo rule
 *  and Progress's read the switch for coaches only (members keep opening their own), Messaging's for everyone, Support's
 *  export rule not at all. Each sentence is checked against the server in
 *  apps/api/tests/integration/portalShared.test.ts; when a rule changes, that test fails and the sentence here changes
 *  with it. */
export const FILES_WHILE_OFF: ReadonlyMap<string, string> = new Map([
  ['progress', 'the link still opens a member’s own progress photos for them, but none for coaches'],
  ['support', 'the link still opens a data export already made, for its member'],
  ['nutrition', 'the link still opens a member’s own meal photos for them, but none for coaches'],
  ['messaging', 'files on messages stay listed by name in conversations, but the link opens none of them'],
]);

/** The background jobs that keep running while their module is off (runWhenDisabled in api/modules/<key>.ts; every
 *  other module job stops), keyed "<module>.<job>", in registry order, each with what it does in plain words. The page's
 *  note under the switches and the switch-off dialog say these sentences; portalShared.test.ts fails when a module adds
 *  or drops such a job without a sentence here. */
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
