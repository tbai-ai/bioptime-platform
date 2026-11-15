import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, userId, DEMO } from '../helpers.js';
import * as entitlements from '../../src/domain/entitlements.js';
import { AppError } from '../../src/lib/errors.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp({ seed: false }); seedUser(); });
after(async () => { await h.app.close(); h.db.close(); });

function seedUser() {
  const now = new Date().toISOString();
  h.db.insert('users', { id: 'usr_t', email: 't@demo.bioptime.test', role: 'member', state: 'active', name: 'T', created_at: now, updated_at: now });
}

test('grant is idempotent on its key and creates one available entitlement', () => {
  const a = entitlements.grant(h.ctx, { memberId: 'usr_t', orderId: null, programmeId: null, packageVersionId: null, serviceType: 'bloodwork', unit: 'collection', quantity: 2, expiresAt: null, idempotencyKey: 'g1' });
  const b = entitlements.grant(h.ctx, { memberId: 'usr_t', orderId: null, programmeId: null, packageVersionId: null, serviceType: 'bloodwork', unit: 'collection', quantity: 2, expiresAt: null, idempotencyKey: 'g1' });
  assert.equal(a, b);
  assert.equal(entitlements.grant(h.ctx, { memberId: 'usr_t', orderId: null, programmeId: null, packageVersionId: null, serviceType: 'consultation', unit: 'session', quantity: 0, expiresAt: null, idempotencyKey: 'g0' }), null);
  assert.deepEqual(entitlements.balance(h.ctx, 'usr_t', 'bloodwork'), { total: 2, used: 0, reserved: 0, remaining: 2, unit: 'collection', expiresAt: null });
});

test('reserve twice with the same key returns the same transaction; a third reservation exhausts the pool', () => {
  const r1 = entitlements.reserve(h.ctx, 'usr_t', 'bloodwork', { type: 'booking', id: 'b1' }, 'r:b1');
  const r1again = entitlements.reserve(h.ctx, 'usr_t', 'bloodwork', { type: 'booking', id: 'b1' }, 'r:b1');
  assert.equal(r1.txId, r1again.txId);
  entitlements.reserve(h.ctx, 'usr_t', 'bloodwork', { type: 'booking', id: 'b2' }, 'r:b2');
  assert.equal(entitlements.balance(h.ctx, 'usr_t', 'bloodwork').remaining, 0);
  assert.throws(() => entitlements.reserve(h.ctx, 'usr_t', 'bloodwork', { type: 'booking', id: 'b3' }, 'r:b3'), (e: unknown) => e instanceof AppError && e.code === 'INVALID_STATE');
});

test('consume turns a reservation into usage once; release gives it back once; neither can double count', () => {
  const r = entitlements.reserve(h.ctx, 'usr_t', 'bloodwork', { type: 'booking', id: 'b1' }, 'r:b1');
  entitlements.consume(h.ctx, r.txId, 'collected');
  entitlements.consume(h.ctx, r.txId, 'collected again');
  let b = entitlements.balance(h.ctx, 'usr_t', 'bloodwork');
  assert.equal(b.used, 1);
  assert.equal(b.reserved, 1);
  entitlements.release(h.ctx, r.txId); // already consumed: no-op
  b = entitlements.balance(h.ctx, 'usr_t', 'bloodwork');
  assert.equal(b.used, 1);
  const r2 = entitlements.reserve(h.ctx, 'usr_t', 'bloodwork', { type: 'booking', id: 'b2' }, 'r:b2');
  entitlements.release(h.ctx, r2.txId, 'cancelled');
  entitlements.release(h.ctx, r2.txId, 'cancelled again');
  b = entitlements.balance(h.ctx, 'usr_t', 'bloodwork');
  assert.deepEqual([b.used, b.reserved, b.remaining], [1, 0, 1]);
  const kinds = h.db.all<{ kind: string }>('SELECT kind FROM entitlement_transactions WHERE entitlement_id = ? ORDER BY created_at', [r.entitlementId]).map((k) => k.kind);
  assert.deepEqual(kinds, ['grant', 'reserve', 'reserve', 'consume', 'release']);
});

test('expired entitlements are closed with an expire transaction and no longer count', () => {
  entitlements.grant(h.ctx, { memberId: 'usr_t', orderId: null, programmeId: null, packageVersionId: null, serviceType: 'consultation', unit: 'session', quantity: 3, expiresAt: '2020-01-01T00:00:00.000Z', idempotencyKey: 'gexp' });
  assert.equal(entitlements.balance(h.ctx, 'usr_t', 'consultation').remaining, 0); // expired ones are excluded from the balance
  assert.equal(entitlements.expireDue(h.ctx), 1);
  assert.equal(h.db.get<{ status: string }>("SELECT status FROM entitlements WHERE service_type = 'consultation' AND expires_at = '2020-01-01T00:00:00.000Z'")!.status, 'expired');
});
