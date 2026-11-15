/* The first-run setup's data and its server calls (AMENDED_PLAN_NOTES §2, CRITIQUE 1 and 24). Order of the calls:
   1. Consent: POST /me/consents, one per kind (health_data, coach_sharing, lab_consent, marketing), version
      onboarding-2026-10. Not the onboarding `consents` step: that one completes onboarding at once on the server.
   2. Slides: POST /me/onboarding {step: 'programme_info'} after slide 2, {step: 'how_it_works'} after slide 3.
   3. Quiz: {step: 'goals', data: {goals, preferences}} after the activity, height, fitness, goals and lifestyle steps,
      always with the whole preferences object (the server replaces it), merged over what the server already had;
      POST /me/progress {metric: 'weight_kg'} for the weight; PUT /me/nutrition/profile for the diet tags while the
      nutrition module is on; {step: 'profile', data: <the whole profile>} after date of birth, gender and place.
   4. Sending: {step: 'consents', data: {healthData, coachSharing, labConsent, marketing, version}} and then
      {step: 'done'}; HEALTH_CONSENT_REQUIRED sends the member back to the consent screen.
   The app resumes from what the server holds (GET /me/onboarding savedData, GET /me/consents), never from the
   onboarding `step` pointer. Nothing here computes calories, macros or any other estimate. */
import { api, ApiError, get, post } from '@/lib/api';

export const CONSENT_VERSION = 'onboarding-2026-10';

export type Consents = { healthData: boolean; coachSharing: boolean; labConsent: boolean; marketing: boolean };
/** Bioptime's defaults: health data is asked for, sharing with the coach and the laboratory are on, news is off. */
export const DEFAULT_CONSENTS: Consents = { healthData: false, coachSharing: true, labConsent: true, marketing: false };
const KIND: Record<keyof Consents, string> = { healthData: 'health_data', coachSharing: 'coach_sharing', labConsent: 'lab_consent', marketing: 'marketing' };

export type Profile = { dateOfBirth?: string; gender?: string; city?: string; state?: string; pincode?: string; address?: string };
export type Preferences = Record<string, unknown>;
export type Restriction = { label: string; kind: string };

export type Onboarding = {
  completedAt: string | null;
  savedData: Record<string, unknown>;
  blockers: Array<{ code: string; message: string }>;
  purchasedPackage: { programmeId: string; name: string; endAt: string | null } | null;
};
type ConsentRow = { granted: boolean; version: string; at: string };
type ProfileAnswer = { name?: string; profile?: Profile & { goals?: string[]; preferences?: Preferences } };

/** Everything the setup starts from. */
export type Setup = {
  onboarding: Onboarding;
  consents: Consents;
  /** health_data is granted on the server (the consent screen was done). */
  consented: boolean;
  firstName: string | null;
  goals: string[];
  /** The server's preferences, kept under the quiz's own keys (the server replaces the object on every save). */
  preferences: Preferences;
  profile: Profile;
  lastWeightKg: number | null;
  restrictions: Restriction[] | null;
  dietPattern: string | null;
};

const PROFILE_KEYS: Array<keyof Profile> = ['dateOfBirth', 'gender', 'city', 'state', 'pincode', 'address'];

export async function loadSetup(nutritionOn: boolean): Promise<Setup> {
  const [onboarding, consentRows, me] = await Promise.all([
    get<Onboarding>('/me/onboarding'),
    get<Record<string, ConsentRow>>('/me/consents'),
    get<ProfileAnswer>('/me/profile'),
  ]);
  // the last weight on record and the nutrition profile only fill the answers in: either may be missing or refused
  const [weight, nutrition] = await Promise.all([
    get<{ items: Array<{ value: number }> }>('/me/progress?metric=weight_kg&limit=1').then((r) => r.items?.[0]?.value ?? null, () => null),
    nutritionOn ? get<{ profile?: { restrictions?: Restriction[]; dietPattern?: string | null } }>('/me/nutrition').then((r) => r.profile ?? null, () => null) : Promise.resolve(null),
  ]);
  const has = (k: keyof Consents) => consentRows?.[KIND[k]];
  const consents: Consents = {
    healthData: has('healthData')?.granted ?? DEFAULT_CONSENTS.healthData,
    coachSharing: has('coachSharing')?.granted ?? DEFAULT_CONSENTS.coachSharing,
    labConsent: has('labConsent')?.granted ?? DEFAULT_CONSENTS.labConsent,
    marketing: has('marketing')?.granted ?? DEFAULT_CONSENTS.marketing,
  };
  const p = me?.profile ?? {};
  const profile: Profile = {};
  for (const k of PROFILE_KEYS) { const v = p[k]; if (typeof v === 'string' && v.trim()) profile[k] = v; }
  return {
    onboarding,
    consents,
    consented: has('healthData')?.granted === true,
    firstName: me?.name?.trim().split(/\s+/)[0] ?? null,
    goals: Array.isArray(p.goals) ? p.goals.filter((g): g is string => typeof g === 'string') : [],
    preferences: p.preferences && typeof p.preferences === 'object' ? { ...p.preferences } : {},
    profile,
    lastWeightKg: typeof weight === 'number' ? weight : null,
    restrictions: nutrition?.restrictions ?? null,
    dietPattern: nutrition?.dietPattern ?? null,
  };
}

/* ---------- where to resume ---------- */

