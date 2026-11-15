/* The Tests (Clinic) package's data shapes and the small pure helpers its screens share: the API payloads of
   GET /me/bloodwork/tests, /me/entitlements, /me/bloodwork/bookings(/:id), /me/bloodwork/slots, /me/reports,
   /reports/:id and /me/lab-preparation, and how they are worded and coloured. Nothing here invents a value: every
   number, date and range comes from the API; the words only name what the API already says (a status, a source, a
   laboratory status code). */
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { AWAITING_UPDATE } from '@/lib/today';
import { fx } from '@/fx';
import type { IconName } from '@/fx';

export type LabTest = {
  id: string; vendorTestId?: string; kind: 'test' | 'package' | string; name: string; description: string; priceInr?: number | null;
  fastingHours: number; turnaround: string; markers: number | null; preparation: string; hidden?: boolean;
  imageAssetId?: string | null; imageUrl?: string | null; tags?: string[]; featured?: boolean;
};
export type Balance = { total: number; used: number; reserved: number; remaining: number; unit: string; expiresAt: string | null };
export type ConsentState = { granted: boolean; version?: string; at?: string };
export type TestsPayload = { items: LabTest[]; entitlement: Balance | null; consents: Record<string, ConsentState | undefined>; vendor: string };
export type EntitlementRow = {
  id: string; serviceType: string; unit: string; quantity: number; used: number; reserved: number; remaining: number; status: string;
  expiresAt: string | null; orderId: string | null; programmeId: string | null; packageName: string | null;
};
export type EntitlementsPayload = { bloodwork: Balance | null; consultation: Balance | null; items: EntitlementRow[] };
export type TimelineEvent = { at: string; from_status: string | null; to_status: string; vendor_status: string | null; source: string; note: string | null };
export type Booking = {
  id: string; reference: string; test: LabTest | null; status: string; statusLabel?: string; slotAt: string; labId: string | null;
  vendorOrderId: string | null; vendorStatus: string | null; vendorPending: boolean; flag: string | null;
  address: { line: string; city: string; state: string; pincode: string } | null; consumesEntitlement: boolean;
  expectedReportBy: string | null; cancelledReason: string | null; canCancel: boolean; canReschedule: boolean;
  report: { id: string; released: boolean; reviewerKind?: 'coach' | 'team' } | null;
  timeline?: TimelineEvent[]; createdAt: string; updatedAt: string; simulated: boolean;
};
export type Slot = { labId: string; labName?: string; time?: string; startAt: string };
export type SlotsPayload = { date: string; pincode: string; slots: Slot[]; note?: string };
export type ReportValue = {
  marker_key: string | null; vendor_test_id?: string; label: string; value: string; units: string | null;
  range_low: number | null; range_high: number | null; matched_range: string | null; flag: string | null; unmapped?: number;
};
export type Report = {
  id: string; bookingId: string; reference: string; test: LabTest | null; collectedAt: string; deliveredAt: string | null;
  released: boolean; reviewed: boolean; reviewedAt: string | null; reviewerName: string | null; reviewerKind: 'coach' | 'team';
  coachNote: string | null; flagged: string[]; markers: number | null; valuesStatus: 'pending' | 'ready' | 'failed' | string;
  values?: ReportValue[]; hasFile: boolean; provenance: string; simulated: boolean;
};
export type Profile = {
  id: string; email: string; phone: string | null; name: string; phoneVerified?: boolean;
  profile: { gender: string | null; dateOfBirth: string | null; city: string | null; state: string | null; pincode: string | null; address: string | null } | null;
  consents?: Record<string, ConsentState | undefined>;
};

/* ---------- bookings ---------- */

/** The seven shared laboratory statuses, in the earlier app's order colours (fx.map.order); a collection whose slot has
 *  passed while it is still open (lib/today shownStatus: "Awaiting update") in the amber that word has on Coach. */
export function statusColour(status: string): string {
  if (status === AWAITING_UPDATE) return fx.hue.amber400;
  return (fx.map.order as Record<string, string>)[status] ?? fx.hue.grey;
}

