/* M1 Habits and reminders: the routes. Every one goes through def() with its role, `feature: 'habits'` (403
   FEATURE_DISABLED while the flag is off) and, for administrators, a permission. Records are checked again in
   api/domain/habits.ts: a member reaches only their own habits, a coach only an assigned client's, and check-in notes
   reach a coach only while the member shares health information (requireHealthAccess), and so do the habits the
   member wrote themselves; the habits a coach set and their completion are visible like plan tasks. Coach payloads pass
   the field policy's safety net (coachSafe in auth/fieldPolicy.ts), which reports any restricted key a presenter
   produced and sends the payload without it. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  coachHabitCreateSchema, coachHabitUpdateSchema, habitArchiveSchema, habitCheckinSchema, isRealDate,
  memberHabitCreateSchema, memberHabitUpdateSchema,
} from '@bioptime/domain/modules/habits';
import type { Ctx } from '../../context.js';
import { parse } from '../../lib/validate.js';
import { AppError, errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import { coachHasMember, hasPermission, requireHealthAccess } from '../../auth/permissions.js';
import { adminRestrictedKeys, coachSafe as policyCoachSafe, stripRestricted } from '../../auth/fieldPolicy.js';
import { audit } from '../../domain/audit.js';
import * as habits from '../../domain/habits.js';

const FEATURE = 'habits';
const TAG = 'habits';

/** The field policy's safety net over a whole coach payload (no phone, email, address, PIN, date of birth or account
 *  secret): the shared coachSafe in auth/fieldPolicy.ts. It looks at the payload as built, before anything is removed;
 *  a restricted key anywhere is reported (paths only, never values) through the field policy's reporter, so a query that
 *  starts returning one is noticed instead of hidden, and the payload goes out without it, so nothing leaks and the
 *  coach's page does not break. Exported for the habits tests. */
export function coachSafe<T>(ctx: Ctx, payload: T): T {
  return policyCoachSafe(ctx, payload, 'habits coach route');
}

