/* The three sign-in doors, granular permissions and their safeguards, the website CMS and theme, coupons, analytics
   exports and the append-only audit log. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, DEMO_MFA_SECRET, userId } from '../helpers.js';
import { totpCode } from '../../src/lib/crypto.js';

const stateCode = (r: { json: { error?: { code: string; details?: unknown } } }) => r.json.error?.code === 'INVALID_STATE' ? (r.json.error.details as { code?: string } | undefined)?.code : r.json.error?.code;

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const login = (c: ReturnType<typeof client>, email: string, password: string, workspace: string, mfa = false) => c.post('/api/auth/login', { email, password, workspace, ...(mfa ? { mfaCode: totpCode(DEMO_MFA_SECRET) } : {}) });

test('three doors: each sign-in page admits only its own kind of account; MFA guards the admin door; permissions come back with the session', async () => {
  const c = client(h.app);
  assert.equal((await login(c, DEMO.member, DEMO_PASSWORDS.member, 'coach')).json.error?.code, 'WRONG_WORKSPACE');
  assert.equal((await login(c, DEMO.member, DEMO_PASSWORDS.member, 'admin')).json.error?.code, 'WRONG_WORKSPACE');
  assert.equal((await login(c, DEMO.coach, DEMO_PASSWORDS.coach, 'client')).json.error?.code, 'WRONG_WORKSPACE');
  assert.equal((await login(c, DEMO.coach, DEMO_PASSWORDS.coach, 'admin')).json.error?.code, 'WRONG_WORKSPACE');
  assert.equal((await login(c, DEMO.owner, DEMO_PASSWORDS.owner, 'coach')).json.error?.code, 'WRONG_WORKSPACE');
  assert.equal((await login(c, DEMO.owner, DEMO_PASSWORDS.owner, 'admin')).json.error?.code, 'MFA_REQUIRED');
  const member = await login(c, DEMO.member, DEMO_PASSWORDS.member, 'client');
  assert.equal(member.status, 200);
  assert.deepEqual(member.json.permissions, [], 'members carry no administrative permissions');
  c.clear();
  const coach = await login(c, DEMO.coach, DEMO_PASSWORDS.coach, 'coach');
  assert.equal(coach.status, 200);
  c.clear();
  const admin = await login(c, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  assert.equal(admin.status, 200);
  const perms = admin.json.permissions as string[];
  assert.ok(perms.includes('content.manage') && !perms.includes('permissions.manage') && !perms.includes('admins.manage'), 'administrators start with the default set');
  const me = await c.get('/api/auth/me');
  assert.deepEqual(me.json.permissions, perms);
  c.clear();
  const owner = await login(c, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  assert.ok((owner.json.permissions as string[]).includes('permissions.manage'), 'owners hold everything');
});

test('public registration never grants administrator privileges, whatever the body carries', async () => {
  const c = client(h.app);
  const reg = await c.post('/api/auth/register', { email: 'sneaky@demo.bioptime.test', password: 'A-long-demo-password-1', name: 'Sneaky', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17', role: 'owner', permissions: ['permissions.manage'] });
  assert.equal(reg.status, 201);
  assert.equal((reg.json.user as { role: string }).role, 'member');
  assert.equal((await c.get('/api/admin/users')).status, 403);
  assert.equal((await c.get('/api/admin/content')).status, 403);
});

test('granular permissions: an owner widens and narrows an administrator; the safeguards hold', async () => {
  const owner = client(h.app), admin = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const adminId = userId(h.ctx, DEMO.admin), ownerId = userId(h.ctx, DEMO.owner);
  assert.equal((await admin.get('/api/admin/users')).json.error?.code, 'PERMISSION_DENIED', 'managing permissions is not in the default set');
  assert.equal((await admin.get('/api/admin/packages')).status, 200);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'packages.manage', granted: false, reason: 'test: narrow' })).status, 200);
  assert.equal((await admin.get('/api/admin/packages')).json.error?.code, 'PERMISSION_DENIED', 'revoked on the next request');
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'packages.manage', granted: true, reason: 'test: restore' })).status, 200);
  assert.equal((await admin.get('/api/admin/packages')).status, 200);
  assert.equal(stateCode(await owner.post(`/api/admin/users/${ownerId}/permissions`, { permission: 'reports.view', granted: false, reason: 'test' })), 'OWNER_PERMISSIONS');
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'permissions.manage', granted: true, reason: 'test: delegate' })).status, 200);
  assert.equal(stateCode(await admin.post(`/api/admin/users/${adminId}/permissions`, { permission: 'permissions.manage', granted: false, reason: 'test: lock myself out' })), 'SELF_LOCKOUT');
  assert.equal((await admin.post(`/api/admin/users/${ownerId}/role`, { role: 'admin', reason: 'test' })).status, 403, 'role changes are owner-only');
  assert.equal(stateCode(await owner.post(`/api/admin/users/${ownerId}/role`, { role: 'admin', reason: 'test' })), 'SELF_ROLE');
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'permissions.manage', granted: false, reason: 'test: undo' })).status, 200);
  const list = await owner.get('/api/admin/users');
  const row = (list.json.items as Array<{ id: string; overrides: unknown[] }>).find((u) => u.id === adminId)!;
  assert.ok(row.overrides.length >= 1, 'overrides are listed with their reasons');
  const audit = await owner.get('/api/admin/audit/search?action=permission.');
  assert.ok((audit.json.items as unknown[]).length >= 4, 'every permission change is audited');
});

test('website content: drafts stay private, publishing needs a reason, rich text is sanitised, links are checked, resets return to the defaults', async () => {
  const admin = client(h.app), coach = client(h.app), anon = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  await login(coach, DEMO.coach, DEMO_PASSWORDS.coach, 'coach');
  assert.equal((await coach.get('/api/admin/content')).status, 403);
  assert.equal((await anon.get('/api/public/content/preview')).status, 401);
  const before = await anon.get('/api/public/content');
  assert.equal(before.status, 200);
  assert.equal((before.json.values as Record<string, unknown>)['home.hero.line1'], 'Train smarter.', 'the baked-in copy is the default');
  assert.equal((await admin.put('/api/admin/content/home.hero.line1', { value: 'Engineer your best years.' })).status, 200);
  assert.equal(((await anon.get('/api/public/content')).json.values as Record<string, unknown>)['home.hero.line1'], 'Train smarter.', 'a draft is not public');
  assert.equal(((await admin.get('/api/public/content/preview')).json.values as Record<string, unknown>)['home.hero.line1'], 'Engineer your best years.', 'the administrator preview shows the draft');
  assert.equal((await admin.post('/api/admin/content/publish', { reason: '' })).status, 400, 'a reason is required');
  assert.equal((await admin.post('/api/admin/content/publish', { reason: 'test: publish hero' })).status, 200);
  const after = await anon.get('/api/public/content');
  assert.equal((after.json.values as Record<string, unknown>)['home.hero.line1'], 'Engineer your best years.');
  assert.ok(after.json.version, 'a publish version is reported');
  // nothing executable gets through a text field, and nothing unknown
  assert.equal((await admin.put('/api/admin/content/nav.about', { value: '<script>alert(1)</script>About' })).status, 200);
  const navAbout = String(((await admin.get('/api/public/content/preview')).json.values as Record<string, unknown>)['nav.about']);
  assert.ok(!/[<>]/.test(navAbout) && navAbout.endsWith('About'), `tags are stripped from plain text: ${navAbout}`);
  assert.equal((await admin.put('/api/admin/content/home.hero.line1', { value: 'x'.repeat(41) })).json.error?.code, 'CONTENT_TOO_LONG');
  assert.equal((await admin.put('/api/admin/content/home.hero.cta_primary_href', { value: 'javascript:alert(1)' })).json.error?.code, 'CONTENT_URL');
  assert.equal((await admin.put('/api/admin/content/home.hero.cta_primary_href', { value: 'https://evil.example/path' })).status, 200, 'https links are allowed');
  assert.equal((await admin.put('/api/admin/content/no.such.key', { value: 'x' })).status, 404);
  const faq = await admin.put('/api/admin/content/faq.items', { value: [{ q: 'Is this sanitised?', a: 'Yes <img src=x onerror=alert(1)> and the tag is gone.' }] });
  assert.equal(faq.status, 200);
  const faqDraft = ((await admin.get('/api/public/content/preview')).json.values as Record<string, Array<{ a: string }>>)['faq.items']!;
  assert.ok(!/onerror|<img/i.test(faqDraft[0]!.a), 'FAQ answers are plain text');
  assert.equal((await admin.post('/api/admin/content/home.hero.line1/reset', { reason: 'test: reset' })).status, 200);
  const republish = await admin.post('/api/admin/content/publish', { keys: ['home.hero.line1'], reason: 'test: publish reset' });
  assert.ok(republish.status === 200 || stateCode(republish) === 'NO_DRAFTS', 'a reset either leaves a draft to publish or applies at once');
  assert.equal(((await anon.get('/api/public/content')).json.values as Record<string, unknown>)['home.hero.line1'], 'Train smarter.');
  const audit = await admin.get('/api/admin/audit/search?action=content.');
  assert.ok((audit.json.items as unknown[]).length >= 3, 'content changes are audited');
});

test('theme: tokens are validated, contrast below WCAG AA blocks publishing, the published CSS overrides the brand tokens, reset returns to the brand book', async () => {
  const admin = client(h.app), anon = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const t = await admin.get('/api/admin/theme');
  assert.equal(t.status, 200);
  const defaults = t.json.defaults as Record<string, unknown>;
  assert.equal(defaults.brandPrimary, '#EE3324');
  assert.equal((await admin.put('/api/admin/theme', { tokens: { ...defaults, brandPrimary: 'red' } })).status, 400, 'colours are hex');
  assert.equal((await admin.put('/api/admin/theme', { tokens: { ...defaults, fontSans: 'Comic Sans' } })).status, 400, 'only approved fonts');
  const low = await admin.put('/api/admin/theme', { tokens: { ...defaults, textMuted: '#1A2238' } });
  assert.equal(low.status, 200);
  assert.ok((low.json.warnings as string[]).length > 0, 'a low-contrast draft is saved with warnings');
  assert.equal(stateCode(await admin.post('/api/admin/theme/publish', { reason: 'test: low contrast' })), 'CONTRAST');
  assert.equal((await admin.put('/api/admin/theme', { tokens: { ...defaults, brandPrimary: '#D12A1C', radiusMd: 6 } })).status, 200);
  assert.equal((await admin.post('/api/admin/theme/publish', { reason: 'test: publish' })).status, 200);
  const css = await anon.get('/api/public/theme.css');
  assert.equal(css.status, 200);
  assert.match(String(css.headers['content-type']), /text\/css/);
  assert.ok(css.text.includes('--bp-color-brand-primary: #D12A1C') && css.text.includes('--bp-radius-md: 6px'), css.text);
  assert.equal((await admin.post('/api/admin/theme/reset', { reason: 'test: reset' })).status, 200);
  assert.ok((await anon.get('/api/public/theme.css')).text.includes('no overrides'));
});

test('coupons: applied by the server at checkout, counted on verified capture, refused when inactive or unknown', async () => {
  const owner = client(h.app), m = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  await m.login(DEMO.memberIncomplete, DEMO_PASSWORDS.member);
  assert.equal((await m.post('/api/me/checkout', { packageId: 'core', idempotencyKey: 'coupon-bad-1', couponCode: 'NOPE' })).json.error?.code, 'COUPON_INVALID');
  const list = await owner.get('/api/packages');
  const core = (list.json.items as Array<{ id: string; slug: string; version: { priceInr: number } }>).find((p) => p.slug === 'core')!;
  const co = await m.post('/api/me/checkout', { packageId: 'core', idempotencyKey: 'coupon-welcome10-1', couponCode: 'WELCOME10' });
  assert.equal(co.status, 201, JSON.stringify(co.json));
  const order = co.json.order as { id: string; totalInr: number; discountInr: number; couponCode: string };
  assert.equal(order.couponCode, 'WELCOME10');
  assert.equal(order.discountInr, Math.round(core.version.priceInr * 10) / 100, 'ten percent, exact to the paisa');
  assert.equal(order.totalInr, core.version.priceInr - order.discountInr);
  const coupons0 = (await owner.get('/api/admin/coupons')).json.items as Array<{ code: string; used: number; id: string }>;
  assert.equal(coupons0.find((c) => c.code === 'WELCOME10')!.used, 0, 'not counted before capture');
  const ck = co.json.checkout as { checkoutId: string };
  assert.equal((await m.post('/api/payments/simulator/complete', { checkoutId: ck.checkoutId, outcome: 'captured' })).status, 200);
  const coupons1 = (await owner.get('/api/admin/coupons')).json.items as Array<{ code: string; used: number; id: string }>;
  const demo = coupons1.find((c) => c.code === 'WELCOME10')!;
  assert.equal(demo.used, 1, 'counted on the verified capture');
  assert.equal((await owner.post('/api/admin/coupons', { code: 'LAUNCH20', kind: 'percent', value: 20, maxUses: 5, reason: 'test' })).status, 201);
  assert.equal((await owner.post('/api/admin/coupons', { code: 'LAUNCH20', kind: 'percent', value: 20, reason: 'test' })).json.error?.code, 'COUPON_EXISTS');
  assert.equal((await owner.post('/api/admin/coupons', { code: 'BAD', kind: 'percent', value: 250, reason: 'test' })).json.error?.code, 'COUPON_VALUE');
  assert.equal((await owner.patch(`/api/admin/coupons/${demo.id}`, { active: false, reason: 'test: off' })).status, 200);
  const m2 = client(h.app);
  await m2.login(DEMO.memberNoCoach, DEMO_PASSWORDS.member);
  assert.equal((await m2.post('/api/me/checkout', { packageId: 'starter', idempotencyKey: 'coupon-off-1', couponCode: 'WELCOME10' })).json.error?.code, 'COUPON_INVALID');
});

test('analytics: reports run over a date range for reports.view, export as CSV, and are audited; coaches are refused', async () => {
  const admin = client(h.app), coach = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  await login(coach, DEMO.coach, DEMO_PASSWORDS.coach, 'coach');
  const names = await admin.get('/api/admin/analytics');
  assert.ok((names.json.items as string[]).includes('enrolments'));
  assert.equal((await coach.get('/api/admin/analytics')).status, 403);
  const r = await admin.get('/api/admin/analytics/package_sales?from=2026-01-01&to=2026-12-31');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.rows) && Array.isArray(r.json.columns));
  const csv = await admin.get('/api/admin/analytics/package_sales.csv?from=2026-01-01&to=2026-12-31');
  assert.equal(csv.status, 200);
  assert.match(String(csv.headers['content-type']), /text\/csv/);
  assert.match(String(csv.headers['content-disposition']), /attachment; filename="bioptime-package_sales-/);
  assert.equal((await admin.get('/api/admin/analytics/no_such_report')).status, 404);
  const audit = await admin.get('/api/admin/audit/search?action=report.run');
  assert.ok((audit.json.items as unknown[]).length >= 2);
});

test('the audit log is append-only at the database: rows cannot be changed or removed', () => {
  const row = h.db.get<{ id: string }>('SELECT id FROM audit_events LIMIT 1');
  assert.ok(row, 'the seed wrote audit rows');
  assert.throws(() => h.db.run("UPDATE audit_events SET reason = 'tampered' WHERE id = ?", [row!.id]), /append-only|abort|constraint/i);
  assert.throws(() => h.db.run('DELETE FROM audit_events WHERE id = ?', [row!.id]), /append-only|abort|constraint/i);
});

test('notification templates: plain text only, placeholders filled, empty strings restore the built-in wording', async () => {
  const admin = client(h.app);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  assert.equal((await admin.put('/api/admin/notification-templates', { category: 'appointment', subject: 'Hi {{name}}: {{title}}', body: '{{body}} <script>x</script>', reason: 'test' })).json.error?.code, 'TEMPLATE_TEXT');
  const ok = await admin.put('/api/admin/notification-templates', { category: 'appointment', subject: 'Hi {{name}}: {{title}}', body: 'Reminder: {{body}}', reason: 'test' });
  assert.equal(ok.status, 200);
  assert.equal((ok.json.templates as Record<string, { subject: string }>).appointment!.subject, 'Hi {{name}}: {{title}}');
  const cleared = await admin.put('/api/admin/notification-templates', { category: 'appointment', subject: '', body: '', reason: 'test: clear' });
  assert.equal((cleared.json.templates as Record<string, unknown>).appointment, undefined);
});

test('review fixes: API 404s are JSON, assignment actions carry their permission, a percent code never zeroes an order, a one-use code counts orders in flight, booleans are booleans, reasons are required, report names are own keys', async () => {
  const owner = client(h.app), admin = client(h.app), anon = client(h.app);
  await login(owner, DEMO.owner, DEMO_PASSWORDS.owner, 'admin', true);
  await login(admin, DEMO.admin, DEMO_PASSWORDS.admin, 'admin', true);
  const miss = await anon.get('/api/nonexistent');
  assert.equal(miss.status, 404);
  assert.match(String(miss.headers['content-type']), /application\/json/, 'never a website page under /api');
  assert.equal(miss.json.error?.code, 'NOT_FOUND');
  assert.equal((await anon.get('/api/')).status, 404);
  const adminId = userId(h.ctx, DEMO.admin);
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'assignments.manage', granted: false, reason: 'test: narrow' })).status, 200);
  assert.equal((await admin.post('/api/admin/assignments/none/pause', { reason: 'test' })).json.error?.code, 'PERMISSION_DENIED');
  assert.equal((await owner.post(`/api/admin/users/${adminId}/permissions`, { permission: 'assignments.manage', granted: true, reason: 'test: restore' })).status, 200);
  assert.equal((await owner.post('/api/admin/coupons', { code: 'FREE100', kind: 'percent', value: 100, maxUses: 1, validTo: '2099-12-31', reason: 'test' })).status, 201);
  assert.equal((await owner.post('/api/admin/coupons', { code: 'BADDATE', kind: 'percent', value: 5, validTo: 'tomorrow', reason: 'test' })).status, 400, 'validity bounds are dates');
  const m = client(h.app);
  await m.login(DEMO.member2, DEMO_PASSWORDS.member);
  const co = await m.post('/api/me/checkout', { packageId: 'starter', idempotencyKey: 'free100-1', couponCode: 'FREE100' });
  assert.equal(co.status, 201, JSON.stringify(co.json));
  assert.equal((co.json.order as { totalInr: number }).totalInr, 1, 'a percent code stops at one rupee');
  const m2 = client(h.app);
  await m2.login(DEMO.memberNoCoach, DEMO_PASSWORDS.member);
  assert.equal((await m2.post('/api/me/checkout', { packageId: 'starter', idempotencyKey: 'free100-2', couponCode: 'FREE100' })).json.error?.code, 'COUPON_EXHAUSTED', 'the pending order holds the only use');
  assert.equal((await admin.put('/api/admin/content/site.announcement.visible', { value: 'false' })).json.error?.code, 'CONTENT_TYPE');
  assert.equal((await admin.put('/api/admin/content/site.announcement.visible', { value: true })).status, 200);
  assert.equal((await admin.put('/api/admin/content/nav.about', { value: 'a < b and <b>c</b>' })).status, 200);
  assert.equal(((await admin.get('/api/public/content/preview')).json.values as Record<string, unknown>)['nav.about'], 'a < b and c', 'a lone < survives, tags do not');
  assert.equal((await admin.post('/api/admin/theme/publish', { reason: '' })).status, 400, 'a reason is required to publish a theme');
  assert.equal((await admin.post('/api/admin/content/nav.about/reset', { reason: '' })).status, 400, 'a reason is required to reset a block');
  assert.equal((await admin.get('/api/admin/analytics/__proto__')).status, 404);
  assert.equal((await admin.get('/api/admin/analytics/constructor')).status, 404);
  const big = await admin.get('/api/admin/audit/search?limit=-1');
  assert.ok((big.json.items as unknown[]).length <= 500, 'a negative limit does not disable the cap');
});

test('website mount: pages are served, dotfiles and _headers answer 404, the portal policy allows only self-hosted fonts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-site-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Site</title>');
  fs.writeFileSync(path.join(dir, 'about.html'), '<!doctype html><title>About</title>');
  fs.writeFileSync(path.join(dir, '404.html'), '<!doctype html><title>Missing</title>');
  fs.writeFileSync(path.join(dir, '.assetsignore'), '# deploy-time ignore list\nREADME.md\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# not a page\n');
  fs.writeFileSync(path.join(dir, '_headers'), "/*\n  Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:\n");
  const site = await makeApp({ seed: false, env: { WEBSITE_DIR: dir } });
  try {
    const c = client(site.app);
    const home = await c.get('/');
    assert.equal(home.status, 200);
    assert.match(home.text, /<title>Site<\/title>/);
    assert.equal((await c.get('/about')).status, 200, 'clean URLs resolve to the .html file');
    const hidden = await c.get('/.assetsignore');
    assert.equal(hidden.status, 404, 'dotfiles are not served');
    assert.match(hidden.text, /<title>Missing<\/title>/, 'the site 404 page answers');
    assert.equal((await c.get('/_headers')).status, 404, 'the Cloudflare headers file is not served');
    assert.equal((await c.get('/README.md')).status, 404, '.assetsignore patterns are honoured');
    assert.match(String(home.headers['content-security-policy']), /font-src https:\/\/fonts\.gstatic\.com/, 'the website keeps the policy from _headers');
    const portal = String((await c.get('/login/coach')).headers['content-security-policy']);
    assert.match(portal, /(^|; )font-src 'self'(;|$)/, `portal pages allow only self-hosted fonts: ${portal}`);
    assert.doesNotMatch(portal, /googleapis|gstatic/, 'the portal never names Google Fonts');
    assert.match(portal, /img-src 'self' data:/, 'the other directives are kept');
  } finally { await site.app.close(); site.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
