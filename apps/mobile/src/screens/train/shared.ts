/* Train's shared vocabulary: the session and exercise shapes the API returns, the category look (the earlier app's
   type colours on Bioptime's exercise categories), dates in the programme's IST calendar, prescriptions, weight units
   (shown in the device's unit, always sent in kg), server media addresses and the morph keys the player and the
   exercise screen open with (Home's next-session banner and week cards use the same keys), and what the player is
   warmed with before it opens (the row's press-in starts the picture and the session loading). */
import { Image } from 'expo-image';
import { deviceSettingsLoaded, fx, motionValues, peekSetting, prefetch, t, useDeviceSetting, type DeviceSettingKey, type DeviceSettings, type IconName, type PillTone } from '@/fx';
import { bundledMedia } from '@/fx/media/bundledMedia';
import { get } from '@/lib/api';
import { onClearCache } from '@/lib/cache';
import { apiBaseSync, remoteImage } from '@/lib/config';
import { dtf, label } from '@/lib/format';
import { loadDrafts } from './player/draft';

export type Media = { videoUrl?: string | null; posterUrl?: string | null; width?: number | null; height?: number | null; durationSeconds?: number | null } | null;
export type MediaStatus = { status?: string; missing?: string[]; note?: string } | null;

export type SessionRow = {
  id: string; programId: string; programTitle: string; programStatus: string; version: number; coachName: string; title: string;
  week: number; day: number; scheduledDate: string; status: 'scheduled' | 'completed' | 'partial' | 'skipped'; completedAt: string | null;
  itemCount: number; feedbackCount: number; setsPrescribed: number; setsDone: number; durationMinutes: number | null; rpe: number | null;
  memberNote: string | null; skipReason: string | null; categories?: string[]; durationMinutesPlanned?: number | null;
  /** The poster of the first exercise's clip (the picture the player opens on), or null. */
  coverPosterUrl?: string | null;
};
export type Programme = { id: string; title: string; version: number; startDate: string | null; coachName: string; summary: string; updatedAt: string };
export type Week = { from: string; to: string; today: string; items: SessionRow[]; programs: Programme[]; next: SessionRow | null; summary: { due: number; done: number; skipped: number; upcoming: number } };

export type SetLog = { setNumber: number; repsDone: number | null; durationSeconds: number | null; loadKg: number | null; completed: boolean };
export type SessionItem = {
  id: string; exerciseId: string | null; exerciseName: string; exerciseCategory: string | null; instructions: string | null; description: string | null;
  muscleGroups: string[] | null; equipment: string[] | null; safetyNotes: string | null; media: Media; block: string | null; sets: number;
  reps: string | null; durationSeconds: number | null; restSeconds: number | null; loadNote: string | null; note: string | null; logs: SetLog[];
};
export type Feedback = { id: string; body: string; coachName: string; createdAt: string };
export type SessionDetail = SessionRow & { items: SessionItem[]; feedback: Feedback[]; media: MediaStatus; today: string };

export type Exercise = {
  id: string; name: string; category: string; description: string | null; instructions: string | null; muscleGroups: string[] | null;
  equipment: string[] | null; safetyNotes: string | null; media: Media; mediaStatus?: MediaStatus;
};

/* ---------- categories ---------- */