export function statusIcon(status: string): IconName {
  switch (status) {
    case AWAITING_UPDATE: return 'clock';
    case 'confirmed': return 'circle-check';
    case 'scheduled': return 'calendar-check';
    case 'sample_collected': return 'test-tube';
    case 'processing': return 'loader-circle';
    case 'results_ready': return 'file-text';
    case 'completed': return 'badge-check';
    case 'cancelled': return 'circle-x';
    default: return 'circle-dot';
  }
}

export const isOpenBooking = (b: Booking) => b.status !== 'completed' && b.status !== 'cancelled';

/** The laboratory's own status codes in plain words (LabStack's order statuses; the API keeps the code). */
const VENDOR_WORDS: Record<string, string> = {
  PENDING: 'Order placed with the laboratory',
  CREATED: 'Order placed with the laboratory',
  ORDER_SCHEDULED: 'The laboratory scheduled the visit',
  PHLEBO_ASSIGNED: 'A phlebotomist was assigned',
  PHLEBO_STARTED: 'The phlebotomist is on the way',
  PATIENT_VISITED: 'The phlebotomist reached your address',
  RESCHEDULED: 'The visit moved to a new slot',
  PHLEBO_NO_SHOW: 'The phlebotomist did not arrive; a new visit is needed',
  PATIENT_MISSED: 'The visit was missed; a new visit is needed',
  SAMPLE_REJECTED: 'The laboratory could not use the collection; a new visit is needed',
  SAMPLE_COLLECTED: 'Collected at your address',
  SAMPLE_IN_TRANSIT: 'On its way to the laboratory',
  SAMPLE_DELIVERED: 'Received by the laboratory',
  SAMPLE_PROCESSED: 'Being analysed by the laboratory',
  PARTIAL_DELIVERED: 'Some results have arrived',
  REPORT_DELIVERED: 'The laboratory delivered the report',
  CANCELED: 'Cancelled by the laboratory',
};

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g;

/** A note written for the team, never for the member: the sync's "webhook", and the reason an administrator gives
 *  for an owner override ("Override: …", audited with their name). */
const internalNote = (e: TimelineEvent) => !e.note || e.note === 'webhook' || (e.source === 'admin' && /^override:/i.test(e.note));

/** One timeline step in words: the laboratory's code in plain words, else the note (dates in it read as IST), else the
 *  status. Internal notes never show. A step a person made that changed the status (the member's own cancellation, a
 *  release, an override) is named by that change: its row keeps the laboratory's last code, which is not what happened
 *  then ("Cancelled in the app · You", never "The phlebotomist did not arrive"); an override is named by its new status
 *  ("Sample collected · Bioptime team"). */
export function timelineText(e: TimelineEvent): string {
  const note = e.note && !internalNote(e) ? e.note.replace(ISO, (iso) => fmtDateTime(iso)) : null;
  const person = e.source === 'member' || e.source === 'coach' || e.source === 'admin';
  if (person && e.from_status && e.from_status !== e.to_status) return note ? note.charAt(0).toUpperCase() + note.slice(1) : label(e.to_status);
  const vendor = e.vendor_status ? VENDOR_WORDS[e.vendor_status] : undefined;
  if (e.vendor_status === 'RESCHEDULED' && note) return note;
  return vendor ?? note ?? label(e.to_status);
}

/** Who made a timeline step. */
export function sourceText(source: string): string {
  switch (source) {
    case 'member': return 'You';
    case 'vendor': return 'Laboratory';
    case 'admin': return 'Bioptime team';
    case 'coach': return 'Your coach';
    default: return 'Bioptime';
  }
}

/* ---------- tests ---------- */

export const fastingText = (t: Pick<LabTest, 'fastingHours'>) => (t.fastingHours ? `Fasting ${t.fastingHours} h` : 'No fasting');
export const markersText = (n: number | null | undefined) => (n ? `${n} marker${n === 1 ? '' : 's'}` : null);

