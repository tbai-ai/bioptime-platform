import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLabStackStatus, canMoveCustomPlan, ORDER_TRANSITIONS, APPOINTMENT_TRANSITIONS, ACCOUNT_TRANSITIONS, LAB_MANUAL_TRANSITIONS } from '@bioptime/domain';
import { hashPassword, verifyPassword, totpSecret, totpCode, verifyTotp, signToken, verifyToken } from '../../src/lib/crypto.js';
import { addMonths, overlaps, zonedToIso, toIstOffsetString, ageFromDob } from '../../src/lib/time.js';

test('lab status moves forward only, except rejected sample or missed visit back to scheduled; cancelled any time', () => {
  assert.deepEqual(applyLabStackStatus('confirmed', 'PHLEBO_ASSIGNED'), { changed: true, status: 'scheduled', flag: undefined });
  assert.deepEqual(applyLabStackStatus('scheduled', 'SAMPLE_COLLECTED'), { changed: true, status: 'sample_collected', flag: undefined });
  assert.equal(applyLabStackStatus('processing', 'PHLEBO_ASSIGNED').changed, false); // backwards without a reason
  assert.deepEqual(applyLabStackStatus('sample_collected', 'SAMPLE_REJECTED'), { changed: true, status: 'scheduled', flag: 'rebook' });
  assert.deepEqual(applyLabStackStatus('scheduled', 'PATIENT_MISSED'), { changed: true, status: 'scheduled', flag: 'rebook' }); // same status, but flagged
  assert.deepEqual(applyLabStackStatus('processing', 'CANCELED'), { changed: true, status: 'cancelled', flag: undefined });
  assert.equal(applyLabStackStatus('scheduled', 'RESCHEDULED').changed, false); // date change only
  assert.equal(applyLabStackStatus('scheduled', 'SOMETHING_NEW').changed, false);
  assert.equal(applyLabStackStatus('completed', 'REPORT_DELIVERED').changed, false); // a closed order never reopens
  assert.equal(applyLabStackStatus('scheduled', 'PHLEBO_STARTED').changed, false); // already scheduled
});

test('manual lab transitions: only cancel early, only complete from results ready', () => {
  assert.deepEqual(LAB_MANUAL_TRANSITIONS.confirmed, ['cancelled']);
  assert.deepEqual(LAB_MANUAL_TRANSITIONS.processing, []);
  assert.deepEqual(LAB_MANUAL_TRANSITIONS.results_ready, ['completed']);
});

test('custom plan workflow does not activate without payment and cannot skip approval', () => {
  assert.equal(canMoveCustomPlan('enquiry_received', 'activated'), false);
  assert.equal(canMoveCustomPlan('proposal_sent', 'accepted'), true);
  assert.equal(canMoveCustomPlan('accepted', 'activated'), false);
  assert.equal(canMoveCustomPlan('payment_pending', 'activated'), true);
  assert.equal(canMoveCustomPlan('declined', 'scoping'), false);
  assert.equal(canMoveCustomPlan('expired', 'scoping'), true);
});

test('order, appointment and account state machines', () => {
  assert.deepEqual(ORDER_TRANSITIONS.pending_payment, ['paid', 'failed', 'cancelled']);
  assert.equal(ORDER_TRANSITIONS.refunded.length, 0);
  assert.ok(!ORDER_TRANSITIONS.draft.includes('paid'));
  assert.ok(APPOINTMENT_TRANSITIONS.completed.length === 0);
  assert.ok(APPOINTMENT_TRANSITIONS.no_show.includes('scheduled'));
  assert.ok(!ACCOUNT_TRANSITIONS.closed.length);
  assert.ok(ACCOUNT_TRANSITIONS.suspended.includes('active'));
});

test('passwords: scrypt hashes verify, differ per salt, reject wrong input and malformed stored values', () => {
  const h1 = hashPassword('correct horse battery staple'), h2 = hashPassword('correct horse battery staple');
  assert.notEqual(h1, h2);
  assert.ok(h1.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct horse battery staple', h1), true);
  assert.equal(verifyPassword('Correct horse battery staple', h1), false);
  assert.equal(verifyPassword('x', 'plaintext-garbage'), false);
  assert.equal(verifyPassword('x', null), false);
});

test('TOTP codes verify within the window and fail outside it', () => {
  const s = totpSecret();
  const now = Math.floor(Date.now() / 1000);
  assert.equal(verifyTotp(s, totpCode(s, now)), true);
  assert.equal(verifyTotp(s, totpCode(s, now - 30)), true);
  assert.equal(verifyTotp(s, totpCode(s, now - 120)), false);
  assert.equal(verifyTotp(s, '000000') && verifyTotp(s, '000001'), false);
});

test('signed tokens carry an expiry and fail with the wrong secret or a tampered body', () => {
  const t = signToken('secret', { r: 'rpt_1' }, 60);
  assert.deepEqual(verifyToken('secret', t)?.r, 'rpt_1');
  assert.equal(verifyToken('other', t), null);
  const expired = signToken('secret', { r: 'x' }, -1);
  assert.equal(verifyToken('secret', expired), null);
  const [body, sig] = t.split('.');
  assert.equal(verifyToken('secret', `${body}x.${sig}`), null);
});

test('time helpers: month arithmetic, overlap, India zone conversion, LabStack appointment format, age', () => {
  assert.equal(addMonths('2026-01-31T00:00:00.000Z', 1), '2026-02-28T00:00:00.000Z');
  assert.equal(addMonths('2026-10-21T10:00:00.000Z', 3), '2027-01-21T10:00:00.000Z');
  assert.equal(overlaps('2026-01-01T10:00:00Z', '2026-01-01T10:30:00Z', '2026-01-01T10:15:00Z', '2026-01-01T10:45:00Z'), true);
  assert.equal(overlaps('2026-01-01T10:00:00Z', '2026-01-01T10:30:00Z', '2026-01-01T10:30:00Z', '2026-01-01T11:00:00Z'), false);
  assert.equal(zonedToIso('2026-10-22', 7 * 60 + 30), '2026-10-22T02:00:00.000Z');
  assert.equal(toIstOffsetString('2026-10-22T02:00:00.000Z'), '2026-10-22T07:30:00+05:30');
  assert.equal(ageFromDob('1990-10-22', '2026-10-21T00:00:00Z'), 35);
  assert.equal(ageFromDob('1990-10-21', '2026-10-21T00:00:00Z'), 36);
});
