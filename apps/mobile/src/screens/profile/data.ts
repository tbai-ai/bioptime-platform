/* Profile (tab 9): the payloads it reads and the small sums it makes from them. Nothing here estimates: every number
   is a count or a value the API returned, and a missing one stays missing ("—" or an honest empty state). */
import { istDate } from '@/lib/format';

export type Sub = 'overview' | 'achievements' | 'reports' | 'orders' | 'settings';
export const SUBS: Array<{ value: Sub; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'achievements', label: 'Achievements' },
  { value: 'reports', label: 'Reports' },
  { value: 'orders', label: 'Orders' },
  { value: 'settings', label: 'Settings' },
];
export const isSub = (v: unknown): v is Sub => typeof v === 'string' && SUBS.some((s) => s.value === v);

/* ---------- GET /me (the parts Profile reads) ---------- */
export type Me = {
  member?: { name?: string; email?: string; state?: string };
  programme?: Programme | null;
  plan?: { id: string; title: string; tasksTotal?: number; tasksDone?: number } | null;
  unread?: { notifications?: number; messages?: number };
};

/* ---------- GET /me/profile ---------- */
export type ProfileRec = {
  id: string; email: string; name: string; phone: string | null;
  profile: { city: string | null; state: string | null } | null;
};

/* ---------- GET /me/programme ---------- */
export type Programme = {
  id: string; status: string; startAt: string | null; endAt: string | null; packageName: string; packageSlug?: string;
  durationLabel?: string | null; consultations?: number; bloodworkEntitlements?: number; coaching?: string | null;
};
export type Entitlement = { id: string; serviceType: string; unit: string; quantity: number; used: number; reserved: number; remaining: number | null; status: string; expiresAt: string | null };
export type Task = { id: string; title: string; kind: string; week: number; day: number; due_at: string | null; status: string };
export type ProgrammeRes = {
  programme: Programme | null;
  entitlements?: Entitlement[];
  plan?: { id: string; title: string; current_version?: number; coach_name?: string | null } | null;
  tasks?: Task[];
};

/** The plan week the member is in: the week of the latest task already due (India dates); null before the first. */
export function planWeek(tasks: Task[] | undefined, today = istDate()): number | null {
  let best: { at: string; week: number } | null = null;
  for (const t of tasks ?? []) {
    const d = t.due_at?.slice(0, 10);
    if (!d || d > today) continue;
    if (!best || d > best.at) best = { at: d, week: Number(t.week) };
  }
  return best?.week ?? null;
}

const KIND_LABEL: Record<string, string> = { bloodwork: 'Blood tests', consultation: 'Consultations' };
export const kindLabel = (k: string) => KIND_LABEL[k] ?? (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));

/** Balances by kind: rows of the same kind (an audited adjustment adds a second row) add up into one line. */
export function balances(rows: Entitlement[] | undefined): Array<{ kind: string; total: number; left: number; booked: number }> {
  const by = new Map<string, { kind: string; total: number; left: number; booked: number }>();
  for (const e of rows ?? []) {
    const b = by.get(e.serviceType) ?? { kind: e.serviceType, total: 0, left: 0, booked: 0 };
    b.total += e.quantity;
    b.left += e.remaining ?? Math.max(0, e.quantity - e.used - e.reserved);
    b.booked += e.reserved;
    by.set(e.serviceType, b);
  }
  return [...by.values()];
}

/* ---------- workouts ---------- */
export type WeekSession = { id: string; scheduledDate: string; status: string; completedAt: string | null; title: string };
export type Week = { from: string; to: string; today: string; items: WeekSession[]; summary?: { due: number; done: number; skipped: number; upcoming: number } };
export type Records = {
  exercises: Array<{
    exerciseId: string; name: string; category: string;
    bestLoadKg: { value: number; reps: number | null; date: string } | null;
    bestReps: { value: number; date: string } | null;
    longestDurationSeconds: { value: number; date: string } | null;
  }>;
  mostSessionsInAWeek: { count: number; weekOf: string } | null;
  sessionsDone: number;
  bestHabitStreak: { count: number; unit: string; habitId: string; title: string } | null;
  note?: string;
};
export type History = { totals?: { completed: number; partial: number; skipped: number } };

