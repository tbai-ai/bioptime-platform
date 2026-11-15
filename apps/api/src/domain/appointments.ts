/* Appointments: slots come from the coach's working hours minus blocks and existing bookings; every booking is
   conflict-checked on the server and reserves a consultation entitlement that a completed consultation consumes.

   Meeting details go through the meeting-provider seam (api/adapters/meetings.ts). With MEETING_PROVIDER "none" nothing
   is created: the link is whatever the coach typed (PATCH /coach/appointments/:id/meeting, M8), or nothing, and the
   member is told that their coach will share how to join. The old placeholder link is never returned. */
import { APPOINTMENT_TRANSITIONS, type AppointmentState } from '@bioptime/domain';
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { addMinutes, minutesBetween, overlaps, weekdayInZone, zonedToIso, addDays, istWhen } from '../lib/time.js';
import { audit, emit } from './audit.js';
import { notify } from './notifications.js';
import { getSetting } from './settings.js';
import * as entitlements from './entitlements.js';
import { activeCoachFor } from './assignments.js';
import { coachHasMember } from '../auth/permissions.js';
import { checkJoinUrl, linkHost, meetingProvider, shownLink } from '../adapters/meetings.js';

export type AppointmentRow = { id: string; member_id: string; coach_id: string | null; programme_id: string | null; kind: string; status: AppointmentState; start_at: string; end_at: string; timezone: string; meeting_link: string | null; meeting_provider?: string | null; meeting_ref?: string | null; note: string | null; member_note: string | null; entitlement_tx_id: string | null; cancelled_reason: string | null; reminder_sent_at: string | null; created_at: string; updated_at: string };

export function getAppointment(ctx: Ctx, id: string): AppointmentRow {
  const a = ctx.db.get<AppointmentRow>('SELECT * FROM appointments WHERE id = ?', [id]);
  if (!a) throw errors.notFound('Appointment');
  return a;
}

export function present(ctx: Ctx, a: AppointmentRow) {
  const member = ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [a.member_id]);
  const coach = a.coach_id ? ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [a.coach_id]) : undefined;
  return { id: a.id, memberId: a.member_id, memberName: member?.name ?? null, coachId: a.coach_id, coachName: coach?.name ?? null, programmeId: a.programme_id, kind: a.kind, status: a.status, startAt: a.start_at, endAt: a.end_at, timezone: a.timezone, meetingLink: a.status === 'scheduled' ? shownLink(a.meeting_link) : null, meetingProvider: a.meeting_provider ?? 'none', note: a.note, memberNote: a.member_note, cancelledReason: a.cancelled_reason, consumesEntitlement: !!a.entitlement_tx_id, createdAt: a.created_at, updatedAt: a.updated_at };
}

/** Free slots for a coach on a date (IST), from the rules minus blocks and other appointments. */
export function slotsFor(ctx: Ctx, coachId: string, date: string): Array<{ startAt: string; endAt: string }> {
  const dayStart = zonedToIso(date, 0);
  const weekday = weekdayInZone(dayStart);
  const rules = ctx.db.all<{ start_minute: number; end_minute: number; slot_minutes: number }>('SELECT * FROM availability_rules WHERE coach_id = ? AND weekday = ? AND active = 1', [coachId, weekday]);
  const blocks = ctx.db.all<{ start_at: string; end_at: string }>('SELECT start_at, end_at FROM availability_blocks WHERE coach_id = ? AND end_at > ? AND start_at < ?', [coachId, dayStart, addDays(dayStart, 1)]);
  const booked = ctx.db.all<{ start_at: string; end_at: string }>("SELECT start_at, end_at FROM appointments WHERE coach_id = ? AND status IN ('requested','scheduled') AND end_at > ? AND start_at < ?", [coachId, dayStart, addDays(dayStart, 1)]);
  const cutoff = addMinutes(ctx.now(), 30);
  const out: Array<{ startAt: string; endAt: string }> = [];
  for (const r of rules) {
    for (let m = r.start_minute; m + r.slot_minutes <= r.end_minute; m += r.slot_minutes) {
      const startAt = zonedToIso(date, m), endAt = zonedToIso(date, m + r.slot_minutes);
      if (startAt < cutoff) continue;
      if (blocks.some((b) => overlaps(startAt, endAt, b.start_at, b.end_at))) continue;
      if (booked.some((b) => overlaps(startAt, endAt, b.start_at, b.end_at))) continue;
      out.push({ startAt, endAt });
    }
  }
  return out;
}

