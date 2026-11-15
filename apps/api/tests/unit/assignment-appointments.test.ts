import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, userId, DEMO } from '../helpers.js';
import * as assignments from '../../src/domain/assignments.js';
import * as appointments from '../../src/domain/appointments.js';
import * as coaches from '../../src/domain/coaches.js';
import { addDays, zonedToIso } from '../../src/lib/time.js';
import { AppError } from '../../src/lib/errors.js';
import type { Ctx } from '../../src/context.js';

let h: Awaited<ReturnType<typeof makeApp>>;
let owner: Ctx;
before(async () => { h = await makeApp(); owner = { ...h.ctx, actor: { id: userId(h.ctx, DEMO.owner), role: 'owner', email: DEMO.owner, name: 'Owner' } }; });
after(async () => { await h.app.close(); h.db.close(); });

test('recommendation ranks available coaches with capacity and matching expertise, and explains why', () => {
  const memberId = userId(h.ctx, DEMO.memberNoCoach); // goal: recovery and mobility, Advanced package
  const programme = h.db.get<{ id: string }>('SELECT id FROM programmes WHERE member_id = ?', [memberId])!;
  const ranked = assignments.recommend(h.ctx, memberId, programme.id);
  assert.ok(ranked.length >= 4);
  assert.equal(ranked[0]!.name, 'Rahul Verma'); // recovery, mobility expertise
  assert.ok(ranked[0]!.reasons.some((r) => r.startsWith('expertise:')));
  assert.ok(ranked.every((c) => typeof c.score === 'number' && c.reasons.length > 0));
});

test('an unavailable or full coach is ineligible; assigning them needs an override with a reason', () => {
  const memberId = userId(h.ctx, DEMO.memberNoCoach);
  const programme = h.db.get<{ id: string }>('SELECT id FROM programmes WHERE member_id = ?', [memberId])!;
  const rahul = userId(h.ctx, DEMO.coach2);
  coaches.setAvailability(owner, rahul, { available: false, unavailableUntil: addDays(h.ctx.now(), 5), reason: 'test leave' });
  const ranked = assignments.recommend(h.ctx, memberId, programme.id);
  assert.equal(ranked.find((c) => c.coachId === rahul)!.eligible, false);
  const req = h.db.get<{ id: string }>("SELECT id FROM assignment_requests WHERE member_id = ? AND status = 'open'", [memberId])!;
  assert.throws(() => assignments.assign(owner, { requestId: req.id, coachId: rahul, method: 'manual', reason: 'test' }), (e: unknown) => e instanceof AppError && e.status === 409);
  assert.throws(() => assignments.assign(owner, { requestId: req.id, coachId: rahul, method: 'override', reason: '' }), (e: unknown) => e instanceof AppError && e.code === 'REASON_REQUIRED');
  const a = assignments.assign(owner, { requestId: req.id, coachId: rahul, method: 'override', reason: 'Member asked for Rahul specifically' });
  assert.equal(a.status, 'active');
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM assignment_requests WHERE id = ?', [req.id])!.status, 'assigned');
  assert.ok(h.db.get('SELECT 1 FROM conversations WHERE member_id = ? AND coach_id = ?', [memberId, rahul]));
  coaches.setAvailability(owner, rahul, { available: true, reason: 'back' });
});

test('reassignment ends the previous assignment and keeps history; pausing a coach pauses their members', () => {
  const memberId = userId(h.ctx, DEMO.member);
  const asha = userId(h.ctx, DEMO.coach), dev = userId(h.ctx, 'dev.kapoor@demo.bioptime.test');
  const programme = h.db.get<{ id: string }>("SELECT id FROM programmes WHERE member_id = ? AND status = 'active'", [memberId])!;
  const before = assignments.listAssignments(h.ctx, { memberId }).length;
  assignments.assign(owner, { memberId, programmeId: programme.id, coachId: dev, method: 'manual', reason: 'Continuity test' });
  const all = assignments.listAssignments(h.ctx, { memberId }) as Array<{ coach_id: string; status: string }>;
  assert.equal(all.length, before + 1);
  assert.equal(all.filter((a) => a.status === 'active').length, 1);
  assert.equal(all.find((a) => a.status === 'active')!.coach_id, dev);
  assert.ok(all.some((a) => a.coach_id === asha && a.status === 'ended'));
  coaches.setAvailability(owner, dev, { available: false, reason: 'leave' });
  assert.equal(h.db.get<{ status: string }>("SELECT status FROM coach_assignments WHERE member_id = ? AND coach_id = ? ORDER BY created_at DESC LIMIT 1", [memberId, dev])!.status, 'paused');
  coaches.setAvailability(owner, dev, { available: true, reason: 'back' });
  assert.equal(h.db.get<{ status: string }>("SELECT status FROM coach_assignments WHERE member_id = ? AND coach_id = ? ORDER BY created_at DESC LIMIT 1", [memberId, dev])!.status, 'active');
});

