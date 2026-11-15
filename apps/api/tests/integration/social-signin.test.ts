/* Sign in with Google and Apple for members (api/auth/social.ts, migration 0036): ID tokens verified on the server
   against the providers' keys (served here by a local JWKS stub: the tests never reach the network), a new identity
   kept 10 minutes under a one-time token until the acceptances arrive, the account made from the stored identity
   (member, verified email, no password), consents and referral as /auth/register records them, linking by verified
   email, the identities page (list, link, unlink, the last way in protected), the demo-only stand-in provider (404 in
   any other mode), Apple's form-post return, and that no coach, administrator or owner is ever linked, created or
   signed in by these routes. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { makeApp, client, DEMO, DEMO_PASSWORDS, DEMO_MFA_SECRET, userId } from '../helpers.js';
import { sha256 } from '../../src/lib/crypto.js';
import { createPrivilegedUser } from '../../src/auth/service.js';
import { DEMO_OWNERS } from '../../src/seed/seed.js';
import { ALL_PERMISSIONS } from '../../src/auth/permissions.js';
import { redactTokens } from '../../src/http/app.js';
import { ProviderKeys, verifyIdToken } from '../../src/auth/social.js';

/* ---------- a Google and an Apple of our own ---------- */
const IOS_ID = 'test-ios-client.apps.googleusercontent.com';
const SERVICES_ID = 'com.bioptime.web';
const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const google = pair(), apple = pair(), rogue = pair();
const jwk = (k: { publicKey: KeyObject }, kid: string) => ({ ...(k.publicKey.export({ format: 'jwk' }) as Record<string, string>), kid, alg: 'RS256', use: 'sig' });
let fetches: string[] = [];
const jwks = async (url: string) => {
  fetches.push(url);
  if (url.includes('googleapis.com')) return { keys: [jwk(google, 'g1')] };
  if (url.includes('appleid.apple.com')) return { keys: [jwk(apple, 'a1')] };
  throw new Error(`unexpected key URL ${url}`);
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mint = (k: { privateKey: KeyObject }, header: Record<string, unknown>, claims: Record<string, unknown>) => {
  const h = b64(header), p = b64(claims);
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), k.privateKey).toString('base64url')}`;
};
const nowS = () => Math.floor(Date.now() / 1000);
const googleToken = (claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = google) =>
  mint(key, { alg: 'RS256', kid: 'g1', typ: 'JWT', ...header }, { iss: 'https://accounts.google.com', aud: IOS_ID, sub: 'google-sub-1', email: 'gita@example.test', email_verified: true, name: 'Gita Google', iat: nowS(), exp: nowS() + 3600, ...claims });
const appleToken = (claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) =>
  mint(apple, { alg: 'RS256', kid: 'a1', typ: 'JWT', ...header }, { iss: 'https://appleid.apple.com', aud: 'com.bioptime.app', sub: 'apple-sub-1', email: 'relay.1@privaterelay.appleid.com', email_verified: 'true', is_private_email: 'true', iat: nowS(), exp: nowS() + 3600, ...claims });

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp({ env: { GOOGLE_SIGN_IN_IOS_CLIENT_ID: IOS_ID, APPLE_SIGN_IN_BUNDLE_IDS: 'com.bioptime.app', APPLE_SIGN_IN_SERVICES_ID: SERVICES_ID }, jwks }); });
after(async () => { await h.app.close(); h.db.close(); });

const MOBILE = { 'x-bioptime-client': 'mobile' };
const social = (body: Record<string, unknown>, c = client(h.app), headers: Record<string, string> = MOBILE) => c.post('/api/auth/social/login', body, headers);
const standin = (email: string, extra: Record<string, unknown> = {}, c = client(h.app), headers: Record<string, string> = MOBILE) => social({ provider: 'standin', standinEmail: email, ...extra }, c, headers);
const ACCEPT = { acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' };
// node:sqlite rows have a null prototype: copied into plain objects so deepEqual compares values only
const identities = (uid: string) => h.db.all<{ provider: string; subject: string; email: string | null }>('SELECT provider, subject, email FROM user_identities WHERE user_id = ? ORDER BY created_at', [uid]).map((r) => ({ ...r }));
const audits = (uid: string, action: string) => h.db.all<{ data: string }>('SELECT data FROM audit_events WHERE action = ? AND target_id = ? ORDER BY at', [action, uid]);
const details = (r: { json: { error?: { details?: unknown } } }) => r.json.error!.details as { pendingToken: string; email: string; name: string | null; expiresInMinutes: number };
const asMobile = async (token: string) => { const c = client(h.app); c.useBearer(token); return c; };

test('GET /public/config says which sign-in buttons to show, with the public identifiers and nothing secret', async () => {
  const r = await client(h.app).get('/api/public/config');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.signIn, { google: true, apple: true, standin: true, googleClientIds: { ios: IOS_ID }, appleServicesId: SERVICES_ID });
  assert.ok(fetches.some((u) => u.includes('appleid.apple.com')), 'apple is offered only once its keys were fetched');
  const n = fetches.length;
  await client(h.app).get('/api/public/config');
  assert.equal(fetches.length, n, 'keys are cached, not fetched per request');

  type Row = { key: string; status: string; configured: boolean; missing: string[]; variables: string[]; mode: string; note: string };
  const identityRow = async (dev: Awaited<ReturnType<typeof makeApp>>) => {
    // the integrations registry names what the owner still has to provide (an owner made outside the demo seed)
    createPrivilegedUser(dev.ctx, { email: 'owner@dev.test', name: 'Owner', password: 'A-long-owner-password-1', role: 'owner' });
    // two-factor authentication is mandatory for owners: this one has an authenticator enrolled (the enrolment flow
    // itself is tested in mandatory-mfa.test.ts)
    dev.db.run('UPDATE users SET mfa_secret = ?, mfa_enabled = 1 WHERE email = ?', [DEMO_MFA_SECRET, 'owner@dev.test']);
    const o = client(dev.app);
    await o.login('owner@dev.test', 'A-long-owner-password-1', 'dashboard', true);
    const reg = await o.get('/api/admin/integrations');
    assert.ok(!JSON.stringify(reg.json).includes(IOS_ID), 'no value is ever shown');
    return (reg.json.items as Row[]).find((i) => i.key === 'identity')!;
  };

  // a server with nothing configured, outside demo mode (every default is empty): no button, no stand-in, and the
  // registry says so (not "live" for a capability the owner has not set up)
  const dev = await makeApp({ seed: false, env: { BIOPTIME_MODE: 'development' } });
  try {
    const d = await client(dev.app).get('/api/public/config');
    assert.deepEqual(d.json.signIn, { google: false, apple: false, standin: false });
    assert.equal((await client(dev.app).post('/api/auth/social/login', { provider: 'standin', standinEmail: 'x@example.test' }, MOBILE)).status, 404, 'the stand-in exists in demo mode only');
    assert.equal((await client(dev.app).post('/api/auth/social/login', { provider: 'standin', standinEmail: 'x@example.test' }, MOBILE)).json.error?.code, 'PROVIDER_UNAVAILABLE');
    assert.equal((await client(dev.app).post('/api/auth/social/login', { provider: 'google', idToken: googleToken() }, MOBILE)).json.error?.code, 'PROVIDER_UNAVAILABLE', 'no Google client id: no Google sign-in');
    assert.equal((await client(dev.app).post('/api/auth/social/login', { provider: 'apple', idToken: appleToken() }, MOBILE)).json.error?.code, 'PROVIDER_UNAVAILABLE', 'no bundle id or Services ID: no Apple sign-in, by default');
    const row = await identityRow(dev);
    assert.equal(row.status, 'pending_configuration');
    assert.equal(row.configured, false);
    assert.equal(row.mode, 'none');
    assert.deepEqual(row.variables, ['GOOGLE_SIGN_IN_WEB_CLIENT_ID', 'GOOGLE_SIGN_IN_IOS_CLIENT_ID', 'GOOGLE_SIGN_IN_ANDROID_CLIENT_ID', 'APPLE_SIGN_IN_BUNDLE_IDS', 'APPLE_SIGN_IN_SERVICES_ID']);
    assert.ok(row.missing.some((m) => m.includes('Google Cloud') && m.includes('GOOGLE_SIGN_IN_IOS_CLIENT_ID')));
    assert.ok(row.missing.some((m) => m.includes('Apple Developer Program') && m.includes('com.bioptime.app') && m.includes('APPLE_SIGN_IN_BUNDLE_IDS')));
    assert.ok(row.missing.some((m) => m.includes('Apple Developer Program') && m.includes('APPLE_SIGN_IN_SERVICES_ID')));
    assert.ok(!row.missing.some((m) => m.includes('fetched')), 'no key fetch is expected while Apple is not set up');
    assert.match(row.note, /Neither button is offered yet/);
  } finally { await dev.app.close(); dev.db.close(); }

  // Google set and the bundle id set, but Apple's keys unreachable: Google only, and the row is not live
  const half = await makeApp({ seed: false, env: { BIOPTIME_MODE: 'development', GOOGLE_SIGN_IN_IOS_CLIENT_ID: IOS_ID, APPLE_SIGN_IN_BUNDLE_IDS: 'com.bioptime.app' } });
  try {
    assert.deepEqual((await client(half.app).get('/api/public/config')).json.signIn, { google: true, apple: false, standin: false, googleClientIds: { ios: IOS_ID } }, 'apple is set but its keys cannot be fetched there');
    const appleThere = await client(half.app).post('/api/auth/social/login', { provider: 'apple', idToken: appleToken() }, MOBILE);
    assert.equal(appleThere.status, 502, JSON.stringify(appleThere.json));
    assert.equal(appleThere.json.error?.code, 'UPSTREAM_UNAVAILABLE', 'keys unreachable: a truthful refusal, never a sign-in');
    const row = await identityRow(half);
    assert.equal(row.status, 'pending_configuration', 'live only once both providers are on');
    assert.equal(row.configured, false);
    assert.equal(row.mode, 'google');
    assert.ok(!row.missing.some((m) => m.includes('Google Cloud')));
    assert.ok(!row.missing.some((m) => m.includes('APPLE_SIGN_IN_BUNDLE_IDS')));
    assert.ok(row.missing.some((m) => m.includes('APPLE_SIGN_IN_SERVICES_ID')));
    assert.ok(row.missing.some((m) => m.includes('could not be fetched')));
    assert.match(row.note, /Only Google is offered so far/);
  } finally { await half.app.close(); half.db.close(); }

  const owner = client(h.app);
  await owner.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const here = ((await owner.get('/api/admin/integrations')).json.items as Row[]).find((i) => i.key === 'identity')!;
  assert.equal(here.status, 'live');
  assert.equal(here.configured, true);
  assert.equal(here.mode, 'google,apple,standin');
  assert.deepEqual(here.missing, []);
  assert.match(here.note, /Google and Apple are offered/);
});

test('the stand-in: a new member is asked for the acceptances, then created with a verified email and no password; consents, referral, welcome and audit as /auth/register', async () => {
  const email = 'nisha.new@example.test';
  const first = await standin(email, { standinName: 'Nisha New' });
  assert.equal(first.status, 409, JSON.stringify(first.json));
  assert.equal(first.json.error?.code, 'ACCOUNT_SETUP_NEEDED');
  const d = details(first);
  assert.ok(d.pendingToken.length >= 32);
  assert.equal(d.email, email);
  assert.equal(d.name, 'Nisha New');
  assert.equal(d.expiresInMinutes, 10);
  assert.ok(!h.db.get('SELECT 1 FROM users WHERE email = ?', [email]), 'no account yet');
  const pending = h.db.get<{ token_hash: string; expires_at: string; created_at: string; used_at: string | null }>('SELECT * FROM social_sign_ups WHERE email = ?', [email])!;
  assert.equal(pending.token_hash, sha256(d.pendingToken), 'the token is stored hashed');
  assert.equal(Date.parse(pending.expires_at) - Date.parse(pending.created_at), 10 * 60_000);

  // the acceptances are required, as on /auth/register; the token survives the refusal so the client can try again
  const noConsent = await social({ provider: 'standin', pendingToken: d.pendingToken, acceptTerms: true, termsVersion: '2026-10-17' });
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.json.error?.code, 'VALIDATION_FAILED');
  assert.ok((noConsent.json.error?.details as Array<{ path: string }>).some((f) => f.path === 'acceptPrivacy'));
  assert.equal(h.db.get<{ used_at: string | null }>('SELECT used_at FROM social_sign_ups WHERE email = ?', [email])!.used_at, null);
  assert.ok(!h.db.get('SELECT 1 FROM users WHERE email = ?', [email]), 'still no account');

  const code = h.db.get<{ code: string }>('SELECT c.code FROM referral_codes c JOIN users u ON u.id = c.member_id WHERE u.email = ?', [DEMO.member])!.code;
  const made = await social({ provider: 'standin', pendingToken: d.pendingToken, ...ACCEPT, marketingConsent: true, referralCode: code, name: 'Nisha N.' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.outcome, 'created');
  const user = made.json.user as { id: string; role: string; state: string; emailVerified: boolean; name: string; email: string };
  assert.equal(user.role, 'member');
  assert.equal(user.state, 'onboarding', 'the provider verified the email: onboarding starts at once');
  assert.equal(user.emailVerified, true);
  assert.equal(user.name, 'Nisha N.');
  assert.deepEqual(made.json.permissions, []);
  const token = (made.json.session as { token?: string; kind: string }).token!;
  assert.ok(token, 'the app gets its bearer token');
  assert.equal((made.json.session as { kind: string }).kind, 'mobile');
  const row = h.db.get<{ password_hash: string | null; email_verified_at: string | null }>('SELECT password_hash, email_verified_at FROM users WHERE id = ?', [user.id])!;
  assert.equal(row.password_hash, null);
  assert.ok(row.email_verified_at);
  assert.ok(h.db.get('SELECT 1 FROM member_profiles WHERE user_id = ? AND member_code LIKE ?', [user.id, 'BPM-%']));
  const consents = h.db.all<{ kind: string; granted: number; version: string }>('SELECT kind, granted, version FROM member_consents WHERE user_id = ? ORDER BY kind', [user.id]).map((r) => ({ ...r }));
  assert.deepEqual(consents, [{ kind: 'marketing', granted: 1, version: '2026-10-17' }, { kind: 'privacy', granted: 1, version: '2026-10-17' }, { kind: 'terms', granted: 1, version: '2026-10-17' }]);
  assert.ok(h.db.get('SELECT 1 FROM notification_preferences WHERE user_id = ?', [user.id]));
  assert.deepEqual(identities(user.id), [{ provider: 'standin', subject: `standin:${email}`, email }]);
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'welcome'", [user.id]));
  assert.ok(h.db.get("SELECT 1 FROM referrals WHERE referred_id = ? AND status = 'signed_up'", [user.id]), 'the referral is recorded like /auth/register');
  for (const a of ['auth.account_created_social', 'member.register', 'auth.social_signin', 'auth.login']) assert.equal(audits(user.id, a).length, 1, a);
  assert.equal(JSON.parse(audits(user.id, 'auth.login')[0]!.data).method, 'standin');
  assert.equal(h.db.get<{ used_at: string | null }>('SELECT used_at FROM social_sign_ups WHERE email = ?', [email])!.used_at !== null, true);

  const app = await asMobile(token);
  const me = await app.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal((me.json.user as { email: string }).email, email);
  assert.deepEqual(me.json.permissions, []);

  assert.equal((await social({ provider: 'standin', pendingToken: d.pendingToken, ...ACCEPT })).json.error?.code, 'TOKEN_USED', 'one use');
  const again = await standin(email);
  assert.equal(again.status, 200);
  assert.equal(again.json.outcome, 'signed_in', 'the linked identity signs in directly');
  assert.equal(identities(user.id).length, 1);

  // password sign-in points at the provider; the forgotten-password link sets a first password
  const pw = await client(h.app).post('/api/auth/login', { email, password: 'whatever-it-is-1', workspace: 'member' });
  assert.equal(pw.status, 401);
  assert.equal(pw.json.error?.code, 'SIGN_IN_WITH_PROVIDER');
  assert.match(pw.json.error!.message, /signs in with the stand-in; use that button, or set a password from the forgotten-password link/);
  assert.doesNotMatch(pw.json.error!.message, /demo/i, 'no demo label in anything a person reads');
  const forgot = await client(h.app).post('/api/auth/password/forgot', { email });
  assert.ok(forgot.json.demoToken, 'a social-only member may set a password');
  assert.equal((await client(h.app).post('/api/auth/password/reset', { token: forgot.json.demoToken, password: 'A-new-long-password-1' })).status, 200);
  const c = client(h.app);
  await c.login(email, 'A-new-long-password-1');
  assert.equal((await c.get('/api/auth/social/identities')).json.hasPassword, true);
});

test('an existing member with the verified email is linked and signed in; a staff email is refused and nothing is linked', async () => {
  const web = client(h.app);
  const r = await standin(DEMO.memberNoCoach, {}, web, { 'x-bioptime-client': 'web' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.outcome, 'linked');
  assert.equal((r.json.session as { token?: string }).token, undefined, 'the web session is a cookie');
  assert.ok(web.cookie.startsWith('bp_session='));
  assert.equal(((await web.get('/api/auth/me')).json.user as { email: string }).email, DEMO.memberNoCoach);
  const uid = userId(h.ctx, DEMO.memberNoCoach);
  assert.deepEqual(identities(uid), [{ provider: 'standin', subject: `standin:${DEMO.memberNoCoach}`, email: DEMO.memberNoCoach }]);
  assert.equal(audits(uid, 'auth.social_link').length, 1);
  assert.equal((await standin(DEMO.memberNoCoach)).json.outcome, 'signed_in');
  assert.equal(identities(uid).length, 1, 'linked once');
  // the password still works beside the identity
  assert.equal((await client(h.app).post('/api/auth/login', { email: DEMO.memberNoCoach, password: DEMO_PASSWORDS.member, workspace: 'member' })).status, 200);

  // a registration that never opened its verification link: the provider's verified email verifies it
  const reg = await client(h.app).post('/api/auth/register', { email: 'unverified.member@example.test', password: 'A-long-demo-password-1', name: 'Unverified Member', ...ACCEPT });
  assert.equal(reg.status, 201);
  const u2 = (reg.json.user as { id: string; state: string });
  assert.equal(u2.state, 'pending_verification');
  const linked = await standin('unverified.member@example.test');
  assert.equal(linked.status, 200);
  assert.equal((linked.json.user as { state: string; emailVerified: boolean }).state, 'onboarding');
  assert.equal((linked.json.user as { emailVerified: boolean }).emailVerified, true);
  assert.equal(audits(u2.id, 'auth.email_verified').length, 1);

  // never staff: coach, administrator and owner emails are refused, and nothing is linked or signed in
  for (const email of [DEMO.coach, DEMO.admin, DEMO.owner]) {
    const sessionsBefore = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM sessions WHERE user_id = ?', [userId(h.ctx, email)])!.n;
    const refused = await standin(email);
    assert.equal(refused.status, 403, email);
    assert.equal(refused.json.error?.code, 'WRONG_WORKSPACE');
    assert.equal(identities(userId(h.ctx, email)).length, 0, `${email} is not linked`);
    assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM sessions WHERE user_id = ?', [userId(h.ctx, email)])!.n, sessionsBefore, `${email} is not signed in`);
    assert.ok(!h.db.get('SELECT 1 FROM social_sign_ups WHERE email = ?', [email]), 'no pending sign-up for a staff email');
  }
  // and a pending token can only ever make a member: the role is fixed in the code path, whatever the body says
  const p = details(await standin('would.be.admin@example.test'));
  const made = await social({ provider: 'standin', pendingToken: p.pendingToken, ...ACCEPT, role: 'owner', workspace: 'admin' });
  assert.equal(made.status, 201);
  assert.equal((made.json.user as { role: string }).role, 'member');
  assert.deepEqual(made.json.permissions, []);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE role IN ('admin', 'owner')")!.n, 2 + DEMO_OWNERS.length, 'still only the seeded privileged accounts (owner@, admin@, Rohan and Avinash)');

  // a suspended member is refused as on password sign-in
  const sus = userId(h.ctx, DEMO.memberNoShare);
  h.db.run("UPDATE users SET state = 'suspended' WHERE id = ?", [sus]);
  try { assert.equal((await standin(DEMO.memberNoShare)).json.error?.code, 'ACCOUNT_SUSPENDED'); assert.equal(identities(sus).length, 0); }
  finally { h.db.run("UPDATE users SET state = 'active' WHERE id = ?", [sus]); }
});

test('a registration whose email was never verified is handed to the provider’s holder: its password, phone confirmation and sessions go; a verified member and a member linking their own account keep everything', async () => {
  const userRow = (email: string) => h.db.get<{ id: string; state: string; password_hash: string | null; phone: string | null; phone_verified_at: string | null; email_verified_at: string | null }>('SELECT id, state, password_hash, phone, phone_verified_at, email_verified_at FROM users WHERE email = ?', [email])!;
  const pwLogin = (email: string, password: string) => client(h.app).post('/api/auth/login', { email, password, workspace: 'member' }, MOBILE);

  // the pre-registration takeover: someone registers the victim's email with a password of their own (and even
  // confirms a phone), signs in, and waits for the victim to tap Sign in with Google
  const victim = 'victim.prehijack@example.test';
  const reg = await client(h.app).post('/api/auth/register', { email: victim, password: 'Attacker-Password-1', name: 'Not The Owner', ...ACCEPT });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.equal((reg.json.user as { state: string }).state, 'pending_verification');
  const attackerLogin = await pwLogin(victim, 'Attacker-Password-1');
  assert.equal(attackerLogin.status, 200, 'the unverified registration can sign in with its password before the claim (unchanged)');
  const attacker = await asMobile((attackerLogin.json.session as { token: string }).token);
  assert.equal((await attacker.get('/api/auth/me')).status, 200);
  h.db.run("UPDATE users SET phone = '+919999900001', phone_verified_at = ? WHERE email = ?", [new Date().toISOString(), victim]);
  const uid = userRow(victim).id;

  // the address's owner arrives with the provider: linked, verified, and the account is theirs alone now
  const claim = await standin(victim, { standinName: 'The Owner' });
  assert.equal(claim.status, 200, JSON.stringify(claim.json));
  assert.equal(claim.json.outcome, 'linked');
  const u = claim.json.user as { id: string; state: string; emailVerified: boolean; phoneVerified: boolean };
  assert.equal(u.id, uid);
  assert.equal(u.state, 'onboarding');
  assert.equal(u.emailVerified, true);
  assert.equal(u.phoneVerified, false, 'the phone whoever registered confirmed is no longer confirmed');
  const after = userRow(victim);
  assert.equal(after.password_hash, null, 'the unproven password is gone');
  assert.equal(after.phone_verified_at, null);
  assert.equal(after.phone, '+919999900001', 'the number itself stays on the profile, to be confirmed again');
  assert.ok(after.email_verified_at);
  assert.equal((await attacker.get('/api/auth/me')).status, 401, 'the session opened before the claim is revoked');
  const oldPw = await pwLogin(victim, 'Attacker-Password-1');
  assert.equal(oldPw.status, 401);
  assert.equal(oldPw.json.error?.code, 'SIGN_IN_WITH_PROVIDER', 'the old password no longer signs in');
  const owner = await asMobile((claim.json.session as { token: string }).token);
  assert.equal((await owner.get('/api/auth/me')).status, 200, 'the new session (the claimant’s) works');
  assert.equal((await owner.get('/api/auth/social/identities')).json.hasPassword, false);
  const linkAudit = JSON.parse(audits(uid, 'auth.social_link')[0]!.data) as Record<string, unknown>;
  assert.equal(linkAudit.claimed, true);
  assert.equal(linkAudit.passwordCleared, true);
  assert.equal(linkAudit.phoneUnconfirmed, true);
  assert.ok((linkAudit.sessionsRevoked as number) >= 1, JSON.stringify(linkAudit));
  assert.equal(audits(uid, 'auth.email_verified').length, 1);
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'security'", [uid]), 'the member is told');
  // only the inbox can set a new password
  const forgot = await client(h.app).post('/api/auth/password/forgot', { email: victim });
  assert.ok(forgot.json.demoToken);
  assert.equal((await client(h.app).post('/api/auth/password/reset', { token: forgot.json.demoToken, password: 'Owner-Chosen-Password-1' })).status, 200);
  assert.equal((await pwLogin(victim, 'Owner-Chosen-Password-1')).status, 200);
  assert.equal((await pwLogin(victim, 'Attacker-Password-1')).status, 401);
  // the same account signs in by its identity afterwards, with nothing cleared again
  const again = await standin(victim);
  assert.equal(again.json.outcome, 'signed_in');
  assert.ok(userRow(victim).password_hash, 'a later sign-in by the linked identity leaves the password alone');

  // the second call site: the pending token was issued before the pre-registration, and completes against it
  const raced = 'raced.prehijack@example.test';
  const pending = details(await standin(raced));
  assert.equal((await client(h.app).post('/api/auth/register', { email: raced, password: 'Racer-Password-1', name: 'Racer', ...ACCEPT })).status, 201);
  const racerLogin = await pwLogin(raced, 'Racer-Password-1');
  assert.equal(racerLogin.status, 200);
  const racer = await asMobile((racerLogin.json.session as { token: string }).token);
  const done = await social({ provider: 'standin', pendingToken: pending.pendingToken, ...ACCEPT });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.outcome, 'linked');
  assert.equal(userRow(raced).password_hash, null);
  assert.equal(userRow(raced).state, 'onboarding');
  assert.equal((await racer.get('/api/auth/me')).status, 401);
  assert.equal((await pwLogin(raced, 'Racer-Password-1')).json.error?.code, 'SIGN_IN_WITH_PROVIDER');

  // a member whose email was verified keeps the password and the open sessions: both sides proved the address
  const verified = DEMO.member;
  assert.ok(userRow(verified).email_verified_at, 'seeded members have verified emails');
  const before = await pwLogin(verified, DEMO_PASSWORDS.member);
  assert.equal(before.status, 200);
  const open = await asMobile((before.json.session as { token: string }).token);
  const linkedVerified = await standin(verified);
  assert.equal(linkedVerified.status, 200);
  assert.equal(linkedVerified.json.outcome, 'linked');
  assert.ok(userRow(verified).password_hash);
  assert.equal((await open.get('/api/auth/me')).status, 200, 'nothing revoked');
  assert.equal((await pwLogin(verified, DEMO_PASSWORDS.member)).status, 200);
  assert.equal(JSON.parse(audits(userId(h.ctx, verified), 'auth.social_link')[0]!.data).claimed, undefined);

  // a signed-in member linking their own unverified account proves both sides themselves: verified, nothing cleared
  const self = 'self.link@example.test';
  assert.equal((await client(h.app).post('/api/auth/register', { email: self, password: 'Self-Password-1', name: 'Self Link', ...ACCEPT })).status, 201);
  const selfLogin = await pwLogin(self, 'Self-Password-1');
  const me = await asMobile((selfLogin.json.session as { token: string }).token);
  const linkedSelf = await me.post('/api/auth/social/link', { provider: 'standin', standinEmail: self }, MOBILE);
  assert.equal(linkedSelf.status, 200, JSON.stringify(linkedSelf.json));
  assert.equal(linkedSelf.json.hasPassword, true);
  assert.equal(userRow(self).state, 'onboarding', 'the provider verified the email');
  assert.ok(userRow(self).password_hash);
  assert.equal((await me.get('/api/auth/me')).status, 200, 'the member’s own session stays');
  assert.equal((await pwLogin(self, 'Self-Password-1')).status, 200);
  assert.equal(JSON.parse(audits(userRow(self).id, 'auth.social_link')[0]!.data).claimed, undefined);
});

test('Google and Apple ID tokens are verified against the providers’ keys; the wrong audience, issuer, expiry, signature, algorithm, email and nonce are all refused', async () => {
  const good = await social({ provider: 'google', idToken: googleToken() });
  assert.equal(good.status, 409, JSON.stringify(good.json));
  assert.equal(good.json.error?.code, 'ACCOUNT_SETUP_NEEDED');
  assert.equal(details(good).email, 'gita@example.test');
  assert.equal(details(good).name, 'Gita Google');
  const reason = async (body: Record<string, unknown>) => { const r = await social(body); assert.equal(r.status, 401, JSON.stringify(r.json)); assert.equal(r.json.error?.code, 'TOKEN_INVALID'); return (r.json.error?.details as { reason: string }).reason; };
  assert.equal(await reason({ provider: 'google', idToken: googleToken({ aud: 'someone-else.apps.googleusercontent.com' }) }), 'audience');
  assert.equal(await reason({ provider: 'google', idToken: googleToken({ iss: 'https://accounts.example.test' }) }), 'issuer');
  assert.equal(await reason({ provider: 'google', idToken: googleToken({ exp: nowS() - 600 }) }), 'expired');
  assert.equal(await reason({ provider: 'google', idToken: googleToken({ email_verified: false }) }), 'email_unverified');
  assert.equal(await reason({ provider: 'google', idToken: googleToken({ email: undefined }) }), 'email_unverified');
  assert.equal(await reason({ provider: 'google', idToken: googleToken({ sub: '' }) }), 'subject');
  assert.equal(await reason({ provider: 'google', idToken: googleToken({}, {}, rogue) }), 'signature', 'a token signed by a key that is not Google’s');
  const before = fetches.filter((u) => u.includes('googleapis')).length;
  assert.equal(await reason({ provider: 'google', idToken: googleToken({}, { kid: 'g-unknown' }, rogue) }), 'unknown_key');
  assert.equal(fetches.filter((u) => u.includes('googleapis')).length, before + 1, 'an unknown kid refetches the keys once (a rotation), then refuses');
  assert.equal(await reason({ provider: 'google', idToken: googleToken({}, { alg: 'HS256' }) }), 'alg');
  assert.equal(await reason({ provider: 'google', idToken: googleToken({}, { alg: 'none' }) }), 'alg');
  assert.equal(await reason({ provider: 'google', idToken: `${b64({ alg: 'none' })}.${b64({ sub: 'x' })}.` }), 'malformed');
  assert.equal(await reason({ provider: 'google', idToken: 'not-a-token-at-all-really' }), 'malformed');
  assert.equal(await reason({ provider: 'apple', idToken: googleToken() }), 'unknown_key', 'a Google token is not an Apple token');
  // Apple: the bundle id or the Services ID as audience; the nonce (hashed, as the native flow sends it) when given
  const nonce = 'n0nce-from-the-app';
  const ap = await social({ provider: 'apple', idToken: appleToken({ nonce: sha256(nonce) }), nonce });
  assert.equal(ap.status, 409, JSON.stringify(ap.json));
  assert.equal(details(ap).email, 'relay.1@privaterelay.appleid.com');
  assert.equal(details(ap).name, null, 'Apple gives no name in the token; the app passes it when creating the account');
  assert.equal(await reason({ provider: 'apple', idToken: appleToken({ nonce: sha256(nonce) }), nonce: 'another' }), 'nonce');
  assert.equal(await reason({ provider: 'apple', idToken: appleToken({}), nonce }), 'nonce', 'a nonce given but absent from the token');
  assert.equal((await social({ provider: 'apple', idToken: appleToken({ aud: SERVICES_ID, sub: 'apple-sub-web' }) })).status, 409, 'the Services ID is an audience too');
  assert.equal(await reason({ provider: 'apple', idToken: appleToken({ aud: 'com.someone.else' }) }), 'audience');
  assert.equal((await social({ provider: 'google' })).json.error?.code, 'VALIDATION_FAILED', 'no token, no sign-in');
  // a mobile sign-up from the Apple identity, the name supplied by the app (Apple hands it over outside the token)
  const made = await social({ provider: 'apple', pendingToken: details(ap).pendingToken, ...ACCEPT, name: 'Arjun Apple' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal((made.json.user as { name: string; email: string }).name, 'Arjun Apple');
  assert.equal((made.json.user as { email: string }).email, 'relay.1@privaterelay.appleid.com');
  assert.deepEqual(identities((made.json.user as { id: string }).id), [{ provider: 'apple', subject: 'apple-sub-1', email: 'relay.1@privaterelay.appleid.com' }]);
  // and signs in by subject afterwards, even when the token carries no email any more
  const back = await social({ provider: 'apple', idToken: appleToken({ email: undefined, email_verified: undefined }) });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(back.json.outcome, 'signed_in');
});

test('the verifier is a plain function over the keys: expiry leeway, time claims, and a provider whose keys fail', async () => {
  const keys = new ProviderKeys(jwks);
  const ok = await verifyIdToken(keys, 'google', googleToken(), { audiences: [IOS_ID] });
  assert.deepEqual(ok, { provider: 'google', subject: 'google-sub-1', email: 'gita@example.test', emailVerified: true, name: 'Gita Google' });
  assert.ok(await verifyIdToken(keys, 'google', googleToken({ exp: nowS() - 30 }), { audiences: [IOS_ID] }), 'a minute of leeway on exp');
  await assert.rejects(verifyIdToken(keys, 'google', googleToken({ iat: nowS() + 3600 }), { audiences: [IOS_ID] }), /verified/);
  await assert.rejects(verifyIdToken(keys, 'google', googleToken({ nbf: nowS() + 3600 }), { audiences: [IOS_ID] }), /verified/);
  await assert.rejects(verifyIdToken(keys, 'google', googleToken(), { audiences: [] }), /verified/);
  assert.equal(keys.state('google'), 'fresh');
  assert.equal(keys.state('apple'), 'unknown');
  const broken = new ProviderKeys(async () => { throw new Error('offline'); });
  assert.equal(await broken.available('apple'), false);
  assert.equal(broken.state('apple'), 'failed');
  await assert.rejects(verifyIdToken(broken, 'apple', appleToken(), { audiences: ['com.bioptime.app'] }), (e: { code?: string }) => e.code === 'UPSTREAM_UNAVAILABLE');
});

test('identities: list, link, unlink; the last way into the account cannot be unlinked; one provider account links to one member', async () => {
  const solo = 'solo@example.test';
  const d = details(await standin(solo));
  const made = await social({ provider: 'standin', pendingToken: d.pendingToken, ...ACCEPT });
  assert.equal(made.status, 201);
  const uid = (made.json.user as { id: string }).id;
  const app = await asMobile((made.json.session as { token: string }).token);
  let list = await app.get('/api/auth/social/identities');
  assert.equal(list.status, 200);
  assert.equal(list.json.hasPassword, false);
  const items = list.json.items as Array<{ provider: string; email: string | null; linkedAt: string }>;
  assert.equal(items.length, 1);
  assert.equal(items[0]!.provider, 'standin');
  assert.equal(items[0]!.email, solo);
  assert.ok(items[0]!.linkedAt);

  const link = await app.post('/api/auth/social/link', { provider: 'google', idToken: googleToken({ sub: 'google-solo', email: 'solo.g@example.test' }) }, MOBILE);
  assert.equal(link.status, 200, JSON.stringify(link.json));
  assert.deepEqual((link.json.items as Array<{ provider: string }>).map((i) => i.provider), ['standin', 'google']);
  assert.equal(audits(uid, 'auth.social_link').length, 1);
  const same = await app.post('/api/auth/social/link', { provider: 'google', idToken: googleToken({ sub: 'google-solo', email: 'solo.g@example.test' }) }, MOBILE);
  assert.equal((same.json.items as unknown[]).length, 2, 'linking the same identity again changes nothing');
  const other = await app.post('/api/auth/social/link', { provider: 'google', idToken: googleToken({ sub: 'google-solo-2' }) }, MOBILE);
  assert.equal(other.json.error?.code, 'PROVIDER_ALREADY_LINKED');
  assert.equal((await app.post('/api/auth/social/link', { provider: 'google', idToken: googleToken({ sub: 'google-solo' }, {}, rogue) }, MOBILE)).json.error?.code, 'TOKEN_INVALID', 'the same verification as signing in');
  // the Google account now signs this member in directly
  const viaGoogle = await social({ provider: 'google', idToken: googleToken({ sub: 'google-solo', email: 'solo.g@example.test' }) });
  assert.equal(viaGoogle.status, 200);
  assert.equal((viaGoogle.json.user as { id: string }).id, uid);
  // another member cannot take it
  const otherMember = client(h.app);
  await otherMember.login(DEMO.member2, DEMO_PASSWORDS.member);
  const taken = await otherMember.post('/api/auth/social/link', { provider: 'google', idToken: googleToken({ sub: 'google-solo' }) });
  assert.equal(taken.json.error?.code, 'IDENTITY_IN_USE');
  assert.equal(identities(userId(h.ctx, DEMO.member2)).length, 0);

  assert.equal((await app.del('/api/auth/social/identities/facebook')).status, 404);
  const gone = await app.del('/api/auth/social/identities/google');
  assert.equal(gone.status, 200, JSON.stringify(gone.json));
  assert.deepEqual((gone.json.items as Array<{ provider: string }>).map((i) => i.provider), ['standin']);
  assert.equal(audits(uid, 'auth.social_unlink').length, 1);
  assert.equal((await app.del('/api/auth/social/identities/google')).status, 404, 'not linked any more');
  const last = await app.del('/api/auth/social/identities/standin');
  assert.equal(last.status, 409);
  assert.equal(last.json.error?.code, 'LAST_SIGN_IN_METHOD');
  assert.equal(identities(uid).length, 1, 'still linked');
  // with a password set, the last identity may go
  const forgot = await client(h.app).post('/api/auth/password/forgot', { email: solo });
  await client(h.app).post('/api/auth/password/reset', { token: forgot.json.demoToken, password: 'A-solo-long-password-1' });
  const pwLogin = await client(h.app).post('/api/auth/login', { email: solo, password: 'A-solo-long-password-1', workspace: 'member' }, MOBILE);
  assert.equal(pwLogin.status, 200, JSON.stringify(pwLogin.json));
  const app2 = await asMobile((pwLogin.json.session as { token: string }).token);
  list = await app2.get('/api/auth/social/identities');
  assert.equal(list.json.hasPassword, true);
  assert.equal((await app2.del('/api/auth/social/identities/standin')).status, 200);
  assert.equal(identities(uid).length, 0);

  // members only
  const coach = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  assert.equal((await coach.get('/api/auth/social/identities')).status, 403);
  assert.equal((await coach.post('/api/auth/social/link', { provider: 'standin', standinEmail: DEMO.coach })).status, 403);
  assert.equal(identities(userId(h.ctx, DEMO.coach)).length, 0);
});

test('a pending sign-up expires after 10 minutes and is purged; an invited member is pointed at the invitation link', async () => {
  const d = details(await standin('late@example.test'));
  h.db.run('UPDATE social_sign_ups SET expires_at = ? WHERE email = ?', [new Date(Date.now() - 1000).toISOString(), 'late@example.test']);
  const r = await social({ provider: 'standin', pendingToken: d.pendingToken, ...ACCEPT });
  assert.equal(r.json.error?.code, 'TOKEN_EXPIRED');
  assert.equal((await social({ provider: 'standin', pendingToken: 'x'.repeat(40), ...ACCEPT })).json.error?.code, 'TOKEN_INVALID');
  h.db.run('UPDATE social_sign_ups SET created_at = ? WHERE email = ?', [new Date(Date.now() - 2 * 24 * 3600_000).toISOString(), 'late@example.test']);
  await standin('purge.trigger@example.test');
  assert.ok(!h.db.get('SELECT 1 FROM social_sign_ups WHERE email = ?', ['late@example.test']), 'rows older than a day are purged');

  const admin = client(h.app);
  await admin.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  const inv = await admin.post('/api/admin/members/invite', { email: 'invited.social@example.test', name: 'Invited Social' });
  assert.ok(inv.status === 201 || inv.status === 200, JSON.stringify(inv.json));
  const refused = await standin('invited.social@example.test');
  assert.equal(refused.json.error?.code, 'INVITATION_PENDING');
  assert.equal(identities(userId(h.ctx, 'invited.social@example.test')).length, 0);
  assert.equal((await client(h.app).post('/api/auth/password/forgot', { email: 'invited.social@example.test' })).json.demoToken, undefined, 'an invited account still activates only from its link');
});

test('Apple’s form post continues to the app scheme, or to the portal with the token in the fragment; tokens never reach the request log', async () => {
  const post = (payload: string) => h.app.inject({ method: 'POST', url: '/api/auth/social/apple/return', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload });
  const token = appleToken();
  const user = JSON.stringify({ name: { firstName: 'Arjun', lastName: 'A' }, email: 'relay.1@privaterelay.appleid.com' });
  const r = await post(new URLSearchParams({ code: 'c0de', id_token: token, state: 'app-s1', user }).toString());
  assert.equal(r.statusCode, 303);
  const loc = new URL(r.headers.location as string);
  assert.equal(`${loc.protocol}//${loc.host}${loc.pathname}`, 'bioptime://social/apple');
  assert.equal(loc.searchParams.get('id_token'), token);
  assert.equal(loc.searchParams.get('state'), 'app-s1');
  assert.equal(loc.searchParams.get('user'), user);
  assert.equal(loc.searchParams.get('error'), null);
  assert.equal(loc.searchParams.get('code'), null, 'the authorisation code is not forwarded: the token is what the server verifies');
  assert.equal(r.headers['cache-control'], 'no-store');

  const web = await post(new URLSearchParams({ id_token: token, state: 'web:abc' }).toString());
  const wl = web.headers.location as string;
  assert.ok(wl.startsWith('http://localhost:3000/login/client?apple=return#'), wl);
  const frag = new URLSearchParams(wl.split('#')[1]);
  assert.equal(frag.get('id_token'), token);
  assert.equal(frag.get('state'), 'web:abc');

  const cancelled = await post(new URLSearchParams({ error: 'user_cancelled_authorize', state: 'app-s2' }).toString());
  const cl = new URL(cancelled.headers.location as string);
  assert.equal(cl.searchParams.get('error'), 'user_cancelled_authorize');
  assert.equal(cl.searchParams.get('id_token'), null);
  const empty = await post('');
  assert.equal(new URL(empty.headers.location as string).searchParams.get('error'), 'missing_token');
  const odd = await post(new URLSearchParams({ id_token: 'not a jwt', state: 'bad state with spaces' }).toString());
  const ol = new URL(odd.headers.location as string);
  assert.equal(ol.searchParams.get('id_token'), null);
  assert.equal(ol.searchParams.get('state'), null);
  // JSON works the same (a client that proxies the post)
  const asJson = await client(h.app).post('/api/auth/social/apple/return', { id_token: token, state: 's3' });
  assert.equal(asJson.status, 303);

  assert.equal(redactTokens('/login/client?apple=return&id_token=eyJabc&pendingToken=xyz&state=s'), '/login/client?apple=return&id_token=[redacted]&pendingToken=[redacted]&state=s');
});

test('the OpenAPI document lists the social routes with their extra responses', async () => {
  const spec = (await client(h.app).get('/api/openapi.json')).json as { paths: Record<string, Record<string, { responses: Record<string, { description: string }>; 'x-role': string }>> };
  const login = spec.paths['/auth/social/login']!.post!;
  assert.equal(login['x-role'], 'none');
  assert.match(login.responses['409']!.description, /ACCOUNT_SETUP_NEEDED/);
  assert.equal(spec.paths['/auth/social/identities']!.get!['x-role'], 'member');
  assert.ok(spec.paths['/auth/social/identities/{provider}']!.delete);
  assert.ok(spec.paths['/auth/social/link']!.post);
  assert.match(spec.paths['/auth/social/apple/return']!.post!.responses['303']!.description, /app scheme/);
  assert.equal(ALL_PERMISSIONS.length > 0, true);
});
