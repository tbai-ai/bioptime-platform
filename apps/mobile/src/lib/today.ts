/* One rule for "today" and "upcoming", shared by Home, Bio, Life and Coach (acceptance L-01, CG-09, FU-M3), so two
   screens never disagree about the same figure:
   - A figure that says today is today's, or it says its date. Days are India days (Asia/Kolkata), as the API counts
     them.
   - A goal on a day's total (steps, water: the API keeps one value a day) shows today's value, or nothing logged
     today; never yesterday's total as today's progress. Any other goal shows its latest value, with "Latest, <date>"
     when that value is not from today. Today's steps are the phone's live count, never below the server's total for
     today (todaySteps), on Home, Bio and /goals alike.
   - A booking is upcoming only while it is open (requested, scheduled or confirmed) and its end, or its start when it
     has no end, is after now. One whose time has passed while it is still open is awaiting its update (the coach
     marks it done, moves or cancels it): it is shown as that, never as upcoming, and a count of booked ones leaves it
     out. Home, Life, the report and Coach read it for consultations; an appointment known by its start only (a lab
     follow-up's) is judged by its end from the upcoming list (shownStatusWith), so it is never past while under way.
     The count beside "x of y left" is of the consultations that hold one of the package's (holdsConsultation), on
     Home and Coach alike. A blood-test home collection is judged by its slot the same way (A1W-m5), with its visit
     window: a slot is the time the laboratory's phlebotomist is due, so the collection stays as it is while the visit
     is due (COLLECTION_WINDOW_MIN after the slot) and awaits its update after that. Tests (its cards, its count and
     its balance), Home's blood-test row and balance, Life's and the report's next-step rows and preparation card, the
     booking screen and Orders say "Awaiting update" for one past its window while the laboratory still has it open, and
     a count of booked or upcoming ones leaves it out (heldByBookings, over the member's list of bookings on Tests and
     Home alike). The server is not asked to change anything: the rule reads the data each screen already has. */
import { istDate } from './format';

/** The India day (YYYY-MM-DD) of a moment. */
export function istDayOf(iso: string): string {
  return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
}

/** Whether a moment falls on today's India day. */
export function isTodayAt(iso: string | null | undefined): boolean {
  return !!iso && istDayOf(iso) === istDate();
}

/* ---------- goals ---------- */

/** The metrics the API keeps as one total per day (packages/domain DAILY_TOTAL_METRICS). */
export const DAILY_TOTALS: readonly string[] = ['steps', 'water_ml'];
/** Daily totals the member counts up from 0 each day (Home's water glasses): a day with none logged reads 0, as Home's
 *  hydration card shows it; steps read "—" until a step is counted or sent. */
const COUNTED_FROM_ZERO: readonly string[] = ['water_ml'];
export const isDailyTotal = (metric: string | null | undefined): boolean => !!metric && DAILY_TOTALS.includes(metric);

export type GoalFigure = {
  /** The value to show against the target (null: nothing to show, "nothing logged today" for a daily goal). */
  value: number | null;
  /** A goal on a day's total: the value is today's only. */
  daily: boolean;
  /** Any other goal: when its value was logged, set only when that was not today (the row says "Latest, <date>"). */
  olderAt: string | null;
};

/** What a goal shows now. `today`: today's total for a daily goal when the caller has it (the phone's live count, the
 *  water the member just set, the server's total for today; null when there is none yet); left out, the goal's latest
 *  value counts only when it was logged today. */
export function goalFigure(g: { metric: string | null; latest?: { value: number; at: string } | null; valuesWithheld?: boolean }, today?: number | null): GoalFigure {
  const daily = isDailyTotal(g.metric);
  if (g.valuesWithheld) return { value: null, daily, olderAt: null };
  if (daily) {
    const value = today !== undefined ? today : g.latest && isTodayAt(g.latest.at) ? g.latest.value : null;
    return { value: value ?? (COUNTED_FROM_ZERO.includes(g.metric as string) ? 0 : null), daily, olderAt: null };
  }
  const value = g.latest?.value ?? null;
  const at = value != null ? g.latest?.at ?? null : null;
  return { value, daily, olderAt: at && !isTodayAt(at) ? at : null };
}

