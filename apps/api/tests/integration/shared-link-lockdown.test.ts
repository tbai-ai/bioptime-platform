/* The shared link's lockdown (owner decision, 15 November 2026: "On the shared link only, turn off the admin
   open-preview, the reset-token reply and the 2FA helper. Testers keep 'Continue without signing in' as client and
   coach.") and the traffic inspection's fixes (final-builds/traffic/TRAFFIC_REPORT.md H1, H2 and M5):
   - OPEN_PREVIEW_WORKSPACES: the open preview opens only the workspaces listed; unset, all three as before.
   - DEMO_STAFF_HELPERS=0: no demo helper hands out a token or code of an administrator or owner; unset, as before.
   - Cache-Control: no-store (and Pragma: no-cache) on every API answer, except the public media and page content that
     choose their own policy.
   - The inbox (GET /notifications) never returns a link that carries a token. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeApp, client, DEMO, DEMO_PASSWORDS, DEMO_MFA_SECRET, userId } from '../helpers.js';
import { buildApp } from '../../src/http/app.js';
import { loadConfig, PLATFORM_ROOT } from '../../src/config.js';
import { OPEN_PREVIEW_ACCOUNTS } from '../../src/auth/openPreview.js';
import { inviteOwner } from '../../src/auth/service.js';
import { inboxData } from '../../src/domain/notifications.js';
import { totpCode } from '../../src/lib/crypto.js';
import * as media from '../../src/domain/exerciseMedia.js';
import { sourceFolder, tempDir } from '../exerciseMediaFixture.js';

type App = Awaited<ReturnType<typeof makeApp>>;
const apps: App[] = [];
const keep = (h: App) => { apps.push(h); return h; };
after(async () => { for (const h of apps) { await h.app.close(); h.db.close(); } });

let previewAll: App;      // OPEN_PREVIEW=1, OPEN_PREVIEW_WORKSPACES unset
let previewNarrow: App;   // OPEN_PREVIEW=1, OPEN_PREVIEW_WORKSPACES=member,coach (the shared link)
let helpersOn: App;       // DEMO_STAFF_HELPERS unset
let helpersOff: App;      // DEMO_STAFF_HELPERS=0
before(async () => {
  // one after the other: building an app checks the module routes it just registered (api/http/app.ts)
  previewAll = keep(await makeApp({ env: { OPEN_PREVIEW: '1' } }));
  previewNarrow = keep(await makeApp({ env: { OPEN_PREVIEW: '1', OPEN_PREVIEW_WORKSPACES: 'member,coach' } }));
  helpersOn = keep(await makeApp());
  helpersOff = keep(await makeApp({ env: { DEMO_STAFF_HELPERS: '0' } }));
});

const STAFF_SESSIONS = "SELECT COUNT(*) n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.role IN ('admin', 'owner')";
const count = (h: App, sql: string, params: unknown[] = []) => h.db.get<{ n: number }>(sql, params as never[])!.n;
const sessionCookie = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat((r.headers['set-cookie'] as string | string[] | undefined) ?? []).find((c) => c.startsWith('bp_session='));
/** A raw POST to /auth/open-preview with any body and content type. */
const rawOpen = (h: App, payload: string, headers: Record<string, string> = {}, url = '/api/auth/open-preview') =>
  h.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', 'x-bioptime-client': 'web', ...headers }, payload });

/* ---------------- OPEN_PREVIEW_WORKSPACES ---------------- */

test('config: OPEN_PREVIEW_WORKSPACES takes exact names (member, coach, admin) in a fixed order; unset is all three; unknown or empty lists refuse to start', () => {
  const base = { BIOPTIME_MODE: 'demo', DATABASE_PATH: ':memory:', OPEN_PREVIEW: '1', DEMO_STAFF_HELPERS: '' } as const;
  assert.deepEqual(loadConfig({ ...base, OPEN_PREVIEW_WORKSPACES: '' }).openPreviewWorkspaces, ['member', 'coach', 'admin']);
  assert.deepEqual(loadConfig({ ...base, OPEN_PREVIEW_WORKSPACES: 'member,coach' }).openPreviewWorkspaces, ['member', 'coach']);
  assert.deepEqual(loadConfig({ ...base, OPEN_PREVIEW_WORKSPACES: ' coach , member,coach ' }).openPreviewWorkspaces, ['member', 'coach']);
  assert.deepEqual(loadConfig({ ...base, OPEN_PREVIEW_WORKSPACES: 'admin' }).openPreviewWorkspaces, ['admin']);
  for (const bad of ['Admin', 'member,owner', 'client', 'member;coach', 'dashboard']) {
    assert.throws(() => loadConfig({ ...base, OPEN_PREVIEW_WORKSPACES: bad }), /OPEN_PREVIEW_WORKSPACES=.* is not understood/, bad);
  }
  assert.throws(() => loadConfig({ ...base, OPEN_PREVIEW_WORKSPACES: ' , ' }), /names no workspace/);
  // without the open preview the list opens nothing
  assert.deepEqual(loadConfig({ ...base, OPEN_PREVIEW: '', OPEN_PREVIEW_WORKSPACES: 'member,coach' }).openPreviewWorkspaces, []);
});

