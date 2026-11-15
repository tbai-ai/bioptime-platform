/* Referrals (module 'referrals', migration 0034): the member's code and link, recording a referral at registration from
   the code alone (self-referrals, duplicates, unknown codes and inactive referrers refused without failing the
   registration), signed_up -> paying_member on the first verified paid order, the member's view (first names only), the
   administrators' list (members.manage), the switch, the data export and the demo rows. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import * as referrals from '../../src/domain/referrals.js';
import * as dataExport from '../../src/domain/dataExport.js';
import { setFlag } from '../../src/domain/features.js';
import { setAccountState } from '../../src/auth/service.js';
import { PLATFORM_ROOT } from '../../src/config.js';

const SITE = path.join(PLATFORM_ROOT, '../../drive');

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const member = (email: string) => signedIn(email, DEMO_PASSWORDS.member);
const ownerCtx = (): Ctx => { const id = userId(h.ctx, DEMO.owner); return { ...h.ctx, actor: { id, role: 'owner', email: DEMO.owner, name: 'Bioptime owner' } }; };
const referralOf = (memberId: string) => h.db.get<{ id: string; referrer_id: string; status: string; code: string; became_paying_at: string | null; first_order_id: string | null }>('SELECT * FROM referrals WHERE referred_id = ?', [memberId]);
const auditCount = (action: string) => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM audit_events WHERE action = ?', [action])!.n;
let n = 0;
async function register(extra: Record<string, unknown> = {}) {
  n++;
  const c = client(h.app);
  const email = `referred.${n}.${Date.now()}@example.test`;
  const r = await c.post('/api/auth/register', { email, password: 'Referred-Person-2026!', name: `Kiran Test${n}`, acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const user = r.json.user as { id: string };
  return { c, id: user.id, email, json: r.json };
}

test('the demo seed: codes for two members and three people who joined with them, the one who paid marked as a paying member', () => {
  const ananya = userId(h.ctx, DEMO.member);
  const priya = userId(h.ctx, 'priya.nair@demo.bioptime.test');
  const ishaan = userId(h.ctx, 'ishaan.mehta@demo.bioptime.test');
  const rohan = userId(h.ctx, 'rohan.das@demo.bioptime.test');
  assert.equal(referralOf(priya)?.referrer_id, ananya);
  assert.equal(referralOf(priya)?.status, 'paying_member', 'Priya has a paid order');
  assert.ok(referralOf(priya)?.first_order_id && referralOf(priya)?.became_paying_at);
  assert.equal(referralOf(ishaan)?.status, 'signed_up', 'Ishaan has not bought anything');
  assert.equal(referralOf(rohan)?.referrer_id, userId(h.ctx, DEMO.member2));
  assert.equal(referralOf(rohan)?.status, 'signed_up', 'Rohan’s order is unpaid');
  for (const r of h.db.all<{ code: string }>('SELECT code FROM referral_codes')) assert.match(r.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  const titles = h.db.all<{ reason: string | null }>("SELECT reason FROM audit_events WHERE action = 'referral.recorded'").map((r) => r.reason ?? '');
  assert.ok(titles.length >= 3 && titles.every((t) => !/demo|sample/i.test(t)), 'plain words in the audit reasons');
});

test('the member’s page: code, link from PUBLIC_ORIGIN, who joined by first name only; a code is made once, on first visit', async () => {
  const ananya = await member(DEMO.member);
  const r = await ananya.get('/api/me/referrals');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json as { code: string; link: string; joined: Array<Record<string, unknown>> };
  assert.equal(d.link, `http://localhost:3000/register?ref=${d.code}`);
  assert.deepEqual(d.joined.map((j) => j.firstName).sort(), ['Ishaan', 'Priya']);
  for (const j of d.joined) {
    assert.deepEqual(Object.keys(j).sort(), ['firstName', 'id', 'joinedAt'], 'no surname, email, phone or payment status');
  }
  assert.ok(!JSON.stringify(d).includes('Nair') && !JSON.stringify(d).includes('Mehta'));

  const deepaId = userId(h.ctx, 'deepa.krishnan@demo.bioptime.test');
  assert.equal(h.db.get('SELECT 1 FROM referral_codes WHERE member_id = ?', [deepaId]), undefined);
  const deepa = await member('deepa.krishnan@demo.bioptime.test');
  const before = auditCount('referral.code_created');
  const first = (await deepa.get('/api/me/referrals')).json as { code: string; joined: unknown[] };
  const second = (await deepa.get('/api/me/referrals')).json as { code: string };
  assert.equal(first.code, second.code, 'the same code every time');
  assert.deepEqual(first.joined, []);
  assert.equal(auditCount('referral.code_created'), before + 1, 'made and audited once');

  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  assert.equal((await coach.get('/api/me/referrals')).status, 403, 'members only');
  assert.equal((await client(h.app).get('/api/me/referrals')).status, 401);
});

test('registration records a referral from the code alone; the client cannot set the referrer or the status', async () => {
  const ananya = await member(DEMO.member);
  const code = ((await ananya.get('/api/me/referrals')).json as { code: string }).code;
  const reg = await register({ referralCode: ` ${code.toLowerCase()} `, referrerId: userId(h.ctx, DEMO.member2), status: 'paying_member' });
  const row = referralOf(reg.id);
  assert.ok(row, 'recorded');
  assert.equal(row!.referrer_id, userId(h.ctx, DEMO.member), 'the referrer comes from the code');
  assert.equal(row!.status, 'signed_up', 'the status starts at signed up, whatever the client sent');
  assert.equal(row!.code, code);
  assert.ok(!JSON.stringify(reg.json).includes(code), 'the registration answer says nothing about the referral');
  const joined = ((await ananya.get('/api/me/referrals')).json as { joined: Array<{ firstName: string }> }).joined;
  assert.ok(joined.some((j) => j.firstName === 'Kiran'), 'the referrer sees the first name');
  const auditRow = h.db.get<{ actor_id: string }>("SELECT actor_id FROM audit_events WHERE action = 'referral.recorded' AND target_id = ?", [row!.id]);
  assert.equal(auditRow?.actor_id, reg.id, 'audited as the new member’s action');
});

test('refused without failing the registration: unknown code, self-referral, duplicate, inactive referrer, module off', async () => {
  const ananyaId = userId(h.ctx, DEMO.member);
  const ananyaCode = referrals.ensureCode(h.ctx, ananyaId).code;

  const unknown = await register({ referralCode: 'ZZZZZZZZ' });
  assert.equal(referralOf(unknown.id), undefined, 'an unknown code records nothing');
  const junk = await register({ referralCode: '<script>' });
  assert.equal(referralOf(junk.id), undefined, 'a malformed code records nothing');

  // the same person under a second email: the code owner's phone number on the new account
  const refusedBefore = auditCount('referral.refused');
  const self = await register({ referralCode: ananyaCode, phone: '+919700000011' });
  assert.equal(referralOf(self.id), undefined, 'self-referral refused');
  assert.equal(auditCount('referral.refused'), refusedBefore + 1);
  assert.deepEqual(referrals.recordAtSignUp(h.ctx, ananyaId, ananyaCode), { recorded: false, reason: 'self' }, 'the code’s own account');

  const once = await register({ referralCode: ananyaCode });
  assert.ok(referralOf(once.id));
  const vikramCode = referrals.ensureCode(h.ctx, userId(h.ctx, DEMO.member2)).code;
  assert.deepEqual(referrals.recordAtSignUp(h.ctx, once.id, vikramCode), { recorded: false, reason: 'duplicate' }, 'referred once, by one person');
  assert.equal(referralOf(once.id)!.referrer_id, ananyaId, 'the first referral stands');

  // a suspended referrer's code
  const sunitaId = userId(h.ctx, 'sunita.bhat@demo.bioptime.test');
  const sunitaCode = referrals.ensureCode(h.ctx, sunitaId).code;
  setAccountState(ownerCtx(), sunitaId, 'suspended', 'referral test');
  const viaSuspended = await register({ referralCode: sunitaCode });
  assert.equal(referralOf(viaSuspended.id), undefined, 'an inactive referrer’s code records nothing');

  // the module switched off: the registration still works and records nothing
  setFlag(ownerCtx(), 'referrals', { enabled: false }, 'referral test: off');
  try {
    const off = await register({ referralCode: ananyaCode });
    assert.equal(referralOf(off.id), undefined);
    const m = await member(DEMO.member);
    assert.equal((await m.get('/api/me/referrals')).json.error?.code, 'FEATURE_DISABLED');
  } finally { setFlag(ownerCtx(), 'referrals', { enabled: true }, 'referral test: on'); }
});

test('the first verified paid order makes the referred member a paying member; later orders change nothing', async () => {
  const code = referrals.ensureCode(h.ctx, userId(h.ctx, DEMO.member2)).code;
  const reg = await register({ referralCode: code });
  const token = (reg.json.verification as { demoToken?: string }).demoToken!;
  assert.equal((await reg.c.post('/api/auth/verify-email', { token })).status, 200);
  const pkg = h.db.get<{ id: string }>("SELECT id FROM packages WHERE slug = 'starter'")!.id;
  // an order that is created but never paid changes nothing
  const unpaid = await reg.c.post('/api/me/checkout', { packageId: pkg, idempotencyKey: 'ref-unpaid' });
  assert.equal(unpaid.status, 201, JSON.stringify(unpaid.json));
  assert.equal(referralOf(reg.id)!.status, 'signed_up');
  const failed = await reg.c.post('/api/payments/simulator/complete', { checkoutId: (unpaid.json.checkout as { checkoutId: string }).checkoutId, outcome: 'failed' });
  assert.equal(failed.status, 200);
  assert.equal(referralOf(reg.id)!.status, 'signed_up', 'a failed payment is not a paying member');

  const co = await reg.c.post('/api/me/checkout', { packageId: pkg, idempotencyKey: 'ref-paid' });
  const paid = await reg.c.post('/api/payments/simulator/complete', { checkoutId: (co.json.checkout as { checkoutId: string }).checkoutId, outcome: 'captured' });
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
  const orderId = (paid.json.order as { id: string }).id;
  const row = referralOf(reg.id)!;
  assert.equal(row.status, 'paying_member');
  assert.equal(row.first_order_id, orderId);
  const at = row.became_paying_at;
  assert.ok(at);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'referral.converted' AND target_id = ?", [row.id])!.n, 1);

  // the referrer still sees only the first name and the date, never that they paid
  const vikram = await member(DEMO.member2);
  const mine = (await vikram.get('/api/me/referrals')).json as { joined: Array<Record<string, unknown>> };
  assert.ok(!JSON.stringify(mine).includes('paying'), 'no payment status for the referrer');

  // a second paid order: nothing moves
  const co2 = await reg.c.post('/api/me/checkout', { packageId: h.db.get<{ id: string }>("SELECT id FROM packages WHERE slug = 'reset'")!.id, idempotencyKey: 'ref-paid-2' });
  await reg.c.post('/api/payments/simulator/complete', { checkoutId: (co2.json.checkout as { checkoutId: string }).checkoutId, outcome: 'captured' });
  assert.equal(referralOf(reg.id)!.became_paying_at, at);
  assert.equal(referralOf(reg.id)!.first_order_id, orderId);
});

test('administrators holding members.manage list every referral with its status; nobody else does', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const r = await owner.get('/api/admin/referrals');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json as { items: Array<{ status: string; statusLabel: string; referrer: { name: string; memberCode: string | null }; referred: { name: string } }>; counts: Record<string, number> };
  assert.ok(d.items.length >= 3);
  assert.ok(d.items.some((i) => i.referred.name === 'Priya Nair' && i.status === 'paying_member' && i.statusLabel === 'Became a paying member'));
  assert.ok(d.items.every((i) => /^BPM-/.test(i.referrer.memberCode ?? '')));
  assert.equal(d.counts.total, d.counts.signed_up! + d.counts.paying_member!);
  assert.ok(!/@|\+91/.test(JSON.stringify(d)), 'no email addresses or phone numbers in the list');
  const paying = (await owner.get('/api/admin/referrals?status=paying_member')).json as { items: Array<{ status: string }> };
  assert.ok(paying.items.length >= 1 && paying.items.every((i) => i.status === 'paying_member'));
  const search = (await owner.get('/api/admin/referrals?q=priya')).json as { items: Array<{ referred: { name: string } }> };
  assert.deepEqual(search.items.map((i) => i.referred.name), ['Priya Nair']);
  assert.equal((await owner.get('/api/admin/referrals?status=rewarded')).status, 400);

  const adminId = userId(h.ctx, DEMO.admin);
  h.db.run('INSERT INTO user_permissions (user_id, permission, granted, reason, updated_at, updated_by) VALUES (?, ?, 0, ?, ?, NULL) ON CONFLICT(user_id, permission) DO UPDATE SET granted = 0', [adminId, 'members.manage', 'referral test', new Date().toISOString()]);
  try {
    const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
    assert.equal((await admin.get('/api/admin/referrals')).json.error?.code, 'PERMISSION_DENIED');
  } finally { h.db.run('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?', [adminId, 'members.manage']); }
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  assert.equal((await coach.get('/api/admin/referrals')).status, 403);
  const m = await member(DEMO.member);
  assert.equal((await m.get('/api/admin/referrals')).status, 403);
});

test('the data export: the member’s code and link, who joined with it by first name, and who referred them; nothing about rewards', () => {
  const ananyaId = userId(h.ctx, DEMO.member);
  const archive = dataExport.buildArchive(h.ctx, ananyaId, 'drq_referraltest') as { moduleSections?: Record<string, Record<string, { label: string; records: Record<string, unknown> }>> };
  const s = archive.moduleSections?.referrals?.referrals;
  assert.ok(s, 'the referrals section is in the archive');
  const rec = s!.records as { code: string; link: string; joinedWithYourCode: Array<{ firstName: string }>; youJoinedWith: unknown };
  assert.equal(rec.link, referrals.referralLink(h.ctx, rec.code));
  assert.ok(rec.joinedWithYourCode.some((j) => j.firstName === 'Priya'));
  assert.equal(rec.youJoinedWith, null);
  assert.ok(!/reward/i.test(JSON.stringify(rec)));
  const priya = dataExport.buildArchive(h.ctx, userId(h.ctx, 'priya.nair@demo.bioptime.test'), 'drq_referraltest2') as typeof archive;
  const p = priya.moduleSections!.referrals!.referrals!.records as { youJoinedWith: { firstName: string } | null; code: string | null };
  assert.equal(p.youJoinedWith?.firstName, 'Ananya');
  assert.equal(p.code, null, 'no code until she opens Refer a friend');
});

test('the website registration sends the code from the link, and its visible text no longer says demo', () => {
  const js = fs.readFileSync(path.join(SITE, 'js', 'account.js'), 'utf8');
  assert.match(js, /referralCode/, 'the register form sends referralCode');
  assert.match(js, /param\('ref'\)/, 'read from register?ref=CODE');
  for (const phrase of [/Demo mode/, /Demo price/, /in this demo/, />Demo</, /used in demo mode/]) assert.doesNotMatch(js, phrase);
});
