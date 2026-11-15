/* Home's data: what the API returns for the pieces Home shows, and the small pure helpers that turn it into what is
   drawn. Nothing here invents a number: a value the API does not have is null and the card says so honestly.
   - /me (shared with the tabs layout's prefetch under the key 'me'), /me/progress/summary and /me/notes are core;
   - /me/workouts needs `workouts`, /me/habits `habits`, /me/goals and /me/checkins `progress`, /me/sessions `sessions`,
     /me/announcements `messaging`, /me/progress/photos `progress` (adding needs `progressPhotos`).
   Days are India days (lib/format istDate), as the API counts them. */
import { get } from '@/lib/api';
import { cacheGeneration, onClearCache } from '@/lib/cache';
import { loadFeatures } from '@/lib/features';
import { dtf, fmtTime, istDate, nf } from '@/lib/format';
import { prefetch } from '@/lib/useLoad';
import { DAILY_TOTALS, goalFigure, heldByBookings, heldSplit, holdsConsultation, isUpcoming } from '@/lib/today';

/* ---------- API shapes (the fields Home reads) ---------- */

export type Task = { id: string; title: string; kind: string; status: 'pending' | 'done' | 'skipped'; due_at: string | null; overdue?: boolean };
export type EntitlementBalance = { total: number; used: number; reserved: number; remaining: number };
export type EntitlementRow = { id: string; serviceType?: string; kind?: string; quantity?: number; total?: number; used?: number; reserved?: number; remaining?: number };
export type Me = {
  member: { id: string; name: string; email?: string; state: string; onboardingCompleted?: boolean; wellnessScore: number | null; wellnessScoreLabel: string | null };
  programme: { id: string; status: string; packageName: string; endAt: string; customPlanId?: string | null } | null;
  entitlements: Record<string, EntitlementBalance> | EntitlementRow[] | null;
  coach: { displayName?: string; name?: string; status: string } | null;
  assignmentStatus?: string | null;
  nextAppointment: { id: string; kind: string; status: string; start_at: string; coach_name?: string | null } | null;
  bloodwork: { id: string; reference?: string; status: string; slot_at: string | null; flag: string | null; test_name: string } | null;
  plan: { id: string; title: string; tasksTotal?: number; tasksDone?: number } | null;
  todaysActions: Task[];
  todaysActionsTotal?: number;
  unread?: { notifications?: number; messages?: number };
  today?: { date: string; steps: number | null; waterMl: number | null };
  demo?: boolean;
};

export type SeriesPoint = { value: number; at: string; day?: string; sourceLabel?: string; source?: string };
export type SummaryMetric = { metric: string; label: string; unit: string; enabled?: boolean; latest: SeriesPoint | null; series?: SeriesPoint[] };
export type Summary = { metrics: SummaryMetric[]; note?: string };

export type Note = { id: string; kind: string; body: string; created_at: string; coach_name?: string | null };
export type WorkoutSession = {
  id: string; title: string; scheduledDate: string; status: string; itemCount: number; categories?: string[];
  durationMinutes: number | null; durationMinutesPlanned?: number | null; completedAt: string | null;
};
export type Workouts = { today: string; items: WorkoutSession[]; next: WorkoutSession | null; summary: { due: number; done: number; skipped: number; upcoming: number } };
export type HabitDay = { date: string; weekday: number; due: boolean; status: string };
export type Habit = { id: string; title: string; status: string; streak?: { count: number; unit: string } | null; recent?: HabitDay[] };
export type Habits = { today: string; items: Habit[] };
export type Goal = {
  id: string; title: string; metric: string | null; metricLabel?: string | null; unit: string | null; baselineValue: number | null; targetValue: number | null;
  latest: { value: number; at: string; sourceLabel?: string } | null; valuesWithheld?: boolean; status: string;
};
export type LiveSession = {
  id: string; kind: string; kindLabel?: string; title: string; hostName?: string; startAt: string; status: string; full?: boolean;
  myRegistration?: { status: string } | null;
};
export type Checkin = { id: string; title: string; status: string; dueDate: string | null; coachName?: string | null };
export type Announcement = { id: string; title: string; body: string; origin: 'team' | 'coach'; from: string; publishedAt: string; read: boolean };
export type ProgressPhoto = { id: string; fileId: string; pose: string; takenAt: string; sharedWithCoach: boolean };
export type PhotosData = {
  items: ProgressPhoto[];
  consent: { granted: boolean; at: string | null; wording: { version: string; status: string; label: string; text: string }; canGrant: boolean; missing: string | null };
  healthShared: boolean; retentionDays: number | null; photosEnabled: boolean; maxBytes?: number;
};
export type AppNotice = { id: string; title: string; body?: string; category?: string; data?: Record<string, unknown> | null; created_at: string; read_at: string | null };

