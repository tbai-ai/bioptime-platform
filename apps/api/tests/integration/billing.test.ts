/* M3 Billing documents and refund requests: receipts for verified payments only (one per payment, whatever is
   replayed), tax invoices only with the seller's details, numbers taken inside the transaction, document totals equal
   to the order's, GST from the setting, credit notes for refunds and voided invoices, immutable documents, the
   printable document behind a 5-minute token, refund requests decided by an administrator, and access: members their
   own, administrators with orders.manage (the buyer's address only with members.view_restricted), coaches nothing. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { processPending } from '../../src/domain/events.js';
import * as billing from '../../src/domain/billing.js';
import * as dataExport from '../../src/domain/dataExport.js';
import { gstIncluded } from '../../src/domain/orders.js';
import { signToken } from '../../src/lib/crypto.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const BUYER = 'farah.ali@demo.bioptime.test'; // no paid order in the demo (her only payment failed)
const SAMPLE_SELLER = { legalName: 'Sample Entity (test)', gstin: '29ABCDE1234F1Z5', address: 'Sample registered address (test)' }; // test values, not a real entity
/** The seeded member's refund request, in her own words (no demo or sample label since 24 October 2026). */
const REFUND_REASON = 'I chose the wrong package by mistake. Please refund this order.';

const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const member = (email: string) => signedIn(email, DEMO_PASSWORDS.member);
const admin = () => signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
const owner = () => signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
const coach = () => signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
const sys = (): Ctx => ({ ...h.ctx, actor: null });
const code = (r: { json: { error?: { code: string; details?: unknown } } }) => r.json.error?.code === 'INVALID_STATE' ? (r.json.error.details as { code?: string } | undefined)?.code : r.json.error?.code;
const docsFor = (orderId: string) => h.db.all<billing.DocumentRow>('SELECT * FROM billing_documents WHERE order_id = ? ORDER BY created_at', [orderId]);
const seq = (name: string) => h.db.get<{ value: number }>('SELECT value FROM sequences WHERE name = ?', [name])!.value;
const auditCount = (action: string, targetId: string) => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM audit_events WHERE action = ? AND target_id = ?', [action, targetId])!.n;
const setGrant = (email: string, permission: string, granted: boolean) => h.db.run('INSERT INTO user_permissions (user_id, permission, granted, reason, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, NULL) ON CONFLICT(user_id, permission) DO UPDATE SET granted = excluded.granted', [userId(h.ctx, email), permission, granted ? 1 : 0, 'billing test', new Date().toISOString()]);
const setSeller = async (value: unknown) => { const o = await owner(); const r = await o.patch('/api/admin/module-settings', { key: 'billing_entity', value, reason: 'billing test' }); assert.equal(r.status, 200, JSON.stringify(r.json)); };

/** Buys a package as the member through checkout and the payment simulator (the real webhook path). */
async function buy(c: Awaited<ReturnType<typeof member>>, packageId: string, key: string) {
  const co = await c.post('/api/me/checkout', { packageId, idempotencyKey: key });
  assert.equal(co.status, 201, JSON.stringify(co.json));
  const checkoutId = (co.json.checkout as { checkoutId: string }).checkoutId;
  const paid = await c.post('/api/payments/simulator/complete', { checkoutId, outcome: 'captured' });
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
  const order = paid.json.order as { id: string; reference: string; status: string; totalInr: number; gstInr: number };
  return { order, checkoutId };
}

test('the demo seed: one receipt per verified paid order, marked simulated, no tax invoice without seller details, one open refund request', () => {
  const paid = h.db.all<{ id: string; total_paise: number; gst_paise: number; amount_paise: number; reference: string }>("SELECT o.* FROM orders o WHERE o.paid_at IS NOT NULL AND o.status IN ('paid','activated')");
  assert.ok(paid.length >= 8, 'the demo has paid orders');
  for (const o of paid) {
    const docs = docsFor(o.id);
    assert.equal(docs.length, 1, `${o.reference} has exactly one document`);
    const d = docs[0]!;
    assert.equal(d.kind, 'receipt');
    assert.equal(d.simulated, 1, 'the payment was simulated: the receipt says so');
    assert.equal(d.total_paise, o.total_paise, 'document total = order total');
    assert.equal(d.gst_paise, o.gst_paise);
    assert.equal(d.subtotal_paise, o.amount_paise);
    assert.ok(d.number.startsWith(`${o.reference}/pay_`), 'a receipt is numbered by the order reference and the payment id');
    assert.equal(JSON.parse(d.seller ?? 'null'), null, 'no seller details are invented');
  }
  const unverified = h.db.all<{ id: string }>("SELECT id FROM orders WHERE status IN ('pending_payment','failed')");
  for (const o of unverified) assert.equal(docsFor(o.id).length, 0, 'nothing for an order whose payment was not verified');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM billing_documents WHERE kind <> 'receipt'")!.n, 0);
  assert.equal(seq('INV'), 1000, 'no invoice number was taken');
  assert.equal(seq('CRN'), 1000, 'no credit note number was taken');
  const req = h.db.all<{ reason: string; status: string }>('SELECT reason, status FROM refund_requests');
  assert.equal(req.length, 1);
  assert.equal(req[0]!.reason, REFUND_REASON);
  assert.doesNotMatch(req[0]!.reason, /\bdemo\b|\bsample\b/i, 'the owner removed the demo and sample labels');
  assert.equal(req[0]!.status, 'requested');
});

