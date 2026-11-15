/* Coach ID sign-in (30 October 2026): a coach signs in to the coach workspace with the Coach ID on their profile
   (coach_profiles.coach_code, BPC-0001) and their password. Letter case and surrounding spaces do not matter; a wrong
   Coach ID answers exactly as a wrong password does; Coach ID and email sign-in share one lockout; a Coach ID is for the
   coach workspace only; email and password sign-in keeps working for every role. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const codeOf = (email: string) => h.db.get<{ coach_code: string }>('SELECT coach_code FROM coach_profiles WHERE user_id = ?', [userId(h.ctx, email)])!.coach_code;
const login = (body: Record<string, unknown>, headers: Record<string, string> = {}) => client(h.app).post('/api/auth/login', body, headers);
const unlock = (email: string) => h.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE email = ?', [email]);

test('the right Coach ID and password open the coach workspace (web cookie and mobile token), and the sign-in is audited as a Coach ID sign-in', async () => {
  const code = codeOf(DEMO.coach);
  assert.match(code, /^BPC-\d{4}$/, 'seeded coaches carry a Coach ID');
  const c = client(h.app);
  const r = await c.post('/api/auth/login', { coachId: code, password: DEMO_PASSWORDS.coach, workspace: 'coach' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const user = r.json.user as { id: string; role: string; email: string };
  assert.deepEqual([user.id, user.role], [userId(h.ctx, DEMO.coach), 'coach']);
  assert.ok(c.cookie.startsWith('bp_session='), 'the web session cookie is set');
  assert.equal((r.json.session as { token?: string }).token, undefined, 'web sessions never carry the token in the body');
  assert.equal((await c.get('/api/auth/me')).status, 200);
  assert.equal((await c.get('/api/coach/clients')).status, 200, 'the coach workspace answers');
  assert.equal((await c.get('/api/admin/overview')).status, 403, 'and nothing of the admin workspace');

  const m = await login({ coachId: code, password: DEMO_PASSWORDS.coach, workspace: 'coach' }, { 'x-bioptime-client': 'mobile' });
  assert.equal(m.status, 200);
  assert.ok(typeof (m.json.session as { token?: string }).token === 'string', 'mobile gets the bearer token');

  const row = h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'auth.login' AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", [user.id])!;
  assert.equal(JSON.parse(row.data).via, 'coach_id');
});

test('letter case and surrounding spaces do not matter; inner characters do', async () => {
  const code = codeOf(DEMO.coach);
  for (const variant of [code.toLowerCase(), `  ${code}  `, `\t${code.toLowerCase()} `, code.replace('BPC', 'bPc')]) {
    const r = await login({ coachId: variant, password: DEMO_PASSWORDS.coach, workspace: 'coach' });
    assert.equal(r.status, 200, `${JSON.stringify(variant)}: ${JSON.stringify(r.json)}`);
    assert.equal((r.json.user as { id: string }).id, userId(h.ctx, DEMO.coach));
  }
  const r = await login({ coachId: code.replace('-', ''), password: DEMO_PASSWORDS.coach, workspace: 'coach' });
  assert.equal(r.json.error?.code, 'INVALID_CREDENTIALS', 'BPC0001 is not BPC-0001');
  unlock(DEMO.coach);
});

test('a wrong Coach ID and a wrong password get the same generic answer; an invited coach without a password too', async () => {
  const code = codeOf(DEMO.coach3);
  const wrongId = await login({ coachId: 'BPC-9999', password: DEMO_PASSWORDS.coach, workspace: 'coach' });
  const wrongPw = await login({ coachId: code, password: 'Not-the-password-1', workspace: 'coach' });
  const unknownShape = await login({ coachId: 'nobody', password: 'whatever', workspace: 'coach' });
  for (const r of [wrongId, wrongPw, unknownShape]) {
    assert.equal(r.status, 401);
    assert.equal(r.json.error?.code, 'INVALID_CREDENTIALS');
    assert.equal(r.json.error?.message, wrongId.json.error?.message, 'one message for every wrong Coach ID or password');
  }
  assert.doesNotMatch(String(wrongId.json.error?.message), /BPC|exist|found/i, 'the answer never says whether the Coach ID exists');
  unlock(DEMO.coach3);

  // an invited coach has a Coach ID but no password until the invitation is accepted
  const owner = client(h.app);
  await owner.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const inv = await owner.post('/api/admin/coaches/invite', { email: 'not.yet.active@demo.bioptime.test', displayName: 'Not Yet Active' });
  assert.equal(inv.status, 201, JSON.stringify(inv.json));
  const invitedCode = codeOf('not.yet.active@demo.bioptime.test');
  const r = await login({ coachId: invitedCode, password: 'Any-password-123', workspace: 'coach' });
  assert.deepEqual([r.status, r.json.error?.code], [401, 'INVALID_CREDENTIALS']);
});

test('a Coach ID signs in to the coach workspace only: any other workspace, none, or both identifiers is VALIDATION_FAILED', async () => {
  const code = codeOf(DEMO.coach);
  for (const body of [
    { coachId: code, password: DEMO_PASSWORDS.coach, workspace: 'admin' },
    { coachId: code, password: DEMO_PASSWORDS.coach, workspace: 'member' },
    { coachId: code, password: DEMO_PASSWORDS.coach, workspace: 'client' },
    { coachId: code, password: DEMO_PASSWORDS.coach, workspace: 'dashboard' },
    { coachId: code, password: DEMO_PASSWORDS.coach },
    { coachId: code, email: DEMO.coach, password: DEMO_PASSWORDS.coach, workspace: 'coach' },
    { password: DEMO_PASSWORDS.coach, workspace: 'coach' },
    { coachId: '   ', password: DEMO_PASSWORDS.coach, workspace: 'coach' },
  ]) {
    const r = await login(body);
    assert.deepEqual([r.status, r.json.error?.code], [400, 'VALIDATION_FAILED'], JSON.stringify(body));
  }
  assert.equal(h.db.get<{ failed_logins: number }>('SELECT failed_logins FROM users WHERE email = ?', [DEMO.coach])!.failed_logins, 0, 'a refused body is not a sign-in attempt');
});

test('Coach ID and email sign-in share one lockout, and a success either way clears it', async () => {
  const email = DEMO.coach2;
  const code = codeOf(email);
  unlock(email);
  // four failures, mixed, then a correct Coach ID sign-in clears the count
  for (let i = 0; i < 2; i++) assert.equal((await login({ coachId: code, password: `Wrong-${i}-password`, workspace: 'coach' })).status, 401);
  for (let i = 0; i < 2; i++) assert.equal((await login({ email, password: `Wrong-${i}-password`, workspace: 'coach' })).status, 401);
  assert.equal(h.db.get<{ failed_logins: number }>('SELECT failed_logins FROM users WHERE email = ?', [email])!.failed_logins, 4, 'both ways count on the same account');
  assert.equal((await login({ coachId: code, password: DEMO_PASSWORDS.coach, workspace: 'coach' })).status, 200);
  assert.equal(h.db.get<{ failed_logins: number }>('SELECT failed_logins FROM users WHERE email = ?', [email])!.failed_logins, 0);

  // five failures, mixed: the account is locked for either way in
  for (let i = 0; i < 3; i++) await login({ coachId: ` ${code.toLowerCase()} `, password: `Wrong-${i}-password`, workspace: 'coach' });
  for (let i = 0; i < 2; i++) await login({ email, password: `Wrong-${i}-password`, workspace: 'coach' });
  const byEmail = await login({ email, password: DEMO_PASSWORDS.coach, workspace: 'coach' });
  const byCode = await login({ coachId: code, password: DEMO_PASSWORDS.coach, workspace: 'coach' });
  assert.deepEqual([byEmail.status, byEmail.json.error?.code], [429, 'RATE_LIMITED'], 'locked: the right password by email is refused');
  assert.deepEqual([byCode.status, byCode.json.error?.code], [429, 'RATE_LIMITED'], 'and by Coach ID');
  unlock(email);
  assert.equal((await login({ coachId: code, password: DEMO_PASSWORDS.coach, workspace: 'coach' })).status, 200, 'after the lock, the Coach ID works again');
});

test('the original email and password sign-in is unchanged for every role, and workspace mismatches keep their answer', async () => {
  assert.equal((await login({ email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'member' })).status, 200);
  assert.equal((await login({ email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'client' })).status, 200);
  assert.equal((await login({ email: DEMO.coach, password: DEMO_PASSWORDS.coach, workspace: 'coach' })).status, 200);
  assert.equal((await login({ email: DEMO.coach, password: DEMO_PASSWORDS.coach, workspace: 'dashboard' })).status, 200);
  assert.equal((await login({ email: DEMO.coach, password: DEMO_PASSWORDS.coach })).status, 200, 'no workspace: as before');
  const ownerNoCode = await login({ email: DEMO.owner, password: DEMO_PASSWORDS.owner, workspace: 'admin' });
  assert.equal(ownerNoCode.json.error?.code, 'MFA_REQUIRED', 'administrators still need their code');
  const { totpCode } = await import('../../src/lib/crypto.js');
  const { DEMO_MFA_SECRET } = await import('../helpers.js');
  assert.equal((await login({ email: DEMO.owner, password: DEMO_PASSWORDS.owner, workspace: 'admin', mfaCode: totpCode(DEMO_MFA_SECRET) })).status, 200);
  // a coach in the admin workspace, a member in the coach workspace: the existing WRONG_WORKSPACE answer
  assert.deepEqual([(await login({ email: DEMO.coach, password: DEMO_PASSWORDS.coach, workspace: 'admin' })).json.error?.code], ['WRONG_WORKSPACE']);
  assert.deepEqual([(await login({ email: DEMO.member, password: DEMO_PASSWORDS.member, workspace: 'coach' })).json.error?.code], ['WRONG_WORKSPACE']);
  assert.deepEqual([(await login({ email: DEMO.coach, password: DEMO_PASSWORDS.coach, workspace: 'member' })).json.error?.code], ['WRONG_WORKSPACE']);
});

/** Counts scrypt runs (password hashes and checks) while fn runs: node:crypto's named exports, which api/lib/crypto.ts
 *  imports, follow the module object once syncBuiltinESMExports is called. */