/** Today's steps as every screen shows them (Home's activity card and goals, Bio's device card and goals, /goals): the
 *  phone's live count while it counts, never below the server's total for today (a value logged by hand, another
 *  device); else the server's total for today; null when there is neither. */
export function todaySteps(live: number | null | undefined, serverToday: number | null | undefined): number | null {
  if (live != null) return Math.max(live, serverToday ?? 0);
  return serverToday ?? null;
}

/** Today's total of a daily metric from a series of day totals (each point's `day`, else the India day of its moment);
 *  null when today has none. */
export function todayTotal(series: readonly { value: number; at: string; day?: string }[] | null | undefined): number | null {
  const day = istDate();
  let out: number | null = null;
  let last = '';
  for (const p of series ?? []) {
    if ((p.day ?? istDayOf(p.at)) === day && p.at >= last) { out = p.value; last = p.at; }
  }
  return out;
}

/* ---------- bookings ---------- */

/** A booking as any screen has it: GET /me's nextAppointment (start_at), GET /me/appointments (startAt, endAt), a
 *  lab follow-up's appointment or booking (startAt, slotAt), GET /me's bloodwork (slot_at). */
export type Booking = {
  status: string;
  start_at?: string | null; startAt?: string | null; end_at?: string | null; endAt?: string | null; slot_at?: string | null; slotAt?: string | null;
};

/** The statuses of a booking that is still to happen (or awaiting its update once its time has passed). */
export const OPEN_BOOKING: readonly string[] = ['requested', 'scheduled', 'confirmed'];
/** The status a screen shows for an open booking whose time has passed ("Awaiting update" through lib/format label). */
export const AWAITING_UPDATE = 'awaiting_update';

/** A home collection's visit window (minutes after its slot): the slot is the time the phlebotomist is due (the slot
 *  picker offers one every 30 minutes), so a collection is due, not yet awaiting its update, until this long after it
 *  (PHLEBO_ASSIGNED, PHLEBO_STARTED and PATIENT_VISITED all read "scheduled" meanwhile). */
export const COLLECTION_WINDOW_MIN = 60;

/** When a booking's time is over: its end, else its start; a booking known by its slot only (a home collection), the
 *  end of its visit window. */
function lastMoment(b: Booking): number {
  const t = b.end_at ?? b.endAt ?? b.start_at ?? b.startAt ?? null;
  const slot = t ? null : b.slot_at ?? b.slotAt ?? null;
  const ms = t ? Date.parse(t) : slot ? Date.parse(slot) + COLLECTION_WINDOW_MIN * 60_000 : NaN;
  return Number.isFinite(ms) ? ms : -Infinity;
}

/** Upcoming: open, and its end (or start; a collection's visit window) is after now. */
export function isUpcoming(b: Booking | null | undefined, now = Date.now()): boolean {
  return !!b && OPEN_BOOKING.includes(b.status) && lastMoment(b) > now;
}

/** Open, but its time has passed: awaiting its update. */
export function isAwaitingUpdate(b: Booking | null | undefined, now = Date.now()): boolean {
  return !!b && OPEN_BOOKING.includes(b.status) && !(lastMoment(b) > now);
}

/** The status to show: AWAITING_UPDATE for an open booking whose time has passed, else its own. */
export function shownStatus(b: Booking, now = Date.now()): string {
  return isAwaitingUpdate(b, now) ? AWAITING_UPDATE : b.status;
}

/** An appointment as GET /me/appointments?range=upcoming lists it: the server keeps an open one there until its end. */
export type ListedAppointment = Booking & { id: string };

/** Open, known by its start only (a lab follow-up's appointment: no end), and that start has passed: whether it is under
 *  way or awaiting its update only the upcoming list can tell. */