export const CATEGORIES = ['strength', 'conditioning', 'core', 'mobility', 'balance', 'recovery', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

const ICONS: Record<Category, IconName> = { strength: 'dumbbell', conditioning: 'heart', core: 'target', mobility: 'wind', balance: 'activity', recovery: 'moon', other: 'circle-dot' };

export function asCategory(c?: string | null): Category {
  return (CATEGORIES as readonly string[]).includes(c ?? '') ? (c as Category) : 'other';
}
export const categoryLabel = (c?: string | null) => label(asCategory(c));
export const categoryIcon = (c?: string | null): IconName => ICONS[asCategory(c)];
export const categoryColor = (c?: string | null): string => fx.map.category[asCategory(c)];
/** Small words in a category's colour (its pill's name): the brand red is too dark for 10 pt text on its own tint, so
 *  it reads in the red label shade; the other category colours are light enough. */
export const inkFor = (color: string): string => (color === fx.red.brand ? fx.red.label : color);
export const categoryInk = (c?: string | null): string => inkFor(categoryColor(c));

/** The categories present, in the fixed order (chips). */
export function presentCategories(lists: Array<readonly (string | null | undefined)[] | null | undefined>): Category[] {
  const seen = new Set<string>();
  for (const l of lists) for (const c of l ?? []) if (c) seen.add(asCategory(c));
  return CATEGORIES.filter((c) => seen.has(c));
}

/** The mood photo of a session (the set slot of its first category, picked by its id): coach-plan thumbnails, the
 *  player's cover and Home's banner use the same choice, so a morph lands on the photo it left. */
export function sessionPhoto(categories: readonly (string | null | undefined)[] | null | undefined, id: string): { slot: string; pick: string } {
  return { slot: `set.session.${asCategory(categories?.find(Boolean))}`, pick: id };
}

export const workoutMorphKey = (id: string) => `workout:${id}`;
/** The library entry the member just tapped, so the exercise screen draws the same poster at once (the morph lands on
 *  it) while it asks the API for the exercise. Memory only. */
const shownExercises = new Map<string, Exercise>();
export const rememberExercise = (e: Exercise) => { shownExercises.set(e.id, e); };
export const rememberedExercise = (id: string) => shownExercises.get(id) ?? null;
/** The same for a session row (the player's header shows its title at once). */
const shownSessions = new Map<string, SessionRow>();
export const rememberSession = (s: SessionRow) => { shownSessions.set(s.id, s); };
export const rememberedSession = (id: string) => shownSessions.get(id) ?? null;
export const exerciseMorphKey = (id: string) => `exercise:${id}`;
/** The last copy of each session the player loaded (memory only): a reopen draws it at once while it refreshes. */
const shownDetails = new Map<string, SessionDetail>();
export const rememberDetail = (d: SessionDetail) => { shownDetails.set(d.id, d); };
export const rememberedDetail = (id: string) => shownDetails.get(id) ?? null;
// another member's sessions never reach the next member's screens
onClearCache(() => { shownExercises.clear(); shownSessions.clear(); shownDetails.clear(); });

/** The load key the player reads a session under (the press-in prefetch and the screen share it). */
export const sessionKey = (id: string) => `workout.${id}`;
export const loadSession = (id: string) => get<SessionDetail>(`/me/workouts/${id}`);

/** A press-in on something that opens the player: its picture starts decoding and the session starts loading, so the
 *  photo that flies is ready and the player opens on data (and on the sets kept from an earlier visit: the drafts are
 *  read once a run). Never throws. */
export function warmSession(id: string, poster?: string | null): void {
  warmPicture(poster);
  prefetch(sessionKey(id), () => loadSession(id)).catch(() => undefined);
  void loadDrafts();
}

/* The row that opens the player stays pressed until the player covers it (M69 fix round): the release is answered on
   the next frame by the row itself (it holds motionValues.press.tile), while the route mounts behind it and the photo
   lifts off later. The player lets it go once its photo has landed (or its stage has faded in); a cap lets it go if
   the player never says so. One row at a time. */
let heldRelease: (() => void) | null = null;
let heldCap: ReturnType<typeof setTimeout> | null = null;
/** The longest the kit's opening can take before its photo lands (the copy's picture cap, the quiet frames, the
 *  flight), plus the overlay's fallback margin. */
const HOLD_CAP = 2 * t.morph + motionValues.morph.pictureCapMs + motionValues.morph.quietCapMs + motionValues.overlay.fallbackExtra;
/** Called by the row as it opens the player: `release` puts the row back (it is covered by then). */
export function holdUntilCovered(release: () => void): void {
  coveredNow();
  heldRelease = release;
  heldCap = setTimeout(coveredNow, HOLD_CAP);
}
/** The player covers the row now: the held row goes back to rest (unseen). */
export function coveredNow(): void {
  if (heldCap) { clearTimeout(heldCap); heldCap = null; }
  const r = heldRelease;
  heldRelease = null;
  r?.();
}

/** Starts decoding a server picture (a poster) ahead of the screen that shows it; a poster bundled in the app needs
 *  no request. Never throws. */
export function warmPicture(path?: string | null): void {
  const uri = serverUrl(path);
  if (!uri || bundledMedia(uri) != null) return;
  try {
    const src = remoteImage(uri);
    Image.prefetch(uri, src.headers ? { headers: src.headers } : undefined).catch(() => false);
  } catch { /* not cached: the screen loads it */ }
}

/* ---------- dates (the programme's calendar dates are IST days, YYYY-MM-DD) ---------- */

const at = (date: string) => new Date(`${date}T00:00:00Z`);
export const weekday = (date: string) => dtf({ weekday: 'short', timeZone: 'UTC' }).format(at(date));
export const dayMonth = (date: string) => dtf({ day: 'numeric', month: 'short', timeZone: 'UTC' }).format(at(date));
export const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/* ---------- session state ---------- */

export type SessionState = { key: 'done' | 'partial' | 'skipped' | 'late' | 'today' | 'ahead'; text: string; tone: PillTone };

/** As the portal reads it: a session still scheduled after its date is "Not logged". */
export function sessionState(s: Pick<SessionRow, 'status' | 'scheduledDate'>, today?: string | null): SessionState {
  if (s.status === 'completed') return { key: 'done', text: 'Done', tone: 'success' };
  if (s.status === 'partial') return { key: 'partial', text: 'Partly done', tone: 'warning' };
  if (s.status === 'skipped') return { key: 'skipped', text: 'Skipped', tone: 'info' };
  if (today && s.scheduledDate < today) return { key: 'late', text: 'Not logged', tone: 'warning' };
  if (today && s.scheduledDate === today) return { key: 'today', text: 'Today', tone: 'error' };
  return { key: 'ahead', text: 'Scheduled', tone: 'info' };
}

/** ': <reason>.' after "You skipped this session", without a second full stop when the reason ends a sentence. */
export function skipReasonSentence(reason?: string | null): string {
  const r = (reason ?? '').trim();
  return r ? `: ${r}${/[.!?]$/.test(r) ? '' : '.'}` : '.';
}

/* ---------- prescriptions and times ---------- */

export const secs = (s: number) => (s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);
export const mmss = (s: number) => { const v = Math.max(0, Math.round(s)); return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };

/** "4 × 20 m", "2 × 45 s". */
export function prescription(i: Pick<SessionItem, 'sets' | 'reps' | 'durationSeconds'>): string {
  const what = i.reps ? i.reps : i.durationSeconds ? secs(i.durationSeconds) : '';
  return what ? `${i.sets} × ${what}` : `${i.sets} ${i.sets === 1 ? 'set' : 'sets'}`;
}

/** "Wed · 6 exercises · 29 min" (minutes only when the coach prescribed every exercise by time). */
export function sessionMeta(s: Pick<SessionRow, 'scheduledDate' | 'itemCount' | 'durationMinutesPlanned'>): string {
  const parts = [weekday(s.scheduledDate), `${s.itemCount} exercise${s.itemCount === 1 ? '' : 's'}`];
  if (s.durationMinutesPlanned) parts.push(`${s.durationMinutesPlanned} min`);
  return parts.join(' · ');
}

/** Lines of a coach's text (form cues, safety notes), without empty ones or list marks. */
export function lines(text?: string | null): string[] {
  return (text ?? '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean);
}

export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ---------- weight units (display only; the API always takes kg) ---------- */

/** A device setting that follows changes and the first read from storage. Not memoised by the React Compiler: the
 *  kit's useDeviceSetting reads the value through a call the compiler caches per key, so it would keep its first value. */
export function useLiveSetting<K extends DeviceSettingKey>(key: K): { value: DeviceSettings[K] | undefined; loaded: boolean } {
  'use no memo';
  useDeviceSetting(key);
  return { value: peekSetting(key), loaded: deviceSettingsLoaded() };
}

const KG_PER_LB = 0.45359237;
export type WeightUnit = 'kg' | 'lb';
export function useWeightUnit(): WeightUnit {
  'use no memo';
  return useLiveSetting('units.weight').value === 'lb' ? 'lb' : 'kg';
}
export const kgTo = (kg: number, unit: WeightUnit) => (unit === 'lb' ? Math.round((kg / KG_PER_LB) * 10) / 10 : kg);
export const toKg = (v: number, unit: WeightUnit) => (unit === 'lb' ? Math.round(v * KG_PER_LB * 100) / 100 : v);
export const fmtNumber = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

/* ---------- server media ---------- */

/** The full address of a file the API names by path ("/api/public/media/…"). */
export function serverUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiBaseSync()}${path.startsWith('/') ? '' : '/'}${path}`;
}
export const hasClip = (m: Media | undefined) => !!m?.videoUrl;