test('a verified payment gets one receipt, even when the webhook is replayed or the event handled again; totals equal the order', async () => {
  const m = await member(BUYER);
  const { order, checkoutId } = await buy(m, 'starter', 'billing-receipt-1');
  assert.equal(order.status, 'activated');
  const docs = docsFor(order.id);
  assert.equal(docs.length, 1);
  const receipt = docs[0]!;
  const row = h.db.get<{ total_paise: number; gst_paise: number; amount_paise: number }>('SELECT * FROM orders WHERE id = ?', [order.id])!;
  assert.deepEqual([receipt.total_paise, receipt.gst_paise, receipt.subtotal_paise], [row.total_paise, row.gst_paise, row.amount_paise]);
  const lines = JSON.parse(receipt.lines) as billing.DocumentLine[];
  assert.equal(lines.reduce((s, l) => s + l.taxable_paise + l.gst_paise, 0), row.total_paise, 'the lines add up to the total');
  assert.equal(lines[0]!.gst_rate_bp, 1800);
  assert.equal(auditCount('billing_document.issue', receipt.id), 1);
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'payment' AND title LIKE 'Your receipt%'", [userId(h.ctx, BUYER)]), 'the member is told the receipt is ready');

  // the provider replays the same capture: ignored, and still one receipt
  const anon = client(h.app);
  const ev = h.services.payments.simulateEvent!(checkoutId, order.reference, Math.round(order.totalInr * 100), 'captured');
  const first = await anon.post('/api/integrations/payments/webhook', JSON.parse(ev.body), { 'x-signature': ev.signature });
  assert.equal(first.json.outcome, 'already_paid');
  const again = await anon.post('/api/integrations/payments/webhook', JSON.parse(ev.body), { 'x-signature': ev.signature });
  assert.equal(again.json.outcome, 'duplicate_ignored');
  await processPending(sys());
  // and the OrderPaid handler running twice (an outbox retry) issues nothing new
  billing.onOrderPaid(sys(), order.id);
  assert.equal(docsFor(order.id).length, 1);
  assert.throws(() => h.db.insert('billing_documents', { ...receipt, id: 'bdc_duplicatereceipt', number: `${receipt.number}-2` } as never), /UNIQUE/, 'the database refuses a second receipt for a payment');
});

test('GST comes from the setting gst_rate_bp and is stored on the order; documents keep the rate the order was priced with', async () => {
  const o = await owner();
  assert.equal((await o.patch('/api/admin/module-settings', { key: 'gst_rate_bp', value: 500, reason: 'billing test: a different rate' })).status, 200);
  try {
    const m = await member(BUYER);
    const { order } = await buy(m, 'starter', 'billing-gst-500');
    const row = h.db.get<{ total_paise: number; gst_paise: number; amount_paise: number; metadata: string }>('SELECT * FROM orders WHERE id = ?', [order.id])!;
    assert.equal(row.gst_paise, gstIncluded(row.total_paise, 500));
    assert.equal(row.amount_paise + row.gst_paise, row.total_paise);
    assert.equal((JSON.parse(row.metadata) as { gstRateBp: number }).gstRateBp, 500);
    const receipt = docsFor(order.id)[0]!;
    assert.equal((JSON.parse(receipt.lines) as billing.DocumentLine[])[0]!.gst_rate_bp, 500);
    assert.equal(receipt.gst_paise, row.gst_paise);
  } finally {
    assert.equal((await o.patch('/api/admin/module-settings', { key: 'gst_rate_bp', value: 1800, reason: 'billing test: back to the default' })).status, 200);
  }
  // 1800 reproduces the constant every earlier order used
  assert.equal(gstIncluded(499900, 1800), Math.round(499900 - 499900 / 1.18));
});