/** The chips of a test: its own tags (presentation fields), else what kind of test the catalogue says it is. */
export function testChips(t: LabTest): string[] {
  const own = (t.tags ?? []).filter(Boolean);
  return (own.length ? own : [t.kind === 'package' ? 'Panel' : 'Single test', t.featured ? 'Featured' : null].filter(Boolean) as string[]).slice(0, 3);
}

/** A test's line: the catalogue's own description, else the laboratory's preparation text (or nothing). */
export function testLine(t: LabTest): string | null {
  return t.description || t.preparation || null;
}

/** Featured tests first, then the catalogue's own order. */
export function orderTests(items: LabTest[]): LabTest[] {
  return [...items.filter((t) => t.featured), ...items.filter((t) => !t.featured)].filter((t) => !t.hidden);
}

/* ---------- entitlements ---------- */

/** Blood-test entitlement rows, keyed by id (a kind can repeat: a package and an adjustment), with their sum by kind. */
export function bloodworkRows(items: EntitlementRow[] | undefined): { rows: EntitlementRow[]; sum: Balance | null } {
  const rows = (items ?? []).filter((r) => r.serviceType === 'bloodwork');
  if (!rows.length) return { rows, sum: null };
  const sum = rows.reduce<Balance>((s, r) => ({
    total: s.total + r.quantity, used: s.used + r.used, reserved: s.reserved + r.reserved, remaining: s.remaining + r.remaining, unit: r.unit,
    expiresAt: r.expiresAt && (!s.expiresAt || r.expiresAt > s.expiresAt) ? r.expiresAt : s.expiresAt,
  }), { total: 0, used: 0, reserved: 0, remaining: 0, unit: 'collection', expiresAt: null });
  return { rows, sum };
}

export const rowName = (r: EntitlementRow) => (r.packageName ? `${r.packageName} package` : 'Added to your account');

/* ---------- dates and slots (IST, the laboratory's clock) ---------- */

const IST = 'Asia/Kolkata';

/** Weekday, day and month of a YYYY-MM-DD day, for the date chips. */
export function dayParts(day: string): { weekday: string; day: string; month: string; long: string } {
  const d = new Date(`${day}T12:00:00+05:30`);
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-IN', { ...o, timeZone: IST });
  return { weekday: part({ weekday: 'short' }), day: part({ day: 'numeric' }), month: part({ month: 'short' }), long: part({ weekday: 'short', day: 'numeric', month: 'short' }) };
}

/** "06:00" from the laboratory's "06:00" (or from the slot's start in IST): the 24-hour clock the rest of the app uses
 *  (the slot chips, under a picker that says the times are IST). */
export function slotTime(s: Pick<Slot, 'time' | 'startAt'>): string {
  const hhmm = s.time ?? new Date(s.startAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST });
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "07:30 IST": a slot's time where it stands on its own (a sentence, a summary row). */
export const slotTimeIst = (s: Pick<Slot, 'time' | 'startAt'>) => `${slotTime(s)} IST`;

/** A collection moment as "Sat, 7 Nov" and "07:30 IST". */
export function whenParts(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: IST }),
    time: slotTimeIst({ startAt: iso }),
  };
}

/** When to stop eating before a fasting collection: the slot minus the laboratory's fasting hours, as "19:30 on Fri,
 *  6 Nov" (IST); null without a fasting time. */
export function fastFrom(slotAt: string, hours: number | null | undefined): string | null {
  if (!hours || hours <= 0) return null;
  const at = new Date(new Date(slotAt).getTime() - hours * 3_600_000);
  if (Number.isNaN(at.getTime())) return null;
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST });
  const day = at.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: IST });
  return `${time} IST on ${day}`;
}

export const shortDate = (iso?: string | null) => (iso ? fmtDate(iso).replace(/ \d{4}$/, '') : '—');

/* ---------- report values ---------- */

