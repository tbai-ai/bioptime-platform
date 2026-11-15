/* Regression tests for the second adversarial review (22 October 2026): administrative controls and website hosting.
   Each test names the rule it guards. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, DEMO_MFA_SECRET, userId } from '../helpers.js';
import { totpCode } from '../../src/lib/crypto.js';
import { findRestrictedFields, adminRestrictedKeys } from '../../src/auth/fieldPolicy.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const login = (c: ReturnType<typeof client>, email: string, password: string, workspace: string, mfa = false) => c.post('/api/auth/login', { email, password, workspace, ...(mfa ? { mfaCode: totpCode(DEMO_MFA_SECRET) } : {}) });
const detail = (r: { json: { error?: { code: string; details?: unknown } } }) => r.json.error?.code === 'INVALID_STATE' ? (r.json.error.details as { code?: string } | undefined)?.code : r.json.error?.code;
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ADMIN_KEYS = adminRestrictedKeys(); // the route's own set, so a test cannot pass on a narrower one

test('member and coach routes act only on accounts of that role: an administrator cannot suspend, credit or annotate an owner, a colleague or a coach through /admin/members', async () => {
  const admin = client(h.app), anon = client(h.app), coach = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  await login(coach, DEMO.coach, DEMO_PASSWORDS.coach, 'coach');
  const ownerId = userId(h.ctx, DEMO.owner), coachId = userId(h.ctx, DEMO.coach), memberId = userId(h.ctx, DEMO.memberNoCoach);
  for (const id of [ownerId, coachId]) {
    assert.equal((await admin.patch(`/api/admin/members/${id}/state`, { state: 'suspended', reason: 'test: must not apply' })).status, 404, 'not a member');
    assert.equal((await admin.post(`/api/admin/members/${id}/entitlements/adjust`, { serviceType: 'consultation', delta: 1, reason: 'test: must not apply', idempotencyKey: `x-${id}` })).status, 404);
    assert.equal((await admin.post(`/api/admin/members/${id}/notes`, { body: 'test: must not apply' })).status, 404);
    assert.equal((await admin.post(`/api/admin/members/${id}/password-reset`)).status, 404);
  }
  assert.equal(h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [ownerId])!.state, 'active', 'the owner is untouched');
  assert.equal((await admin.patch(`/api/admin/coaches/${memberId}/state`, { state: 'suspended', reason: 'test: must not apply' })).status, 404, 'a member is not a coach');
  assert.equal((await admin.patch(`/api/admin/coaches/${ownerId}/state`, { state: 'suspended', reason: 'test: must not apply' })).status, 404);
  const ok = await admin.patch(`/api/admin/members/${memberId}/state`, { state: 'suspended', reason: 'test: a real member can be suspended' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await admin.patch(`/api/admin/members/${memberId}/state`, { state: 'active', reason: 'test: and reinstated' })).status, 200);
  assert.equal((await anon.patch(`/api/admin/members/${ownerId}/state`, { state: 'suspended', reason: 'test: anonymous' })).status, 401, 'the role check never answers before authentication');
  assert.equal((await coach.patch(`/api/admin/members/${ownerId}/state`, { state: 'suspended', reason: 'test: coach' })).status, 403, 'nor before the workspace guard');
  const ci = await admin.post('/api/admin/coaches/invite', { email: 'invited.coach.r2@demo.bioptime.test', displayName: 'Invited Coach R2' });
  assert.equal(ci.status, 201, JSON.stringify(ci.json));
  assert.equal((await admin.post('/api/admin/members/invite', { email: 'invited.coach.r2@demo.bioptime.test', name: 'Coach As Member', reason: 'test: must not apply' })).json.error?.code, 'EMAIL_IN_USE', 'an invited coach’s account cannot be taken over by a member invitation');
  assert.equal(h.db.get<{ role: string }>('SELECT role FROM users WHERE email = ?', ['invited.coach.r2@demo.bioptime.test'])!.role, 'coach');
});

test('activation only from the invited state: closing an invited account voids its link, and a changed state refuses the link even if it still exists', async () => {
  const admin = client(h.app), anon = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const inv = await admin.post('/api/admin/members/invite', { email: 'closed.invite@demo.bioptime.test', name: 'Closed Before Activation', reason: 'test: invite' });
  assert.equal(inv.status, 201, JSON.stringify(inv.json));
  const token = inv.json.token as string, id = (inv.json.user as { id: string }).id;
  assert.equal((await admin.patch(`/api/admin/members/${id}/state`, { state: 'closed', reason: 'test: withdrawn' })).status, 200);
  assert.equal((await anon.post('/api/auth/invitations/member/preview', { token })).json.error?.code, 'TOKEN_INVALID', 'the link died with the account state');
  assert.equal((await anon.post('/api/auth/invitations/member/accept', { token, password: 'A-long-demo-password-1', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' })).json.error?.code, 'TOKEN_INVALID');
  assert.equal(h.db.get<{ state: string; password_hash: string | null }>('SELECT state, password_hash FROM users WHERE id = ?', [id])!.state, 'closed');
  // the state check is its own layer: a link that survives (here by hand) still does not activate a non-invited account
  const inv2 = await admin.post('/api/admin/members/invite', { email: 'suspended.invite@demo.bioptime.test', name: 'Suspended Before Activation', reason: 'test: invite' });
  const id2 = (inv2.json.user as { id: string }).id;
  h.db.run("UPDATE users SET state = 'suspended' WHERE id = ?", [id2]);
  assert.equal((await anon.post('/api/auth/invitations/member/preview', { token: inv2.json.token })).json.error?.code, 'ACTIVATION_STATE');
  const acc = await anon.post('/api/auth/invitations/member/accept', { token: inv2.json.token, password: 'A-long-demo-password-1', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' });
  assert.equal(detail(acc), 'ACTIVATION_STATE');
  assert.equal(h.db.get<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = ?', [id2])!.password_hash, null, 'no password was set');
  assert.equal((await anon.get('/api/me')).status, 401, 'no session was opened');
});

test('members.view_restricted applies to the whole response: no address, PIN code, phone or date of birth anywhere in the member record, the member list or the bookings without it', async () => {
  const owner = client(h.app), admin = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const adminId = userId(h.ctx, DEMO.admin), memberId = userId(h.ctx, DEMO.member);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.view_restricted', granted: false, reason: 'test: narrow' })).status, 200);
  try {
    const full = await owner.get(`/api/admin/members/${memberId}`);
    assert.equal(typeof (full.json.profile as { phone: unknown }).phone, 'string', 'the owner still sees the phone');
    const d = await admin.get(`/api/admin/members/${memberId}`);
    assert.equal(d.status, 200);
    assert.deepEqual(findRestrictedFields(d.json, ADMIN_KEYS), [], 'nothing restricted anywhere in the record');
    assert.equal((d.json.profile as { restricted?: boolean }).restricted, true);
    assert.equal(typeof (d.json.profile as { email: unknown }).email, 'string', 'email stays: it is the account identifier');
    assert.ok(Array.isArray(d.json.bookings), 'the record still carries its sections');
    const list = await admin.get('/api/admin/members');
    assert.deepEqual(findRestrictedFields(list.json, ADMIN_KEYS), [], 'the member list carries no phone');
    const ownersList = await owner.get('/api/admin/members');
    assert.ok((ownersList.json.items as Array<{ phone?: unknown }>).some((m) => typeof m.phone === 'string'), 'the owner list keeps it');
    const bookings = await admin.get('/api/admin/bloodwork/bookings');
    assert.equal(bookings.status, 200);
    assert.deepEqual(findRestrictedFields(bookings.json, ADMIN_KEYS), [], 'bookings carry no collection address without the permission');
    const plans = await admin.get('/api/admin/custom-plans');
    assert.deepEqual(findRestrictedFields(plans.json, ADMIN_KEYS), [], 'bespoke requests carry no contact phone without the permission');
    const ownerPlans = (await owner.get('/api/admin/custom-plans')).json.items as Array<{ id: string; contact_phone?: unknown }>;
    const withPhone = ownerPlans.find((r) => typeof r.contact_phone === 'string');
    assert.ok(withPhone, 'the owner sees a bespoke contact phone, so the checks can fail');
    assert.deepEqual(findRestrictedFields((await admin.get(`/api/admin/custom-plans/${withPhone!.id}`)).json, ADMIN_KEYS), [], 'nor the bespoke detail');
    const someBooking = ((await owner.get('/api/admin/bloodwork/bookings')).json.items as Array<{ id: string }>)[0];
    assert.ok(someBooking, 'the demo has a booking');
    assert.ok(findRestrictedFields((await owner.get(`/api/admin/bloodwork/bookings/${someBooking!.id}`)).json, ADMIN_KEYS).length > 0, 'the owner sees the collection address');
    assert.deepEqual(findRestrictedFields((await admin.get(`/api/admin/bloodwork/bookings/${someBooking!.id}`)).json, ADMIN_KEYS), [], 'nor the booking detail');
    assert.deepEqual(findRestrictedFields((await admin.get('/api/admin/enquiries')).json, ADMIN_KEYS), [], 'nor the enquiries');
    const phone = (full.json.profile as { phone: string }).phone;
    const q = encodeURIComponent(phone.slice(0, 6));
    assert.ok(((await owner.get(`/api/admin/members?q=${q}`)).json.items as Array<{ id: string }>).some((m) => m.id === memberId), 'the owner finds the member by phone');
    assert.ok(!((await admin.get(`/api/admin/members?q=${q}`)).json.items as Array<{ id: string }>).some((m) => m.id === memberId), 'the narrowed admin cannot search by phone (it would spell the number out)');
    const suspended = await admin.patch(`/api/admin/members/${memberId}/state`, { state: 'suspended', reason: 'test: narrowed admin' });
    assert.equal(suspended.status, 200);
    assert.deepEqual(findRestrictedFields(suspended.json, ADMIN_KEYS), [], 'nor the state change response');
    assert.equal((await admin.patch(`/api/admin/members/${memberId}/state`, { state: 'active', reason: 'test: restore' })).status, 200);
  } finally {
    await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.view_restricted', granted: true, reason: 'test: restore' });
  }
});

test('entitlement adjustments: the idempotency key is namespaced per member and service, so a replayed key on another member is a new adjustment', async () => {
  const owner = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  const a = userId(h.ctx, DEMO.member), b = userId(h.ctx, DEMO.member2);
  const remaining = async (id: string) => ((await owner.get(`/api/admin/members/${id}`)).json.entitlements as Array<{ serviceType: string; remaining: number }>).filter((e) => e.serviceType === 'consultation').reduce((s, e) => s + e.remaining, 0);
  const a0 = await remaining(a), b0 = await remaining(b);
  assert.equal((await owner.post(`/api/admin/members/${a}/entitlements/adjust`, { serviceType: 'consultation', delta: 1, reason: 'test: goodwill', idempotencyKey: 'shared-key-1' })).status, 200);
  assert.equal((await owner.post(`/api/admin/members/${b}/entitlements/adjust`, { serviceType: 'consultation', delta: 1, reason: 'test: goodwill', idempotencyKey: 'shared-key-1' })).status, 200);
  assert.equal(await remaining(a), a0 + 1);
  assert.equal(await remaining(b), b0 + 1, 'the second member is credited too');
  assert.equal((await owner.post(`/api/admin/members/${b}/entitlements/adjust`, { serviceType: 'consultation', delta: 1, reason: 'test: replay', idempotencyKey: 'shared-key-1' })).status, 200);
  assert.equal(await remaining(b), b0 + 1, 'the same member and key is applied once');
  const row = h.db.get<{ idempotency_key: string }>("SELECT idempotency_key FROM entitlement_transactions WHERE idempotency_key LIKE 'adjust:%' ORDER BY created_at DESC LIMIT 1")!;
  assert.match(row.idempotency_key, /^adjust:usr_[^:]+:consultation:shared-key-1$/);
});

test('bespoke plans: acceptance is the member’s own step, and an approval binds to the proposal terms it approved', async () => {
  const admin = client(h.app), m = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  await m.login(DEMO.member2, DEMO_PASSWORDS.member, 'member');
  const req = await m.post('/api/me/custom-plans', { goals: 'Three months of strength work with one test', duration: '3 months' });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  const id = (req.json as { id: string }).id;
  const move = (to: string, extra: Record<string, unknown> = {}) => admin.post(`/api/admin/custom-plans/${id}/transition`, { to, ...extra });
  assert.equal((await move('under_review')).status, 200);
  assert.equal((await move('scoping')).status, 200);
  const terms = { durationMonths: 3, durationLabel: '3 months', consultations: 3, bloodworkEntitlements: 1, priceInr: 15999 };
  assert.equal((await move('awaiting_internal_approval', { proposal: terms, approval: 'Approved at these terms' })).status, 200);
  const stale = await move('proposal_sent', { proposal: { ...terms, priceInr: 12999 } });
  assert.equal(detail(stale), 'APPROVAL_STALE', 'a repriced proposal is not sent under the old approval');
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM custom_plan_requests WHERE id = ?', [id])!.status, 'awaiting_internal_approval');
  assert.equal((await move('accepted')).status, 400, 'an administrator cannot record the member’s acceptance');
  assert.equal((await move('payment_pending')).status, 400);
  const sent = await move('proposal_sent', { proposal: { ...terms, priceInr: 12999 }, approval: 'Approved at the revised price' });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal((sent.json as { proposal: { priceInr: number } }).proposal.priceInr, 12999);
  assert.deepEqual((sent.json as { allowedNext: string[] }).allowedNext.filter((s) => s === 'accepted' || s === 'payment_pending'), [], 'administrators are not offered the member’s step');
  const { transition } = await import('../../src/domain/customPlans.js');
  const adminCtx = { ...h.ctx, actor: { id: userId(h.ctx, DEMO.admin), role: 'admin', email: DEMO.admin, name: 'Admin' } } as unknown as typeof h.ctx;
  assert.throws(() => transition(adminCtx, id, 'accepted'), (e: unknown) => JSON.stringify(e).includes('MEMBER_STEP'), 'the domain refuses it too, not only the route schema');
  assert.equal((await m.post(`/api/me/custom-plans/${id}/accept`)).status, 200, 'the member accepts through their own flow');
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM custom_plan_requests WHERE id = ?', [id])!.status, 'payment_pending');
});

test('image uploads: a 2.5 MB image passes the route’s own body limit; 3 MB stays the ceiling', async () => {
  const admin = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const big = Buffer.concat([PNG_1x1, Buffer.alloc(2_500_000)]);
  const up = await admin.post('/api/admin/assets', { filename: 'big.png', dataBase64: big.toString('base64'), alt: 'A large test image', reason: 'test: size' });
  assert.equal(up.status, 201, JSON.stringify(up.json).slice(0, 300));
  const tooBig = Buffer.concat([PNG_1x1, Buffer.alloc(3 * 1024 * 1024 + 1)]);
  const refused = await admin.post('/api/admin/assets', { filename: 'too-big.png', dataBase64: tooBig.toString('base64'), reason: 'test: size' });
  assert.equal(refused.json.error?.code, 'ASSET_TOO_LARGE', JSON.stringify(refused.json).slice(0, 300));
});

test('packages: PATCH keeps promoLabel and visible, an archived package cannot be revised or published or fetched publicly, and ₹0 is not publishable', async () => {
  const owner = client(h.app), anon = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  const created = await owner.post('/api/admin/packages', { slug: 'review-free', name: 'Review Free', kind: 'package', durationMonths: 1, durationLabel: '1 month', consultations: 1, bloodworkEntitlements: 0, priceInr: 0, coaching: 'standard', reason: 'test: create' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = created.json.id as string;
  assert.equal(detail(await owner.post(`/api/admin/packages/${id}/publish`, { reason: 'test: free' })), 'NO_PRICE', 'a zero price does not go on sale');
  const patched = await owner.patch(`/api/admin/packages/${id}`, { promoLabel: 'Popular', visible: false, priceInr: 999, reason: 'test: label and visibility' });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.promoLabel, 'Popular');
  assert.equal(patched.json.visible, false);
  assert.equal((await owner.post(`/api/admin/packages/${id}/publish`, { reason: 'test: priced now' })).status, 200);
  assert.equal((await anon.get('/api/packages/review-free')).status, 200);
  assert.equal((await owner.post(`/api/admin/packages/${id}/archive`, { reason: 'test: archive' })).status, 200);
  assert.equal(detail(await owner.patch(`/api/admin/packages/${id}`, { priceInr: 1999, reason: 'test: must be refused' })), 'ARCHIVED');
  assert.equal(detail(await owner.post(`/api/admin/packages/${id}/publish`, { reason: 'test: must be refused' })), 'ARCHIVED');
  assert.equal((await anon.get('/api/packages/review-free')).status, 404, 'archived packages are not public');
});

test('settings carry no LabStack detail; theme rollback is one way; reasons on metric and enquiry changes reach the audit log', async () => {
  const admin = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const s = await admin.get('/api/admin/settings');
  assert.equal(s.status, 200);
  const lab = (s.json.integrations as { labstack: Record<string, unknown> }).labstack;
  assert.equal(lab.restricted, true);
  assert.equal(lab.managedUnder, '/admin/integrations/labstack');
  for (const k of ['state', 'vendor', 'mode', 'webhookAddress', 'lastSyncAt']) assert.equal(k in lab, false, `${k} is not in the settings payload`);
  const defaults = (await admin.get('/api/admin/theme')).json.defaults as Record<string, unknown>;
  assert.equal((await admin.put('/api/admin/theme', { tokens: { ...defaults, brandPrimary: '#E02A1A' } })).status, 200);
  assert.equal((await admin.post('/api/admin/theme/publish', { reason: 'test: v1' })).status, 200);
  assert.equal((await admin.put('/api/admin/theme', { tokens: { ...defaults, brandPrimary: '#E8402F' } })).status, 200);
  assert.equal((await admin.post('/api/admin/theme/publish', { reason: 'test: v2' })).status, 200);
  assert.equal((await admin.post('/api/admin/theme/rollback', { reason: 'test: back to v1' })).status, 200);
  assert.equal(detail(await admin.post('/api/admin/theme/rollback', { reason: 'test: again' })), 'NO_PREVIOUS', 'a second rollback cannot re-apply the theme rolled back from');
  assert.equal((await admin.put('/api/admin/theme', { tokens: { ...defaults, brandPrimary: '#F04A3A' } })).status, 200);
  assert.equal((await admin.post('/api/admin/theme/publish', { reason: 'test: v3 so that a previous theme exists again' })).status, 200);
  assert.equal((await admin.post('/api/admin/theme/reset', { reason: 'test: reset' })).status, 200);
  assert.equal(detail(await admin.post('/api/admin/theme/rollback', { reason: 'test: after reset' })), 'NO_PREVIOUS', 'reset leaves nothing to roll back to');
  const enquiries = (await admin.get('/api/admin/enquiries')).json.items as Array<{ id: string }>;
  assert.ok(enquiries.length, 'the demo seeds an enquiry');
  assert.equal((await admin.patch(`/api/admin/enquiries/${enquiries[0]!.id}`, { status: 'in_progress', reason: 'test: follow-up call booked' })).status, 200);
  const log = (await admin.get(`/api/admin/audit?targetType=enquiry&targetId=${enquiries[0]!.id}`)).json.items as Array<{ action: string; reason: string | null }>;
  assert.equal(log.find((e) => e.action === 'enquiry.update')?.reason, 'test: follow-up call booked');
  const metrics = (await admin.get('/api/admin/metrics-config')).json.items as Array<{ metric: string; enabled: boolean }>;
  const metric = metrics[0]!;
  assert.equal((await admin.patch(`/api/admin/metrics-config/${metric.metric}`, { enabled: metric.enabled, reason: 'test: reviewed' })).status, 200);
  const mlog = (await admin.get(`/api/admin/audit?targetType=metric&targetId=${metric.metric}`)).json.items as Array<{ action: string; reason: string | null }>;
  assert.equal(mlog.find((e) => e.action === 'metric.config')?.reason, 'test: reviewed');
});

test('website hosting: an ignored page is unreachable by every spelling (directory, clean URL, extension-less) while its stylesheet stays public', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-site-'));
  fs.mkdirSync(path.join(dir, 'brand', 'book'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Site</title>');
  fs.writeFileSync(path.join(dir, '404.html'), '<!doctype html><title>Missing</title>');
  fs.writeFileSync(path.join(dir, 'brand', 'book', 'index.html'), '<!doctype html><title>Private book</title>');
  fs.writeFileSync(path.join(dir, 'brand', 'book', 'book.js'), 'window.book = 1;');
  fs.writeFileSync(path.join(dir, 'brand', 'book', 'tokens.css'), ':root { --bp: 1 }');
  fs.writeFileSync(path.join(dir, '.assetsignore'), '# private reference\nbrand/book/index.html\nbrand/book/book.js\nREADME.md\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# private readme');
  fs.writeFileSync(path.join(dir, '_headers'), '/*\n  X-Test: private-headers\n');
  fs.writeFileSync(path.join(dir, 'blog.html'), '<!doctype html><title>Blog index</title>');
  fs.mkdirSync(path.join(dir, 'blog'));
  fs.writeFileSync(path.join(dir, 'blog', 'first-post.html'), '<!doctype html><title>First post</title>');
  const site = await makeApp({ seed: false, env: { WEBSITE_DIR: dir } });
  try {
    const c = client(site.app);
    assert.equal((await c.get('/')).status, 200);
    assert.equal((await c.get('/brand/book/tokens.css')).status, 200, 'the tokens stylesheet is part of the site');
    for (const p of ['/brand/book/index.html', '/brand/book/', '/brand/book', '/brand/book/index', '/brand/book/book.js', '/brand//book/', '/brand/book/./index.html', '/brand/book/index%2Ehtml',
      '/BRAND/BOOK/', '/Brand/book/', '/brand/BOOK', '/brand/book/INDEX', '/brand/book/INDEX.HTML', '/brand/book/Index.html', '/brand/book/Book.js', '/brand/boo%4B/', '/README.MD', '/readme.md', '/_HEADERS', '//_headers', '/_headers']) {
      let r = await c.get(p);
      if (r.status === 301) r = await c.get(String(r.headers.location)); // .html spellings first take the clean-URL redirect
      assert.equal(r.status, 404, `${p} answers 404`);
      assert.doesNotMatch(r.text, /Private book|window\.book|private readme|private-headers/, `${p} leaks nothing`);
    }
    const blog = await c.get('/blog');
    assert.equal(blog.status, 200, 'a clean URL that is also a folder serves its page');
    assert.match(blog.text, /Blog index/);
    assert.equal((await c.get('/blog/first-post')).status, 200);
    assert.equal((await c.get('/Blog')).status, 404, 'another letter case of a page is not that page');
  } finally {
    await site.app.close(); site.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('coach reports queue: reading marker values through /coach/reports leaves one health.viewed audit row per client, like the client record does', async () => {
  const coach = client(h.app);
  await coach.login(DEMO.coach2, DEMO_PASSWORDS.coach, 'dashboard');
  const before = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'health.viewed' AND data LIKE '%reports-queue%'")!.n;
  const r = await coach.get('/api/coach/reports');
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  const items = r.json.items as Array<{ id: string; memberId: string }>;
  assert.ok(items.length, 'the demo coach has at least one shared report in the queue');
  const members = new Set(items.map((i) => i.memberId));
  const after = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'health.viewed' AND data LIKE '%reports-queue%'")!.n;
  assert.equal(after - before, members.size, 'one audit row per client whose values were read');
  for (const m of members) assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'health.viewed' AND target_type = 'user' AND target_id = ? AND data LIKE '%reports-queue%'", [m]), `audited for ${m}`);
});

test('coach follow-ups: owned by the coach from creation and not pushed to every administrator; listed only for their owner', async () => {
  const coach = client(h.app), other = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  await other.login(DEMO.coach2, DEMO_PASSWORDS.coach, 'dashboard');
  const clients = (await coach.get('/api/coach/clients')).json.items as Array<{ id: string }>;
  assert.ok(clients.length, 'the demo coach has clients');
  const before = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE category = 'operations'")!.n;
  const r = await coach.post(`/api/coach/clients/${clients[0]!.id}/follow-ups`, { title: 'Review: call about sleep log', detail: 'test' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.owner_id, userId(h.ctx, DEMO.coach), 'owned from creation');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE category = 'operations'")!.n, before, 'no administrator broadcast');
  assert.ok(((await coach.get('/api/coach/follow-ups')).json.items as Array<{ id: string }>).some((t) => t.id === r.json.id));
  assert.ok(!((await other.get('/api/coach/follow-ups')).json.items as Array<{ id: string }>).some((t) => t.id === r.json.id), 'another coach does not see it');
});

/* ---------- round 3: gaps found by the verification of the round-2 fixes ---------- */