test('unset (as before): every workspace opens; /public/config keeps openPreview: true and lists all three', async () => {
  assert.deepEqual(previewAll.config.openPreviewWorkspaces, ['member', 'coach', 'admin']);
  const cfg = await client(previewAll.app).get('/api/public/config');
  assert.equal(cfg.json.openPreview, true, 'the boolean the app reads is unchanged');
  assert.deepEqual(cfg.json.openPreviewWorkspaces, ['member', 'coach', 'admin']);
  for (const workspace of ['member', 'coach', 'admin'] as const) {
    const r = await client(previewAll.app).post('/api/auth/open-preview', { workspace });
    assert.equal(r.status, 200, `${workspace}: ${JSON.stringify(r.json)}`);
    assert.equal((r.json.user as { email: string }).email, OPEN_PREVIEW_ACCOUNTS[workspace]);
  }
});

test('member,coach (the shared link): /public/config lists member and coach; both open; admin answers 403 OPEN_PREVIEW_WORKSPACE_OFF with no session', async () => {
  const cfg = await client(previewNarrow.app).get('/api/public/config');
  assert.equal(cfg.json.openPreview, true);
  assert.deepEqual(cfg.json.openPreviewWorkspaces, ['member', 'coach']);
  for (const workspace of ['member', 'coach'] as const) {
    const r = await client(previewNarrow.app).post('/api/auth/open-preview', { workspace });
    assert.equal(r.status, 200, `${workspace}: ${JSON.stringify(r.json)}`);
  }
  const before = count(previewNarrow, STAFF_SESSIONS);
  for (const headers of [{}, { 'x-bioptime-client': 'mobile' }] as Array<Record<string, string>>) {
    const r = await client(previewNarrow.app).post('/api/auth/open-preview', { workspace: 'admin' }, headers);
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.equal(r.json.error?.code, 'OPEN_PREVIEW_WORKSPACE_OFF');
    assert.match(r.json.error!.message, /admin workspace does not open without signing in/);
    assert.doesNotMatch(r.json.error!.message, /\bdemo\b/i);
    assert.deepEqual(r.json.error?.details, { workspace: 'admin', workspaces: ['member', 'coach'] });
    assert.equal(sessionCookie(r), undefined, 'no session cookie');
    assert.ok(!('session' in r.json) && !/"token"/.test(r.text), 'no token');
  }
  assert.equal(count(previewNarrow, STAFF_SESSIONS), before, 'no staff session was made');
  assert.equal(count(previewNarrow, "SELECT COUNT(*) n FROM audit_events WHERE action = 'auth.open_preview' AND json_extract(data, '$.workspace') = 'admin'"), 0);
  // the admin workspace still signs in with its password (and its code)
  const pw = await client(previewNarrow.app).post('/api/auth/login', { email: DEMO.owner, password: DEMO_PASSWORDS.owner, workspace: 'admin', mfaCode: totpCode(DEMO_MFA_SECRET) });
  assert.equal(pw.status, 200, JSON.stringify(pw.json));
});

test('member,coach: no spelling, alias, array, duplicate key, form post, query string or nesting opens a staff session', async () => {
  const h = previewNarrow;
  const before = count(h, STAFF_SESSIONS);
  const refused = (r: { statusCode: number; json: () => unknown; headers: Record<string, unknown> }, codes: string[], label: string) => {
    const body = r.json() as { error?: { code: string } };
    assert.ok(r.statusCode === 400 || r.statusCode === 403, `${label}: ${r.statusCode} ${JSON.stringify(body)}`);
    assert.ok(codes.includes(body.error?.code ?? ''), `${label}: ${body.error?.code}`);
    assert.equal(sessionCookie(r), undefined, `${label}: no session`);
  };
  const validation = ['VALIDATION_FAILED'], off = ['OPEN_PREVIEW_WORKSPACE_OFF'];
  for (const workspace of ['Admin', 'ADMIN', ' admin', 'admin ', 'owner', 'Owner', 'dashboard', 'administrator', 'staff', ['admin'], ['member', 'admin'], { workspace: 'admin' }, null, 1, true]) {
    refused(await rawOpen(h, JSON.stringify({ workspace })), validation, JSON.stringify(workspace));
  }
  refused(await rawOpen(h, '{"__proto__":{"workspace":"admin"}}'), validation, '__proto__');
  refused(await rawOpen(h, '{"constructor":{"prototype":{"workspace":"admin"}}}'), validation, 'constructor.prototype');
  refused(await rawOpen(h, '{"workspace":"member","workspace":"admin"}'), off, 'duplicate key (the last one counts)');
  refused(await rawOpen(h, '{"workspace":"adm\\u0069n"}'), off, 'an escaped spelling is the same word');
  refused(await rawOpen(h, 'workspace=admin', { 'content-type': 'application/x-www-form-urlencoded' }), off, 'form post');
  refused(await rawOpen(h, 'workspace=member&workspace=admin', { 'content-type': 'application/x-www-form-urlencoded' }), off, 'form post, repeated field');
  refused(await rawOpen(h, '{"workspace":"admin"}', { 'x-bioptime-client': 'mobile' }), off, 'mobile');
  // anything beside the workspace word changes nothing: the member workspace opens the member account
  for (const [payload, url] of [['{"workspace":"member","role":"admin","email":"rohan@demo.bioptime.test","user":{"role":"owner"}}', undefined], ['{"workspace":"member"}', '/api/auth/open-preview?workspace=admin&role=owner'], ['{"workspace":"coach","workspaces":["admin"]}', undefined]] as const) {
    const r = await rawOpen(h, payload, {}, url);
    assert.equal(r.statusCode, 200, payload);
    assert.ok(['member', 'coach'].includes((r.json() as { user: { role: string } }).user.role), `${payload}: not a staff account`);
  }
  assert.equal(count(h, STAFF_SESSIONS), before, 'no staff session was made by any of them');
});