/* ---------- the early start ---------- */

/** The keys Home draws its first frame from ('home.habits': a new member's "Your first week" card above the Wellness
 *  card needs it before the arrival starts, so the card never grows over the arriving score card). */
export type HomeKey = 'me' | 'home.summary' | 'workouts' | 'home.habits';

/** The last answer Home had (or was prefetched) for each of its first-frame keys, for this member only (a sign-in or
 *  sign-out clears them with the cache): Home draws from it on its first frame (a cold start whose prefetch has
 *  answered, a page mounted again) instead of a skeleton, while its own loads ask again. Memory only. */
const early = new Map<HomeKey, { gen: number; data: unknown }>();
onClearCache(() => early.clear());

/** What Home last had for `key` for this member, or null. */
export function peekHome<T>(key: HomeKey): T | null {
  const e = early.get(key);
  return e && e.gen === cacheGeneration() ? (e.data as T) : null;
}

/** Keep `data` as Home's latest for `key` (called by Home when an answer arrives). */
export function rememberHome(key: HomeKey, data: unknown): void {
  if (data != null) early.set(key, { gen: cacheGeneration(), data });
}

function keep<T>(key: HomeKey, p: Promise<T>): Promise<T> {
  const gen = cacheGeneration();
  p.then((d) => { if (gen === cacheGeneration() && d != null) early.set(key, { gen, data: d }); }, () => undefined);
  return p;
}

/** Starts Home's core loads before Home draws (a restored session during the splash, the preview's way in):
 *  lib/useLoad's prefetch under 'me' (GET /me), 'home.summary' (GET /me/progress/summary) and, with `workouts`, the
 *  module-gated loads: 'workouts' (GET /me/workouts) and 'home.habits' (GET /me/habits), each asked only once this
 *  member's module list says its module is on (the server refuses the route otherwise, so a member without the module
 *  sends no request that is bound to fail; the answer is then null). The two go out side by side once the module list
 *  is known. HomeScreen takes those keys with { shared: true } instead of asking again, and draws its first frame from
 *  the answers when they are already here (peekHome). Call it only after the auth state has committed (after
 *  clearCache), so the cache generation keeps the answers. Resolves when all have settled; never rejects. */
export function prefetchHome(opts?: { workouts?: boolean }): Promise<void> {
  const me = prefetch<Me>('me', () => get<Me>('/me'));
  const loads: Promise<unknown>[] = [
    keep('me', me),
    keep('home.summary', prefetch<Summary>('home.summary', () => get<Summary>('/me/progress/summary'))),
  ];
  // the module list is the signed-in member's (lib/features, keyed by their id, shared with useFeatures)
  if (opts?.workouts) {
    // asked once, and only by a load that really starts (a fresh prefetch already there asks nothing)
    let list: Promise<Set<string>> | null = null;
    const modules = () => (list ??= me.then((m) => loadFeatures(m.member.id)));
    loads.push(keep('workouts', prefetch<Workouts | null>('workouts', () => modules()
      .then((f) => (f.has('workouts') ? get<Workouts>('/me/workouts') : null)))));
    loads.push(keep('home.habits', prefetch<Habits | null>('home.habits', () => modules()
      .then((f) => (f.has('habits') ? get<Habits>('/me/habits') : null)))));
  }
  return Promise.allSettled(loads).then(() => undefined, () => undefined);
}

/* ---------- names, dates and numbers ---------- */

const IST = 'Asia/Kolkata';