test('coach view and health sharing: with sharing off the coach gets no measurements, progress log or wellness score; with it on they do', async () => {
  const noShareId = userId(h.ctx, DEMO.memberNoShare);
  const coachRow = h.db.get<{ email: string }>("SELECT u.email FROM coach_assignments a JOIN users u ON u.id = a.coach_id WHERE a.member_id = ? AND a.status = 'active'", [noShareId]);
  assert.ok(coachRow, 'the non-sharing demo member has a coach');
  const m = client(h.app), coach = client(h.app);
  await m.login(DEMO.memberNoShare, DEMO_PASSWORDS.member, 'member');
  assert.equal((await m.post('/api/me/progress', { metric: 'weight_kg', value: 71.5 })).status, 201);
  await coach.login(coachRow!.email, DEMO_PASSWORDS.coach, 'dashboard');
  const d = await coach.get(`/api/coach/clients/${noShareId}`);
  assert.equal(d.status, 200, JSON.stringify(d.json).slice(0, 200));
  assert.equal(d.json.healthShared, false);
  const progress = d.json.progress as { metrics: unknown[]; withheld?: boolean; tasks: unknown };
  assert.deepEqual(progress.metrics, [], 'no measurement series');
  assert.equal(progress.withheld, true);
  assert.ok(progress.tasks, 'plan and task completion stay: the coach authored them');
  assert.deepEqual(d.json.recentProgress, [], 'no progress log');
  assert.equal((d.json.member as { wellnessScore: unknown }).wellnessScore, null);
  assert.equal(((d.json.profile as { profile: { wellnessScore: unknown } }).profile).wellnessScore, null);
  assert.doesNotMatch(JSON.stringify(d.json), /71\.5/, 'the value appears nowhere in the record');
  // a sharing client's record still carries the series
  const sharing = client(h.app);
  await sharing.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const memberId = userId(h.ctx, DEMO.member);
  const s = await sharing.get(`/api/coach/clients/${memberId}`);
  assert.equal(s.json.healthShared, true);
  assert.ok((s.json.progress as { metrics: unknown[] }).metrics.length > 0, 'metrics are present with sharing on');
});