test('members read only their own documents; the printable document opens only through a short-lived token', async () => {
  const ananya = await member(DEMO.member);
  const vikram = await member(DEMO.member2);
  const mine = await ananya.get('/api/me/billing');
  assert.equal(mine.status, 200, JSON.stringify(mine.json));
  const docs = mine.json.documents as Array<{ id: string; number: string; kind: string; simulated: boolean; buyer: Record<string, unknown>; voidReason?: unknown }>;
  const orders = mine.json.orders as Array<{ id: string; canRequestRefund: boolean; documentIds: string[] }>;
  assert.ok(docs.length >= 1 && orders.length >= 1);
  assert.ok(docs.every((d) => !('voidReason' in d)), 'administrators’ notes stay off the member payload');
  const doc = docs[0]!;
  assert.equal((await vikram.get(`/api/me/billing/documents/${doc.id}`)).status, 404, 'another member’s document does not exist for them');
  assert.equal((await vikram.post(`/api/me/billing/documents/${doc.id}/file-token`)).status, 404);
  assert.equal((await ananya.get(`/api/me/billing/documents/${doc.id}`)).json.number, doc.number);

  const t = await ananya.post(`/api/me/billing/documents/${doc.id}/file-token`);
  assert.equal(t.status, 200);
  assert.equal(t.json.expiresInSeconds, 300);
  assert.equal(auditCount('billing_document.file_access', doc.id), 1, 'opening a document is audited');
  const anon = client(h.app);
  const page = await anon.get(`/api/billing/documents/file?token=${encodeURIComponent(t.json.token as string)}`);
  assert.equal(page.status, 200);
  assert.match(String(page.headers['content-type']), /text\/html/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(String(page.headers['content-security-policy']), /default-src 'none'/);
  assert.match(page.text, new RegExp(doc.number.replace(/[/.]/g, '\\$&')));
  assert.match(page.text, /Not a tax invoice/);
  assert.match(page.text, /<span class="simulated">Simulated payment<\/span>/, 'one small, plain simulated note at the top');
  const shown = page.text.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  assert.equal(shown.match(/simulated/gi)?.length, 1, 'the note is the only place the document says so');
  assert.doesNotMatch(page.text, /no money moved/, 'no second mention in the footer');
  assert.doesNotMatch(page.text.replaceAll('@demo.bioptime.test', ''), /sample data|\bdemo\b/i, 'no "Sample data" or "demo" label (the login email keeps its reserved domain)');
  assert.match(page.text, /Seller details have not been added yet/);
  assert.doesNotMatch(page.text, /billing_entity|setting is empty/, 'no internal setting name on a member’s document (portal-13)');
  assert.doesNotMatch(page.text, /Generated \d{4}-\d\d-\d\dT/, 'the footer time is in India time and in words (portal-m2)');
  assert.match(page.text, /Generated \d{1,2} [A-Z][a-z]+ \d{4}, \d\d:\d\d IST/);
  assert.match(page.text, /<div class="tableWrap"><table>/, 'the details table scrolls inside its own box on a phone (portal-1)');
  assert.match(page.text, /@media screen and \(max-width:640px\)\{\.page\{margin:0;padding:6mm\}/, 'a small-screen rule narrows the page padding (portal-1)');

  assert.equal(code(await anon.get('/api/billing/documents/file?token=forged.token')), 'LINK_EXPIRED');
  const expired = signToken(h.config.TOKEN_SECRET, { k: 'billing', d: doc.id, u: userId(h.ctx, DEMO.member) }, -10);
  assert.equal(code(await anon.get(`/api/billing/documents/file?token=${encodeURIComponent(expired)}`)), 'LINK_EXPIRED');
  const someoneElse = signToken(h.config.TOKEN_SECRET, { k: 'billing', d: doc.id, u: userId(h.ctx, DEMO.member2) }, 300);
  assert.equal((await anon.get(`/api/billing/documents/file?token=${encodeURIComponent(someoneElse)}`)).status, 404, 'the access check runs again as the token holder');
  const reportToken = signToken(h.config.TOKEN_SECRET, { r: doc.id, u: userId(h.ctx, DEMO.member) }, 300);
  assert.equal(code(await anon.get(`/api/billing/documents/file?token=${encodeURIComponent(reportToken)}`)), 'LINK_EXPIRED', 'a report link is not a billing link');
});

test('coaches see no payment data: every billing route refuses them', async () => {
  const c = await coach();
  const anyDoc = h.db.get<{ id: string; order_id: string }>('SELECT id, order_id FROM billing_documents LIMIT 1')!;
  for (const [method, url] of [['GET', '/api/me/billing'], ['GET', `/api/me/billing/documents/${anyDoc.id}`], ['POST', `/api/me/billing/documents/${anyDoc.id}/file-token`], ['POST', `/api/me/orders/${anyDoc.order_id}/refund-request`], ['GET', '/api/admin/billing/summary'], ['GET', '/api/admin/billing/documents'], ['GET', `/api/admin/billing/documents/${anyDoc.id}`], ['POST', `/api/admin/billing/documents/${anyDoc.id}/file-token`], ['GET', '/api/admin/refund-requests']] as const) {
    const r = method === 'GET' ? await c.get(url) : await c.post(url, { reason: 'coach probe' });
    assert.equal(r.status, 403, `${method} ${url}`);
  }
  const token = signToken(h.config.TOKEN_SECRET, { k: 'billing', d: anyDoc.id, u: userId(h.ctx, DEMO.coach) }, 300);
  assert.equal((await client(h.app).get(`/api/billing/documents/file?token=${encodeURIComponent(token)}`)).status, 403, 'even a signed token does not open a document for a coach');
  const detail = await c.get(`/api/coach/clients/${userId(h.ctx, DEMO.member)}`);
  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.text, /billing_document|bdc_|"receipt"/, 'the client record carries no billing documents');
});

test('administrators need orders.manage; the buyer address needs members.view_restricted', async () => {
  const a = await admin();
  const list = await a.get('/api/admin/billing/documents?kind=receipt&limit=5');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const items = list.json.items as Array<{ id: string; buyer: Record<string, unknown>; memberName: string; restricted: boolean }>;
  assert.equal(items.length, 5);
  assert.ok(items.every((d) => typeof d.buyer.address === 'string' && d.restricted === false), 'the default administrator holds members.view_restricted');

  setGrant(DEMO.admin, 'members.view_restricted', false);
  try {
    const r = await a.get(`/api/admin/billing/documents/${items[0]!.id}`);
    assert.equal(r.status, 200);
    const buyer = r.json.buyer as Record<string, unknown>;
    assert.equal(buyer.address, undefined, 'no address');
    assert.equal(buyer.pincode, undefined, 'no PIN code');
    assert.equal(typeof buyer.email, 'string', 'email stays: it is the account identifier administrators manage');
    assert.equal(r.json.restricted, true);
    const t = await a.post(`/api/admin/billing/documents/${items[0]!.id}/file-token`);
    const page = await client(h.app).get(`/api/billing/documents/file?token=${encodeURIComponent(t.json.token as string)}`);
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.text, /Lake View Road/, 'the printable document withholds the address too');
    assert.match(page.text, /Address withheld/);
  } finally { setGrant(DEMO.admin, 'members.view_restricted', true); }

  setGrant(DEMO.admin, 'orders.manage', false);
  try {
    for (const url of ['/api/admin/billing/summary', '/api/admin/billing/documents', '/api/admin/refund-requests']) assert.equal(code(await a.get(url)), 'PERMISSION_DENIED', url);
    assert.equal(code(await a.post(`/api/admin/billing/documents/${items[0]!.id}/void`, { reason: 'no permission' })), 'PERMISSION_DENIED');
    const t = signToken(h.config.TOKEN_SECRET, { k: 'billing', d: items[0]!.id, u: userId(h.ctx, DEMO.admin) }, 300);
    assert.equal(code(await client(h.app).get(`/api/billing/documents/file?token=${encodeURIComponent(t)}`)), 'PERMISSION_DENIED', 'a token issued earlier dies with the permission');
  } finally { setGrant(DEMO.admin, 'orders.manage', true); }

  const m = await member(DEMO.member);
  assert.equal((await m.get('/api/admin/billing/documents')).status, 403);
});