export function firstName(name?: string | null): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** "26 Oct" (India time). */
export function dayMonth(iso?: string | null): string {
  if (!iso) return '';
  try { return dtf({ day: 'numeric', month: 'short', timeZone: IST }).format(new Date(iso.length === 10 ? `${iso}T06:30:00Z` : iso)); } catch { return iso.slice(0, 10); }
}

/** "Fri" for an India day ('2026-10-30') or a moment. */
export function weekdayShort(dateOrIso: string): string {
  try { return dtf({ weekday: 'short', timeZone: IST }).format(new Date(dateOrIso.length === 10 ? `${dateOrIso}T06:30:00Z` : dateOrIso)); } catch { return ''; }
}

export function weekdayLong(dateOrIso: string): string {
  try { return dtf({ weekday: 'long', timeZone: IST }).format(new Date(dateOrIso.length === 10 ? `${dateOrIso}T06:30:00Z` : dateOrIso)); } catch { return ''; }
}

/** The India day of a moment. */
export function istDayOf(iso: string): string {
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  return d.toISOString().slice(0, 10);
}

/** "Fri 17:00", or "today 17:00" / "tomorrow 17:00". */
export function whenShort(iso: string): string {
  const day = istDayOf(iso);
  const time = fmtTime(iso);
  if (day === istDate()) return `today ${time}`;
  if (day === istDate(1)) return `tomorrow ${time}`;
  return `${weekdayShort(iso)} ${dayMonth(iso)}, ${time}`;
}