test('coach invitations: closing an invited coach withdraws the invitation; the link neither previews nor activates', async () => {
  const admin = client(h.app), anon = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const inv = await admin.post('/api/admin/coaches/invite', { email: 'withdrawn.coach@demo.bioptime.test', displayName: 'Withdrawn Coach' });
  assert.equal(inv.status, 201, JSON.stringify(inv.json));
  const token = inv.json.token as string;
  assert.equal((await anon.post('/api/auth/invitations/preview', { token })).status, 200, 'the link works while the account is invited');
  const id = userId(h.ctx, 'withdrawn.coach@demo.bioptime.test');
  assert.equal((await admin.patch(`/api/admin/coaches/${id}/state`, { state: 'closed', reason: 'test: invitation withdrawn' })).status, 200);
  assert.equal((await anon.post('/api/auth/invitations/preview', { token })).json.error?.code, 'INVITATION_INVALID');
  const acc = await anon.post('/api/auth/invitations/accept', { token, password: 'A-long-demo-password-1', acceptPolicies: true, policiesVersion: '2026-10-17', profile: { displayName: 'Withdrawn Coach' } });
  assert.equal(acc.json.error?.code, 'INVITATION_INVALID');
  assert.equal(h.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [id])!.state, 'closed', 'the closed account stays closed');
  assert.equal(h.db.get<{ status: string }>("SELECT status FROM coach_invitations WHERE email = 'withdrawn.coach@demo.bioptime.test'")!.status, 'revoked');
  assert.equal((await anon.get('/api/me')).status, 401, 'no session was opened');
});