test('a start with the admin workspace no longer listed signs out the admin sessions the preview opened; member sessions and password sessions stay', async () => {
  const h = keep(await makeApp({ env: { OPEN_PREVIEW: '1' } }));
  const restarted: Array<Awaited<ReturnType<typeof buildApp>>> = [];
  try {
    const admin = client(h.app), member = client(h.app), owner = client(h.app);
    assert.equal((await admin.post('/api/auth/open-preview', { workspace: 'admin' })).status, 200);
    assert.equal((await member.post('/api/auth/open-preview', { workspace: 'member' })).status, 200);
    await owner.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
    const narrowed = { ...h.config, OPEN_PREVIEW_WORKSPACES: 'member,coach', openPreviewWorkspaces: ['member', 'coach'] as typeof h.config.openPreviewWorkspaces };
    const app2 = await buildApp({ config: narrowed, db: h.db, services: h.services });
    restarted.push(app2);
    await app2.ready();
    const me = (cookie: string) => app2.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal((await me(admin.cookie)).statusCode, 401, 'the admin preview session is signed out');
    assert.equal((await me(member.cookie)).statusCode, 200, 'the member preview session stays');
    assert.equal((await me(owner.cookie)).statusCode, 200, 'a password session of an owner stays');
    const ended = h.db.all<{ data: string }>("SELECT data FROM audit_events WHERE action = 'auth.open_preview_ended'");
    assert.equal(ended.length, 1);
    assert.deepEqual(JSON.parse(ended[0]!.data), { sessionsRevoked: 1, workspaces: ['admin'] });
    assert.equal((await app2.inject({ method: 'POST', url: '/api/auth/open-preview', headers: { 'content-type': 'application/json', 'x-bioptime-client': 'web' }, payload: '{"workspace":"admin"}' })).statusCode, 403);
    // with all three listed again nothing more is signed out
    const app3 = await buildApp({ config: h.config, db: h.db, services: h.services });
    restarted.push(app3);
    assert.equal(h.db.all("SELECT 1 FROM audit_events WHERE action = 'auth.open_preview_ended'").length, 1);
  } finally { for (const a of restarted) await a.close(); }
});

test('the portal reads the list: absent opens every workspace (older servers), a list opens only its names; staff helpers absent = on', async () => {
  // the dashboard's own file, loaded as it is (a computed specifier keeps it out of the API's typecheck)
  type Ws = 'member' | 'coach' | 'admin';
  const lib = await import(pathToFileURL(path.join(PLATFORM_ROOT, 'apps/dashboard/src/lib/openPreview.ts')).href) as {
    previewWorkspacesFrom: (config: unknown) => Ws[]; previewOpens: (on: boolean, list: readonly Ws[], ws: 'client' | 'coach' | 'admin') => boolean; staffHelpersFrom: (config: unknown) => boolean;
  };
  assert.deepEqual(lib.previewWorkspacesFrom({ openPreview: true }), ['member', 'coach', 'admin']);
  assert.deepEqual(lib.previewWorkspacesFrom(null), ['member', 'coach', 'admin']);
  assert.deepEqual(lib.previewWorkspacesFrom({ openPreview: true, openPreviewWorkspaces: ['member', 'coach'] }), ['member', 'coach']);
  assert.deepEqual(lib.previewWorkspacesFrom({ openPreviewWorkspaces: ['ADMIN', 'owner', 'coach'] }), ['coach']);
  assert.deepEqual(lib.previewWorkspacesFrom({ openPreviewWorkspaces: 'admin' }), [], 'not a list: none');
  assert.equal(lib.previewOpens(true, ['member', 'coach'], 'client'), true);
  assert.equal(lib.previewOpens(true, ['member', 'coach'], 'coach'), true);
  assert.equal(lib.previewOpens(true, ['member', 'coach'], 'admin'), false);
  assert.equal(lib.previewOpens(false, ['member', 'coach', 'admin'], 'client'), false, 'nothing while the preview is off');
  assert.equal(lib.staffHelpersFrom({ demo: true }), true);
  assert.equal(lib.staffHelpersFrom(undefined), true);
  assert.equal(lib.staffHelpersFrom({ demo: true, demoStaffHelpers: false }), false);
  // the guard, the sign-in page and the "Fill in the preview code" links go through these
  const src = (rel: string) => fs.readFileSync(path.join(PLATFORM_ROOT, 'apps/dashboard/src', rel), 'utf8');
  assert.match(src('lib/auth.tsx'), /if \(opens\(ws\) && \(!user \|\| !roles\.includes\(user\.role\)\)\) return <OpenWorkspace/);
  const logins = src('pages/auth/Logins.tsx');
  assert.match(logins, /const opening = opens && !openErr && !signedInHere;/);
  assert.match(logins, /needMfa && demo && staffHelpers && mfaPreview && /);
  assert.match(logins, /enrol\?\.preview && demo && staffHelpers && /);
});

