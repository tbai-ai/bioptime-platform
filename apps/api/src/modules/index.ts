/* The API module registry. Each module is one entry here; the app registers its routes inside /api, the job runner
   appends its jobs, the outbox merges its event handlers, the file store asks its access resolvers, the demo seed calls
   its seedDemo and GET /me/adherence (M2) reads its adherence provider, all from this list.

   Every module below has its own descriptor (api/modules/<key>.ts) and a flag seeded off (by 0008_foundation.sql for the
   first twelve, by 0031_growth_referrals_flags.sql for growth and referrals), so the modules were built in parallel
   without touching this file.

   The list is built the first time something reads it, not while this file loads. A module file imports routes and
   domain files that read the registry, so whichever api/modules/<key>.ts a process imports first is still loading when
   this file runs; building the list here would read that module before it exists. Read MODULES inside a function,
   never at the top level of a file.

   Module migrations (the runner applies any unapplied file in name order). These are the files that exist; once applied
   to a database a migration file is never edited. The first eleven depend only on 0001 to 0008; growth and referrals,
   registered on 24 October 2026, also depend on 0031, which holds their switches:
     habits        0009_habits.sql            M1 Habits and reminders
     progress      0010_progress.sql          M2 Progress: goals, check-ins, photos, range charts and adherence
     billing       0011_billing.sql           M3 Billing documents and refund requests
     support       0012_support.sql           M4 Support requests, help centre, data export, imports and coach onboarding
     nutrition     0013_nutrition.sql         M5 Nutrition
     workouts      0014_workouts.sql          M6 Workouts
     labFollowups  0015_labFollowups.sql      M7 Lab follow-ups and preparation reminders
     sessions      0016_sessions.sql          M8 Live sessions, webinars and consultation follow-through
     messaging     0017_messaging.sql         M9 Message attachments and announcements
     learning      0018_learning.sql          M10 Learning
     ai            0019_ai.sql                M11 Coach AI drafting
     labstackOps   (none)                     LabStack operations (administration only, behind labstack.manage)
     growth        0033_growth.sql            Growth: call slots, discovery calls, corporate enquiries, newsletter subscribers
                                              (double opt-in) and team notes; DC and CE references
     referrals     0034_referrals.sql         Referrals: each member's referral code and the members who joined with one
   Integration files after the modules (additive only):
                   0020_integration_core.sql  reminders.skip_reason (why a due reminder was skipped, module_off among them)
                   0021_integration_admin.sql the administrator's note on a data request, apart from the member's note
   Later additive fixes (each says in its header what it changes and why; gaps in the numbering are unused numbers):
                   0025_nutrition_fixes.sql   meal plan versions keep their own title
                   0026_workouts_fixes.sql    workout programme versions keep their own title and start date
                   0029_learning_fixes.sql    when a coach assignment of a course began (course_enrollments.assigned_at)
                   0031_growth_referrals_flags.sql the switches of the growth and referrals modules (24 October), off
                   0035_phone_sign_in.sql     the phone_sign_in switch and phone sign-in codes (identity, not a module:
                                              api/auth/phoneSignIn.ts)
                   0036_social_identities.sql Sign in with Google / Apple: user_identities and the pending social
                                              sign-ups (identity, not a module: api/auth/social.ts)
                   0037_mfa_enrolment.sql     mandatory two-factor enrolment tokens for administrators and owners
                                              (identity, not a module: api/auth/service.ts)
                   0038_assignment_pause_cause.sql why a coach assignment is paused (coach account, away, or an
                                              administrator), so reactivation resumes only its own (api/domain/assignments.ts)
   For the member app (30 October 2026), one file per change:
                   0039_progress_daily.sql    daily totals (steps from the phone, water): progress_daily_totals keys
                                              one entry per member, metric, India date, source and provider; water_ml
                                              joins metric_config on a database that has a metric list (api/domain/plans.ts)
                   0040_workouts_member_library.sql exercises.safety_notes, and a session item's frozen description,
                                              muscle groups, equipment and safety notes (api/domain/workouts.ts)
                   0041_exercise_media.sql    an index on exercises.media_ref; the clips are files in
                                              EXERCISE_MEDIA_DIR (api/domain/exerciseMedia.ts)
                   0042_nutrition_search.sql  saved dishes (nutrition_favourites) and a meal log's dish from the
                                              library and portion (meal_logs.food_id, recipe_id, portion)
                                              (api/domain/nutrition.ts)
                   0043_presentation_fields.sql a package version's picture, compare at price and accent; a blood
                                              test's picture, tags and featured mark (api/domain/packages.ts, bloodwork.ts)
                   0044_member_assistant.sql  the member assistant behind its off switch: member_consents rebuilt with
                                              assistant_processing, assistant_messages, settings.member_assistant "off"
                                              (api/domain/assistant.ts)
   A new change takes the next free number after the highest file.
*/
import type { ApiModule, ModuleKey } from './types.js';
import { habits } from './habits.js';
import { progress } from './progress.js';
import { billing } from './billing.js';
import { support } from './support.js';
import { nutrition } from './nutrition.js';
import { workouts } from './workouts.js';
import { labFollowups } from './labFollowups.js';
import { sessions } from './sessions.js';
import { messaging } from './messaging.js';
import { learning } from './learning.js';
import { ai } from './ai.js';
import { labstackOps } from './labstackOps.js';
import { growth } from './growth.js';
import { referrals } from './referrals.js';

/** The registry's own array, empty until the first read fills it (see the header). */
const registered: ApiModule[] = [];

function filled(): ApiModule[] {
  if (registered.length === 0) {
    try {
      registered.push(habits, progress, billing, support, nutrition, workouts, labFollowups, sessions, messaging, learning, ai, labstackOps, growth, referrals);
    } catch (e) {
      throw new Error(`The module registry was read while a module file was still loading (${(e as Error).message}). Read MODULES inside a function, not while a file loads.`);
    }
  }
  return registered;
}

const readOnly = (): boolean => { throw new TypeError('The module registry is read-only: tests pass their own list to buildApp (opts.modules).'); };

/** Every registered module, in registry order. It behaves as a read-only array (map, find, for…of, spread) and is built
 *  on first use. */
export const MODULES: ApiModule[] = new Proxy(registered, {
  get: (_target, prop) => Reflect.get(filled(), prop),
  has: (_target, prop) => Reflect.has(filled(), prop),
  ownKeys: () => Reflect.ownKeys(filled()),
  getOwnPropertyDescriptor: (_target, prop) => Reflect.getOwnPropertyDescriptor(filled(), prop),
  set: readOnly,
  defineProperty: readOnly,
  deleteProperty: readOnly,
});

/** The registered module with this key, or undefined. */
export function moduleByKey(key: string): ApiModule | undefined { return MODULES.find((m) => m.key === key); }

/** The flag a module's routes require: its declared feature, or its own key. */
export function featureOf(m: ApiModule): string { return m.feature ?? m.key; }

/** The module whose flag this is, if any. */
export function moduleForFeature(feature: string): ApiModule | undefined { return MODULES.find((m) => featureOf(m) === feature); }

export type { ModuleKey };
