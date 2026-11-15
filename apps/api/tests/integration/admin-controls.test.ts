/* The administrative controls added for the master build: member invitations and activation, manual entitlement
   adjustments on the ledger, the image library and CMS image blocks, package publish state and enrolment rules, theme
   rollback, the finer permissions (restricted fields, approvals, publishing, LabStack), derived milestones, and the
   laboratory status spelling fix. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, DEMO_MFA_SECRET, userId } from '../helpers.js';
import { totpCode } from '../../src/lib/crypto.js';
import { applyLabStackStatus } from '@bioptime/domain';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const login = (c: ReturnType<typeof client>, email: string, password: string, workspace: string, mfa = false) => c.post('/api/auth/login', { email, password, workspace, ...(mfa ? { mfaCode: totpCode(DEMO_MFA_SECRET) } : {}) });
const detail = (r: { json: { error?: { code: string; details?: unknown } } }) => r.json.error?.code === 'INVALID_STATE' ? (r.json.error.details as { code?: string } | undefined)?.code : r.json.error?.code;

// a 1x1 PNG and a few bytes that are not an image
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('member invitation: an administrator invites, the member activates with a password and the policies, lands in onboarding; the link works once', async () => {
  const admin = client(h.app), anon = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const inv = await admin.post('/api/admin/members/invite', { email: 'invited.member@demo.bioptime.test', name: 'Invited Member', reason: 'test: invite' });
  assert.equal(inv.status, 201, JSON.stringify(inv.json));
  const token = inv.json.token as string;
  assert.ok(token, 'demo mode returns the activation token');
  assert.equal((inv.json.user as { state: string }).state, 'invited');
  assert.equal((await anon.post('/api/auth/login', { email: 'invited.member@demo.bioptime.test', password: 'anything-at-all-1', workspace: 'client' })).status, 401, 'no password yet');
  const preview = await anon.post('/api/auth/invitations/member/preview', { token });
  assert.equal((await anon.get(`/api/auth/invitations/member/${token}`)).status, 404, 'the token never travels in a URL: the GET preview is gone');
  assert.equal(preview.status, 200);
  assert.equal(preview.json.email, 'invited.member@demo.bioptime.test');
  assert.equal((await anon.post('/api/auth/password/reset', { token, password: 'A-long-demo-password-1' })).json.error?.code, 'TOKEN_INVALID', 'an activation link is not a reset link');
  const acc = await anon.post('/api/auth/invitations/member/accept', { token, password: 'A-long-demo-password-1', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  assert.equal((acc.json.user as { state: string }).state, 'onboarding');
  assert.equal((await anon.get('/api/me')).status, 200, 'signed in after activation');
  assert.equal((await client(h.app).post('/api/auth/invitations/member/accept', { token, password: 'A-long-demo-password-2', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' })).json.error?.code, 'TOKEN_USED');
  assert.equal((await admin.post('/api/admin/members/invite', { email: DEMO.member, name: 'Dup', reason: 'test' })).json.error?.code, 'EMAIL_IN_USE');
  const row = h.db.get<{ member_code: string }>('SELECT member_code FROM member_profiles WHERE user_id = ?', [(acc.json.user as { id: string }).id])!;
  assert.match(row.member_code, /^BPM-\d{5}$/);
});

test('entitlement adjustments: a ledger row with actor, reason and idempotency key; never below what is used or held; permission-gated', async () => {
  const owner = client(h.app), admin = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const memberId = userId(h.ctx, DEMO.member);
  const before = await owner.get(`/api/admin/members/${memberId}`);
  const consult = (before.json.entitlements as Array<{ serviceType: string; remaining: number }>).filter((e) => e.serviceType === 'consultation').reduce((s, e) => s + e.remaining, 0);
  assert.equal((await owner.post(`/api/admin/members/${memberId}/entitlements/adjust`, { serviceType: 'consultation', delta: 2, reason: '', idempotencyKey: 'adj-no-reason-1' })).status, 400, 'a reason is required');
  const up = await owner.post(`/api/admin/members/${memberId}/entitlements/adjust`, { serviceType: 'consultation', delta: 2, reason: 'test: goodwill after a missed slot', idempotencyKey: 'adj-up-1' });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal((up.json as { remaining: number }).remaining, consult + 2);
  const again = await owner.post(`/api/admin/members/${memberId}/entitlements/adjust`, { serviceType: 'consultation', delta: 2, reason: 'test: retry', idempotencyKey: 'adj-up-1' });
  assert.equal((again.json as { remaining: number }).remaining, consult + 2, 'the same key is applied once');
  const tooFar = await owner.post(`/api/admin/members/${memberId}/entitlements/adjust`, { serviceType: 'consultation', delta: -50, reason: 'test: too far', idempotencyKey: 'adj-down-big' });
  assert.equal(detail(tooFar), 'ADJUST_TOO_FAR');
  const down = await owner.post(`/api/admin/members/${memberId}/entitlements/adjust`, { serviceType: 'consultation', delta: -1, reason: 'test: correction', idempotencyKey: 'adj-down-1' });
  assert.equal((down.json as { remaining: number }).remaining, consult + 1);
  const after = await owner.get(`/api/admin/members/${memberId}`);
  const adj = (after.json.entitlements as Array<{ id: string; orderId: string | null }>).find((e) => e.orderId === null)!;
  const ledger = await owner.get(`/api/admin/members/${memberId}/entitlements/${adj.id}/transactions`);
  assert.ok((ledger.json.items as Array<{ kind: string; note: string; created_by: string }>).some((t) => t.kind === 'adjust' && t.note.includes('goodwill') && t.created_by === userId(h.ctx, DEMO.owner)));
  const adminId = userId(h.ctx, DEMO.admin);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'entitlements.adjust', granted: false, reason: 'test' })).status, 200);
  assert.equal((await admin.post(`/api/admin/members/${memberId}/entitlements/adjust`, { serviceType: 'consultation', delta: 1, reason: 'test', idempotencyKey: 'adj-denied-1' })).json.error?.code, 'PERMISSION_DENIED');
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'entitlements.adjust', granted: true, reason: 'test: restore' })).status, 200);
  const audit = await owner.get('/api/admin/audit/search?action=entitlement.adjust');
  assert.ok((audit.json.items as unknown[]).length >= 2);
});

test('image library: only real PNG, JPEG or WebP under 3 MB; served immutably by id; a CMS image block must name a library image; in-use images cannot be removed', async () => {
  const admin = client(h.app), anon = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  assert.equal((await admin.post('/api/admin/assets', { filename: 'evil.svg', dataBase64: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64') })).json.error?.code, 'ASSET_TYPE');
  assert.equal((await admin.post('/api/admin/assets', { filename: 'fake.png', dataBase64: Buffer.from('not an image at all').toString('base64') })).json.error?.code, 'ASSET_TYPE', 'checked by content, not by name');
  const up = await admin.post('/api/admin/assets', { filename: 'dot.png', dataBase64: PNG_1x1.toString('base64'), alt: 'A single dot' });
  assert.equal(up.status, 201, JSON.stringify(up.json));
  const asset = up.json as { id: string; url: string; width: number; height: number; mime: string };
  assert.equal(asset.mime, 'image/png'); assert.equal(asset.width, 1); assert.equal(asset.height, 1);
  const same = await admin.post('/api/admin/assets', { filename: 'dot-again.png', dataBase64: PNG_1x1.toString('base64') });
  assert.equal((same.json as { id: string }).id, asset.id, 'the same bytes are one asset');
  const served = await anon.get(asset.url);
  assert.equal(served.status, 200);
  assert.match(String(served.headers['content-type']), /image\/png/);
  assert.match(String(served.headers['cache-control']), /immutable/);
  assert.equal((await anon.get('/api/public/assets/ast_nope')).status, 404);
  assert.equal((await anon.get('/api/public/assets/..%2F..%2Fetc%2Fpasswd')).status, 404);
  assert.equal((await admin.put('/api/admin/content/home.programs.ignite.image', { value: { assetId: 'ast_missing', alt: 'x' } })).json.error?.code, 'CONTENT_ASSET');
  assert.equal((await admin.put('/api/admin/content/home.programs.ignite.image', { value: { assetId: asset.id, alt: 'Technology' } })).status, 200);
  const preview = await admin.get('/api/public/content/preview');
  assert.equal(((preview.json.values as Record<string, { url: string }>)['home.programs.ignite.image']).url, asset.url);
  assert.equal(detail(await admin.del(`/api/admin/assets/${asset.id}?reason=test%3A+remove`)), 'ASSET_IN_USE', 'an image a draft uses cannot be removed');
  const del = await admin.post(`/api/admin/content/home.programs.ignite.image/reset`, { reason: 'test: clear the image' });
  assert.equal(del.status, 200);
  assert.equal((await admin.put('/api/admin/content/home.section.blog.visible', { value: false })).status, 200, 'section visibility is a boolean block');
  assert.equal((await anon.get('/api/admin/assets')).status, 401);
});

test('packages: publish and unpublish without a new version, enrolment rules on the version, a price is needed to publish', async () => {
  const owner = client(h.app), anon = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  const created = await owner.post('/api/admin/packages', { slug: 'trial-7', name: 'Trial week', kind: 'package', description: 'test', durationMonths: 1, durationLabel: '1 week', consultations: 1, bloodworkEntitlements: 0, priceInr: null, coaching: 'standard', forSale: false, includes: [], eligibility: 'invite_only', startPolicy: 'on_first_consultation', graceDays: 7, services: [{ name: 'One consultation' }], reason: 'test: create' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = (created.json as { id: string }).id;
  const v = (created.json as { version: { eligibility: string; startPolicy: string; graceDays: number; services: Array<{ name: string }>; version: number } }).version;
  assert.equal(v.eligibility, 'invite_only'); assert.equal(v.startPolicy, 'on_first_consultation'); assert.equal(v.graceDays, 7); assert.equal(v.services[0]!.name, 'One consultation');
  assert.equal(detail(await owner.post(`/api/admin/packages/${id}/publish`, { reason: 'test' })), 'NO_PRICE');
  const priced = await owner.patch(`/api/admin/packages/${id}`, { priceInr: 999, reason: 'test: price' });
  assert.equal((priced.json as { version: { version: number } }).version.version, 2, 'a price change is a new version');
  const pub = await owner.post(`/api/admin/packages/${id}/publish`, { reason: 'test: publish' });
  assert.equal((pub.json as { version: { forSale: boolean; version: number } }).version.forSale, true);
  assert.equal((pub.json as { version: { version: number } }).version.version, 2, 'publishing does not cut a version');
  assert.ok((((await anon.get('/api/packages')).json.items) as Array<{ id: string }>).some((p) => p.id === id), 'listed on the website once published');
  const unpub = await owner.post(`/api/admin/packages/${id}/unpublish`, { reason: 'test: pause sales' });
  assert.equal((unpub.json as { version: { forSale: boolean } }).version.forSale, false);
  assert.ok(!(((await anon.get('/api/packages')).json.items) as Array<{ id: string; version: { forSale: boolean } }>).some((p) => p.id === id && p.version.forSale));
});

test('theme rollback returns to the previously published theme', async () => {
  const admin = client(h.app), anon = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const t = await admin.get('/api/admin/theme');
  const defaults = t.json.defaults as Record<string, unknown>;
  assert.equal(detail(await admin.post('/api/admin/theme/rollback', { reason: 'test: nothing yet' })), 'NO_PREVIOUS');
  assert.equal((await admin.put('/api/admin/theme', { tokens: { ...defaults, brandPrimary: '#E02A1A' } })).status, 200);
  assert.equal((await admin.post('/api/admin/theme/publish', { reason: 'test: v1' })).status, 200);
  assert.equal((await admin.put('/api/admin/theme', { tokens: { ...defaults, brandPrimary: '#E8402F' } })).status, 200);
  assert.equal((await admin.post('/api/admin/theme/publish', { reason: 'test: v2' })).status, 200);
  assert.ok((await anon.get('/api/public/theme.css')).text.includes('#E8402F'));
  assert.equal((await admin.post('/api/admin/theme/rollback', { reason: 'test: back to v1' })).status, 200);
  assert.ok((await anon.get('/api/public/theme.css')).text.includes('#E02A1A'));
  assert.equal((await admin.post('/api/admin/theme/reset', { reason: 'test: reset' })).status, 200);
});

test('finer permissions: restricted contact fields, approvals, publishing and LabStack are separate; administrators do not get LabStack by default', async () => {
  const owner = client(h.app), admin = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  const a = await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const perms = a.json.permissions as string[];
  assert.ok(!perms.includes('labstack.manage') && perms.includes('members.view_restricted') && perms.includes('content.publish') && perms.includes('custom_plans.approve'));
  assert.equal((await admin.get('/api/admin/integrations/labstack/status')).json.error?.code, 'PERMISSION_DENIED');
  assert.equal((await owner.get('/api/admin/integrations/labstack/status')).status, 200);
  const adminId = userId(h.ctx, DEMO.admin);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'labstack.manage', granted: true, reason: 'test: lab duty' })).status, 200);
  const status = await admin.get('/api/admin/integrations/labstack/status');
  assert.equal(status.status, 200);
  assert.ok(['connected', 'standin', 'pending_configuration'].includes(String(status.json.state)));
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'labstack.manage', granted: false, reason: 'test: done' })).status, 200);
  const memberId = userId(h.ctx, DEMO.member);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.view_restricted', granted: false, reason: 'test: narrow' })).status, 200);
  const d = await admin.get(`/api/admin/members/${memberId}`);
  assert.equal((d.json.profile as { phone: unknown; restricted?: boolean }).phone, undefined, 'phone stripped without the permission (response-wide, not nulled in one object)');
  assert.equal((d.json.profile as { restricted?: boolean }).restricted, true);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'members.view_restricted', granted: true, reason: 'test: restore' })).status, 200);
  assert.ok((await admin.get(`/api/admin/members/${memberId}`)).json.profile && ((await admin.get(`/api/admin/members/${memberId}`)).json.profile as { restricted?: boolean }).restricted === undefined);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'content.publish', granted: false, reason: 'test' })).status, 200);
  assert.equal((await admin.put('/api/admin/content/nav.blog', { value: 'Journal' })).status, 200, 'editing still allowed');
  assert.equal((await admin.post('/api/admin/content/publish', { reason: 'test' })).json.error?.code, 'PERMISSION_DENIED', 'publishing is separate');
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'content.publish', granted: true, reason: 'test: restore' })).status, 200);
  assert.equal((await admin.del('/api/admin/content/nav.blog/draft')).status, 200);
  const health = await client(h.app).get('/api/health');
  assert.equal(health.json.labstack, undefined, 'the public health check names no integration');
});

test('milestones are derived from records, with their sources, for the member and the coach', async () => {
  const m = client(h.app), coach = client(h.app);
  await m.login(DEMO.member, DEMO_PASSWORDS.member);
  await login(coach, DEMO.coach, DEMO_PASSWORDS.coach, 'coach');
  const mine = await m.get('/api/me/milestones');
  assert.equal(mine.status, 200);
  const items = mine.json.items as Array<{ key: string; achievedAt: string | null; source: string }>;
  assert.ok(items.length >= 8 && items.every((i) => typeof i.source === 'string'));
  assert.ok(items.find((i) => i.key === 'onboarded')?.achievedAt, 'the demo member completed onboarding');
  const view = await coach.get(`/api/coach/clients/${userId(h.ctx, DEMO.member)}`);
  assert.ok(Array.isArray(view.json.milestones));
});

test('the laboratory spells it CANCELED: the mapping and the webhook guard agree', () => {
  assert.equal(applyLabStackStatus('processing', 'CANCELED').changed, true);
  assert.equal(applyLabStackStatus('processing', 'CANCELLED').changed, false, 'the British spelling is not a LabStack status');
});