/* ---------------- DEMO_STAFF_HELPERS ---------------- */

test('config: DEMO_STAFF_HELPERS takes 0 or 1 (unset = on) and is never on outside demo mode', () => {
  const base = { DATABASE_PATH: ':memory:', OPEN_PREVIEW: '', OPEN_PREVIEW_WORKSPACES: '' } as const;
  assert.equal(loadConfig({ ...base, BIOPTIME_MODE: 'demo', DEMO_STAFF_HELPERS: '' }).demoStaffHelpers, true);
  assert.equal(loadConfig({ ...base, BIOPTIME_MODE: 'demo', DEMO_STAFF_HELPERS: '1' }).demoStaffHelpers, true);
  assert.equal(loadConfig({ ...base, BIOPTIME_MODE: 'demo', DEMO_STAFF_HELPERS: '0' }).demoStaffHelpers, false);
  assert.equal(loadConfig({ ...base, BIOPTIME_MODE: 'development', DEMO_STAFF_HELPERS: '' }).demoStaffHelpers, false);
  for (const bad of ['off', 'false', 'no', '2']) assert.throws(() => loadConfig({ ...base, BIOPTIME_MODE: 'demo', DEMO_STAFF_HELPERS: bad }), /DEMO_STAFF_HELPERS=.* is not understood/, bad);
});

test('unset (as before): the reset and verification tokens come back for every account, the authenticator helper answers for staff, the sign-in names it', async () => {
  const h = helpersOn;
  const c = client(h.app);
  assert.equal((await c.get('/api/public/config')).json.demoStaffHelpers, true);
  for (const email of [DEMO.admin, DEMO.owner, OPEN_PREVIEW_ACCOUNTS.admin, DEMO.member, DEMO.coach]) {
    const r = await c.post('/api/auth/password/forgot', { email });
    assert.equal(typeof r.json.demoToken, 'string', email);
  }
  const invited = inviteOwner(h.ctx, { email: 'invited.owner.on@demo.bioptime.test', name: 'Invited Owner' });
  assert.equal(typeof (await c.post('/api/auth/resend-verification', { email: invited.user.email })).json.demoToken, 'string');
  const code = await c.get(`/api/auth/demo/totp?email=${encodeURIComponent(DEMO.admin)}`);
  assert.equal(code.status, 200);
  assert.match(String(code.json.code), /^\d{6}$/);
  const mfa = await c.post('/api/auth/login', { email: DEMO.admin, password: DEMO_PASSWORDS.admin, workspace: 'admin' });
  assert.deepEqual([mfa.status, mfa.json.error?.code, mfa.json.error?.details], [401, 'MFA_REQUIRED', { previewCodePath: '/auth/demo/totp' }]);
});

