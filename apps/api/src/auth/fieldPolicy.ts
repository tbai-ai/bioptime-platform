/* Field-level access policy for what a coach may see about a client.

   A coach sees what coaching needs: name, member code, age, gender, city, goals, consents, programme and plan. Contact
   and identity fields are restricted by default and never leave the server in a coach response: phone, email, street
   address and PIN code, date of birth (the age is derived instead), payment and account-security data. No setting opens
   them; the setting coach_field_policy can only close city and state.

   `coachMemberView` builds the view; `coachSafe` is the safety net the routes run over their whole payload, so a field
   cannot slip through a nested object that a future query adds. */
import type { Ctx } from '../context.js';
import { getSetting } from '../domain/settings.js';
import { ageFromDob } from '../lib/time.js';

/** Only the coarse location can be switched; contact and identity fields are never sent to a coach (the owner's rule). */
export type CoachFieldPolicy = { city: boolean; state: boolean };
export const DEFAULT_COACH_FIELD_POLICY: CoachFieldPolicy = { city: true, state: true };

/** Keys that are never sent to a coach whatever the policy says. */
export const HARD_RESTRICTED = new Set(['passwordhash', 'mfasecret', 'tokenhash', 'ip', 'useragent', 'failedlogins', 'lockeduntil', 'card', 'upi', 'accountnumber', 'aadhaar', 'pan', 'passport', 'patient']);
/** Keys compare after lower-casing and dropping underscores and dashes, so phone, phone_number, phoneNumber and PHONE are one key. */
export const normalKey = (k: string) => k.toLowerCase().replace(/[_-]/g, '');
const EMAIL_KEYS = ['email', 'emailaddress', 'contactemail'];
const PHONE_KEYS = ['phone', 'phonenumber', 'mobile', 'phoneverifiedat', 'contactphone'];
const ADDRESS_KEYS = ['address', 'line', 'addressline', 'addressline1', 'addressline2'];
const PIN_KEYS = ['pincode', 'postalcode', 'zip'];
const DOB_KEYS = ['dateofbirth', 'dob', 'birthdate'];
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

export function coachFieldPolicy(ctx: Ctx): CoachFieldPolicy {
  const stored = getSetting<Partial<CoachFieldPolicy>>(ctx, 'coach_field_policy') ?? {};
  // only city and state are read from the setting; any other key a stored value carries is ignored
  const out = { ...DEFAULT_COACH_FIELD_POLICY };
  for (const k of Object.keys(out) as Array<keyof CoachFieldPolicy>) if (typeof stored[k] === 'boolean') out[k] = stored[k] as boolean;
  return out;
}

/** The keys a coach response must never contain: the hard-restricted keys and every contact and identity key. City and
    state are left out of the views by coachMemberView when switched off (a key named 'state' is also an account state). */
export function restrictedKeys(_policy?: CoachFieldPolicy): Set<string> {
  return new Set<string>([...HARD_RESTRICTED, ...EMAIL_KEYS, ...PHONE_KEYS, ...ADDRESS_KEYS, ...PIN_KEYS, ...DOB_KEYS]);
}

/** What an administrator without members.view_restricted never receives: the same set without email, which is the
    account identifier they manage. */
export function adminRestrictedKeys(): Set<string> {
  return new Set<string>([...HARD_RESTRICTED, ...PHONE_KEYS, ...ADDRESS_KEYS, ...PIN_KEYS, ...DOB_KEYS]);
}

/** Remove restricted keys anywhere in a payload (objects and arrays), returning a new value. */
export function stripRestricted<T>(value: T, keys: Set<string>): T {
  if (Array.isArray(value)) return value.map((v) => stripRestricted(v, keys)) as T;
  if (isPlain(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) { if (keys.has(normalKey(k))) continue; out[k] = stripRestricted(v, keys); }
    return out as T;
  }
  return value; // Dates, Buffers and other class instances pass through untouched
}

/** Walk a payload and list any restricted key it still carries, for tests and for the route-level safety net. */
export function findRestrictedFields(value: unknown, keys: Set<string>, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findRestrictedFields(v, keys, `${path}[${i}]`));
  if (isPlain(value)) return Object.entries(value).flatMap(([k, v]) => (keys.has(normalKey(k)) ? [`${path}.${k}`] : findRestrictedFields(v, keys, `${path}.${k}`)));
  return [];
}

/** Where coachSafe reports a presenter that handed it a restricted key (paths only, never values). Tests replace it to
    assert that presenters stay clean; outside tests it writes one warning line. */
export type RestrictedFieldReporter = (where: string, paths: string[]) => void;
let reportRestricted: RestrictedFieldReporter = (where, paths) => { console.warn(`[fieldPolicy] ${where}: stripped restricted field(s) ${paths.join(', ')}`); };
export function setRestrictedFieldReporter(r: RestrictedFieldReporter): RestrictedFieldReporter { const prev = reportRestricted; reportRestricted = r; return prev; }
/** Report restricted key paths through the current reporter (for checks that refuse instead of stripping, such as the
    Coach AI context in api/domain/ai.ts). Paths only, never values. */
export function reportRestrictedFields(where: string, paths: string[]): void { if (paths.length) reportRestricted(where, paths); }

/** The safety net for every coach-facing payload: restricted keys never leave (they are stripped, so a presenter bug
    cannot leak a phone number or address), and any key that had to be stripped is reported, because a presenter should
    never have produced it. Checks the payload as the presenter built it, before stripping. */
export function coachSafe<T>(ctx: Ctx, payload: T, where = 'coach response'): T {
  const keys = restrictedKeys(coachFieldPolicy(ctx));
  const found = findRestrictedFields(payload, keys);
  if (!found.length) return payload;
  reportRestricted(where, found);
  return stripRestricted(payload, keys);
}

/** What a coach may see of a member's profile: the coaching view, built field by field (never by deleting from the full record). */
export function coachMemberView(ctx: Ctx, profile: { id: string; name: string; state: string; email?: string; phone?: string | null; createdAt?: string; lastLoginAt?: string | null; emailVerified?: boolean; profile: Record<string, unknown>; consents: Record<string, unknown> }, policy = coachFieldPolicy(ctx)) {
  const p = profile.profile;
  const dob = typeof p.dateOfBirth === 'string' ? p.dateOfBirth : null;
  return {
    id: profile.id, name: profile.name, state: profile.state, memberCode: (p.memberCode as string | null) ?? null, createdAt: profile.createdAt ?? null, lastLoginAt: profile.lastLoginAt ?? null,
    profile: {
      gender: p.gender ?? null, age: dob ? ageFromDob(dob, ctx.now()) : null,
      ...(policy.city ? { city: p.city ?? null } : {}), ...(policy.state ? { state: p.state ?? null } : {}),
      goals: p.goals ?? [], preferences: p.preferences ?? {}, timezone: p.timezone ?? 'Asia/Kolkata',
      onboardingStep: p.onboardingStep ?? null, onboardingCompletedAt: p.onboardingCompletedAt ?? null,
      wellnessScore: p.wellnessScore ?? null, wellnessScoreLabel: !p.wellnessScoreLabel || p.wellnessScoreLabel === 'sample' ? 'estimate' : p.wellnessScoreLabel,
    },
    consents: profile.consents,
  };
}