test('nothing goes on sale at ₹0: create, revise and checkout refuse it, not only publish', async () => {
  const owner = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  const created = await owner.post('/api/admin/packages', { slug: 'zero-on-sale', name: 'Zero On Sale', kind: 'package', durationMonths: 1, durationLabel: '1 month', consultations: 1, bloodworkEntitlements: 0, priceInr: 0, coaching: 'standard', forSale: true, reason: 'test: must be refused' });
  assert.equal(detail(created), 'NO_PRICE');
  const starter = ((await owner.get('/api/admin/packages')).json.items as Array<{ id: string; slug: string }>).find((p) => p.slug === 'starter')!;
  assert.equal(detail(await owner.patch(`/api/admin/packages/${starter.id}`, { priceInr: 0, reason: 'test: must be refused' })), 'NO_PRICE', 'a package on sale cannot be revised to ₹0');
  assert.ok(((await owner.get('/api/admin/packages')).json.items as Array<{ slug: string; version: { priceInr: number } }>).find((p) => p.slug === 'starter')!.version.priceInr > 0, 'the price is unchanged');
});

test('assignments: only member accounts become a coach’s client', async () => {
  const admin = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const coachId = userId(h.ctx, DEMO.coach);
  for (const email of [DEMO.owner, DEMO.admin, DEMO.coach2]) {
    const r = await admin.post('/api/admin/assignments', { memberId: userId(h.ctx, email), coachId, reason: 'test: must be refused' });
    assert.equal(r.status, 404, `${email} is not a member`);
  }
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM coach_assignments WHERE member_id = ?", [userId(h.ctx, DEMO.owner)])!.n, 0);
});

test('the member and coach role check runs after the permission: a caller without the permission learns nothing about an id', async () => {
  const owner = client(h.app), admin = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const adminId = userId(h.ctx, DEMO.admin);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.manage', granted: false, reason: 'test: narrow' })).status, 200);
  try {
    for (const id of [userId(h.ctx, DEMO.owner), userId(h.ctx, DEMO.coach), userId(h.ctx, DEMO.member), 'usr_does_not_exist']) {
      const r = await admin.get(`/api/admin/members/${id}`);
      assert.equal(r.json.error?.code, 'PERMISSION_DENIED', `the same answer for ${id}`);
    }
  } finally {
    await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.manage', granted: true, reason: 'test: restore' });
  }
  assert.equal((await admin.get(`/api/admin/members/${userId(h.ctx, DEMO.owner)}`)).status, 404, 'with the permission an owner id is not a member');
});

test('sign-in tokens stay out of logs and URLs; a missing portal asset is a 404, not the app', async () => {
  const { redactTokens } = await import('../../src/http/app.js');
  assert.equal(redactTokens('/login/client/activate?token=abc123&x=1'), '/login/client/activate?token=[redacted]&x=1');
  assert.equal(redactTokens('/invite?Token=abc#frag'), '/invite?Token=[redacted]#frag');
  assert.equal(redactTokens('/about'), '/about');
  const c = client(h.app);
  assert.equal((await c.get('/portal/assets/index-OLDHASH.js')).status, 404);
});

test('reports no coach can review: an administrator releases them with a note and a reason; a coach-reviewable report stays with the coach', async () => {
  const admin = client(h.app), m = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const noShareId = userId(h.ctx, DEMO.memberNoShare);
  // a delivered, unreleased report for the member who keeps coach sharing off
  const now = new Date().toISOString();
  const testId = h.db.get<{ id: string }>('SELECT id FROM bloodwork_tests LIMIT 1')!.id;
  const booking = { id: 'bkg_review_round3' };
  h.db.insert('bloodwork_bookings', { id: booking.id, reference: 'LAB-R3-001', member_id: noShareId, test_id: testId, status: 'results_ready', slot_at: now, pincode: '600028', address: 'Demo address', city: 'Chennai', state: 'Tamil Nadu', created_at: now, updated_at: now });
  const reportId = 'rpt_review_round3';
  h.db.insert('report_metadata', { id: reportId, booking_id: booking.id, member_id: noShareId, vendor_link: 'standin://report', storage_path: null, delivered_at: new Date().toISOString(), released_at: null, reviewed_at: null, reviewed_by: null, coach_note: null, flagged: '[]', markers: null, values_status: 'pending', created_at: new Date().toISOString() });
  const list = (await admin.get('/api/admin/reports?unreviewed=1')).json.items as Array<{ id: string; coachCanReview: boolean }>;
  assert.equal(list.find((r) => r.id === reportId)?.coachCanReview, false);
  await m.login(DEMO.memberNoShare, DEMO_PASSWORDS.member, 'member');
  assert.equal((await m.get(`/api/reports/${reportId}`)).json.error?.code, 'NOT_RELEASED', 'the member waits for a review');
  assert.equal((await admin.post(`/api/admin/reports/${reportId}/release`, { note: 'Reviewed by the team.', reason: '' })).status, 400, 'a reason is required');
  const rel = await admin.post(`/api/admin/reports/${reportId}/release`, { note: 'Reviewed by the Bioptime team; your values are explained below.', reason: 'test: member keeps sharing off' });
  assert.equal(rel.status, 200, JSON.stringify(rel.json).slice(0, 300));
  assert.equal((await m.get(`/api/reports/${reportId}`)).status, 200, 'the member can now open it');
  assert.equal(detail(await admin.post(`/api/admin/reports/${reportId}/release`, { note: 'again', reason: 'test: twice' })), 'ALREADY_RELEASED');
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'report.released_without_coach' AND target_id = ? AND reason = 'test: member keeps sharing off'", [reportId]));
  // a sharing member with an active coach: the coach reviews, the administrator may not
  const sharingId = userId(h.ctx, DEMO.member);
  const b2 = h.db.get<{ id: string }>('SELECT id FROM bloodwork_bookings WHERE member_id = ? LIMIT 1', [sharingId]);
  assert.ok(b2);
  h.db.insert('report_metadata', { id: 'rpt_review_round3_b', booking_id: b2!.id, member_id: sharingId, vendor_link: 'standin://report', storage_path: null, delivered_at: new Date().toISOString(), released_at: null, reviewed_at: null, reviewed_by: null, coach_note: null, flagged: '[]', markers: null, values_status: 'pending', created_at: new Date().toISOString() });
  assert.equal(detail(await admin.post('/api/admin/reports/rpt_review_round3_b/release', { note: 'Should not happen.', reason: 'test: coach reviews' })), 'COACH_REVIEWS');
});