test('slots come from working hours minus blocks and bookings; conflicts and the 30-minute lead are refused', () => {
  const coachId = userId(h.ctx, DEMO.coach2);
  const memberId = userId(h.ctx, DEMO.member2); // Vikram, assigned to Rahul in the seed
  let d = addDays(h.ctx.now(), 3).slice(0, 10);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(`${d}T00:00:00Z`, 1).slice(0, 10);
  const slots = appointments.slotsFor(h.ctx, coachId, d);
  assert.ok(slots.length >= 10, 'morning and evening windows');
  const first = slots[0]!;
  const cctx: Ctx = { ...h.ctx, actor: { id: coachId, role: 'coach', email: DEMO.coach2, name: 'Rahul' } };
  const a = appointments.book(cctx, { memberId, coachId, startAt: first.startAt, kind: 'consultation', byCoach: true });
  assert.equal(a.status, 'scheduled');
  assert.ok(!appointments.slotsFor(h.ctx, coachId, d).some((s) => s.startAt === first.startAt), 'the booked slot disappears');
  assert.throws(() => appointments.book(cctx, { memberId: userId(h.ctx, DEMO.memberNoCoach), coachId, startAt: first.startAt, kind: 'check_in', byCoach: true }), (e: unknown) => e instanceof AppError && e.code === 'SLOT_TAKEN');
  assert.throws(() => appointments.book(cctx, { memberId, coachId, startAt: h.ctx.now(), kind: 'check_in', byCoach: true }), (e: unknown) => e instanceof AppError && e.code === 'TOO_SOON');
  coaches.addBlock(cctx, coachId, { startAt: zonedToIso(d, 17 * 60), endAt: zonedToIso(d, 20 * 60), reason: 'test block' });
  assert.ok(appointments.slotsFor(h.ctx, coachId, d).every((s) => s.startAt < zonedToIso(d, 17 * 60)), 'blocked evening removed');
});

test('a completed consultation consumes the entitlement; a cancelled one releases it', () => {
  const memberId = userId(h.ctx, DEMO.member2);
  // this test is about entitlement accounting, not the open-request limit (covered in review-round2.test.ts)
  h.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('max_open_appointments', '10', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [h.ctx.now()]);
  const coachId = userId(h.ctx, DEMO.coach2);
  const cctx: Ctx = { ...h.ctx, actor: { id: coachId, role: 'coach', email: DEMO.coach2, name: 'Rahul' } };
  const mctx: Ctx = { ...h.ctx, actor: { id: memberId, role: 'member', email: DEMO.member2, name: 'Vikram' } };
  const bal = () => h.db.get<{ used: number; reserved: number }>("SELECT SUM(used_qty) used, SUM(reserved_qty) reserved FROM entitlements WHERE member_id = ? AND service_type = 'consultation'", [memberId])!;
  const before = bal();
  let d = addDays(h.ctx.now(), 10).slice(0, 10);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(`${d}T00:00:00Z`, 1).slice(0, 10);
  const slots = appointments.slotsFor(h.ctx, coachId, d);
  const a = appointments.book(mctx, { memberId, startAt: slots[0]!.startAt, kind: 'consultation' });
  assert.equal(bal().reserved, before.reserved + 1);
  appointments.complete(cctx, a.id, 'done');
  assert.deepEqual([bal().used, bal().reserved], [before.used + 1, before.reserved]);
  const b = appointments.book(mctx, { memberId, startAt: slots[1]!.startAt, kind: 'consultation' });
  appointments.cancel(mctx, b.id, 'cannot make it');
  assert.deepEqual([bal().used, bal().reserved], [before.used + 1, before.reserved]);
  assert.throws(() => appointments.complete(cctx, b.id), (e: unknown) => e instanceof AppError && e.code === 'INVALID_STATE');
});