function slotLength(ctx: Ctx, coachId: string, startAt: string): number {
  const weekday = weekdayInZone(startAt);
  const r = ctx.db.get<{ slot_minutes: number }>('SELECT slot_minutes FROM availability_rules WHERE coach_id = ? AND weekday = ? AND active = 1 LIMIT 1', [coachId, weekday]);
  return r?.slot_minutes ?? 30;
}

function assertNoConflict(ctx: Ctx, coachId: string | null, memberId: string, startAt: string, endAt: string, ignoreId?: string): void {
  if (coachId) {
    const clash = ctx.db.get("SELECT id FROM appointments WHERE coach_id = ? AND status IN ('requested','scheduled') AND end_at > ? AND start_at < ? AND id != ?", [coachId, startAt, endAt, ignoreId ?? '']);
    if (clash) throw errors.conflict('That time was just taken. Pick another slot.', 'SLOT_TAKEN');
    const blocked = ctx.db.get('SELECT id FROM availability_blocks WHERE coach_id = ? AND end_at > ? AND start_at < ?', [coachId, startAt, endAt]);
    if (blocked) throw errors.conflict('The coach is not available then.', 'SLOT_BLOCKED');
  }
  const own = ctx.db.get("SELECT id FROM appointments WHERE member_id = ? AND status IN ('requested','scheduled') AND end_at > ? AND start_at < ? AND id != ?", [memberId, startAt, endAt, ignoreId ?? '']);
  if (own) throw errors.conflict('You already have an appointment at that time.', 'MEMBER_CONFLICT');
}