/** en-IN grouping, `decimals` places when the value has them. */
export function num(value: number, decimals = 0): string {
  return nf({ minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(value);
}

/** 6.9 → "6h 54m" (the earlier app's sleep total). */
export function hoursText(h: number): string {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}

/** 6.9 → "6 hours 54 minutes" (spoken). */
export function hoursSpoken(h: number): string {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${hh} hour${hh === 1 ? '' : 's'}${mm ? ` ${mm} minute${mm === 1 ? '' : 's'}` : ''}`;
}

/** "1 task" / "3 tasks". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---------- package balances (CRITIQUE §33; entitlement rows can repeat a kind) ---------- */

export type Balance = { kind: 'consultation' | 'bloodwork'; label: string; remaining: number; total: number; reserved: number };

/** The member's balances by kind. /me sends them already added up by kind; a list of entitlement rows (one per grant,
 *  and an audited adjustment adds a second row of the same kind) is added up here, keyed by id so no row counts twice. */
export function balancesOf(ent: Me['entitlements']): Balance[] {
  if (!ent) return [];
  const sums: Record<string, EntitlementBalance> = {};
  if (Array.isArray(ent)) {
    const seen = new Set<string>();
    for (const r of ent) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      const kind = r.serviceType ?? r.kind ?? '';
      const total = r.quantity ?? r.total ?? 0;
      const used = r.used ?? 0;
      const reserved = r.reserved ?? 0;
      const s = sums[kind] ?? { total: 0, used: 0, reserved: 0, remaining: 0 };
      sums[kind] = { total: s.total + total, used: s.used + used, reserved: s.reserved + reserved, remaining: s.remaining + (r.remaining ?? Math.max(0, total - used - reserved)) };
    }
  } else {
    for (const [k, v] of Object.entries(ent)) if (v) sums[k] = v;
  }
  const out: Balance[] = [];
  const c = sums.consultation;
  if (c && c.total > 0) out.push({ kind: 'consultation', label: 'Consultations', remaining: c.remaining, total: c.total, reserved: c.reserved });
  const b = sums.bloodwork;
  if (b && b.total > 0) out.push({ kind: 'bloodwork', label: 'Blood tests', remaining: b.remaining, total: b.total, reserved: b.reserved });
  return out;
}

/* ---------- metrics ---------- */

export type MetricView = { key: string; label: string; short: string; unit: string; latest: number | null; at: string | null; source: string | null; values: number[]; trend: 'up' | 'down' | 'flat' | null; decimals: number };

const SHORT: Record<string, string> = { resting_hr_bpm: 'Resting HR', sleep_hours: 'Sleep', weight_kg: 'Weight', steps: 'Steps', water_ml: 'Water' };
const DECIMALS: Record<string, number> = { sleep_hours: 1, weight_kg: 1, waist_cm: 1 };
const UNITS: Record<string, string> = { sleep_hours: 'h', steps: 'steps', resting_hr_bpm: 'bpm', weight_kg: 'kg' };

/** Steps the app counted on a phone. The API's label says "From this phone", true only on the phone that counted them:
 *  the app says where they came from instead (the same words on any device, the web included). */
export const PHONE_APP = 'From the phone app';
export const sourceText = (label: string | null | undefined): string | null => (label === 'From this phone' ? PHONE_APP : label ?? null);

/** The series with one value a day (oldest first): a day logged twice (a check-in's answer and a value logged by hand,
 *  or a correction) keeps its latest value, so a line or a trend never joins two values of the same day. */
export function onePerDay<P extends { value: number; at: string; day?: string }>(series: readonly P[]): P[] {
  const out: P[] = [];
  let lastDay: string | null = null;
  for (const p of [...series].sort((a, b) => a.at.localeCompare(b.at))) {
    const day = p.day ?? istDayOf(p.at);
    if (day === lastDay) out[out.length - 1] = p;
    else out.push(p);
    lastDay = day;
  }
  return out;
}

/** One metric from the summary: its latest value and the values of up to `points` days (one a day, oldest first) for a
 *  sparkline, which is drawn only from two days on (a second value on the same day is no trend). */
export function metricView(summary: Summary | null, key: string, points = 7): MetricView | null {
  const m = summary?.metrics?.find((x) => x.metric === key);
  if (!m || m.enabled === false) return null;
  const series = onePerDay((m.series ?? []).filter((p) => typeof p?.value === 'number'));
  const values = series.slice(-points).map((p) => p.value);
  const n = values.length;
  const trend = n >= 2 ? (values[n - 1] > values[n - 2] ? 'up' : values[n - 1] < values[n - 2] ? 'down' : 'flat') : null;
  return {
    key, label: m.label, short: SHORT[key] ?? m.label, unit: UNITS[key] ?? m.unit,
    latest: typeof m.latest?.value === 'number' ? m.latest.value : null, at: m.latest?.at ?? null,
    source: sourceText(m.latest?.sourceLabel ?? (m.latest?.source === 'member' ? 'Self-reported' : m.latest?.source === 'device' ? PHONE_APP : null)),
    values, trend, decimals: DECIMALS[key] ?? 0,
  };
}

/** Whether a fall is good news for this metric (resting heart rate, weight, waist). */
export const lowerIsBetter = (key: string) => key === 'resting_hr_bpm' || key === 'weight_kg' || key === 'waist_cm';

/* ---------- goals ---------- */

export type GoalRow = {
  id: string; title: string; metric: string; unit: string; latest: number | null; target: number; share: number; decimals: number;
  /** A day's total (steps, water): the value is today's only. */
  daily: boolean;
  /** Any other goal: when its latest value was logged, set only when that was not today (null for a daily goal). */
  at: string | null;
};

/** The metrics the API keeps as one total per day (packages/domain DAILY_TOTAL_METRICS): a goal on one of them is about
 *  today, so yesterday's total never shows as today's progress (the shared rule, lib/today: Bio's goals read it too). */
export const DAILY_GOAL_METRICS = DAILY_TOTALS;

/** Active measurable goals: latest against target, by the shared rule (lib/today goalFigure). A goal on a day's total
 *  (steps, water) shows today's total (`today`, the same value as the card beside it: what the phone counts, what the
 *  member set; without one, the latest value only when it is from today, else nothing yet). Any other goal shows its
 *  latest value with its date when that is not today. A goal to come down (target under the starting value) counts the
 *  way travelled from the start; any other goal counts latest ÷ target. Withheld values are not shown. */
export function goalRows(goals: Goal[] | null | undefined, today: Partial<Record<string, number | null>> = {}): GoalRow[] {
  return (goals ?? []).filter((g) => g.status === 'active' && g.metric && typeof g.targetValue === 'number').map((g) => {
    const metric = g.metric as string;
    const fig = goalFigure(g, metric in today ? today[metric] ?? null : undefined);
    const latest = fig.value;
    const target = g.targetValue as number;
    let share = 0;
    if (latest != null) {
      if (g.baselineValue != null && target < g.baselineValue) share = (g.baselineValue - latest) / (g.baselineValue - target);
      else share = target > 0 ? latest / target : 0;
    }
    return {
      id: g.id, title: g.title, metric, unit: g.unit ?? '', latest, target, share: Math.max(0, share),
      decimals: DECIMALS[metric] ?? (Number.isInteger(target) && (latest == null || Number.isInteger(latest)) ? 0 : 1),
      daily: fig.daily, at: fig.olderAt,
    };
  });
}

/** The focus areas the member picked in the onboarding quiz (GET /me/profile → profile.goals, the labels) that are not
 *  yet written as an open goal: a focus whose words are already in the title of an active or paused goal is not offered
 *  again (Home's goals card and /goals both ask through here, so the two never differ). */
export function openFocus(picked: unknown, goals: readonly { title: string; status: string }[] | null | undefined): string[] {
  if (!Array.isArray(picked)) return [];
  const open = (goals ?? []).filter((g) => g.status === 'active' || g.status === 'paused').map((g) => g.title.toLowerCase());
  return picked.filter((f): f is string => typeof f === 'string' && !!f.trim())
    .filter((f) => !open.some((title) => title.includes(f.trim().toLowerCase())));
}

/* ---------- the habit week ---------- */

export type StreakDay = { date: string; letter: string; name: string; state: 'done' | 'missed' | 'open' | 'rest' | 'future' };

/** Monday to Sunday of this week: a day is done when every habit due that day was checked in. `best` is the longest
 *  current streak of a single habit (the API's count, `bestTitle` that habit), not a count of the lit days. */
export function habitWeek(habits: Habits | null, today = istDate()): { days: StreakDay[]; best: number | null; unit: string; bestTitle: string | null } {
  const t = new Date(`${today}T00:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(t.getTime() - dow * 86_400_000);
  const active = (habits?.items ?? []).filter((h) => h.status === 'active');
  const days: StreakDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const name = weekdayLong(date);
    const letter = name.slice(0, 1);
    if (date > today) return { date, letter, name, state: 'future' };
    const due = active.map((h) => h.recent?.find((r) => r.date === date)).filter((r): r is HabitDay => !!r && r.due);
    if (!due.length) return { date, letter, name, state: 'rest' };
    if (due.every((r) => r.status === 'done')) return { date, letter, name, state: 'done' };
    return { date, letter, name, state: date === today ? 'open' : 'missed' };
  });
  const top = active.filter((h) => !!h.streak && h.streak.count > 0).sort((a, b) => b.streak!.count - a.streak!.count)[0];
  return { days, best: top ? top.streak!.count : null, unit: top?.streak?.unit ?? 'days', bestTitle: top?.title ?? null };
}