test('no tax invoice without the seller details; the summary names what is missing; numbers are taken inside the transaction', async () => {
  const a = await admin();
  const s = await a.get('/api/admin/billing/summary');
  assert.equal(s.status, 200);
  assert.equal((s.json.taxInvoices as { ready: boolean }).ready, false);
  assert.deepEqual((s.json.taxInvoices as { missing: string[] }).missing, ['billing_entity.legalName', 'billing_entity.gstin', 'billing_entity.address']);
  assert.equal(s.json.openRefundRequests, 1);

  await setSeller({ legalName: 'Sample Entity (test)' });
  assert.deepEqual(billing.taxInvoiceSetup(h.ctx).missing, ['billing_entity.gstin', 'billing_entity.address']);
  const m = await member(BUYER);
  const partial = await buy(m, 'starter', 'billing-partial-seller');
  assert.deepEqual(docsFor(partial.order.id).map((d) => d.kind), ['receipt'], 'a legal name alone does not make a tax invoice');

  await setSeller(SAMPLE_SELLER);
  // a failure after the number is taken rolls the number back with everything else
  const pending = await m.post('/api/me/checkout', { packageId: 'starter', idempotencyKey: 'billing-rollback' });
  const ck = (pending.json.checkout as { checkoutId: string }).checkoutId;
  h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'billing'"); // capture it with the handlers off, to issue by hand below
  const paid = await m.post('/api/payments/simulator/complete', { checkoutId: ck, outcome: 'captured' });
  h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'billing'");
  const orderId = (paid.json.order as { id: string }).id;
  assert.equal(docsFor(orderId).length, 0, 'the handlers do not run while the module is off');
  const before = seq('INV');
  assert.throws(() => h.db.tx(() => { billing.issueForPaidOrder(sys(), orderId); assert.equal(seq('INV'), before + 1); throw new Error('rollback probe'); }), /rollback probe/);
  assert.equal(seq('INV'), before, 'the INV number went back with the failed transaction');
  assert.equal(docsFor(orderId).length, 0);

  // issued by an administrator, with a reason
  assert.equal(code(await a.post(`/api/admin/billing/orders/${orderId}/issue`, {})), 'VALIDATION_FAILED');
  const issued = await a.post(`/api/admin/billing/orders/${orderId}/issue`, { reason: 'paid while billing was off' });
  assert.equal(issued.status, 200, JSON.stringify(issued.json));
  const kinds = (issued.json.issued as Array<{ kind: string; number: string }>);
  assert.deepEqual(kinds.map((d) => d.kind), ['receipt', 'tax_invoice']);
  assert.equal(kinds[1]!.number, `INV-${before + 1}`);
  assert.equal(code(await a.post(`/api/admin/billing/orders/${orderId}/issue`, { reason: 'again' })), 'NOTHING_TO_ISSUE');
  const inv = docsFor(orderId).find((d) => d.kind === 'tax_invoice')!;
  assert.deepEqual(JSON.parse(inv.seller!), SAMPLE_SELLER, 'the invoice keeps a snapshot of the seller details');
  assert.equal(h.db.get<{ reason: string }>("SELECT reason FROM audit_events WHERE action = 'billing_document.issue' AND target_id = ?", [inv.id])!.reason, 'paid while billing was off');
  // the next paid order gets both straight from the OrderPaid handler
  const next = await buy(m, 'starter', 'billing-with-seller');
  assert.deepEqual(docsFor(next.order.id).map((d) => d.kind).sort(), ['receipt', 'tax_invoice']);
  assert.equal(docsFor(next.order.id).find((d) => d.kind === 'tax_invoice')!.number, `INV-${before + 2}`);
  const page = await client(h.app).get(`/api/billing/documents/file?token=${encodeURIComponent((await m.post(`/api/me/billing/documents/${inv.id}/file-token`)).json.token as string)}`);
  assert.match(page.text, /Tax invoice/);
  assert.match(page.text, /29ABCDE1234F1Z5/);
  assert.match(page.text, /place-of-supply rules, which are pending configuration/);
});

test('documents cannot be changed or deleted; only an issued tax invoice can be voided, with a reason, and a credit note cancels it', async () => {
  const receipt = h.db.get<billing.DocumentRow>("SELECT * FROM billing_documents WHERE kind = 'receipt' LIMIT 1")!;
  assert.throws(() => h.db.run('UPDATE billing_documents SET total_paise = 100, subtotal_paise = 100, gst_paise = 0 WHERE id = ?', [receipt.id]), /immutable/);
  assert.throws(() => h.db.run("UPDATE billing_documents SET buyer = '{}' WHERE id = ?", [receipt.id]), /immutable/);
  assert.throws(() => h.db.run("UPDATE billing_documents SET status = 'void' WHERE id = ?", [receipt.id]), /immutable|CHECK/, 'voiding needs a reason and a time');
  assert.throws(() => h.db.run('DELETE FROM billing_documents WHERE id = ?', [receipt.id]), /kept/);

  const a = await admin();
  assert.equal(code(await a.post(`/api/admin/billing/documents/${receipt.id}/void`, { reason: 'try a receipt' })), 'NOT_VOIDABLE');
  const inv = h.db.get<billing.DocumentRow>("SELECT * FROM billing_documents WHERE kind = 'tax_invoice' AND status = 'issued' ORDER BY created_at LIMIT 1")!;
  assert.equal(code(await a.post(`/api/admin/billing/documents/${inv.id}/void`, { reason: '' })), 'VALIDATION_FAILED');
  const crnBefore = seq('CRN');
  const v = await a.post(`/api/admin/billing/documents/${inv.id}/void`, { reason: 'seller address was wrong (test)', reissue: true });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const credit = v.json.creditNote as { id: string; number: string; totalInr: number; relatedDocument: { id: string } };
  const replacement = v.json.replacement as { number: string; relatedDocument: { id: string } };
  assert.equal(credit.number, `CRN-${crnBefore + 1}`);
  assert.equal(credit.relatedDocument.id, inv.id);
  assert.equal(credit.totalInr, inv.total_paise / 100, 'the credit note cancels the invoice in full');
  assert.equal(replacement.relatedDocument.id, inv.id);
  assert.match(replacement.number, /^INV-\d+$/);
  const after = h.db.get<billing.DocumentRow>('SELECT * FROM billing_documents WHERE id = ?', [inv.id])!;
  assert.equal(after.status, 'void');
  assert.equal(after.void_reason, 'seller address was wrong (test)');
  assert.equal(after.voided_by, userId(h.ctx, DEMO.admin));
  assert.equal(after.total_paise, inv.total_paise, 'nothing else changed');
  assert.equal(h.db.get<{ reason: string }>("SELECT reason FROM audit_events WHERE action = 'billing_document.void' AND target_id = ?", [inv.id])!.reason, 'seller address was wrong (test)');
  assert.equal(code(await a.post(`/api/admin/billing/documents/${inv.id}/void`, { reason: 'twice' })), 'ALREADY_VOID');
  assert.equal(code(await a.post(`/api/admin/billing/documents/${credit.id}/void`, { reason: 'a credit note' })), 'NOT_VOIDABLE');
  assert.throws(() => h.db.run("UPDATE billing_documents SET status = 'issued' WHERE id = ?", [inv.id]), /immutable/, 'a void document stays void');
  const memberView = await (await member(BUYER)).get(`/api/me/billing/documents/${inv.id}`);
  assert.equal(memberView.json.status, 'void');
  assert.equal(memberView.json.voidReason, undefined, 'the member sees the status, not the administrator’s reason');
});