export function book(ctx: Ctx, input: { memberId: string; coachId?: string; startAt: string; kind: 'consultation' | 'check_in' | 'review'; note?: string; idempotencyKey?: string; byCoach?: boolean }) {
  return ctx.db.tx(() => {
    if (input.idempotencyKey) {
      // keys are the member's own: a key string reused by someone else can never hand them another member's appointment
      const existing = ctx.db.get<AppointmentRow>('SELECT * FROM appointments WHERE idempotency_key = ? AND member_id = ?', [`${input.memberId}:${input.idempotencyKey}`, input.memberId]);
      if (existing) return present(ctx, existing);
    }
    const assignment = activeCoachFor(ctx, input.memberId);
    const coachId = input.coachId ?? assignment?.coachId ?? null;
    if (!coachId) throw errors.state('No coach is assigned yet; book once your coach is confirmed.', { code: 'NO_COACH' });
    if (assignment && assignment.coachId !== coachId && !input.byCoach && ctx.actor?.role === 'member') throw errors.forbidden('You can only book with your assigned coach', 'WRONG_COACH');
    if (ctx.actor?.role === 'coach' && !coachHasMember(ctx, ctx.actor.id, input.memberId)) throw errors.forbidden('Not your client', 'NO_ACCESS');
    if (input.startAt <= addMinutes(ctx.now(), 30)) throw errors.badRequest('Pick a time at least 30 minutes from now', 'TOO_SOON');
    if (!input.byCoach && ctx.actor?.role === 'member') { // the administrator's limit on open requests per member
      const limit = Math.max(1, Number(getSetting(ctx, 'max_open_appointments')) || 2);
      const open = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM appointments WHERE member_id = ? AND status IN ('requested','scheduled') AND start_at > ?", [input.memberId, ctx.now()])!.n;
      if (open >= limit) throw errors.state(`You already have ${open} upcoming consultation${open === 1 ? '' : 's'}; that is the most you can hold at once. Cancel one or wait until it has taken place.`, { code: 'TOO_MANY_OPEN', limit });
    }
    const minutes = slotLength(ctx, coachId, input.startAt);
    const endAt = addMinutes(input.startAt, minutes);
    const date = input.startAt.slice(0, 10);
    const inRules = slotsFor(ctx, coachId, date).some((s) => s.startAt === input.startAt) || slotsFor(ctx, coachId, addDays(input.startAt, 0).slice(0, 10)).some((s) => s.startAt === input.startAt);
    assertNoConflict(ctx, coachId, input.memberId, input.startAt, endAt);
    const programme = ctx.db.get<{ id: string }>("SELECT id FROM programmes WHERE member_id = ? AND status = 'active' ORDER BY start_at DESC LIMIT 1", [input.memberId]);
    const id = ids.appointment();
    let txId: string | null = null;
    if (input.kind === 'consultation') {
      try { txId = entitlements.reserve(ctx, input.memberId, 'consultation', { type: 'appointment', id }, `reserve:appointment:${input.memberId}:${input.idempotencyKey ?? id}`).txId; }
      catch (e) { if (!input.byCoach) throw e; txId = null; } // a coach may schedule a courtesy consultation beyond the package; it consumes nothing
    }
    const status: AppointmentState = inRules || input.byCoach ? 'scheduled' : 'requested';
    const now = ctx.now();
    const meeting = status === 'scheduled' ? createMeeting(ctx, { id, kind: input.kind, coachId, startAt: input.startAt, endAt }) : null;
    ctx.db.insert('appointments', { id, member_id: input.memberId, coach_id: coachId, programme_id: programme?.id ?? null, kind: input.kind, status, start_at: input.startAt, end_at: endAt, timezone: 'Asia/Kolkata', meeting_link: meeting?.joinUrl ?? null, meeting_provider: meeting?.provider ?? 'none', meeting_ref: meeting?.meetingRef ?? null, note: input.byCoach ? input.note ?? null : null, member_note: input.byCoach ? null : input.note ?? null, entitlement_tx_id: txId, idempotency_key: input.idempotencyKey ? `${input.memberId}:${input.idempotencyKey}` : null, created_by: ctx.actor?.id ?? 'system', created_at: now, updated_at: now });
    const memberName = ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [input.memberId])?.name ?? 'A member';
    const when = `${istWhen(input.startAt)}`;
    notify(ctx, { userId: input.memberId, category: 'appointment', title: status === 'scheduled' ? 'Consultation booked' : 'Consultation requested', body: status === 'scheduled' ? `${when}. ${meeting?.joinUrl ? 'Open Appointments to join.' : 'Your coach will share how to join.'}` : `${when}. Your coach will confirm it.`, data: { appointmentId: id } });
    notify(ctx, { userId: coachId, category: 'appointment', title: status === 'scheduled' ? 'New consultation' : 'Consultation request', body: `${memberName}, ${when}.`, data: { appointmentId: id, memberId: input.memberId } });
    emit(ctx, 'AppointmentScheduled', { type: 'appointment', id }, { memberId: input.memberId, coachId, status });
    audit(ctx, 'appointment.book', { type: 'appointment', id }, null, { status, kind: input.kind, consumes: !!txId });
    return present(ctx, getAppointment(ctx, id));
  });
}

/** The meeting for a consultation, from the configured provider. "none" creates nothing and invents no link. */
function createMeeting(ctx: Ctx, a: { id: string; kind: string; coachId: string | null; startAt: string; endAt: string }) {
  return meetingProvider(ctx.config).createMeeting({ kind: 'appointment', refId: a.id, title: a.kind === 'consultation' ? 'Bioptime consultation' : a.kind === 'check_in' ? 'Bioptime check-in' : 'Bioptime review', startAt: a.startAt, endAt: a.endAt, timezone: 'Asia/Kolkata', hostId: a.coachId });
}

export function confirm(ctx: Ctx, id: string) {
  const a = getAppointment(ctx, id);
  const meeting = createMeeting(ctx, { id, kind: a.kind, coachId: a.coach_id, startAt: a.start_at, endAt: a.end_at });
  const link = meeting.joinUrl ?? shownLink(a.meeting_link); // a link the coach typed before confirming stays
  move(ctx, a, 'scheduled', { meeting_link: link, meeting_provider: meeting.provider, meeting_ref: meeting.meetingRef ?? a.meeting_ref ?? null });
  notify(ctx, { userId: a.member_id, category: 'appointment', title: 'Consultation confirmed', body: `${istWhen(a.start_at)}. ${link ? 'Open Appointments to join.' : 'Your coach will share how to join.'}`, data: { appointmentId: id } });
  return present(ctx, getAppointment(ctx, id));
}