const DONE = new Set(['completed', 'partial']);
/** India date (YYYY-MM-DD) of an instant. */
export const istDay = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10);
/** YYYY-MM-DD plus days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** Per day of this week (Monday first): sessions logged that day, and sessions still planned for it. */
export function weekDays(w: Week): Array<{ day: string; done: number; planned: number }> {
  const days = Array.from({ length: 7 }, (_, i) => ({ day: addDays(w.from, i), done: 0, planned: 0 }));
  for (const s of w.items) {
    const done = DONE.has(s.status);
    const on = done && s.completedAt ? istDay(s.completedAt) : s.scheduledDate;
    const slot = days.find((d) => d.day === on) ?? (done ? days.find((d) => d.day === s.scheduledDate) : undefined);
    if (!slot) continue;
    if (done) slot.done += 1; else if (s.status === 'scheduled') slot.planned += 1;
  }
  return days;
}

/** The bar heights (0..100, red above 75): a logged day is red and taller with more sessions, a planned day a grey
 *  half bar, an empty day a low grey stub so the week still reads as seven days. Heights draw no number. */
export function barValues(days: Array<{ done: number; planned: number }>): number[] {
  const most = Math.max(1, ...days.map((d) => d.done));
  return days.map((d) => (d.done ? 80 + Math.round((20 * d.done) / most) : d.planned ? 40 : 8));
}

/** One number, kg with its reps, reps or a duration, for a record row. */
export function recordValue(r: Records['exercises'][number]): { value: string; date: string } | null {
  if (r.bestLoadKg) return { value: `${trim(r.bestLoadKg.value)} kg${r.bestLoadKg.reps ? ` × ${r.bestLoadKg.reps}` : ''}`, date: r.bestLoadKg.date };
  if (r.bestReps) return { value: `${r.bestReps.value} reps`, date: r.bestReps.date };
  if (r.longestDurationSeconds) return { value: duration(r.longestDurationSeconds.value), date: r.longestDurationSeconds.date };
  return null;
}
const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export function duration(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/* ---------- the rest ---------- */
export type Milestone = { key: string; title: string; achievedAt: string | null; detail: string; source: string };
export type Metric = { metric: string; label: string; unit: string; enabled?: boolean; latest: { value: number; at: string; source: string } | null; series: Array<{ value: number | string; at: string }> };
export type Summary = { programmeCompletion: number | null; tasks?: { total: number; done: number; skipped: number }; metrics: Metric[]; note?: string };
export type Report = {
  id: string; reference: string; test: { name: string; kind?: string } | null; collectedAt: string | null; releasedAt: string | null;
  reviewed: boolean; reviewerName: string | null; flagged: string[]; markers: number | null; hasFile: boolean; simulated?: boolean;
};
export type Order = {
  id: string; reference: string; packageName: string; status: string; totalInr: number | null; paidAt: string | null; createdAt: string;
  payment?: { simulated?: boolean } | null; refund?: { status: string; amountInr: number } | null;
};
export type Booking = {
  id: string; reference: string; status: string; slotAt: string | null; createdAt: string; simulated?: boolean;
  test: { name: string; markers?: number | null; fastingHours?: number | null; turnaround?: string | null } | null;
};
export type BillingDoc = { id: string; kind: string; number: string; status: string; totalInr: number; issuedAt: string; orderReference?: string; packageName?: string; simulated?: boolean; relatedDocument?: { number: string } | null };
export type Billing = { orders: Array<{ id: string; reference: string; canRequestRefund?: boolean; openRequestId?: string | null; simulated?: boolean }>; documents: BillingDoc[]; requests: Array<{ id: string; orderReference: string; status: string; createdAt: string }> };

export function docLabel(d: BillingDoc): string {
  if (d.kind === 'receipt') return 'Receipt · not a tax invoice';
  if (d.kind === 'credit_note') return `Credit note${d.relatedDocument ? ` against ${d.relatedDocument.number}` : ''}`;
  return d.relatedDocument ? `Tax invoice · replaces ${d.relatedDocument.number}` : 'Tax invoice';
}