test('a refund produces a credit note against the tax invoice, or against the receipt when there is none', async () => {
  const a = await admin();
  // an order with a tax invoice (the seller details are set by the test above)
  const withInvoice = h.db.get<{ order_id: string; id: string; number: string; total_paise: number }>("SELECT d.order_id, d.id, d.number, d.total_paise FROM billing_documents d JOIN orders o ON o.id = d.order_id WHERE d.kind = 'tax_invoice' AND d.status = 'issued' AND o.status = 'activated' ORDER BY d.created_at DESC LIMIT 1")!;
  const r1 = await a.post(`/api/admin/orders/${withInvoice.order_id}/refund`, { reason: 'billing test refund' });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.ok(h.db.get("SELECT 1 FROM domain_events WHERE type = 'OrderRefunded' AND aggregate_id = ?", [withInvoice.order_id]), 'the refund emits OrderRefunded');
  await processPending(sys());
  const credit = h.db.get<billing.DocumentRow>("SELECT * FROM billing_documents WHERE kind = 'credit_note' AND order_id = ? AND refund_id IS NOT NULL", [withInvoice.order_id])!;
  assert.ok(credit, 'a credit note was issued');
  assert.equal(credit.related_document_id, withInvoice.id);
  assert.equal(credit.total_paise, withInvoice.total_paise);
  assert.ok(credit.refund_id);
  assert.match(credit.number, /^CRN-\d+$/);
  billing.onOrderRefunded(sys(), withInvoice.order_id, credit.refund_id);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM billing_documents WHERE kind = 'credit_note' AND order_id = ? AND refund_id IS NOT NULL", [withInvoice.order_id])!.n, 1, 'once per refund');
  assert.equal(code(await a.post(`/api/admin/billing/documents/${withInvoice.id}/void`, { reason: 'after the refund' })), 'ALREADY_CREDITED');

  // a demo order with a receipt only
  const receiptOnly = h.db.get<{ order_id: string; id: string }>("SELECT d.order_id, d.id FROM billing_documents d JOIN orders o ON o.id = d.order_id WHERE d.kind = 'receipt' AND o.status = 'activated' AND NOT EXISTS (SELECT 1 FROM billing_documents x WHERE x.order_id = d.order_id AND x.kind <> 'receipt') AND NOT EXISTS (SELECT 1 FROM refund_requests q WHERE q.order_id = d.order_id) ORDER BY d.created_at LIMIT 1")!;
  assert.equal((await a.post(`/api/admin/orders/${receiptOnly.order_id}/refund`, { reason: 'billing test refund 2' })).status, 200);
  await processPending(sys());
  const note = h.db.get<billing.DocumentRow>("SELECT * FROM billing_documents WHERE kind = 'credit_note' AND order_id = ?", [receiptOnly.order_id])!;
  assert.equal(note.related_document_id, receiptOnly.id);
  const m = h.db.get<{ email: string }>('SELECT u.email FROM users u JOIN orders o ON o.member_id = u.id WHERE o.id = ?', [receiptOnly.order_id])!;
  const view = await (await member(m.email)).get(`/api/me/billing/documents/${note.id}`);
  assert.equal(view.json.taxDocument, false, 'a credit note against a receipt is a refund record, not a GST credit note');
});