/* ---------- today's brief ---------- */

/** One sentence built on the phone from what the API holds (never written by an assistant, never a guess): the tasks
 *  due, the next session, the next consultation and a booked blood test. */
export function briefText(me: Me | null, workouts: Workouts | null, open: number, appt: NextAppointment | null = nextAppointmentOf(me, null)): string {
  if (!me) return '';
  const today = istDate();
  const parts: string[] = [];
  if (open > 0) parts.push(`${plural(open, 'task')} due`);
  else if (me.plan) parts.push('No tasks due');
  const next = workouts?.next;
  if (next) parts.push(next.scheduledDate === today ? `${next.title} today` : `${next.title} on ${weekdayLong(next.scheduledDate)}`);
  // the next consultation by the shared rule (lib/today): only one still to come
  if (appt) parts.push(`${appt.kind === 'consultation' ? 'consultation' : 'appointment'} ${whenShort(appt.startAt)}`);
  const bw = me.bloodwork;
  if (bw && bw.slot_at && isUpcoming(bw)) parts.push(`blood test ${whenShort(bw.slot_at)}`);
  if (!parts.length) return 'Nothing is scheduled for today.';
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------- bookings (the shared rule, lib/today: Home, Life and Coach call the same consultation upcoming) ---------- */

/** An appointment as GET /me/appointments lists it (the fields Home reads). */
export type ApptRow = { id: string; kind: string; status: string; startAt: string; endAt?: string | null; coachName?: string | null; consumesEntitlement?: boolean };
/** The consultation Home shows as next, in one shape. */
export type NextAppointment = { id: string; kind: string; status: string; startAt: string; endAt: string | null };

/** The next upcoming appointment: the first upcoming one of GET /me/appointments?range=upcoming when Home has it (it
 *  also holds one under way, whose end is still to come), else GET /me's nextAppointment while it is upcoming; null
 *  when none is (a past one still marked scheduled is never next). */
export function nextAppointmentOf(me: Me | null, list: readonly ApptRow[] | null): NextAppointment | null {
  if (list) {
    const a = list.filter((x) => isUpcoming(x)).sort((x, y) => Date.parse(x.startAt) - Date.parse(y.startAt))[0];
    return a ? { id: a.id, kind: a.kind, status: a.status, startAt: a.startAt, endAt: a.endAt ?? null } : null;
  }
  const n = me?.nextAppointment;
  return n && isUpcoming(n) ? { id: n.id, kind: n.kind, status: n.status, startAt: n.start_at, endAt: null } : null;
}

/** A blood-test booking as GET /me/bloodwork/bookings lists it (the fields Home reads; the Tests tab's and Orders' own
 *  list, under the same 'bookings' key). */
export type BloodBooking = { id: string; status: string; slotAt: string; consumesEntitlement: boolean };

/** A balance's held count split by the shared rule; `held` instead while it cannot be split yet ("2 booked and held"). */
export type HeldCount = { booked: number; awaiting: number; held?: number };

/** A consultation balance's held count split into the ones still to come ("booked") and the ones whose time has passed
 *  while still open ("awaiting update"), from the upcoming list when Home has it, else from the next appointment, so
 *  the count never says booked beside "None booked" (or beside Coach's "None booked"). A blood-test balance is split
 *  over the member's bookings that hold one (`bookings`, the list the Tests tab splits its balance over): one whose
 *  visit window has passed while it is still open awaits its update (lib/today heldByBookings), so Home and Tests say
 *  the same. Until that list has arrived, the latest booking Home has (GET /me's bloodwork) stands for the only held
 *  one only while at most one is held; with more, the count is not split (`held`). */
export function balanceSplit(b: Balance, me: Me, list: readonly ApptRow[] | null, bookings: readonly BloodBooking[] | null = null): HeldCount {
  if (b.kind !== 'consultation') {
    if (bookings) return heldByBookings(b.reserved, bookings.filter((x) => x.consumesEntitlement));
    return b.reserved <= 1 ? heldByBookings(b.reserved, [me.bloodwork]) : { booked: 0, awaiting: 0, held: b.reserved };
  }
  const upcoming = list ? list.filter((a) => isUpcoming(a) && holdsConsultation(a)).length : null;
  return heldSplit(b.reserved, upcoming, !!nextAppointmentOf(me, null));
}

/* ---------- live sessions and this week ---------- */

/** Live session kinds as the photo slots name them. */
export function liveKind(kind: string): 'class' | 'webinar' | 'workshop' {
  if (kind === 'webinar') return 'webinar';
  if (kind === 'workshop') return 'workshop';
  return 'class';
}

/** Upcoming live sessions, soonest first. */
export function upcomingSessions(items: LiveSession[] | null | undefined, limit = 8): LiveSession[] {
  const now = Date.now() - 60 * 60_000;
  return (items ?? []).filter((s) => s.status === 'published' && Date.parse(s.startAt) >= now).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)).slice(0, limit);
}

/** Minutes of sessions completed today (India day), from what the member logged. */
export function activeMinutesToday(w: Workouts | null): number | null {
  if (!w) return null;
  const today = istDate();
  return w.items.filter((s) => (s.status === 'completed' || s.status === 'partial') && s.completedAt && istDayOf(s.completedAt) === today)
    .reduce((n, s) => n + (s.durationMinutes ?? 0), 0);
}

export const STATUS_WORD: Record<string, string> = { completed: 'Done', partial: 'Partly done', skipped: 'Skipped', scheduled: 'Planned', missed: 'Missed' };