export type QuizStepId = 'activity' | 'birth' | 'weight' | 'height' | 'fitness' | 'goals' | 'lifestyle' | 'gender' | 'place';
export type Phase = 'consent' | 'slides' | 'quiz' | 'sending';

/** Whether a quiz step has an answer on the server. The weight leaves none in onboarding (it is a progress entry), so a
 *  later answer stands for it. */
export function answered(id: QuizStepId, s: { preferences: Preferences; goals: string[]; profile: Profile }): boolean {
  switch (id) {
    case 'activity': return typeof s.preferences.activityLevel === 'string';
    case 'birth': return !!s.profile.dateOfBirth;
    case 'weight': return false;
    case 'height': return typeof s.preferences.heightCm === 'number';
    case 'fitness': return typeof s.preferences.fitnessLevel === 'string';
    case 'goals': return s.goals.length > 0;
    case 'lifestyle': return Array.isArray(s.preferences.lifestyle);
    case 'gender': return !!s.profile.gender;
    case 'place': return !!(s.profile.city || s.profile.state || s.profile.pincode || s.profile.address);
  }
}

/** The phase (and slide or quiz step) to open: from the server's answers, the furthest point reached. */
export function resumeAt(s: Setup, steps: QuizStepId[]): { phase: Phase; slide: number; step: number } {
  if (!s.consented) return { phase: 'consent', slide: 0, step: 0 };
  const saved = s.onboarding.savedData ?? {};
  if (!('how_it_works' in saved)) return { phase: 'slides', slide: 'programme_info' in saved ? 2 : 0, step: 0 };
  let last = -1;
  steps.forEach((id, i) => { if (answered(id, s)) last = i; });
  if (last >= steps.length - 1) return { phase: 'sending', slide: 0, step: steps.length - 1 };
  return { phase: 'quiz', slide: 0, step: last + 1 };
}

/* ---------- the calls ---------- */

export async function recordConsents(c: Consents): Promise<void> {
  for (const k of Object.keys(KIND) as Array<keyof Consents>) await post('/me/consents', { kind: KIND[k], version: CONSENT_VERSION, granted: c[k] });
}

export async function saveSlide(step: 'programme_info' | 'how_it_works'): Promise<void> {
  await post('/me/onboarding', { step, data: { seen: true } });
}

export async function saveGoals(goals: string[], preferences: Preferences): Promise<void> {
  await post('/me/onboarding', { step: 'goals', data: { goals, preferences } });
}

/** The whole profile object (non-empty fields only) every time. */
export async function saveProfile(profile: Profile): Promise<void> {
  const data: Record<string, string> = {};
  for (const k of PROFILE_KEYS) { const v = profile[k]?.trim(); if (v) data[k] = v; }
  await post('/me/onboarding', { step: 'profile', data });
}

export async function saveWeight(kg: number): Promise<void> {
  await post('/me/progress', { metric: 'weight_kg', value: Math.round(kg * 10) / 10 });
}

/** The quiz's diet tags in the nutrition profile (module on): a vegan or vegetarian pattern, and gluten and dairy as
 *  things to avoid, keeping every restriction the quiz did not add (allergies a coach entered stay). */
export const DIET_TAGS = { vegan: 'Vegan', vegetarian: 'Vegetarian', glutenFree: 'Gluten', dairyFree: 'Dairy' } as const;
export type Diet = { restrictions: Restriction[] | null; dietPattern: string | null };
/** Returns what the nutrition profile now holds (the caller compares the next save against it). */
export async function saveDiet(lifestyle: string[], current: Diet): Promise<Diet> {
  const quizAvoid = [DIET_TAGS.glutenFree, DIET_TAGS.dairyFree].map((l) => l.toLowerCase());
  const kept = (current.restrictions ?? []).filter((r) => !(r.kind === 'avoid' && quizAvoid.includes(r.label.toLowerCase())));
  const added: Restriction[] = [];
  if (lifestyle.includes('gluten_free')) added.push({ label: DIET_TAGS.glutenFree, kind: 'avoid' });
  if (lifestyle.includes('dairy_free')) added.push({ label: DIET_TAGS.dairyFree, kind: 'avoid' });
  const pattern = lifestyle.includes('vegan') ? DIET_TAGS.vegan : lifestyle.includes('vegetarian') ? DIET_TAGS.vegetarian
    : current.dietPattern === DIET_TAGS.vegan || current.dietPattern === DIET_TAGS.vegetarian ? null : current.dietPattern;
  const next = [...kept, ...added];
  const same = pattern === current.dietPattern && JSON.stringify(next) === JSON.stringify(current.restrictions ?? []);
  if (!same) await api('PUT', '/me/nutrition/profile', { dietPattern: pattern, restrictions: next });
  return { dietPattern: pattern, restrictions: next };
}

/** The end of the setup: the onboarding consents step (the same choices), then done. */
export async function finishSetup(c: Consents): Promise<void> {
  await post('/me/onboarding', { step: 'consents', data: { ...c, version: CONSENT_VERSION } });
  await post('/me/onboarding', { step: 'done', data: {} });
}

export function isHealthConsentRefusal(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'HEALTH_CONSENT_REQUIRED';
}

/** Whole years between a YYYY-MM-DD date of birth and today. */
export function ageOn(dob: string, now = new Date()): number {
  const [y, m, d] = dob.split('-').map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age;
}