export function reschedule(ctx: Ctx, id: string, startAt: string, reason?: string) {
  return ctx.db.tx(() => {
    const a = getAppointment(ctx, id);
    if (a.status !== 'scheduled' && a.status !== 'requested') throw errors.state(`An appointment that is ${a.status} cannot be moved`);
    const cutoff = Number(getSetting(ctx, 'appointment_cutoff_minutes'));
    if (ctx.actor?.role === 'member' && minutesBetween(ctx.now(), a.start_at) < cutoff) throw errors.state(`Appointments can be moved until ${cutoff / 60} hours before they start. Message your coach instead.`, { code: 'CUTOFF' });
    if (startAt <= addMinutes(ctx.now(), 30)) throw errors.badRequest('Pick a time at least 30 minutes from now', 'TOO_SOON');
    const minutes = slotLength(ctx, a.coach_id ?? '', startAt);
    const endAt = addMinutes(startAt, minutes);
    assertNoConflict(ctx, a.coach_id, a.member_id, startAt, endAt, id);
    ctx.db.update('appointments', id, { start_at: startAt, end_at: endAt, reminder_sent_at: null, updated_at: ctx.now() });
    audit(ctx, 'appointment.reschedule', { type: 'appointment', id }, reason ?? null, { from: a.start_at, to: startAt });
    const other = ctx.actor?.id === a.member_id ? a.coach_id : a.member_id;
    if (other) notify(ctx, { userId: other, category: 'appointment', title: 'Consultation moved', body: `Now ${istWhen(startAt)}.`, data: { appointmentId: id } });
    return present(ctx, getAppointment(ctx, id));
  });
}

export function cancel(ctx: Ctx, id: string, reason: string) {
  return ctx.db.tx(() => {
    const a = getAppointment(ctx, id);
    move(ctx, a, 'cancelled', { cancelled_reason: reason || 'cancelled' });
    if (a.meeting_ref) meetingProvider(ctx.config).cancelMeeting({ provider: a.meeting_provider ?? 'none', meetingRef: a.meeting_ref });
    if (a.entitlement_tx_id) entitlements.release(ctx, a.entitlement_tx_id, 'appointment cancelled');
    const other = ctx.actor?.id === a.member_id ? a.coach_id : a.member_id;
    if (other) notify(ctx, { userId: other, category: 'appointment', title: 'Consultation cancelled', body: `${istWhen(a.start_at)} was cancelled. ${reason}`.trim(), data: { appointmentId: id } });
    audit(ctx, 'appointment.cancel', { type: 'appointment', id }, reason);
    return present(ctx, getAppointment(ctx, id));
  });
}

export function complete(ctx: Ctx, id: string, note?: string) {
  return ctx.db.tx(() => {
    const a = getAppointment(ctx, id);
    move(ctx, a, 'completed', { note: note ?? a.note });
    if (a.entitlement_tx_id) entitlements.consume(ctx, a.entitlement_tx_id, 'consultation completed');
    emit(ctx, 'AppointmentCompleted', { type: 'appointment', id }, { memberId: a.member_id, coachId: a.coach_id });
    audit(ctx, 'appointment.complete', { type: 'appointment', id }, null, { consumed: !!a.entitlement_tx_id });
    return present(ctx, getAppointment(ctx, id));
  });
}

export function noShow(ctx: Ctx, id: string, note?: string) {
  const a = getAppointment(ctx, id);
  move(ctx, a, 'no_show', { note: note ?? a.note });
  audit(ctx, 'appointment.no_show', { type: 'appointment', id }, note ?? null);
  return present(ctx, getAppointment(ctx, id));
}

/** The coach's meeting details for a requested or scheduled consultation: an https link they typed, or null to clear
 *  it. The member is told once a scheduled consultation has a link. Audited with the link's host only (a link can carry
 *  a passcode). */
export function setMeetingLink(ctx: Ctx, id: string, joinUrl: string | null) {
  return ctx.db.tx(() => {
    const a = getAppointment(ctx, id);
    if (a.status !== 'scheduled' && a.status !== 'requested') throw errors.state(`Meeting details cannot change on an appointment that is ${a.status}`, { code: 'APPOINTMENT_CLOSED' });
    const link = joinUrl === null ? null : checkJoinUrl(joinUrl);
    const before = shownLink(a.meeting_link);
    ctx.db.update('appointments', id, { meeting_link: link, updated_at: ctx.now() });
    audit(ctx, 'appointment.meeting_set', { type: 'appointment', id }, null, { hasLink: !!link, host: linkHost(link), hadLink: !!before, provider: a.meeting_provider ?? 'none' });
    if (link && link !== before && a.status === 'scheduled') notify(ctx, { userId: a.member_id, category: 'appointment', title: 'How to join your consultation', body: `${istWhen(a.start_at)}. Your coach shared how to join: open Appointments.`, data: { appointmentId: id } });
    return present(ctx, getAppointment(ctx, id));
  });
}