test('DEMO_STAFF_HELPERS=0: no reset or verification token, no authenticator code and no pointer to it for an administrator or owner; members and coaches keep theirs', async () => {
  const h = helpersOff;
  const c = client(h.app);
  assert.equal(h.config.demoStaffHelpers, false);
  assert.equal((await c.get('/api/public/config')).json.demoStaffHelpers, false);
  const nobody = await c.post('/api/auth/password/forgot', { email: 'nobody.here@example.org' });
  for (const email of [DEMO.admin, DEMO.owner, OPEN_PREVIEW_ACCOUNTS.admin, 'avinash@demo.bioptime.test']) {
    const r = await c.post('/api/auth/password/forgot', { email });
    assert.equal(r.status, 200, email);
    assert.deepEqual(r.json, nobody.json, `${email}: the same answer as an address without an account`);
    // the reset itself still happens: the link goes by email (the outbox here)
    assert.ok(h.db.get("SELECT 1 FROM auth_tokens WHERE user_id = ? AND kind = 'password_reset' AND used_at IS NULL", [userId(h.ctx, email)]), `${email}: a reset link was issued`);
  }
  for (const email of [DEMO.member, DEMO.coach, OPEN_PREVIEW_ACCOUNTS.member, OPEN_PREVIEW_ACCOUNTS.coach]) {
    assert.equal(typeof (await c.post('/api/auth/password/forgot', { email })).json.demoToken, 'string', `${email}: kept`);
  }
  // verification tokens: an invited owner gets none, a new member still does (register and resend)
  const invited = inviteOwner(h.ctx, { email: 'invited.owner.off@demo.bioptime.test', name: 'Invited Owner' });
  const resendStaff = await c.post('/api/auth/resend-verification', { email: invited.user.email });
  assert.equal(resendStaff.status, 200);
  assert.ok(!('demoToken' in resendStaff.json));
  const m = client(h.app);
  const reg = await m.post('/api/auth/register', { email: 'new.member.off@example.org', password: 'A-long-password-2026', name: 'New Member', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.equal(typeof (reg.json.verification as { demoToken?: string }).demoToken, 'string');
  assert.equal(typeof (await c.post('/api/auth/resend-verification', { email: 'new.member.off@example.org' })).json.demoToken, 'string');
  // the authenticator helper refuses every staff account; the sign-in no longer names it, and the real code still works
  for (const email of [DEMO.admin, DEMO.owner, OPEN_PREVIEW_ACCOUNTS.admin]) {
    const r = await c.get(`/api/auth/demo/totp?email=${encodeURIComponent(email)}`);
    assert.deepEqual([r.status, r.json.error?.code], [403, 'DEMO_STAFF_HELPER_OFF'], email);
    assert.ok(!('code' in r.json) && !/\b\d{6}\b/.test(r.text), `${email}: no code in the answer`);
  }
  assert.equal((await c.get(`/api/auth/demo/totp?email=${encodeURIComponent(DEMO.member)}`)).status, 404, 'a member has no authenticator, as before');
  const mfa = await c.post('/api/auth/login', { email: DEMO.admin, password: DEMO_PASSWORDS.admin, workspace: 'admin' });
  assert.deepEqual([mfa.status, mfa.json.error?.code], [401, 'MFA_REQUIRED']);
  assert.ok(!/previewCodePath/.test(mfa.text), 'no pointer to the helper');
  const ok = await c.post('/api/auth/login', { email: DEMO.admin, password: DEMO_PASSWORDS.admin, workspace: 'admin', mfaCode: totpCode(DEMO_MFA_SECRET) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // mandatory enrolment: the token comes back (it is the account's own sign-in), the helper pointer does not, and the
  // helper refuses the secret just issued
  const avinash = 'avinash@demo.bioptime.test';
  h.db.run('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE email = ?', [avinash]);
  const enrol = await c.post('/api/auth/login', { email: avinash, password: DEMO_PASSWORDS.avinash, workspace: 'admin' });
  assert.deepEqual([enrol.status, enrol.json.error?.code], [403, 'MFA_ENROLMENT_REQUIRED']);
  const details = enrol.json.error?.details as { enrolmentToken?: string; previewCodePath?: string };
  assert.equal(typeof details.enrolmentToken, 'string');
  assert.equal(details.previewCodePath, undefined);
  assert.equal((await c.post('/api/auth/mfa/enrol/start', { enrolmentToken: details.enrolmentToken })).status, 200);
  assert.equal((await c.get(`/api/auth/demo/totp?email=${avinash}`)).json.error?.code, 'DEMO_STAFF_HELPER_OFF');
  // the other demo helpers never served staff: the stand-in identity provider refuses a staff account in both modes
  for (const x of [helpersOn, helpersOff]) {
    const r = await client(x.app).post('/api/auth/social/login', { provider: 'standin', standinEmail: DEMO.admin });
    assert.deepEqual([r.status, r.json.error?.code], [403, 'WRONG_WORKSPACE']);
  }
});

test('the shared link (open preview for member and coach, staff helpers off): the preview accounts keep their restrictions, the admin one gets no reset token', async () => {
  const h = keep(await makeApp({ env: { OPEN_PREVIEW: '1', OPEN_PREVIEW_WORKSPACES: 'member,coach', DEMO_STAFF_HELPERS: '0' } }));
  const c = client(h.app);
  const cfg = (await c.get('/api/public/config')).json;
  assert.deepEqual([cfg.openPreview, cfg.openPreviewWorkspaces, cfg.demoStaffHelpers], [true, ['member', 'coach'], false]);
  assert.ok(!('demoToken' in (await c.post('/api/auth/password/forgot', { email: OPEN_PREVIEW_ACCOUNTS.admin })).json));
  const memberToken = (await c.post('/api/auth/password/forgot', { email: OPEN_PREVIEW_ACCOUNTS.member })).json.demoToken as string;
  assert.equal(typeof memberToken, 'string');
  const reset = await c.post('/api/auth/password/reset', { token: memberToken, password: 'Another-long-password-2026' });
  assert.deepEqual([reset.status, reset.json.error?.code], [403, 'OPEN_PREVIEW_RESTRICTED'], 'a preview account’s password stays as it is');
  assert.equal((await c.post('/api/auth/open-preview', { workspace: 'admin' })).json.error?.code, 'OPEN_PREVIEW_WORKSPACE_OFF');
});

test('the shared link: a member or coach preview session never turns into a staff one, and no spelling of a staff address gets a helper', async () => {
  const h = keep(await makeApp({ env: { OPEN_PREVIEW: '1', OPEN_PREVIEW_WORKSPACES: 'member,coach', DEMO_STAFF_HELPERS: '0' } }));
  const before = count(h, STAFF_SESSIONS);
  for (const workspace of ['member', 'coach'] as const) {
    const c = client(h.app);
    assert.equal((await c.post('/api/auth/open-preview', { workspace })).status, 200, workspace);
    // asking for the admin workspace with the preview session in hand: refused, and the session stays what it was
    for (const headers of [{}, { 'x-bioptime-client': 'mobile' }] as Array<Record<string, string>>) {
      const r = await c.post('/api/auth/open-preview', { workspace: 'admin' }, headers);
      assert.deepEqual([r.status, r.json.error?.code], [403, 'OPEN_PREVIEW_WORKSPACE_OFF'], `${workspace}: admin refused`);
    }
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200, workspace);
    assert.equal((me.json.user as { email: string }).email, OPEN_PREVIEW_ACCOUNTS[workspace], `${workspace}: still the preview account`);
    for (const url of ['/api/admin/overview', '/api/admin/outbox', '/api/admin/settings']) assert.equal((await c.get(url)).status, 403, `${workspace}: ${url}`);
    assert.equal((await c.post('/api/auth/mfa/setup', {})).status, 403, `${workspace}: no authenticator set-up`);
  }
  // the address in any spelling the server reads as a staff account: no reset token, no code, no pointer to it
  const anon = client(h.app);
  const nobody = (await anon.post('/api/auth/password/forgot', { email: 'nobody.here@example.org' })).json;
  for (const email of ['ADMIN@demo.bioptime.test', ' Owner@Demo.Bioptime.Test ', 'rohan@DEMO.bioptime.test']) {
    assert.deepEqual((await anon.post('/api/auth/password/forgot', { email })).json, nobody, `forgot: ${email}`);
    const mfa = await anon.post('/api/auth/login', { email, password: DEMO_PASSWORDS.owner, workspace: 'admin' });
    assert.ok(!/previewCodePath/.test(mfa.text), `login: ${email}`);
  }
  for (const email of ['ADMIN@demo.bioptime.test', ' admin@demo.bioptime.test', 'Owner@demo.bioptime.test', 'rohan@demo.bioptime.test ', 'admin@DEMO.BIOPTIME.TEST']) {
    const r = await anon.get(`/api/auth/demo/totp?email=${encodeURIComponent(email)}`);
    assert.equal(r.status, 403, `totp: ${JSON.stringify(email)} ${r.text}`);
    assert.ok(!('code' in r.json) && !/\b\d{6}\b/.test(r.text), `totp: ${JSON.stringify(email)}: no code`);
  }
  assert.equal(count(h, STAFF_SESSIONS), before, 'no staff session was made');
});

/* ---------------- Cache-Control ---------------- */

const noStore = (r: { headers: Record<string, unknown> }, label: string) => {
  assert.equal(r.headers['cache-control'], 'no-store', `${label}: cache-control`);
  assert.equal(r.headers.pragma, 'no-cache', `${label}: pragma`);
};

test('no-store: every sign-in, MFA, password and session answer, success or refusal, web or app', async () => {
  const h = helpersOn;
  const c = client(h.app);
  noStore(await c.post('/api/auth/login', { email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'member' }), 'login (web)');
  noStore(await client(h.app).post('/api/auth/login', { email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'member' }, { 'x-bioptime-client': 'mobile' }), 'login (app, with the bearer token)');
  noStore(await client(h.app).post('/api/auth/login', { email: DEMO.member, password: 'not-the-password', workspace: 'member' }), 'login refused');
  noStore(await client(h.app).post('/api/auth/login', { email: DEMO.admin, password: DEMO_PASSWORDS.admin, workspace: 'admin' }), 'MFA_REQUIRED');
  noStore(await client(h.app).post('/api/auth/mfa/enrol/start', { enrolmentToken: 'x'.repeat(32) }), 'enrolment refused');
  noStore(await client(h.app).post('/api/auth/password/forgot', { email: DEMO.member2 }), 'password/forgot (with demoToken)');
  noStore(await client(h.app).post('/api/auth/password/reset', { token: 'forged-token-value', password: 'Another-long-password-2' }), 'password/reset refused');
  noStore(await c.get('/api/auth/me'), 'auth/me');
  noStore(await c.get('/api/auth/sessions'), 'auth/sessions');
  noStore(await c.post('/api/auth/logout'), 'logout');
  const p = client(previewAll.app);
  noStore(await p.post('/api/auth/open-preview', { workspace: 'member' }), 'open-preview');
  noStore(await client(previewNarrow.app).post('/api/auth/open-preview', { workspace: 'admin' }), 'open-preview refused');
});

test('no-store: everything personal or authenticated (member, coach, admin), the public JSON without a policy of its own, errors and unknown routes', async () => {
  const h = helpersOn;
  const m = client(h.app);
  await m.login(DEMO.member, DEMO_PASSWORDS.member);
  for (const url of ['/api/me', '/api/me/profile', '/api/me/programme', '/api/me/reports', '/api/me/progress/summary', '/api/me/workouts', '/api/me/habits', '/api/notifications?unread=1&limit=10', '/api/conversations']) {
    const r = await m.get(url);
    assert.equal(r.status, 200, `${url}: ${JSON.stringify(r.json).slice(0, 200)}`);
    noStore(r, url);
  }
  const bearer = client(h.app);
  bearer.useBearer(((await client(h.app).post('/api/auth/login', { email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'member' }, { 'x-bioptime-client': 'mobile' })).json.session as { token: string }).token);
  noStore(await bearer.get('/api/me'), '/api/me with a bearer token');
  const coach = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  noStore(await coach.get('/api/coach/home'), 'coach home');
  const owner = client(h.app);
  await owner.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  noStore(await owner.get('/api/admin/overview'), 'admin overview');
  noStore(await owner.get('/api/admin/outbox'), 'admin outbox');
  const anon = client(h.app);
  for (const url of ['/api/public/config', '/api/packages', '/api/bloodwork/tests', '/api/health', '/api/public/status']) noStore(await anon.get(url), url);
  noStore(await anon.get('/api/me'), '401');
  noStore(await anon.get('/api/admin/overview'), '401 admin');
  noStore(await m.get('/api/admin/overview'), '403');
  noStore(await anon.get('/api/no-such-route'), 'unknown API route');
  noStore(await anon.post('/api/no-such-route', {}), 'unknown API route (POST)');
});

test('kept: the exercise clips and posters stay immutable for a year (200, 206, 304; signed in or not), the public page content and theme stay no-cache; a media 404 is no-store', async () => {
  const mediaDir = tempDir('lockdown-served');
  const h = keep(await makeApp({ seed: false, env: { EXERCISE_MEDIA_DIR: mediaDir } }));
  media.importExercises(h.config, sourceFolder(['squats']).dir);
  const item = media.manifestItems(h.config).find((i) => i.key === 'squats')!;
  const IMMUTABLE = 'public, max-age=31536000, immutable';
  const kept = (r: { statusCode: number; headers: Record<string, unknown> }, status: number, label: string) => {
    assert.equal(r.statusCode, status, label);
    assert.equal(r.headers['cache-control'], IMMUTABLE, `${label}: its own policy`);
    assert.equal(r.headers.pragma, undefined, `${label}: no pragma`);
  };
  const get = (name: string, headers: Record<string, string> = {}) => h.app.inject({ method: 'GET', url: `/api/public/media/exercises/${name}`, headers });
  kept(await get(item.video), 200, 'clip');
  kept(await get(item.poster), 200, 'poster');
  kept(await get(item.video, { range: 'bytes=0-99' }), 206, 'clip range');
  kept(await get(item.video, { 'if-none-match': media.resolveFile(h.ctx, item.video)!.etag }), 304, 'clip revalidated');
  kept(await h.app.inject({ method: 'HEAD', url: `/api/public/media/exercises/${item.video}` }), 200, 'clip HEAD (players ask for the size first)');
  // a signed-in portal page sends its cookie with the clip, the app its bearer token: still cached
  const seeded = keep(await makeApp({ env: { EXERCISE_MEDIA_DIR: mediaDir } }));
  const m = client(seeded.app);
  await m.login(DEMO.member, DEMO_PASSWORDS.member);
  const withCookie = await seeded.app.inject({ method: 'GET', url: `/api/public/media/exercises/${item.video}`, headers: { cookie: m.cookie } });
  kept(withCookie, 200, 'clip with a session cookie');
  const token = ((await client(seeded.app).post('/api/auth/login', { email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'member' }, { 'x-bioptime-client': 'mobile' })).json.session as { token: string }).token;
  kept(await seeded.app.inject({ method: 'GET', url: `/api/public/media/exercises/${item.poster}`, headers: { authorization: `Bearer ${token}` } }), 200, 'poster with a bearer token');
  // errors are never cached, whatever the route set before it failed
  const missing = await get('squats.00000000.mp4');
  assert.equal(missing.statusCode, 404);
  noStore({ headers: missing.headers }, 'unknown clip');
  const outside = await get(item.video, { range: `bytes=${item.bytes + 10}-` });
  assert.equal(outside.statusCode, 416);
  noStore({ headers: outside.headers }, 'range outside the file');
  // the public page content and theme revalidate on every use, as they chose
  for (const url of ['/api/public/content', '/api/public/theme.css']) {
    const r = await h.app.inject({ method: 'GET', url });
    assert.equal(r.statusCode, 200, url);
    assert.equal(r.headers['cache-control'], 'no-cache', url);
    assert.equal(r.headers.pragma, undefined, url);
  }
});

test('kept: the website and the portal keep their own policies (images and fonts for a day, pages revalidated); the hook touches only /api', async () => {
  const site = tempDir('lockdown-site');
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><title>Site</title><p>Home</p>');
  fs.mkdirSync(path.join(site, 'assets'));
  fs.writeFileSync(path.join(site, 'assets', 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  fs.writeFileSync(path.join(site, 'assets', 'face.woff2'), Buffer.from('wOF2-test-font'));
  const h = keep(await makeApp({ seed: false, env: { WEBSITE_DIR: site } }));
  for (const [url, policy] of [['/assets/photo.png', 'public, max-age=86400'], ['/assets/face.woff2', 'public, max-age=86400'], ['/', 'public, max-age=0']] as const) {
    const r = await h.app.inject({ method: 'GET', url });
    assert.equal(r.statusCode, 200, url);
    assert.equal(r.headers['cache-control'], policy, url);
    assert.equal(r.headers.pragma, undefined, `${url}: no pragma`);
  }
});

/* ---------------- M5: no token in the inbox ---------------- */

test('inboxData: the link keys, any key named like a token, secret or password and any value with a token, code or key parameter are left out; the rest stays', () => {
  const data = {
    verifyUrl: 'http://localhost:3000/verify?token=abc', resetUrl: 'http://localhost:3000/reset-password?token=abc', activateUrl: 'x', inviteUrl: 'y',
    enrolmentToken: 'z', clientSecret: 'z', password: 'z', link: 'https://example.org/page?ref=1&token=abc', fragment: 'https://example.org/#code=1',
    appointmentId: 'apt_1', referral: 'https://example.org/register?ref=CODE', count: 3, nested: { ok: true },
  };
  assert.deepEqual(inboxData(data), { appointmentId: 'apt_1', referral: 'https://example.org/register?ref=CODE', count: 3, nested: { ok: true } });
  // a stored value that is not an object reads as no data rather than failing the whole inbox
  for (const odd of [null, undefined, 'text', 3, ['verifyUrl']]) assert.deepEqual(inboxData(odd), {}, JSON.stringify(odd));
});

test('GET /notifications returns no verification or reset link, new or written before this change; the link stays only on the stored record for the email', async () => {
  const h = helpersOn;
  const m = client(h.app);
  const reg = await m.post('/api/auth/register', { email: 'inbox.check@example.org', password: 'A-long-password-2026', name: 'Inbox Check', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  const verifyToken = (reg.json.verification as { demoToken: string }).demoToken; // the demo's own verify flow (website, app) keeps this
  const resetToken = (await client(h.app).post('/api/auth/password/forgot', { email: 'inbox.check@example.org' })).json.demoToken as string;
  const id = userId(h.ctx, 'inbox.check@example.org');
  // a row as the server wrote it before this change (the M5 capture), with a harmless field beside the link
  h.db.insert('notifications', { id: 'ntf_lockdown_legacy', user_id: id, category: 'verification', title: 'Verify your email', body: 'Open the link we sent.', data: JSON.stringify({ verifyUrl: 'http://localhost:3000/verify?token=LEGACYTOKENVALUE1234567890', note: 'kept' }), event_id: null, created_at: new Date().toISOString(), read_at: null });
  for (const url of ['/api/notifications', '/api/notifications?unread=1&limit=10']) {
    const r = await m.get(url);
    assert.equal(r.status, 200);
    for (const secret of [verifyToken, resetToken, 'LEGACYTOKENVALUE1234567890']) assert.ok(!r.text.includes(secret), `${url}: no token`);
    assert.doesNotMatch(r.text, /verifyUrl|resetUrl|token=/);
    const items = r.json.items as Array<{ id: string; category: string; title: string; data: Record<string, unknown> }>;
    assert.ok(items.some((n) => n.category === 'verification' && n.title === 'Verify your email' && Object.keys(n.data).length === 0), `${url}: the notification itself is there`);
    assert.ok(items.some((n) => n.title === 'Reset your password'), `${url}: so is the reset notice`);
    assert.deepEqual(items.find((n) => n.id === 'ntf_lockdown_legacy')?.data, { note: 'kept' });
  }
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND json_extract(data, '$.verifyUrl') LIKE '%token=%'", [id]), 'stored for the email channel, never returned');
  assert.equal((await m.post('/api/notifications/read', { all: true })).status, 200);
});

test('pending_verification outside demo mode: signing in works as the code intends, onboarding waits for the email, and no answer carries the verification token', async () => {
  const h = keep(await makeApp({ seed: false, env: { BIOPTIME_MODE: 'development' } }));
  const m = client(h.app);
  const reg = await m.post('/api/auth/register', { email: 'pending.dev@example.org', password: 'A-long-password-2026', name: 'Pending Dev', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.deepEqual(reg.json.verification, { required: true }, 'no token outside demo mode');
  const stored = h.db.get<{ link: string }>("SELECT json_extract(data, '$.verifyUrl') link FROM notifications WHERE user_id = ? AND category = 'verification'", [userId(h.ctx, 'pending.dev@example.org')])!.link;
  const token = new URL(stored).searchParams.get('token')!;
  assert.ok(token.length > 20);
  const signIn = await client(h.app).post('/api/auth/login', { email: 'pending.dev@example.org', password: 'A-long-password-2026', workspace: 'member' });
  assert.equal(signIn.status, 200, 'sign-in is not refused (registration signs in at once)');
  assert.equal((signIn.json.user as { state: string }).state, 'pending_verification');
  for (const url of ['/api/notifications', '/api/auth/me', '/api/me', '/api/me/onboarding']) {
    const r = await m.get(url);
    assert.ok(!r.text.includes(token), `${url}: no verification token`);
  }
  const step = await m.post('/api/me/onboarding', { step: 'profile', data: {} });
  assert.deepEqual([step.status, step.json.error?.code], [403, 'EMAIL_UNVERIFIED'], 'onboarding waits for the email');
  assert.equal((await client(h.app).post('/api/auth/verify-email', { token })).status, 200, 'the emailed link still verifies');
});
