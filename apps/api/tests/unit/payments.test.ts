import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, userId, DEMO } from '../helpers.js';
import * as orders from '../../src/domain/orders.js';
import { AppError } from '../../src/lib/errors.js';
import type { Ctx } from '../../src/context.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

function memberCtx(email: string): Ctx { const id = userId(h.ctx, email); return { ...h.ctx, actor: { id, role: 'member', email, name: 'M' } }; }

test('a checkout needs a priced, for-sale package; bespoke and unpriced packages are refused', () => {
  const m = memberCtx(DEMO.memberNoCoach);
  assert.throws(() => orders.createCheckout(m, h.services.payments, { memberId: m.actor!.id, packageId: 'bespoke' }), (e: unknown) => e instanceof AppError && e.status === 409);
  const r = orders.createCheckout(m, h.services.payments, { memberId: m.actor!.id, packageId: 'ignite', idempotencyKey: 'pay-test-1' });
  assert.equal(r.order.status, 'pending_payment');
  assert.equal(r.order.totalInr, 2999);
  assert.ok(r.checkout?.simulated);
  const again = orders.createCheckout(m, h.services.payments, { memberId: m.actor!.id, packageId: 'ignite', idempotencyKey: 'pay-test-1' });
  assert.equal(again.order.id, r.order.id);
});

test('the webhook is the only path to paid: bad signatures are rejected, amount mismatches open an exception, replays are ignored', () => {
  const m = memberCtx(DEMO.memberNoCoach);
  const r = orders.createCheckout(m, h.services.payments, { memberId: m.actor!.id, packageId: 'ignite', idempotencyKey: 'pay-test-2' });
  const checkoutId = r.checkout!.checkoutId;
  const sim = h.services.payments.simulateEvent!.bind(h.services.payments);
  const bad = sim(checkoutId, r.order.reference, 299900, 'captured');
  assert.throws(() => orders.handlePaymentWebhook(h.ctx, h.services.payments, bad.body, 'deadbeef'), (e: unknown) => e instanceof AppError && e.code === 'BAD_SIGNATURE');
  assert.throws(() => orders.handlePaymentWebhook(h.ctx, h.services.payments, bad.body + ' ', bad.signature), (e: unknown) => e instanceof AppError && e.code === 'BAD_SIGNATURE');
  const wrongAmount = sim(checkoutId, r.order.reference, 100, 'captured');
  assert.equal(orders.handlePaymentWebhook(h.ctx, h.services.payments, wrongAmount.body, wrongAmount.signature).outcome, 'amount_mismatch');
  assert.ok(h.db.get("SELECT 1 FROM support_tasks WHERE kind = 'payment_mismatch' AND ref_id = ?", [r.order.id]));
  assert.equal(orders.getOrder(h.ctx, r.order.id).status, 'pending_payment');
  const good = sim(checkoutId, r.order.reference, 299900, 'captured');
  assert.equal(orders.handlePaymentWebhook(h.ctx, h.services.payments, good.body, good.signature).outcome, 'captured');
  assert.equal(orders.getOrder(h.ctx, r.order.id).status, 'activated');
  assert.equal(orders.handlePaymentWebhook(h.ctx, h.services.payments, good.body, good.signature).outcome, 'duplicate_ignored');
  const programmes = h.db.all('SELECT id FROM programmes WHERE order_id = ?', [r.order.id]);
  assert.equal(programmes.length, 1, 'activation happened exactly once');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM entitlements WHERE order_id = ?", [r.order.id])!.n, 0, 'a programme without coaching grants no consultations or tests');
});

test('a failed payment leaves nothing activated and the member can try again', () => {
  const m = memberCtx(DEMO.memberNoCoach);
  const r = orders.createCheckout(m, h.services.payments, { memberId: m.actor!.id, packageId: 'reset', idempotencyKey: 'pay-test-3' });
  const ev = h.services.payments.simulateEvent!(r.checkout!.checkoutId, r.order.reference, Math.round(r.order.totalInr * 100), 'failed');
  assert.equal(orders.handlePaymentWebhook(h.ctx, h.services.payments, ev.body, ev.signature).outcome, 'failed');
  assert.equal(orders.getOrder(h.ctx, r.order.id).status, 'failed');
  assert.equal(h.db.all('SELECT id FROM programmes WHERE order_id = ?', [r.order.id]).length, 0);
});

test('a refund cancels unused entitlements, ends the programme and the assignment, and is audited', () => {
  const memberId = userId(h.ctx, DEMO.member2); // Vikram: Advanced, active assignment
  const order = h.db.get<{ id: string }>("SELECT id FROM orders WHERE member_id = ? AND status = 'activated'", [memberId])!;
  const owner: Ctx = { ...h.ctx, actor: { id: userId(h.ctx, DEMO.owner), role: 'owner', email: DEMO.owner, name: 'Owner' } };
  const r = orders.requestRefund(owner, h.services.payments, order.id, 'Member moved abroad');
  assert.ok(['refund_pending', 'refunded'].includes(r.status));
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM programmes WHERE order_id = ?', [order.id])!.status, 'cancelled');
  assert.ok(h.db.all<{ status: string }>('SELECT status FROM entitlements WHERE order_id = ?', [order.id]).every((e) => e.status === 'cancelled'));
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM coach_assignments WHERE member_id = ? AND status = 'active'", [memberId])!.n, 0);
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'order.refund' AND target_id = ?", [order.id]));
});