export function habitRoutes(app: FastifyInstance): void {
  const me = (req: FastifyRequest) => req.ctx.actor!.id;
  const member = (req: FastifyRequest) => ({ role: 'member' as const, id: me(req) });
  const coach = (req: FastifyRequest) => ({ role: 'coach' as const, id: me(req) });
  /** The assigned coach only; anyone else is refused before the record is read. */
  const clientId = (req: FastifyRequest) => { const id = param(req, 'id'); if (!coachHasMember(req.ctx, me(req), id)) throw errors.forbidden('Not your client', 'NO_ACCESS'); return id; };
  const guard = coachSafe;
  /** Does the member share health information with this coach right now? The habits the member wrote themselves and
   *  check-in notes follow it; the habits a coach set and their completion do not (as plan tasks). */
  const sharesHealth = (ctx: Ctx, memberId: string) => {
    try { requireHealthAccess(ctx, memberId); return true; }
    catch (e) { if (e instanceof AppError && e.code === 'NOT_SHARED') return false; throw e; }
  };
  const dateParam = (req: FastifyRequest) => { const d = param(req, 'date'); if (!isRealDate(d)) throw errors.validation([{ path: 'date', message: 'Use a real date, YYYY-MM-DD' }], 'date: use a real date, YYYY-MM-DD'); return d; };

  /* ---------- member ---------- */

  def(app, { method: 'GET', path: '/me/habits', summary: 'My habits: today’s check-in, this week, the streak and the last days (?archived=1 adds archived ones)', tag: TAG, auth: 'member', feature: FEATURE, query: z.object({ archived: z.string().optional() }) },
    async (req) => habits.listForMember(req.ctx, me(req), { includeArchived: ['1', 'true'].includes(String(query(req).archived ?? '')) }));

  def(app, { method: 'POST', path: '/me/habits', summary: 'Add one of my own habits', tag: TAG, auth: 'member', feature: FEATURE, body: memberHabitCreateSchema, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(memberHabitCreateSchema, req.body);
    const row = habits.createHabit(req.ctx, me(req), member(req), i);
    reply.code(201);
    return habits.habitView(req.ctx, row, true);
  });

  def(app, { method: 'PATCH', path: '/me/habits/:id', summary: 'Change one of my habits: anything on my own; only the reminders on one my coach set', tag: TAG, auth: 'member', feature: FEATURE, body: memberHabitUpdateSchema }, async (req) => {
    const i = parse(memberHabitUpdateSchema, req.body);
    const row = habits.updateHabit(req.ctx, param(req, 'id'), member(req), i);
    return habits.habitView(req.ctx, row, true);
  });

  def(app, { method: 'POST', path: '/me/habits/:id/checkins', summary: 'Check in on a habit for today or a recent day (one per day; repeating it is safe)', tag: TAG, auth: 'member', feature: FEATURE, body: habitCheckinSchema, rateLimit: { max: 120, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(habitCheckinSchema, req.body);
    const r = habits.checkIn(req.ctx, me(req), param(req, 'id'), i);
    reply.code(r.created ? 201 : 200);
    return { ...r, habit: habits.habitView(req.ctx, habits.getHabitRow(req.ctx, param(req, 'id'))!, true) };
  });

  def(app, { method: 'DELETE', path: '/me/habits/:id/checkins/:date', summary: 'Undo a check-in', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => {
    const r = habits.undoCheckIn(req.ctx, me(req), param(req, 'id'), dateParam(req));
    return { ...r, habit: habits.habitView(req.ctx, habits.getHabitRow(req.ctx, param(req, 'id'))!, true) };
  });

  /* ---------- coach ---------- */

  def(app, { method: 'GET', path: '/coach/clients/:id/habits', summary: 'A client’s habits: the ones a coach set, with completion, weekly adherence and follow-ups; the client’s own habits and check-in notes only while they share health information', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => {
    const id = clientId(req);
    const shared = sharesHealth(req.ctx, id);
    const view = guard(req.ctx, habits.teamView(req.ctx, id, { notes: shared, memberWritten: shared, viewerCoachId: me(req) }));
    const what = [
      ...(view.habits.some((h) => h.checkins.some((c) => 'note' in c && c.note)) ? ['habit-checkin-notes'] : []),
      ...(view.habits.some((h) => h.setBy === 'member') ? ['member-written-habits'] : []),
    ];
    if (shared && what.length) audit(req.ctx, 'health.viewed', { type: 'user', id }, null, { by: 'coach', what: what.join(', ') });
    return view;
  });

  def(app, { method: 'POST', path: '/coach/clients/:id/habits', summary: 'Set a habit for an assigned client', tag: TAG, auth: 'coach', feature: FEATURE, body: coachHabitCreateSchema, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => {
    const id = clientId(req);
    const i = parse(coachHabitCreateSchema, req.body);
    const row = habits.createHabit(req.ctx, id, coach(req), i);
    reply.code(201);
    return guard(req.ctx, habits.habitView(req.ctx, row, false));
  });

  def(app, { method: 'PATCH', path: '/coach/habits/:id', summary: 'Change, pause or resume a habit a coach set for an assigned client', tag: TAG, auth: 'coach', feature: FEATURE, body: coachHabitUpdateSchema }, async (req) => {
    const { reason, ...patch } = parse(coachHabitUpdateSchema, req.body);
    const row = habits.updateHabit(req.ctx, param(req, 'id'), coach(req), patch, reason ?? null);
    return guard(req.ctx, habits.habitView(req.ctx, row, false));
  });

  def(app, { method: 'POST', path: '/coach/habits/:id/archive', summary: 'Archive a habit a coach set for an assigned client (with a reason)', tag: TAG, auth: 'coach', feature: FEATURE, body: habitArchiveSchema }, async (req) => {
    const i = parse(habitArchiveSchema, req.body);
    const row = habits.archiveHabit(req.ctx, param(req, 'id'), coach(req), i.reason);
    return guard(req.ctx, habits.habitView(req.ctx, row, false));
  });

  /* ---------- administrator ---------- */

  def(app, { method: 'GET', path: '/admin/members/:id/habits', summary: 'A member’s habits, check-ins and weekly adherence (read only)', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE }, async (req) => {
    const id = param(req, 'id');
    audit(req.ctx, 'member.record_viewed', { type: 'user', id }, null, { by: req.ctx.actor!.role, sections: ['habits'] });
    const view = habits.teamView(req.ctx, id, { notes: true, memberWritten: true });
    return hasPermission(req.ctx, 'members.view_restricted') ? view : stripRestricted(view, adminRestrictedKeys());
  });
}