test('outbox: an administrator without members.view_restricted sees no phone number on SMS rows and cannot find rows by one', async () => {
  const owner = client(h.app), admin = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  h.db.insert('outbox_messages', { id: 'obx_review_r3', channel: 'sms', to_address: '+919700001234', subject: null, body: 'test message', notification_id: null, status: 'logged', created_at: new Date().toISOString() });
  const adminId = userId(h.ctx, DEMO.admin);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.view_restricted', granted: false, reason: 'test: narrow' })).status, 200);
  try {
    const all = await admin.get('/api/admin/outbox');
    assert.equal(all.status, 200);
    assert.equal((all.json.items as Array<{ id: string; to_address: string }>).find((r) => r.id === 'obx_review_r3')?.to_address, 'restricted');
    assert.doesNotMatch(JSON.stringify(all.json), /\+919700001234/);
    assert.deepEqual((await admin.get('/api/admin/outbox?to=%2B919700001234')).json.items, [], 'no lookup by phone number');
    assert.equal(((await owner.get('/api/admin/outbox?to=%2B919700001234')).json.items as unknown[]).length, 1, 'the owner can');
  } finally {
    await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.view_restricted', granted: true, reason: 'test: restore' });
  }
});

/* ---------- round 4: gaps found by the verification of the round-3 fixes ---------- */

