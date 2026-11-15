/* Final integration fixes: a data request is all-or-nothing (a member still in onboarding can ask for deletion; the
   request, its team task and the audit are written together), and the orders list pages with a '<time>~<id>' cursor so
   orders sharing a timestamp are never skipped at a page boundary. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, DEMO, userId } from '../helpers.js';
import { requestData } from '../../src/domain/members.js';
import { listOrders } from '../../src/domain/orders.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

test('a member still in onboarding can ask for deletion: one request, one team task, state unchanged; asking again reuses it', () => {
  const id = userId(h.ctx, DEMO.memberIncomplete);
  const before = h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [id])!.state;
  assert.notEqual(before, 'active', 'the demo member is still being set up');
  const ctx = { ...h.ctx, actor: { id, role: 'member' as const, email: DEMO.memberIncomplete, name: 'Ishaan Mehta' } };
  const first = requestData(ctx, id, 'deletion', 'please remove me') as { id: string; status: string };
  assert.equal(first.status, 'requested');
  assert.equal(h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [id])!.state, before, 'an account being set up keeps its state');
  const tasks = () => h.db.all("SELECT id FROM support_tasks WHERE ref_type = 'data_request' AND ref_id = ?", [first.id]).length;
  assert.equal(tasks(), 1, 'the team has one task');
  const again = requestData(ctx, id, 'deletion') as { id: string };
  assert.equal(again.id, first.id, 'asking again reuses the open request');
  assert.equal(h.db.all("SELECT id FROM data_requests WHERE user_id = ? AND kind = 'deletion'", [id]).length, 1, 'no second request');
  assert.equal(tasks(), 1, 'and no second task');
});

test('an open request that lost its task gets one when the member asks again', () => {
  const id = userId(h.ctx, DEMO.memberNoCoach);
  const ctx = { ...h.ctx, actor: { id, role: 'member' as const, email: DEMO.memberNoCoach, name: 'Karthik Reddy' } };
  const r = requestData(ctx, id, 'export') as { id: string };
  h.db.run("DELETE FROM support_tasks WHERE ref_type = 'data_request' AND ref_id = ?", [r.id]);
  requestData(ctx, id, 'export');
  assert.equal(h.db.all("SELECT id FROM support_tasks WHERE ref_type = 'data_request' AND ref_id = ?", [r.id]).length, 1);
});

test('the orders list never skips orders that share a timestamp at a page boundary', () => {
  const all = h.db.all<{ id: string }>('SELECT id FROM orders');
  assert.ok(all.length >= 4, 'the demo has orders to page through');
  const stamp = '2026-01-01T00:00:00.000Z';
  const orig = h.db.all<{ id: string; created_at: string }>('SELECT id, created_at FROM orders');
  try {
    h.db.run('UPDATE orders SET created_at = ?', [stamp]); // every order shares one timestamp
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const page: { items: Array<{ id: string }>; nextCursor: string | null } = listOrders(h.ctx, { limit: 3, cursor });
      seen.push(...page.items.map((o) => o.id));
      if (!page.nextCursor) break;
      assert.match(page.nextCursor, /~/, 'the cursor carries the id');
      cursor = page.nextCursor;
    }
    assert.equal(seen.length, all.length, 'every order once');
    assert.equal(new Set(seen).size, all.length, 'no order twice');
    // an older bare-timestamp cursor still means strictly before that time
    assert.equal(listOrders(h.ctx, { limit: 50, cursor: stamp }).items.length, 0);
  } finally {
    for (const o of orig) h.db.run('UPDATE orders SET created_at = ? WHERE id = ?', [o.created_at, o.id]);
  }
});