function move(ctx: Ctx, a: AppointmentRow, to: AppointmentState, extra: Record<string, string | null> = {}): void {
  if (!APPOINTMENT_TRANSITIONS[a.status].includes(to)) throw errors.state(`An appointment that is ${a.status} cannot become ${to}`, { from: a.status, to });
  ctx.db.update('appointments', a.id, { status: to, updated_at: ctx.now(), ...extra });
}

export function list(ctx: Ctx, opts: { memberId?: string; coachId?: string; range?: 'upcoming' | 'past' | 'all'; status?: string; limit: number }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.memberId) { where.push('a.member_id = ?'); params.push(opts.memberId); }
  if (opts.coachId) { where.push('a.coach_id = ?'); params.push(opts.coachId); }
  if (opts.status) { where.push('a.status = ?'); params.push(opts.status); }
  if (opts.range === 'upcoming') { where.push("a.end_at >= ? AND a.status IN ('requested','scheduled')"); params.push(ctx.now()); }
  if (opts.range === 'past') { where.push("(a.end_at < ? OR a.status IN ('completed','cancelled','no_show'))"); params.push(ctx.now()); }
  const rows = ctx.db.all<AppointmentRow>(`SELECT a.* FROM appointments a ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.start_at ${opts.range === 'past' ? 'DESC' : 'ASC'} LIMIT ?`, [...params, opts.limit]);
  return rows.map((a) => present(ctx, a));
}

/** Reminders about 24 hours before, once. */
export function sendReminders(ctx: Ctx): number {
  const hours = Math.max(1, Number(getSetting(ctx, 'reminder_hours_before')) || 24); // the administrator's setting
  const from = addMinutes(ctx.now(), (hours - 1) * 60), to = addMinutes(ctx.now(), (hours + 1) * 60);
  const rows = ctx.db.all<AppointmentRow>("SELECT * FROM appointments WHERE status = 'scheduled' AND reminder_sent_at IS NULL AND start_at BETWEEN ? AND ?", [from, to]);
  // 'tomorrow' only when the reminder goes out about a day ahead; the member and the coach get the same title
  const title = hours >= 20 && hours <= 28 ? 'Consultation tomorrow' : 'Consultation coming up';
  for (const a of rows) {
    const prefs = ctx.db.get<{ reminders: number }>('SELECT reminders FROM notification_preferences WHERE user_id = ?', [a.member_id]);
    if (!prefs || prefs.reminders) notify(ctx, { userId: a.member_id, category: 'appointment_reminder', title, body: `${istWhen(a.start_at)}. ${shownLink(a.meeting_link) ? 'Your coach shared how to join: open Appointments.' : 'Your coach will share how to join.'}`, data: { appointmentId: a.id } });
    if (a.coach_id) notify(ctx, { userId: a.coach_id, category: 'appointment_reminder', title, body: `${istWhen(a.start_at)}.`, data: { appointmentId: a.id }, channels: ['in_app'] });
    ctx.db.update('appointments', a.id, { reminder_sent_at: ctx.now() });
  }
  return rows.length;
}

/** Scheduled appointments whose end passed without a completion or cancellation become operations exceptions. */
export function flagOverdue(ctx: Ctx, openTask: (input: { kind: string; title: string; detail?: string; refType?: string; refId?: string }) => string): number {
  const rows = ctx.db.all<AppointmentRow>("SELECT * FROM appointments WHERE status = 'scheduled' AND end_at < ?", [addMinutes(ctx.now(), -60)]);
  for (const a of rows) openTask({ kind: 'overdue_appointment', title: 'Consultation not closed', detail: `Appointment ${a.id} ended at ${a.end_at} without being marked completed, no-show or cancelled.`, refType: 'appointment', refId: a.id });
  return rows.length;
}