test('website fallback: a raw request line cannot climb out of the site folder (\'#\' and %2E%2E), and only real site pages are served', async () => {
  const net = await import('node:net');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-climb-'));
  const dir = path.join(base, 'site');
  fs.mkdirSync(path.join(dir, 'blog'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Site</title>');
  fs.writeFileSync(path.join(dir, '404.html'), '<!doctype html><title>Missing</title>');
  fs.writeFileSync(path.join(dir, 'blog.html'), '<!doctype html><title>Blog index</title>');
  fs.writeFileSync(path.join(dir, '.assetsignore'), 'docs/\n');
  fs.writeFileSync(path.join(base, 'secret.html'), 'OUTSIDE SECRET');
  fs.writeFileSync(path.join(base, 'docs.html'), 'OUTSIDE DOCS');
  const site = await makeApp({ seed: false, env: { WEBSITE_DIR: dir } });
  try {
    await site.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (site.app.server.address() as { port: number }).port;
    const raw = (target: string, method = 'GET') => new Promise<string>((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => s.write(`${method} ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
      let out = ''; s.on('data', (d) => { out += d.toString('latin1'); }); s.on('end', () => resolve(out)); s.on('error', reject);
    });
    for (const target of ['/x#/../../secret', '/x#/../secret', '/%2E%2E/docs', '/%2e%2e/secret', '/blog/..%2F..%2Fsecret', '/x%23/../../secret', '/..%2Fsecret']) {
      for (const method of ['GET', 'HEAD']) {
        const res = await raw(target, method);
        assert.doesNotMatch(res, /OUTSIDE/, `${method} ${target} serves nothing outside the site`);
        assert.doesNotMatch(res.split('\r\n')[0]!, / 200 /, `${method} ${target} is not a 200`);
      }
    }
    assert.match(await raw('/blog'), /Blog index/, 'the real sibling page still works');
  } finally {
    await site.app.close(); site.db.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('member search: a caller cannot switch phone search back on through the query string', async () => {
  const owner = client(h.app), admin = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const adminId = userId(h.ctx, DEMO.admin), memberId = userId(h.ctx, DEMO.member);
  const phone = h.db.get<{ phone: string }>('SELECT phone FROM users WHERE id = ?', [memberId])!.phone;
  const q = encodeURIComponent(phone.slice(-7));
  assert.ok(((await owner.get(`/api/admin/members?q=${q}`)).json.items as Array<{ id: string }>).some((m) => m.id === memberId), 'the check can fail: the owner finds the member by phone');
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.view_restricted', granted: false, reason: 'test: narrow' })).status, 200);
  try {
    for (const extra of ['', '&includePhone=1', '&includePhone=true', '&includePhone=0', '&limit=5000']) {
      const r = await admin.get(`/api/admin/members?q=${q}${extra}`);
      assert.ok(!(r.json.items as Array<{ id: string }> | undefined ?? []).some((m) => m.id === memberId), `no phone match with ${extra || 'no extra parameter'}`);
    }
  } finally {
    await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.view_restricted', granted: true, reason: 'test: restore' });
  }
});

test('bespoke requests: a public form never selects or reveals an account by email; a proposal needs at least ₹1', async () => {
  const anon = client(h.app), admin = client(h.app), m = client(h.app);
  const r = await anon.post('/api/custom-plans/requests', { name: 'Someone Else', email: DEMO.member, goals: 'A plan for twelve weeks of strength work', duration: '3 months' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json).sort(), ['id', 'received', 'reference'], 'only the reference comes back to a visitor');
  assert.equal(h.db.get<{ member_id: string | null }>('SELECT member_id FROM custom_plan_requests WHERE id = ?', [r.json.id as string])!.member_id, null, 'no account was linked by the typed email');
  await m.login(DEMO.member, DEMO_PASSWORDS.member, 'member');
  assert.ok(!((await m.get('/api/me/custom-plans')).json.items as Array<{ id: string }>).some((x) => x.id === r.json.id), 'the member does not see a request someone else made in their name');
  const ownerTry = await anon.post('/api/custom-plans/requests', { name: 'Probe', email: DEMO.owner, goals: 'Probe for an account name', duration: '1 month' });
  assert.doesNotMatch(JSON.stringify(ownerTry.json), /owner|usr_/i, 'no account name or id leaks');
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const mine = await m.post('/api/me/custom-plans', { goals: 'Eight weeks of mobility with one test', duration: '2 months' });
  const id = mine.json.id as string;
  const move = (to: string, extra: Record<string, unknown> = {}) => admin.post(`/api/admin/custom-plans/${id}/transition`, { to, ...extra });
  assert.equal((await move('under_review')).status, 200);
  assert.equal((await move('scoping')).status, 200);
  assert.equal((await move('awaiting_internal_approval', { proposal: { durationMonths: 2, durationLabel: '2 months', consultations: 2, bloodworkEntitlements: 1, priceInr: 0.004 }, approval: 'Approved at a fraction of a rupee' })).status, 200);
  assert.equal(detail(await move('proposal_sent')), 'PROPOSAL_INCOMPLETE', 'a price that rounds to ₹0 is not sent');
});

test('prices below ₹1 never go on sale, and checkout refuses a zero price written behind the API’s back', async () => {
  const owner = client(h.app), m = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  assert.equal(detail(await owner.post('/api/admin/packages', { slug: 'sub-paise', name: 'Sub Paise', kind: 'package', durationMonths: 1, durationLabel: '1 month', consultations: 1, bloodworkEntitlements: 0, priceInr: 0.004, coaching: 'standard', forSale: true, reason: 'test' })), 'NO_PRICE');
  const testId = h.db.get<{ id: string }>('SELECT id FROM bloodwork_tests LIMIT 1')!.id;
  assert.equal((await owner.patch(`/api/admin/bloodwork/tests/${testId}`, { priceInr: 0, reason: 'test: zero' })).status, 400, 'a test price is at least ₹1');
  const created = await owner.post('/api/admin/packages', { slug: 'zero-behind', name: 'Zero Behind', kind: 'package', durationMonths: 1, durationLabel: '1 month', consultations: 1, bloodworkEntitlements: 0, priceInr: 999, coaching: 'standard', forSale: true, reason: 'test' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  h.db.run('UPDATE package_versions SET price_paise = 0, for_sale = 1 WHERE package_id = ?', [created.json.id as string]);
  await m.login(DEMO.memberNoCoach, DEMO_PASSWORDS.member, 'member');
  const co = await m.post('/api/me/checkout', { packageId: created.json.id, idempotencyKey: 'zero-behind-1' });
  assert.equal(detail(co), 'PRICE_NOT_SET', JSON.stringify(co.json).slice(0, 200));
});

test('coach list and home honour the city switch; wellness scores follow the sharing consent', async () => {
  const owner = client(h.app), coach = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const hasCity = (v: unknown): boolean => JSON.stringify(v).includes('"city"');
  assert.ok(hasCity((await coach.get('/api/coach/clients')).json), 'the list carries city while it is on');
  assert.equal((await owner.patch('/api/admin/settings', { key: 'coach_field_policy', value: { city: false }, reason: 'test: close city' })).status, 200);
  try {
    assert.equal(hasCity((await coach.get('/api/coach/clients')).json), false, 'not in the list');
    const home = (await coach.get('/api/coach/home')).json;
    assert.ok((home.clients as unknown[]).length > 0);
    assert.equal(hasCity(home.clients), false, 'not on the home screen’s client rows (the coach’s own city stays)');
  } finally {
    await owner.patch('/api/admin/settings', { key: 'coach_field_policy', value: { city: true, state: true }, reason: 'test: restore' });
  }
  const noShareId = userId(h.ctx, DEMO.memberNoShare), sharingId = userId(h.ctx, DEMO.member);
  h.db.run('UPDATE member_profiles SET wellness_score = 77 WHERE user_id = ?', [noShareId]);
  h.db.run('UPDATE member_profiles SET wellness_score = 66 WHERE user_id = ?', [sharingId]);
  const noShareCoach = h.db.get<{ email: string }>("SELECT u.email FROM coach_assignments a JOIN users u ON u.id = a.coach_id WHERE a.member_id = ? AND a.status = 'active'", [noShareId])!.email;
  const c2 = client(h.app);
  await c2.login(noShareCoach, DEMO_PASSWORDS.coach, 'dashboard');
  const hidden = await c2.get(`/api/coach/clients/${noShareId}`);
  assert.equal((hidden.json.member as { wellnessScore: unknown }).wellnessScore, null);
  assert.doesNotMatch(JSON.stringify(hidden.json), /"wellnessScore":77/, 'the score is withheld everywhere in the record');
  assert.equal(((await coach.get(`/api/coach/clients/${sharingId}`)).json.member as { wellnessScore: unknown }).wellnessScore, 66, 'and shown with sharing on');
});

test('coach invitations: a pending invitation for an account that is no longer invited neither previews, activates nor lists', async () => {
  const admin = client(h.app), anon = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const inv = await admin.post('/api/admin/coaches/invite', { email: 'stale.invite@demo.bioptime.test', displayName: 'Stale Invite' });
  assert.equal(inv.status, 201);
  const token = inv.json.token as string;
  h.db.run("UPDATE users SET state = 'suspended' WHERE email = 'stale.invite@demo.bioptime.test'"); // the invitation row stays pending
  assert.equal(h.db.get<{ status: string }>("SELECT status FROM coach_invitations WHERE email = 'stale.invite@demo.bioptime.test'")!.status, 'pending');
  assert.equal((await anon.post('/api/auth/invitations/preview', { token })).json.error?.code, 'INVITATION_INVALID');
  const acc = await anon.post('/api/auth/invitations/accept', { token, password: 'A-long-demo-password-1', acceptPolicies: true, policiesVersion: '2026-10-17', profile: { displayName: 'Stale Invite' } });
  assert.equal(acc.json.error?.code, 'INVITATION_INVALID');
  assert.equal(h.db.get<{ state: string }>("SELECT state FROM users WHERE email = 'stale.invite@demo.bioptime.test'")!.state, 'suspended');
  const list = (await admin.get('/api/admin/coaches')).json.invitations as Array<{ email: string }>;
  assert.ok(!list.some((i) => i.email === 'stale.invite@demo.bioptime.test'), 'not listed as pending');
});

test('request logs carry no sign-in token', async () => {
  const { loadConfig } = await import('../../src/config.js');
  const { Db } = await import('../../src/db/db.js');
  const { createServices } = await import('../../src/services.js');
  const { buildApp } = await import('../../src/http/app.js');
  const config = loadConfig({ BIOPTIME_MODE: 'demo', DATABASE_PATH: ':memory:', LABSTACK_STANDIN_SPEED: 'manual', JOBS_ENABLED: 'false', RATE_LIMITS: 'off', WEBSITE_DIR: '/nonexistent-website', DASHBOARD_DIR: '/nonexistent-dashboard' });
  const db = new Db(':memory:'); db.migrate();
  const lines: string[] = [];
  const app = await buildApp({ config, db, services: createServices(config, db), logger: true, logStream: { write: (s: string) => { lines.push(s); } } });
  try {
    await app.ready();
    await app.inject({ method: 'GET', url: '/login/client/activate?token=SECRET-TOKEN-123&x=1' });
    await app.inject({ method: 'GET', url: '/invite?code=SECRET-CODE-456' });
    const log = lines.join('');
    assert.match(log, /\[redacted\]/, 'the request was logged with the token redacted');
    assert.doesNotMatch(log, /SECRET-TOKEN-123|SECRET-CODE-456/);
  } finally { await app.close(); db.close(); }
});

test('a report delivered for a member who keeps sharing off goes to the Bioptime team, and the member is told so', async () => {
  const row = h.db.get<{ member_id: string; email: string; coach_id: string }>("SELECT e.member_id, u.email, a.coach_id FROM entitlements e JOIN users u ON u.id = e.member_id JOIN coach_assignments a ON a.member_id = e.member_id AND a.status = 'active' WHERE e.service_type = 'bloodwork' AND e.status = 'available' AND e.quantity - e.used_qty - e.reserved_qty > 0 AND u.role = 'member' LIMIT 1");
  assert.ok(row, 'a demo member with an active coach and a blood test left');
  const m = client(h.app);
  await m.login(row!.email, DEMO_PASSWORDS.member, 'member');
  assert.equal((await m.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
  try {
    let d = new Date(Date.now() + 4 * 86400000);
    while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() + 86400000);
    const date = d.toISOString().slice(0, 10);
    const test = ((await m.get('/api/me/bloodwork/tests')).json.items as Array<{ id: string; name: string }>).find((t) => t.name.startsWith('Lipid'))!;
    const slot = ((await m.get(`/api/me/bloodwork/slots?date=${date}&pincode=560034`)).json.slots as Array<{ startAt: string; labId: string }>)[0]!;
    const booking = await m.post('/api/me/bloodwork/bookings', { testId: test.id, slotAt: slot.startAt, labId: slot.labId, pincode: '560034', address: '12 Demo Street', city: 'Bengaluru', state: 'Karnataka', idempotencyKey: 'r4-noshare-booking' });
    assert.equal(booking.status, 201, JSON.stringify(booking.json).slice(0, 200));
    const vendorOrderId = booking.json.vendorOrderId as string;
    const standin = h.services.standin!;
    while (await standin.step(vendorOrderId)) { /* walk to REPORT_DELIVERED */ }
    const report = h.db.get<{ id: string }>('SELECT id FROM report_metadata WHERE booking_id = ?', [booking.json.id as string]);
    assert.ok(report, 'the report was delivered');
    assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND title = 'Report to review' AND data LIKE ?", [row!.coach_id, `%${report!.id}%`])!.n, 0, 'the coach, who cannot open it, is not asked to review it');
    assert.ok(h.db.get("SELECT 1 FROM support_tasks WHERE kind = 'missing_report_notification' AND ref_id = ?", [report!.id]), 'an operations task asks the team to release it');
    const ready = h.db.get<{ body: string }>("SELECT body FROM notifications WHERE user_id = ? AND title = 'Results received' ORDER BY created_at DESC LIMIT 1", [row!.member_id]);
    assert.match(ready!.body, /Bioptime team/, 'the member is told the team is reviewing');
    const waiting = await m.get(`/api/reports/${report!.id}`);
    assert.match(String(waiting.json.error?.message), /Bioptime team/);
    const admin = client(h.app);
    await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
    assert.equal((await admin.post(`/api/admin/reports/${report!.id}/release`, { note: 'Reviewed by the Bioptime team.', reason: 'test: sharing off' })).status, 200);
    const opened = await m.get(`/api/reports/${report!.id}`);
    assert.equal(opened.json.reviewerKind, 'team');
    const ms = (await m.get('/api/me/milestones')).json.items as Array<{ key: string; detail: string }>;
    const firstId = h.db.get<{ id: string }>('SELECT id FROM report_metadata WHERE member_id = ? AND released_at IS NOT NULL ORDER BY released_at LIMIT 1', [row!.member_id])!.id;
    const first = ms.find((x) => x.key === 'report');
    assert.ok(first, 'the milestone exists');
    if (firstId === report!.id) assert.match(first!.detail, /Bioptime team/, 'the milestone names who reviewed it');
  } finally {
    await m.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true });
  }
});

/* ---------- round 5: gaps found by the verification of the round-4 fixes ---------- */

const upsertSetting = (key: string, value: unknown) => h.db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value), new Date().toISOString()]);

test('consultations: the open-request limit and the reminder window follow the administrator’s settings; no meeting link is promised', async () => {
  const appointments = await import('../../src/domain/appointments.js');
  // a fixed clock far from the seeded appointments (a Wednesday, 10:00 IST), so nothing else is open or due around it
  const NOW = '2031-03-05T04:30:00.000Z';
  const later = (hours: number) => new Date(Date.parse(NOW) + hours * 3600000).toISOString();
  const fctx = { ...h.ctx, now: () => NOW } as typeof h.ctx;
  const memberId = userId(h.ctx, DEMO.member2);
  const mctx = { ...fctx, actor: { id: memberId, role: 'member', email: DEMO.member2, name: 'Vikram' } } as unknown as typeof h.ctx;
  const coachId = h.db.get<{ coach_id: string }>("SELECT coach_id FROM coach_assignments WHERE member_id = ? AND status = 'active'", [memberId])!.coach_id;
  // the open-request limit: one open consultation already, the limit set to one, a second request is refused
  const stamp = new Date().toISOString();
  h.db.insert('appointments', { id: 'apt_r5_limit', member_id: memberId, coach_id: coachId, programme_id: null, kind: 'consultation', status: 'requested', start_at: later(24 * 5), end_at: later(24 * 5 + 0.5), timezone: 'Asia/Kolkata', meeting_link: null, note: null, member_note: null, entitlement_tx_id: null, created_by: memberId, created_at: stamp, updated_at: stamp });
  const open = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM appointments WHERE member_id = ? AND status IN ('requested','scheduled') AND start_at > ?", [memberId, NOW])!.n;
  assert.equal(open, 1, 'exactly one open consultation after the fixed clock');
  upsertSetting('max_open_appointments', 1);
  try {
    const slot = appointments.slotsFor(fctx, coachId, later(24 * 7).slice(0, 10))[0]?.startAt ?? later(24 * 7);
    assert.throws(() => appointments.book(mctx, { memberId, startAt: slot, kind: 'consultation' }), (e: unknown) => JSON.stringify(e).includes('TOO_MANY_OPEN'));
  } finally {
    upsertSetting('max_open_appointments', 2);
    h.db.run("DELETE FROM appointments WHERE id = 'apt_r5_limit'");
  }
  // reminders: 48 hours ahead when the setting says 48, not at 24. Three consultations about 48 hours away (no link, the
  // old placeholder, a link the coach typed) and one 24 hours away, all on the fixed clock
  const ids = { none: 'apt_r5_none', placeholder: 'apt_r5_placeholder', typed: 'apt_r5_typed', day: 'apt_r5_24h' };
  const typedLink = 'https://video.example.org/j/consult-r5?pwd=s3cret';
  const add = (id: string, hours: number, link: string | null) => h.db.insert('appointments', { id, member_id: memberId, coach_id: coachId, programme_id: null, kind: 'consultation', status: 'scheduled', start_at: later(hours), end_at: later(hours + 0.5), timezone: 'Asia/Kolkata', meeting_link: link, note: null, member_note: null, entitlement_tx_id: null, created_by: coachId, created_at: stamp, updated_at: stamp });
  add(ids.none, 48, null);
  add(ids.placeholder, 48.25, `https://meet.bioptime.example/${ids.placeholder}`);
  add(ids.typed, 47.5, typedLink);
  add(ids.day, 24, null);
  upsertSetting('reminder_hours_before', 48);
  try {
    assert.equal(appointments.sendReminders(fctx), 3, 'the three consultations 47 to 49 hours away, nothing else');
    for (const id of [ids.none, ids.placeholder, ids.typed]) assert.equal(h.db.get<{ r: string | null }>('SELECT reminder_sent_at r FROM appointments WHERE id = ?', [id])!.r, NOW, 'reminded 48 hours ahead');
    assert.equal(h.db.get<{ r: string | null }>('SELECT reminder_sent_at r FROM appointments WHERE id = ?', [ids.day])!.r, null, 'not at 24 hours');
    // each reminder is read by its appointment and its recipient (the member's and the coach's share a timestamp)
    const reminder = (appointmentId: string, recipient: string) => h.db.all<{ title: string; body: string }>("SELECT title, body FROM notifications WHERE category = 'appointment_reminder' AND user_id = ? AND json_extract(data, '$.appointmentId') = ?", [recipient, appointmentId]);
    const ist = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(11, 16);
    // the India day in words and the India time, as the portal writes them: "Fri 7 Mar 2031 at 10:00 IST" (portal-13)
    const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso)).replace(',', '');
    const when = (iso: string) => `${day(iso)} at ${ist(iso)} IST.`;
    for (const [id, hours] of [[ids.none, 48], [ids.placeholder, 48.25]] as const) {
      const n = reminder(id, memberId);
      assert.equal(n.length, 1, 'one reminder for the member');
      assert.equal(n[0]!.title, 'Consultation coming up', 'a 48-hour reminder does not say tomorrow');
      assert.equal(n[0]!.body, `${when(later(hours))} Your coach will share how to join.`, 'no link, or only the old placeholder: no link is promised');
      assert.doesNotMatch(n[0]!.body, /link|https?:/i);
    }
    const t = reminder(ids.typed, memberId);
    assert.equal(t.length, 1);
    assert.equal(t[0]!.body, `${when(later(47.5))} Your coach shared how to join: open Appointments.`, 'a link the coach typed is pointed to, never copied into the message');
    assert.doesNotMatch(t[0]!.body, /link|https?:|video\.example|s3cret/i);
    const c = reminder(ids.none, coachId);
    assert.equal(c.length, 1, 'one reminder for the coach');
    assert.equal(c[0]!.body, when(later(48)), 'the coach’s reminder carries the time only');
    assert.deepEqual(reminder(ids.day, memberId), [], 'nothing for the consultation 24 hours away');
  } finally {
    upsertSetting('reminder_hours_before', 24);
    for (const id of Object.values(ids)) {
      h.db.run("DELETE FROM notifications WHERE json_extract(data, '$.appointmentId') = ?", [id]);
      h.db.run('DELETE FROM appointments WHERE id = ?', [id]);
    }
  }
});

test('reports: a released note is never overwritten, and a coach who is away cannot review (the team releases instead)', async () => {
  const bloodwork = await import('../../src/domain/bloodwork.js');
  const admin = client(h.app), coach = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const memberId = userId(h.ctx, DEMO.member);
  const coachRow = h.db.get<{ id: string; email: string }>("SELECT u.id, u.email FROM coach_assignments a JOIN users u ON u.id = a.coach_id WHERE a.member_id = ? AND a.status = 'active'", [memberId])!;
  await coach.login(coachRow.email, DEMO_PASSWORDS.coach, 'dashboard');
  const now = new Date().toISOString();
  const testId = h.db.get<{ id: string }>('SELECT id FROM bloodwork_tests LIMIT 1')!.id;
  h.db.insert('bloodwork_bookings', { id: 'bkg_r5_away', reference: 'LAB-R5-001', member_id: memberId, test_id: testId, status: 'results_ready', slot_at: now, pincode: '560001', address: 'Demo address', city: 'Bengaluru', state: 'Karnataka', created_at: now, updated_at: now });
  h.db.insert('report_metadata', { id: 'rpt_r5_away', booking_id: 'bkg_r5_away', member_id: memberId, vendor_link: 'standin://report', storage_path: null, delivered_at: now, released_at: null, reviewed_at: null, reviewed_by: null, coach_note: null, flagged: '[]', markers: null, values_status: 'pending', created_at: now });
  assert.equal((await admin.post(`/api/admin/coaches/${coachRow.id}/availability`, { available: false, reason: 'test: away' })).status, 200);
  try {
    const r = await coach.post('/api/coach/reports/rpt_r5_away/review', { coachNote: 'A note from the away coach.' });
    assert.equal(r.json.error?.code, 'COACH_CANNOT_REVIEW', JSON.stringify(r.json).slice(0, 200));
    assert.equal((await admin.post('/api/admin/reports/rpt_r5_away/release', { note: 'Reviewed by the team while the coach is away.', reason: 'test: coach away' })).status, 200);
  } finally {
    await admin.post(`/api/admin/coaches/${coachRow.id}/availability`, { available: true, reason: 'test: back' });
  }
  const cctx = { ...h.ctx, actor: { id: coachRow.id, role: 'coach', email: coachRow.email, name: 'Coach' } } as unknown as typeof h.ctx;
  assert.throws(() => bloodwork.reviewReport(cctx, 'rpt_r5_away', { coachNote: 'Overwrite attempt' }), (e: unknown) => JSON.stringify(e).includes('ALREADY_RELEASED'));
  assert.match(h.db.get<{ n: string }>('SELECT coach_note n FROM report_metadata WHERE id = ?', ['rpt_r5_away'])!.n, /team while the coach is away/);
  const task = h.db.get<{ detail: string }>("SELECT detail FROM support_tasks WHERE kind = 'missing_report_notification' ORDER BY created_at DESC LIMIT 1");
  if (task) assert.doesNotMatch(task.detail, /undefined/);
});

test('bespoke plans: a sent proposal’s terms are locked, a decline cancels the open order so it cannot activate, and unlinked requests get no proposal', async () => {
  const admin = client(h.app), m = client(h.app), anon = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  await m.login(DEMO.member2, DEMO_PASSWORDS.member, 'member');
  const id = (await m.post('/api/me/custom-plans', { goals: 'Four months of strength with one test', duration: '4 months' })).json.id as string;
  const move = (rid: string, to: string, extra: Record<string, unknown> = {}) => admin.post(`/api/admin/custom-plans/${rid}/transition`, { to, ...extra });
  const terms = { durationMonths: 4, durationLabel: '4 months', consultations: 2, bloodworkEntitlements: 1, priceInr: 5000 };
  for (const [to, extra] of [['under_review', {}], ['scoping', {}], ['awaiting_internal_approval', { proposal: terms, approval: 'Approved' }], ['proposal_sent', {}]] as Array<[string, Record<string, unknown>]>) assert.equal((await move(id, to, extra)).status, 200, to);
  const acc = await m.post(`/api/me/custom-plans/${id}/accept`);
  assert.equal(acc.status, 200);
  const orderId = (acc.json.order as { id: string }).id;
  assert.equal(detail(await move(id, 'declined', { proposal: { ...terms, consultations: 40, bloodworkEntitlements: 20, durationMonths: 24 } })), 'PROPOSAL_LOCKED', 'terms cannot change after sending');
  assert.equal((await move(id, 'declined', { proposal: terms, note: 'test: withdrawn' })).status, 200, 'unchanged terms (as the portal sends them) are fine');
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM orders WHERE id = ?', [orderId])!.status, 'cancelled', 'the open order was cancelled');
  const checkoutId = (acc.json.checkout as { checkoutId: string }).checkoutId;
  await m.post('/api/payments/simulator/complete', { checkoutId, outcome: 'captured' });
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM programmes WHERE custom_plan_id = ?', [id])!.n, 0, 'a declined request never activates');
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM custom_plan_requests WHERE id = ?', [id])!.status, 'declined');
  // a request made without signing in cannot be sent a proposal nobody can accept
  const anonReq = await anon.post('/api/custom-plans/requests', { name: 'A Visitor', email: 'visitor.r5@demo.bioptime.test', goals: 'Twelve weeks of mobility', duration: '3 months' });
  const aid = anonReq.json.id as string;
  for (const [to, extra] of [['under_review', {}], ['scoping', {}], ['awaiting_internal_approval', { proposal: terms, approval: 'Approved' }]] as Array<[string, Record<string, unknown>]>) assert.equal((await move(aid, to, extra)).status, 200, to);
  assert.equal(detail(await move(aid, 'proposal_sent')), 'NOT_LINKED');
});

test('catalogue and lab events: an omitted price is kept, a missed collection opens a task and tells the member the team will call, and a coach list hides unshared check-ins', async () => {
  const owner = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  const testId = h.db.get<{ id: string }>('SELECT id FROM bloodwork_tests WHERE hidden = 0 LIMIT 1')!.id;
  assert.equal((await owner.patch(`/api/admin/bloodwork/tests/${testId}`, { priceInr: 1500, reason: 'test: price' })).status, 200);
  assert.equal((await owner.patch(`/api/admin/bloodwork/tests/${testId}`, { hidden: false, reason: 'test: visibility only' })).status, 200);
  assert.equal(h.db.get<{ p: number | null }>('SELECT price_paise p FROM bloodwork_tests WHERE id = ?', [testId])!.p, 150000, 'the price survives a visibility-only change');
  // a missed collection
  const bloodwork = await import('../../src/domain/bloodwork.js');
  const memberId = userId(h.ctx, DEMO.member);
  const now = new Date().toISOString();
  h.db.insert('bloodwork_bookings', { id: 'bkg_r5_missed', reference: 'LAB-R5-002', member_id: memberId, test_id: testId, status: 'scheduled', slot_at: now, pincode: '560001', address: 'Demo address', city: 'Bengaluru', state: 'Karnataka', vendor_status: 'PHLEBO_ASSIGNED', created_at: now, updated_at: now });
  bloodwork.applyVendorStatus(h.ctx, 'bkg_r5_missed', 'PHLEBO_NO_SHOW', 'vendor');
  assert.ok(h.db.get("SELECT 1 FROM support_tasks WHERE kind = 'collection_rebook' AND ref_id = 'bkg_r5_missed'"), 'the team is asked to arrange a new visit');
  const n = h.db.get<{ body: string }>("SELECT body FROM notifications WHERE user_id = ? AND title = 'A new visit is needed' ORDER BY created_at DESC LIMIT 1", [memberId]);
  assert.ok(n && /Bioptime team will contact you/.test(n.body) && !/Pick a new slot/.test(n.body), 'no promise of an in-app reschedule');
  // the coach list's last check-in ignores progress entries a non-sharing member keeps to themselves
  const noShareId = userId(h.ctx, DEMO.memberNoShare);
  const coachEmail = h.db.get<{ email: string }>("SELECT u.email FROM coach_assignments a JOIN users u ON u.id = a.coach_id WHERE a.member_id = ? AND a.status = 'active'", [noShareId])!.email;
  const future = new Date(Date.now() + 60000).toISOString();
  h.db.insert('progress_entries', { id: 'pe_r5_private', member_id: noShareId, metric: 'weight_kg', value: 70, unit: 'kg', at: future, source: 'member', created_at: now });
  const c = client(h.app);
  await c.login(coachEmail, DEMO_PASSWORDS.coach, 'dashboard');
  const row = ((await c.get('/api/coach/clients')).json.items as Array<{ id: string; lastCheckInAt: string | null }>).find((x) => x.id === noShareId)!;
  assert.notEqual(row.lastCheckInAt, future, 'the private progress entry does not show as a check-in');
});

test('member bespoke view: no internal approvals, notes, events, scope or draft terms reach the member; an expired proposal is recorded as expired', async () => {
  const admin = client(h.app), m = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  await m.login(DEMO.member, DEMO_PASSWORDS.member, 'member');
  const created = await m.post('/api/me/custom-plans', { goals: 'Five months of strength with two tests', duration: '6 months' });
  assert.equal(created.status, 201);
  const id = created.json.id as string;
  const move = (to: string, extra: Record<string, unknown> = {}) => admin.post(`/api/admin/custom-plans/${id}/transition`, { to, ...extra });
  await move('under_review', { note: 'INTERNAL: price sensitive member' });
  await move('scoping', { scope: { internal: 'margin target 40%' } });
  await move('awaiting_internal_approval', { proposal: { durationMonths: 5, durationLabel: '5 months', consultations: 3, bloodworkEntitlements: 2, priceInr: 9999, notes: 'INTERNAL draft note' }, approval: 'Approved by the owner' });
  const draft = ((await m.get('/api/me/custom-plans')).json.items as Array<Record<string, unknown>>).find((r) => r.id === id)!;
  assert.deepEqual(draft.proposal, {}, 'draft terms stay internal until the proposal is sent');
  for (const k of ['approvals', 'events', 'scope', 'owner_name', 'owner_id', 'approved_hash', 'contact_phone', 'allowedNext']) assert.equal(k in draft, false, `${k} is not sent to the member`);
  assert.doesNotMatch(JSON.stringify(draft), /INTERNAL|margin target|Approved by the owner/);
  assert.equal((await move('proposal_sent')).status, 200);
  const sent = ((await m.get('/api/me/custom-plans')).json.items as Array<{ id: string; proposal: Record<string, unknown> }>).find((r) => r.id === id)!;
  assert.equal(sent.proposal.priceInr, 9999);
  assert.equal('notes' in sent.proposal, false, 'the proposal’s internal note stays internal');
  h.db.run('UPDATE custom_plan_requests SET expires_at = ? WHERE id = ?', [new Date(Date.now() - 60000).toISOString(), id]);
  const acc = await m.post(`/api/me/custom-plans/${id}/accept`);
  assert.equal(detail(acc), 'EXPIRED');
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM custom_plan_requests WHERE id = ?', [id])!.status, 'expired', 'the expiry is recorded, not rolled back');
});