async function scryptRuns(fn: () => Promise<unknown>): Promise<number> {
  const original = nodeCrypto.scryptSync;
  let runs = 0;
  nodeCrypto.scryptSync = ((...args: Parameters<typeof original>) => { runs++; return original(...args); }) as typeof original;
  syncBuiltinESMExports();
  try { await fn(); } finally { nodeCrypto.scryptSync = original; syncBuiltinESMExports(); }
  return runs;
}

test('the response time never tells whether a Coach ID or an email exists: every wrong answer costs exactly one password check', async () => {
  const email = DEMO.coach3;
  const code = codeOf(email);
  const owner = client(h.app);
  await owner.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const inv = await owner.post('/api/admin/coaches/invite', { email: 'timing.probe@demo.bioptime.test', displayName: 'Timing Probe' });
  assert.equal(inv.status, 201, JSON.stringify(inv.json));
  const invitedCode = codeOf('timing.probe@demo.bioptime.test');
  unlock(email);

  // deterministic: one scrypt on every path, found or not (it used to be two when nothing matched: a fresh hash, then the check)
  const cases: Array<[string, Record<string, unknown>, number]> = [
    ['unknown Coach ID', { coachId: 'BPC-9876', password: 'Not-the-password-1', workspace: 'coach' }, 401],
    ['invited coach, no password yet', { coachId: invitedCode, password: 'Not-the-password-1', workspace: 'coach' }, 401],
    ['real Coach ID, wrong password', { coachId: code, password: 'Not-the-password-1', workspace: 'coach' }, 401],
    ['unknown email', { email: 'nobody.here@demo.bioptime.test', password: 'Not-the-password-1', workspace: 'coach' }, 401],
    ['real email, wrong password', { email, password: 'Not-the-password-1', workspace: 'coach' }, 401],
    ['right Coach ID and password', { coachId: code, password: DEMO_PASSWORDS.coach, workspace: 'coach' }, 200],
  ];
  for (const [what, body, status] of cases) {
    let answer = 0;
    const runs = await scryptRuns(async () => { answer = (await login(body)).status; });
    assert.equal(answer, status, what);
    assert.equal(runs, 1, `${what}: exactly one scrypt`);
    unlock(email);
  }

  // and measured: the fastest of several interleaved tries (noise only ever adds time) is about the same either way
  const timed = async (body: Record<string, unknown>) => { const t0 = performance.now(); assert.equal((await login(body)).status, 401); return performance.now() - t0; };
  const unknownId: number[] = [], wrongPassword: number[] = [];
  for (let i = 0; i < 7; i++) {
    unknownId.push(await timed({ coachId: `BPC-${9000 + i}`, password: `Wrong-${i}-password`, workspace: 'coach' }));
    wrongPassword.push(await timed({ coachId: code, password: `Wrong-${i}-password`, workspace: 'coach' }));
    unlock(email);
  }
  const ratio = Math.min(...unknownId) / Math.min(...wrongPassword);
  assert.ok(ratio > 0.67 && ratio < 1.5, `unknown Coach ID ${Math.min(...unknownId).toFixed(1)} ms vs wrong password ${Math.min(...wrongPassword).toFixed(1)} ms (ratio ${ratio.toFixed(2)}; it was about 2 before)`);
});