/** Panels for the report, named after the catalogue's own tests; a marker the app does not know goes to "Other". */
const PANELS: { title: string; keys: string[] }[] = [
  { title: 'Lipid profile', keys: ['total_cholesterol', 'hdl', 'ldl', 'triglycerides'] },
  { title: 'Blood sugar', keys: ['fasting_glucose', 'hba1c'] },
  { title: 'Blood count', keys: ['haemoglobin', 'wbc', 'platelets'] },
  { title: 'Thyroid', keys: ['t3', 't4', 'tsh'] },
  { title: 'Vitamins', keys: ['vitamin_d', 'vitamin_b12'] },
  { title: 'Inflammation', keys: ['hs_crp'] },
];

export function markerPanels(values: ReportValue[]): { title: string; values: ReportValue[]; flags: number }[] {
  const used = new Set<ReportValue>();
  const out = PANELS.map((p) => {
    const vs = p.keys.flatMap((k) => values.filter((v) => v.marker_key === k));
    vs.forEach((v) => used.add(v));
    return { title: p.title, values: vs, flags: vs.filter((v) => v.flag).length };
  }).filter((p) => p.values.length);
  const rest = values.filter((v) => !used.has(v));
  if (rest.length) out.push({ title: out.length ? 'Other markers' : 'Results', values: rest, flags: rest.filter((v) => v.flag).length });
  return out;
}

/** The laboratory's range in words ("125–200", "≤ 200", "≥ 40"), or its own matched text. */
export function rangeText(v: Pick<ReportValue, 'matched_range' | 'range_low' | 'range_high'>): string {
  if (v.matched_range) return v.matched_range;
  if (v.range_low != null && v.range_high != null) return `${v.range_low}–${v.range_high}`;
  if (v.range_low != null) return `≥ ${v.range_low}`;
  if (v.range_high != null) return `≤ ${v.range_high}`;
  return '—';
}

/** Where a value sits on the range bar (the green band is 15 %–85 % = the laboratory's range), or null when the value
 *  is not a number or there is no range. A range open at the top places the dot by how far the value is above the floor
 *  (never past the band's end); one open at the bottom starts at zero. */
export function rangePosition(v: ReportValue): number | null {
  const n = Number(v.value);
  if (!Number.isFinite(n)) return null;
  const lo = v.range_low, hi = v.range_high;
  const clamp = (x: number) => Math.max(0.04, Math.min(0.96, x));
  if (lo != null && hi != null && hi > lo) return clamp(0.15 + (0.7 * (n - lo)) / (hi - lo));
  if (hi != null && hi > 0) return clamp(0.15 + (0.7 * n) / hi);
  if (lo != null && lo > 0) return clamp(n < lo ? (0.15 * n) / lo : 0.15 + 0.7 * (1 - lo / n));
  return null;
}

/** The marker's state in words and colour: the laboratory's flag, never a judgement of the app's own. */
export function markerState(v: ReportValue): { text: string; colour: string } | null {
  if (v.flag === 'high') return { text: 'Above range', colour: fx.map.marker.high };
  if (v.flag === 'low') return { text: 'Below range', colour: fx.map.marker.low };
  if (v.flag) return { text: label(v.flag), colour: fx.map.marker.borderline };
  if (Number.isFinite(Number(v.value)) && (v.range_low != null || v.range_high != null || v.matched_range)) return { text: 'In range', colour: fx.map.marker.in_range };
  return null;
}

/** The summary pill of a report (the old list's words). */
export function reportState(r: Pick<Report, 'flagged' | 'valuesStatus' | 'values' | 'hasFile'>): { text: string; tone: 'warning' | 'success' | 'info' } {
  if (r.flagged?.length) return { text: `${r.flagged.length} outside range`, tone: 'warning' };
  if (r.valuesStatus === 'ready' && (r.values?.length ?? 0) > 0) return { text: 'All in range', tone: 'success' };
  return { text: r.valuesStatus === 'pending' ? 'Values pending' : r.hasFile ? 'See the laboratory PDF' : 'No values', tone: 'info' };
}