test('refund requests: a member asks with a reason, may withdraw; an administrator approves or declines with a note; all audited', async () => {
  const m = await member(BUYER);
  const other = await member(DEMO.member2);
  const { order } = await buy(m, 'starter', 'billing-request-1');
  assert.equal(code(await m.post(`/api/me/orders/${order.id}/refund-request`, {})), 'VALIDATION_FAILED');
  assert.equal(code(await m.post(`/api/me/orders/${order.id}/refund-request`, { reason: 'x' })), 'VALIDATION_FAILED');
  assert.equal((await other.post(`/api/me/orders/${order.id}/refund-request`, { reason: 'not my order' })).status, 404);
  const unpaid = h.db.get<{ id: string; member_id: string }>("SELECT id, member_id FROM orders WHERE status = 'failed' AND member_id = ?", [userId(h.ctx, BUYER)])!;
  assert.equal(code(await m.post(`/api/me/orders/${unpaid.id}/refund-request`, { reason: 'never paid' })), 'NOT_REFUNDABLE');

  const created = await m.post(`/api/me/orders/${order.id}/refund-request`, { reason: 'Changed my plans (test)' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const reqId = created.json.id as string;
  assert.equal(created.json.status, 'requested');
  assert.equal(auditCount('refund_request.create', reqId), 1);
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'refund' AND json_extract(data, '$.refundRequestId') = ?", [userId(h.ctx, DEMO.admin), reqId]), 'administrators who decide are told');
  assert.equal(code(await m.post(`/api/me/orders/${order.id}/refund-request`, { reason: 'again' })), 'REQUEST_OPEN');
  assert.equal((await other.post(`/api/me/refund-requests/${reqId}/withdraw`)).status, 404, 'only the member who asked may withdraw');
  const w = await m.post(`/api/me/refund-requests/${reqId}/withdraw`);
  assert.equal(w.json.status, 'withdrawn');
  assert.equal(auditCount('refund_request.withdraw', reqId), 1);
  assert.equal(code(await m.post(`/api/me/refund-requests/${reqId}/withdraw`)), 'NOT_OPEN');

  // asked again, declined with a note the member reads
  const second = await m.post(`/api/me/orders/${order.id}/refund-request`, { reason: 'Asking again (test)' });
  const a = await admin();
  assert.equal((await m.post(`/api/admin/refund-requests/${second.json.id}/decide`, { decision: 'approve', note: 'self-approval' })).status, 403, 'a member cannot decide');
  assert.equal(code(await a.post(`/api/admin/refund-requests/${second.json.id}/decide`, { decision: 'decline' })), 'VALIDATION_FAILED', 'a note is required');
  const declined = await a.post(`/api/admin/refund-requests/${second.json.id}/decide`, { decision: 'decline', note: 'The terms do not cover this (test)' });
  assert.equal(declined.json.status, 'declined');
  assert.equal(declined.json.decidedByName, 'Operations admin');
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', [order.id])!.status, 'activated', 'declining changes nothing on the order');
  assert.equal(h.db.get<{ reason: string }>("SELECT reason FROM audit_events WHERE action = 'refund_request.decide' AND target_id = ?", [second.json.id as string])!.reason, 'The terms do not cover this (test)');
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'refund' AND title = 'Refund request declined'", [userId(h.ctx, BUYER)]));
  assert.equal(code(await a.post(`/api/admin/refund-requests/${second.json.id}/decide`, { decision: 'approve', note: 'changed my mind' })), 'ALREADY_DECIDED');

  // asked a third time, approved: the existing refund path runs and the credit note follows
  const third = await m.post(`/api/me/orders/${order.id}/refund-request`, { reason: 'Third time (test)' });
  const listed = await a.get('/api/admin/refund-requests?status=requested');
  assert.ok((listed.json.items as Array<{ id: string; memberEmail: string }>).some((r) => r.id === third.json.id && r.memberEmail === BUYER));
  const approved = await a.post(`/api/admin/refund-requests/${third.json.id}/decide`, { decision: 'approve', note: 'Approved (test)' });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  assert.equal(approved.json.status, 'approved');
  assert.equal((approved.json.refund as { status: string }).status, 'completed');
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', [order.id])!.status, 'refunded');
  assert.ok(h.db.get("SELECT 1 FROM billing_documents WHERE kind = 'credit_note' AND order_id = ?", [order.id]), 'the credit note follows the refund');
  const mine = await m.get('/api/me/billing');
  assert.equal((mine.json.orders as Array<{ id: string; canRequestRefund: boolean }>).find((o) => o.id === order.id)!.canRequestRefund, false);
  assert.equal(code(await m.post(`/api/me/orders/${order.id}/refund-request`, { reason: 'after the refund' })), 'NOT_REFUNDABLE');

  // a refund made another way closes an open request as approved
  const sample = h.db.get<{ id: string; order_id: string }>("SELECT id, order_id FROM refund_requests WHERE reason = ?", [REFUND_REASON])!;
  assert.equal((await a.post(`/api/admin/orders/${sample.order_id}/refund`, { reason: 'refunded from Orders (test)' })).status, 200);
  await processPending(sys());
  const closed = h.db.get<{ status: string; refund_id: string | null }>('SELECT status, refund_id FROM refund_requests WHERE id = ?', [sample.id])!;
  assert.equal(closed.status, 'approved');
  assert.ok(closed.refund_id);
});

test('with the module off, every billing route answers FEATURE_DISABLED, the document link included, and the client config omits the flag', async () => {
  const m = await member(DEMO.member);
  const doc = (await m.get('/api/me/billing')).json.documents as Array<{ id: string }>;
  const t = await m.post(`/api/me/billing/documents/${doc[0]!.id}/file-token`);
  const a = await admin();
  h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'billing'");
  try {
    assert.equal(code(await m.get('/api/me/billing')), 'FEATURE_DISABLED');
    assert.equal(code(await m.post(`/api/me/orders/${doc[0]!.id}/refund-request`, { reason: 'while off' })), 'FEATURE_DISABLED');
    assert.equal(code(await a.get('/api/admin/billing/documents')), 'FEATURE_DISABLED');
    assert.equal(code(await a.get('/api/admin/refund-requests')), 'FEATURE_DISABLED');
    assert.equal(code(await client(h.app).get(`/api/billing/documents/file?token=${encodeURIComponent(t.json.token as string)}`)), 'FEATURE_DISABLED');
    const cfg = await m.get('/api/public/config');
    assert.ok(!(cfg.json.features as string[]).includes('billing'));
  } finally { h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'billing'"); }
  assert.ok(((await m.get('/api/public/config')).json.features as string[]).includes('billing'));
});

/** Pages through an administrator list with its cursor and returns the ids in the order they came. */
async function pageAll(c: Awaited<ReturnType<typeof admin>>, base: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let calls = 0;
  do {
    const r = await c.get(`${base}${base.includes('?') ? '&' : '?'}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    ids.push(...(r.json.items as Array<{ id: string }>).map((x) => x.id));
    cursor = r.json.nextCursor as string | null;
    assert.ok(++calls < 500, 'paging ends');
  } while (cursor);
  return ids;
}

test('bespoke orders: documents use the GST rate stored on the order, or 1800 when none was stored, never the current setting', async () => {
  const o = await owner();
  const m = await member(BUYER);
  const memberId = userId(h.ctx, BUYER);
  assert.equal((await o.patch('/api/admin/module-settings', { key: 'gst_rate_bp', value: 500, reason: 'billing test: bespoke rate' })).status, 200);
  try {
    // the real flow: request, proposal, approval, acceptance, payment through the simulator
    const created = await m.post('/api/me/custom-plans', { goals: 'Sample bespoke goals for the billing GST test', duration: '3 months' });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const cpl = created.json.id as string;
    const move = async (to: string, extra: Record<string, unknown> = {}) => { const r = await o.post(`/api/admin/custom-plans/${cpl}/transition`, { to, ...extra }); assert.equal(r.status, 200, JSON.stringify(r.json)); };
    await move('under_review');
    await move('scoping');
    await move('awaiting_internal_approval', { proposal: { durationMonths: 3, durationLabel: 'Sample 3 months', consultations: 2, bloodworkEntitlements: 1, priceInr: 12345 } });
    await move('proposal_sent', { approval: 'Sample approval (billing test)' });
    const accepted = await m.post(`/api/me/custom-plans/${cpl}/accept`);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    const paid = await m.post('/api/payments/simulator/complete', { checkoutId: (accepted.json.checkout as { checkoutId: string }).checkoutId, outcome: 'captured' });
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    const order = h.db.get<{ id: string; total_paise: number; gst_paise: number; metadata: string }>('SELECT * FROM orders WHERE custom_plan_id = ?', [cpl])!;
    const stored = (JSON.parse(order.metadata) as { gstRateBp?: unknown }).gstRateBp;
    const expected = typeof stored === 'number' ? stored : 1800;
    assert.equal(gstIncluded(order.total_paise, expected), order.gst_paise, 'the rate the documents print is the rate the order was charged at');
    const docs = docsFor(order.id);
    assert.ok(docs.length >= 1, 'the bespoke order has its receipt');
    for (const d of docs) {
      assert.equal(d.total_paise, order.total_paise);
      assert.equal(d.gst_paise, order.gst_paise);
      assert.deepEqual((JSON.parse(d.lines) as billing.DocumentLine[]).map((l) => l.gst_rate_bp), [expected], `${d.kind} prints the order's rate`);
    }
    const screen = (await m.get('/api/me/billing')).json.documents as Array<{ id: string; lines: Array<{ gstRatePct: number }> }>;
    assert.equal(screen.find((d) => d.id === docs[0]!.id)!.lines[0]!.gstRatePct, expected / 100);

    // deterministic: one bespoke order that stored 500 and one that stored nothing, both paid and verified
    const bespoke = (key: string, metadata: Record<string, unknown>, rateBp: number) => {
      const now = new Date().toISOString();
      const total = 1234500;
      const gst = gstIncluded(total, rateBp);
      h.db.insert('orders', { id: `ord_bspgst${key}`, reference: `PAY-BSPGST-${key}`, member_id: memberId, package_version_id: null, custom_plan_id: cpl, status: 'paid', amount_paise: total - gst, gst_paise: gst, total_paise: total, currency: 'INR', metadata: JSON.stringify(metadata), paid_at: now, created_at: now, updated_at: now });
      h.db.insert('payments', { id: `pay_bspgst${key}`, order_id: `ord_bspgst${key}`, provider: 'simulator', status: 'captured', amount_paise: total, currency: 'INR', signature_verified: 1, raw: '{}', created_at: now, updated_at: now });
      billing.issueForPaidOrder(sys(), `ord_bspgst${key}`);
      const issued = docsFor(`ord_bspgst${key}`);
      assert.ok(issued.length >= 1);
      for (const d of issued) {
        assert.equal(d.gst_paise, gst);
        assert.deepEqual((JSON.parse(d.lines) as billing.DocumentLine[]).map((l) => l.gst_rate_bp), [rateBp], `${key}: ${d.kind}`);
      }
    };
    bespoke('stored', { packageName: 'Bespoke plan (billing test)', customPlanId: cpl, gstRateBp: 500 }, 500);
    bespoke('unstored', { packageName: 'Bespoke plan (billing test)', customPlanId: cpl }, 1800); // the setting is 500 right now: not used
  } finally {
    assert.equal((await o.patch('/api/admin/module-settings', { key: 'gst_rate_bp', value: 1800, reason: 'billing test: back to the default' })).status, 200);
  }
  const row = (metadata: string) => ({ metadata } as unknown as Parameters<typeof billing.orderGstRateBp>[0]);
  assert.equal(billing.orderGstRateBp(row('{"gstRateBp":500}')), 500);
  assert.equal(billing.orderGstRateBp(row('{"gstRateBp":0}')), 0, 'a stored zero rate is kept');
  for (const bad of ['{}', 'null', '[]', '{"gstRateBp":"500"}', '{"gstRateBp":12.5}', '{"gstRateBp":-1}', '{"gstRateBp":20000}']) assert.equal(billing.orderGstRateBp(row(bad)), 1800, bad);
});

test('administrator lists page by (time, id): rows that share a time are neither skipped nor repeated', async () => {
  const a = await admin();
  const m = await member(BUYER);
  const memberId = userId(h.ctx, BUYER);
  const u = h.db.get<{ email: string; name: string }>('SELECT email, name FROM users WHERE id = ?', [memberId])!;
  // three paid orders whose documents and refund requests all carry one and the same time
  const at = '2026-01-15T09:30:00.000Z';
  const fixed: Ctx = { ...sys(), now: () => at };
  const orderIds: string[] = [];
  h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'billing'"); // paid with the handlers off, issued below at the fixed time
  try {
    for (const k of [1, 2, 3]) orderIds.push((await buy(m, 'starter', `billing-page-${k}`)).order.id);
  } finally { h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'billing'"); }
  for (const id of orderIds) {
    assert.ok(billing.issueForPaidOrder(fixed, id).length >= 1);
    billing.createRefundRequest({ ...fixed, actor: { id: memberId, role: 'member', email: u.email, name: u.name } }, id, 'Paging test (test)');
  }
  const sharedDocs = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM billing_documents WHERE issued_at = ?', [at])!.n;
  assert.ok(sharedDocs >= 3, 'several documents share one time');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM refund_requests WHERE created_at = ?', [at])!.n, 3);

  const expectDocs = (where = '', params: string[] = []) => h.db.all<{ id: string }>(`SELECT id FROM billing_documents ${where} ORDER BY issued_at DESC, id DESC`, params).map((r) => r.id);
  // a page smaller than the group of rows sharing a time: a strict "time < cursor" would skip the rest of the group
  assert.deepEqual(await pageAll(a, `/api/admin/billing/documents?memberId=${memberId}`, 2), expectDocs('WHERE member_id = ?', [memberId]));
  assert.deepEqual(await pageAll(a, '/api/admin/billing/documents', 3), expectDocs(), 'every document, once, newest first');
  assert.deepEqual(await pageAll(a, '/api/admin/billing/documents?kind=receipt', 1), expectDocs("WHERE kind = 'receipt'"));

  const expectRequests = (where = '', params: string[] = []) => h.db.all<{ id: string }>(`SELECT id FROM refund_requests ${where} ORDER BY created_at DESC, id DESC`, params).map((r) => r.id);
  assert.deepEqual(await pageAll(a, `/api/admin/refund-requests?memberId=${memberId}`, 1), expectRequests('WHERE member_id = ?', [memberId]));
  assert.deepEqual(await pageAll(a, '/api/admin/refund-requests?status=requested', 2), expectRequests("WHERE status = 'requested'"));
  assert.deepEqual(await pageAll(a, '/api/admin/refund-requests', 2), expectRequests());

  // a cursor of the earlier format (a bare time) still pages strictly before that time; a malformed one is refused
  const before = await a.get(`/api/admin/billing/documents?memberId=${memberId}&limit=200&cursor=${encodeURIComponent(at)}`);
  assert.equal(before.status, 200);
  assert.ok((before.json.items as Array<{ issuedAt: string }>).every((d) => d.issuedAt < at));
  assert.equal(code(await a.get(`/api/admin/billing/documents?cursor=${encodeURIComponent(`${at}~not-an-id`)}`)), 'INVALID_CURSOR');
  assert.equal(code(await a.get(`/api/admin/refund-requests?cursor=${encodeURIComponent(`${at}~bdc_wrongkind123`)}`)), 'INVALID_CURSOR');
});

test('data export: the member’s own billing documents and refund requests as their screen shows them; no void reasons, deciders, other people or provider payloads', async () => {
  // a tax invoice whose seller setting also holds contact fields: the export keeps the seller's identity only
  await setSeller({ ...SAMPLE_SELLER, email: 'seller-contact@sample.test', phone: '0000000000', pan: 'SAMPLEPAN0' });
  const m = await member(BUYER);
  try { await buy(m, 'starter', 'billing-export-seller'); } finally { await setSeller(SAMPLE_SELLER); }
  const memberId = userId(h.ctx, BUYER);
  const archive = dataExport.buildArchive(h.ctx, memberId, 'drq_billingexporttest');
  const section = (archive.moduleSections as Record<string, Record<string, { label: string; records: Array<Record<string, unknown>> }>> | undefined)?.billing;
  assert.ok(section, 'the billing module contributes its section');
  assert.deepEqual(Object.keys(section), ['documents', 'refundRequests']);
  assert.equal(archive.notIncluded.find((n) => /billing documents/i.test(n.what)), undefined, 'billing leaves the notIncluded list');
  const docs = section.documents.records;
  const reqs = section.refundRequests.records;
  const text = JSON.stringify(section);

  // every document of the member's, and no one else's
  const mine = h.db.all<billing.DocumentRow>('SELECT * FROM billing_documents WHERE member_id = ? ORDER BY issued_at, id', [memberId]);
  assert.deepEqual(docs.map((d) => d.number), mine.map((d) => d.number));
  const others = h.db.all<{ number: string; buyer: string }>('SELECT number, buyer FROM billing_documents WHERE member_id <> ?', [memberId]);
  assert.ok(others.length > 0);
  for (const d of others) assert.ok(!text.includes(d.number), `another member's document ${d.number}`);
  for (const e of h.db.all<{ email: string; phone: string | null }>('SELECT email, phone FROM users WHERE id <> ?', [memberId])) {
    assert.ok(!text.includes(e.email), `another person's email ${e.email}`);
    if (e.phone) assert.ok(!text.includes(e.phone), 'another person’s phone');
  }

  // as the member's Billing screen shows them: numbers, dates, amounts, status
  const screen = (await m.get('/api/me/billing')).json as { documents: Array<{ number: string; status: string; issuedAt: string; totalInr: number; gstInr: number }>; requests: Array<{ id: string; reason: string; status: string; decisionNote: string | null }> };
  assert.equal(screen.documents.length, docs.length);
  for (const s of screen.documents) {
    const d = docs.find((x) => x.number === s.number)!;
    assert.ok(d, s.number);
    assert.equal(d.status, s.status);
    assert.equal(d.issued_at, s.issuedAt);
    assert.equal(d.total_paise, Math.round(s.totalInr * 100));
    assert.equal(d.gst_paise, Math.round(s.gstInr * 100));
  }
  const voided = mine.find((d) => d.status === 'void' && d.void_reason)!;
  assert.ok(voided, 'the member has a voided invoice (voided by an administrator above)');
  const v = docs.find((d) => d.number === voided.number)!;
  assert.equal(v.status, 'void');
  assert.equal(v.voided_at, voided.voided_at);
  assert.ok(typeof v.credited_by === 'string', 'the credit note that cancelled it is named');
  for (const d of docs) for (const k of ['void_reason', 'voidReason', 'voided_by', 'voidedBy', 'voidedByName', 'member_id', 'memberId', 'payment_id', 'paymentId', 'id', 'raw', 'provider_ref']) assert.ok(!(k in d), `no ${k}`);
  assert.ok(!text.includes(voided.void_reason!), 'never the administrator’s void reason');

  // the seller's identity, never the setting's contact fields
  const withContacts = docs.filter((d) => d.kind === 'tax_invoice' && (d.seller as Record<string, string> | null)?.gstin);
  assert.ok(withContacts.length >= 1);
  for (const d of withContacts) assert.deepEqual(Object.keys(d.seller as object).sort(), ['address', 'gstin', 'legalName']);
  assert.ok(!text.includes('seller-contact@sample.test') && !text.includes('0000000000') && !text.includes('SAMPLEPAN0'), 'no seller email, phone or PAN');
  // the member's own billed-to details, as printed on their documents
  assert.ok(docs.every((d) => (d.billed_to as { email: string }).email === BUYER));

  // refund requests: theirs, with what they wrote and the note written to them; never who decided
  const theirs = h.db.all<billing.RefundRequestRow>('SELECT * FROM refund_requests WHERE member_id = ? ORDER BY created_at, id', [memberId]);
  assert.deepEqual(reqs.map((r) => r.your_reason), theirs.map((r) => r.reason));
  assert.deepEqual(reqs.map((r) => r.status), theirs.map((r) => r.status));
  assert.equal(screen.requests.length, reqs.length);
  const declined = reqs.find((r) => r.status === 'declined')!;
  assert.equal(declined.decision_note, 'The terms do not cover this (test)', 'the note written to the member is theirs');
  const approved = reqs.find((r) => r.status === 'approved' && r.refund)!;
  assert.equal((approved.refund as { status: string }).status, 'completed');
  for (const r of reqs) for (const k of ['decided_by', 'decidedBy', 'decidedByName', 'member_id', 'memberId', 'memberEmail', 'id', 'refund_id']) assert.ok(!(k in r), `no ${k}`);
  for (const r of theirs.filter((x) => x.decided_by)) assert.ok(!text.includes(r.decided_by!), 'no administrator id');
  assert.ok(!text.includes('Operations admin'), 'no administrator name');
  assert.ok(!text.includes(REFUND_REASON), 'another member’s request stays out');

  // nothing from the payment provider
  for (const p of h.db.all<{ id: string; provider_ref: string | null; checkout_id: string | null; event_id: string | null }>('SELECT y.id, y.provider_ref, y.checkout_id, y.event_id FROM payments y JOIN orders o ON o.id = y.order_id WHERE o.member_id = ?', [memberId])) {
    for (const v2 of [p.provider_ref, p.checkout_id, p.event_id]) if (v2) assert.ok(!text.includes(v2), `no provider value ${v2}`);
  }
  assert.ok(!/provider_ref|providerRef|checkout_id|checkoutId|event_id|"raw"/.test(text), "no provider fields");
});