export function startedWithoutEnd(b: Booking & { startAt?: string | null }, now = Date.now()): boolean {
  return OPEN_BOOKING.includes(b.status) && !(b.end_at ?? b.endAt) && !!b.startAt && !(Date.parse(b.startAt) > now);
}

/** The status to show for an appointment that may come without its end (a lab follow-up's), by the same end-aware rule
 *  as Home and Coach: its own end when it has one; else its entry in the upcoming list (`upcoming`, which carries the
 *  end): listed, judged by that end; not listed while the list is known and its start has passed, awaiting its update.
 *  While the list is not known (loading, not reached), its own status: never "Awaiting update" for one that may be
 *  under way. */
export function shownStatusWith(b: ListedAppointment, upcoming: readonly ListedAppointment[] | null | undefined, now = Date.now()): string {
  if (!OPEN_BOOKING.includes(b.status) || b.end_at || b.endAt) return shownStatus(b, now);
  const listed = upcoming?.find((x) => x.id === b.id);
  const end = listed ? listed.endAt ?? listed.end_at ?? null : null;
  if (end) return shownStatus({ ...b, endAt: end }, now);
  if (listed || !upcoming) return b.status; // listed with no end (still upcoming to the server), or no list: its own
  return lastMoment(b) > now ? b.status : AWAITING_UPDATE; // not listed: past to the server once its start has passed
}

/** A booking that holds one of the package's consultations: a consultation that reserved one (a coach's courtesy
 *  consultation, a check-in or a review holds none). The figure beside "x of y left" counts only these, on Home and on
 *  Coach, so both describe the package. */
export function holdsConsultation(b: { kind?: string | null; consumesEntitlement?: boolean | null }): boolean {
  return b.kind === 'consultation' && b.consumesEntitlement !== false;
}

/** How many of `items` hold one of the package's consultations and await their update (open, their time passed). */
export function awaitingHeld(items: readonly (Booking & { kind?: string | null; consumesEntitlement?: boolean | null })[] | null | undefined, now = Date.now()): number {
  return (items ?? []).filter((b) => holdsConsultation(b) && isAwaitingUpdate(b, now)).length;
}

/** A home collection that is due now: open, its slot has come and its visit window has not ended. */
export function isCollectionDue(b: Booking | null | undefined, now = Date.now()): boolean {
  const slot = b ? b.slot_at ?? b.slotAt ?? null : null;
  return !!b && !!slot && !(b.end_at ?? b.endAt ?? b.start_at ?? b.startAt) && !(Date.parse(slot) > now) && isUpcoming(b, now);
}

/** A blood-test balance's held count (its reserved: the open collections that hold one) split by the same rule: each
 *  collection the screen knows that holds one and whose visit window has passed while it is open awaits its update,
 *  and every other held one is booked. `known`: every booking that holds one, from the member's list of bookings (GET
 *  /me/bloodwork/bookings, which Tests and Home both read), so Home and Tests never call booked a collection the other
 *  shows awaiting its update. */
export function heldByBookings(held: number, known: readonly (Booking | null | undefined)[], now = Date.now()): { booked: number; awaiting: number } {
  const h = Math.max(0, held);
  const awaiting = Math.min(h, known.filter((b) => isAwaitingUpdate(b, now)).length);
  return { booked: h - awaiting, awaiting };
}

/** How many of `held` (a package balance's reserved count: the open bookings that hold one) are still upcoming, and how
 *  many await their update. `upcoming`: the open bookings that hold one and are upcoming, when the caller has the list
 *  (null: not known; then `nextKnown` says whether the one the screen shows is upcoming, and every held one is counted
 *  with it). */
export function heldSplit(held: number, upcoming: number | null, nextKnown: boolean): { booked: number; awaiting: number } {
  const h = Math.max(0, held);
  const booked = upcoming != null ? Math.min(h, upcoming) : nextKnown ? h : 0;
  return { booked, awaiting: h - booked };
}
