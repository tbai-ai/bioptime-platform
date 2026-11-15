/* Phone sign-in (switch 'phone_sign_in', migration 0035): one answer for every number (no account enumeration), codes
   that work once, for 10 minutes, with 5 attempts, stored only as an HMAC and never written down (the outbox withholds
   the digits), limits per number and per address, members only (never staff), confirming one's own number, the demo
   preview helper (demo mode, seeded members' sign-in codes only, never a confirmation code, the number in the body),
   truthful delivery wording while SMS is the outbox, and the production refusal while SMS is the outbox. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import * as phone from '../../src/auth/phoneSignIn.js';
import { setFlag, enabledFeatures } from '../../src/domain/features.js';
import { setAccountState } from '../../src/auth/service.js';
import { hmacHex, sha256 } from '../../src/lib/crypto.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const ANANYA = '+919700000011', VIKRAM = '+919700000012', DEEPA = '+919700000013', ARJUN = '+919700000014', SUNITA = '+919700000015', KARTHIK = '+919700000016';
const ownerCtx = (): Ctx => { const id = userId(h.ctx, DEMO.owner); return { ...h.ctx, actor: { id, role: 'owner', email: DEMO.owner, name: 'Bioptime owner' } }; };
const fresh = () => { h.db.run('DELETE FROM phone_sign_in_codes'); };
const start = (number: string, c = client(h.app)) => c.post('/api/auth/phone/start', { phone: number, workspace: 'client' });
const verify = (number: string, code: string, c = client(h.app), headers?: Record<string, string>) => c.post('/api/auth/phone/verify', { phone: number, code }, headers);
const preview = (number: string) => client(h.app).post('/api/auth/demo/phone-code', { phone: number });
const codeFor = async (number: string) => { const r = await preview(number); assert.equal(r.status, 200, JSON.stringify(r.json)); return String(r.json.code); };
const smsTo = (number: string) => h.db.all<{ body: string; to_address: string }>("SELECT body, to_address FROM outbox_messages WHERE channel = 'sms' AND to_address = ? ORDER BY created_at", [number]);
const rows = () => h.db.all<{ id: string; purpose: string; user_id: string | null; code_hash: string | null; attempts: number; used_at: string | null; phone_key: string }>('SELECT * FROM phone_sign_in_codes ORDER BY created_at');
/** A confirmation code is readable nowhere (the outbox withholds the digits; the preview helper never keeps one), so a
 *  test sets a known code on the newest live row of that purpose, with the server's own formula and secret. */
const plant = (purpose: 'sign_in' | 'confirm_phone', code = '424242') => {
  const r = h.db.get<{ id: string }>('SELECT id FROM phone_sign_in_codes WHERE purpose = ? AND used_at IS NULL AND code_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1', [purpose]);
  assert.ok(r, `a live ${purpose} code`);
  h.db.run('UPDATE phone_sign_in_codes SET code_hash = ? WHERE id = ?', [hmacHex(h.ctx.config.TOKEN_SECRET, `phone-sign-in:code:${r.id}:${code}`), r.id]);
  return code;
};
const PLATFORM = fileURLToPath(new URL('../../../../', import.meta.url));
const phoneVerifiedAt = (id: string) => h.db.get<{ phone_verified_at: string | null }>('SELECT phone_verified_at FROM users WHERE id = ?', [id])!.phone_verified_at;
const wrong = (code: string) => (code === '000000' ? '000001' : '000000');

test('the switch: stored off by the migration, switched on by the demo seed; the seeded members’ numbers are confirmed', async () => {
  const flag = h.db.get<{ enabled: number; description: string }>("SELECT enabled, description FROM feature_flags WHERE key = 'phone_sign_in'");
  assert.equal(flag?.enabled, 1, 'on in demo mode');
  assert.match(flag!.description, /one-time code/);
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'feature_flag.update' AND target_id = 'phone_sign_in'"));
  assert.ok(h.db.get<{ phone_verified_at: string | null }>('SELECT phone_verified_at FROM users WHERE email = ?', [DEMO.member])!.phone_verified_at);
  assert.ok(((await client(h.app).get('/api/public/config')).json.features as string[]).includes('phone_sign_in'));

  const bare = await makeApp({ seed: false });
  try { assert.equal(bare.db.get<{ enabled: number }>("SELECT enabled FROM feature_flags WHERE key = 'phone_sign_in'")?.enabled, 0, 'off until switched on'); }
  finally { await bare.app.close(); bare.db.close(); }
});

test('asking for a code answers the same way for a member, an unknown number, a staff number and an unconfirmed number', async () => {
  fresh();
  const coachId = userId(h.ctx, DEMO.coach), adminId = userId(h.ctx, DEMO.admin);
  h.db.run('UPDATE users SET phone = ?, phone_verified_at = ? WHERE id = ?', ['+919811100001', new Date().toISOString(), coachId]);
  h.db.run('UPDATE users SET phone = ?, phone_verified_at = ? WHERE id = ?', ['+919811100002', new Date().toISOString(), adminId]);
  h.db.run('UPDATE users SET phone_verified_at = NULL WHERE email = ?', ['karthik.reddy@demo.bioptime.test']);
  try {
    const answers = await Promise.all([start(ANANYA), start('+919999999999'), start('+919811100001'), start('+919811100002'), start(KARTHIK)]);
    for (const a of answers) assert.equal(a.status, 202, JSON.stringify(a.json));
    const bodies = answers.map((a) => a.text);
    assert.ok(bodies.every((b) => b === bodies[0]), 'byte for byte the same answer');
    assert.equal(answers[0]!.json.previewCodePath, '/auth/demo/phone-code', 'demo mode names the preview helper, for every number alike');
    assert.equal(smsTo(ANANYA).length, 1, 'the member gets one SMS');
    for (const n of ['+919999999999', '+919811100001', '+919811100002', KARTHIK]) assert.equal(smsTo(n).length, 0, `no SMS to ${n}`);
    const all = rows();
    assert.equal(all.length, 5, 'every request is counted for its number');
    assert.equal(all.filter((r) => r.code_hash).length, 1, 'only the member’s request carries a code');
    assert.equal(all.find((r) => r.code_hash)!.user_id, userId(h.ctx, DEMO.member));
    // staff never sign in by phone, whatever code they try
    assert.equal((await verify('+919811100001', '123456')).json.error?.code, 'PHONE_CODE_INVALID');
    const staffPreview = await preview('+919811100001');
    assert.equal(staffPreview.status, 404, 'the preview helper refuses a staff number');
    assert.equal(staffPreview.json.error?.code, 'NO_CODE_WAITING');
  } finally {
    h.db.run('UPDATE users SET phone = NULL, phone_verified_at = NULL WHERE id IN (?, ?)', [coachId, adminId]);
    h.db.run('UPDATE users SET phone_verified_at = ? WHERE email = ?', [new Date().toISOString(), 'karthik.reddy@demo.bioptime.test']);
  }
});

test('a code signs the member in once; the number may be typed as people type it; nothing writes the code down', async () => {
  fresh();
  assert.equal((await start('97000 00012')).status, 202, 'the ten local digits');
  const code = await codeFor(VIKRAM);
  assert.match(code, /^\d{6}$/);
  const stored = rows()[0]!;
  assert.notEqual(stored.code_hash, code);
  assert.notEqual(stored.code_hash, sha256(code), 'an HMAC, not a bare hash of six digits');
  for (const m of smsTo(VIKRAM)) assert.ok(!m.body.includes(code), 'the outbox withholds the digits');
  const auditText = JSON.stringify(h.db.all("SELECT data FROM audit_events WHERE action LIKE 'auth.phone%'"));
  assert.ok(!auditText.includes(code), 'the audit log never holds the code');

  const c = client(h.app);
  const r = await verify('+91 97000-00012', code, c);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((r.json.user as { email: string }).email, DEMO.member2);
  assert.equal((r.json.session as { token?: string }).token, undefined, 'the web session is a cookie');
  assert.equal(((await c.get('/api/auth/me')).json.user as { email: string }).email, DEMO.member2);
  const login = h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'auth.login' AND target_id = ? ORDER BY at DESC LIMIT 1", [userId(h.ctx, DEMO.member2)]);
  assert.equal(JSON.parse(login!.data).method, 'phone_code');

  assert.equal((await verify(VIKRAM, code)).json.error?.code, 'PHONE_CODE_INVALID', 'single use');
  assert.equal((await preview(VIKRAM)).status, 404, 'a used code is no longer offered');

  // the app gets a bearer token
  await start(VIKRAM);
  const appCode = await codeFor(VIKRAM);
  const m = await verify(VIKRAM, appCode, client(h.app), { 'x-bioptime-client': 'mobile' });
  assert.equal(m.status, 200);
  assert.ok((m.json.session as { token?: string }).token, 'the app receives its token');
});

test('five attempts per code, a wrong guess answered like an unknown number, a newer code replaces the older one', async () => {
  fresh();
  await start(DEEPA);
  const code = await codeFor(DEEPA);
  const unknown = await verify('+919999999998', wrong(code));
  for (let i = 0; i < 5; i++) {
    const r = await verify(DEEPA, wrong(code));
    assert.equal(r.status, 400);
    assert.equal(r.text, unknown.text, 'the same answer as for a number with no account');
  }
  assert.equal(rows()[0]!.attempts, 5, 'each attempt is counted');
  assert.equal((await verify(DEEPA, code)).json.error?.code, 'PHONE_CODE_INVALID', 'the right code no longer works after five wrong ones');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'auth.phone_code_failed' AND target_id = ?", [userId(h.ctx, 'deepa.krishnan@demo.bioptime.test')])!.n, 5);

  fresh();
  await start(DEEPA);
  const first = await codeFor(DEEPA);
  await start(DEEPA);
  const second = await codeFor(DEEPA);
  if (first !== second) assert.equal((await verify(DEEPA, first)).json.error?.code, 'PHONE_CODE_INVALID', 'the older code stopped working');
  assert.equal((await verify(DEEPA, second)).status, 200);
});

test('a code expires after 10 minutes', async () => {
  fresh();
  await start(ARJUN);
  const code = await codeFor(ARJUN);
  const row = rows()[0]!;
  const expires = h.db.get<{ expires_at: string; created_at: string }>('SELECT expires_at, created_at FROM phone_sign_in_codes WHERE id = ?', [row.id])!;
  assert.equal(Date.parse(expires.expires_at) - Date.parse(expires.created_at), 10 * 60_000);
  h.db.run('UPDATE phone_sign_in_codes SET expires_at = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), row.id]);
  assert.equal((await verify(ARJUN, code)).json.error?.code, 'PHONE_CODE_INVALID');
  assert.equal((await preview(ARJUN)).status, 404);
});

test('limits per number: 3 codes in 15 minutes and 5 in 24 hours, counted the same for numbers with no account', async () => {
  fresh();
  for (const n of [SUNITA, '+919999999997']) {
    for (let i = 0; i < 3; i++) assert.equal((await start(n)).status, 202);
    const r = await start(n);
    assert.equal(r.status, 429, `${n}: the fourth in 15 minutes`);
    assert.equal(r.json.error?.code, 'RATE_LIMITED');
  }
  const limited = [await start(SUNITA), await start('+919999999997')];
  assert.equal(limited[0]!.text, limited[1]!.text, 'the limit answers the same with or without an account');
  // an hour later: two more fit in the day, then the daily limit
  h.db.run('UPDATE phone_sign_in_codes SET created_at = ?', [new Date(Date.now() - 60 * 60_000).toISOString()]);
  assert.equal((await start(SUNITA)).status, 202);
  assert.equal((await start(SUNITA)).status, 202);
  const daily = await start(SUNITA);
  assert.equal(daily.status, 429);
  assert.match(daily.json.error!.message, /today/);
  // rows older than two days are deleted when the next code is asked for
  h.db.run('UPDATE phone_sign_in_codes SET created_at = ?', [new Date(Date.now() - 49 * 3600_000).toISOString()]);
  assert.equal((await start(SUNITA)).status, 202);
  assert.equal(rows().length, 1);
});

test('limits per address: the start route’s rate limit', async () => {
  const limited = await makeApp({ env: { RATE_LIMITS: 'on' } });
  try {
    const c = client(limited.app);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await c.post('/api/auth/phone/start', { phone: `+9198000000${String(i).padStart(2, '0')}` })).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(202));
    assert.equal(statuses[10], 429, 'the eleventh from one address in 10 minutes');
  } finally { await limited.app.close(); limited.db.close(); }
});

test('members only, and a closed account cannot sign in by phone', async () => {
  fresh();
  const sunitaId = userId(h.ctx, 'sunita.bhat@demo.bioptime.test');
  await start(SUNITA);
  const code = await codeFor(SUNITA);
  setAccountState(ownerCtx(), sunitaId, 'suspended', 'phone test');
  try {
    assert.equal((await verify(SUNITA, code)).json.error?.code, 'ACCOUNT_SUSPENDED');
    fresh();
    await start(SUNITA);
    assert.equal(rows()[0]!.code_hash, null, 'no code for a suspended account');
  } finally { h.db.run("UPDATE users SET state = 'active' WHERE id = ?", [sunitaId]); }
});

test('confirming the number on the profile: a code to that number; a changed number makes it useless; one account per number', async () => {
  fresh();
  const vikramId = userId(h.ctx, DEMO.member2);
  h.db.run('UPDATE users SET phone_verified_at = NULL WHERE id = ?', [vikramId]);
  const vikram = client(h.app);
  await vikram.login(DEMO.member2, DEMO_PASSWORDS.member);
  // not confirmed: no sign-in code
  await start(VIKRAM);
  assert.equal(rows()[0]!.code_hash, null);
  fresh();
  const s = await vikram.post('/api/auth/phone/confirm/start');
  assert.equal(s.status, 202, JSON.stringify(s.json));
  assert.equal(s.json.sentTo, '+91••••••0012');
  assert.equal(s.json.delivered, false, 'the outbox sends no text message');
  assert.match(String(s.json.message), /^Text messages are not sent from this copy of Bioptime/);
  assert.equal((await preview(VIKRAM)).status, 404, 'the preview helper never offers a confirmation code');
  const code = plant('confirm_phone');
  assert.equal((await vikram.post('/api/auth/phone/confirm', { code: wrong(code) })).json.error?.code, 'PHONE_CODE_INVALID');
  // the code cannot sign anyone in: it is for confirming
  assert.equal((await verify(VIKRAM, code)).json.error?.code, 'PHONE_CODE_INVALID');
  const ok = await vikram.post('/api/auth/phone/confirm', { code });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(h.db.get<{ phone_verified_at: string | null }>('SELECT phone_verified_at FROM users WHERE id = ?', [vikramId])!.phone_verified_at);
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'auth.phone_confirmed' AND target_id = ?", [vikramId]));
  assert.equal(((await vikram.post('/api/auth/phone/confirm/start')).json.error?.details as { code?: string } | undefined)?.code, 'PHONE_ALREADY_CONFIRMED');

  // a code sent before the number changed does not confirm the new number
  fresh();
  h.db.run('UPDATE users SET phone_verified_at = NULL WHERE id = ?', [vikramId]);
  await vikram.post('/api/auth/phone/confirm/start');
  const old = plant('confirm_phone');
  h.db.run('UPDATE users SET phone = ? WHERE id = ?', ['+919700000099', vikramId]);
  assert.equal((await vikram.post('/api/auth/phone/confirm', { code: old })).json.error?.code, 'PHONE_CODE_INVALID');

  // a number confirmed on another account
  fresh();
  h.db.run('UPDATE users SET phone = ? WHERE id = ?', [ANANYA, vikramId]);
  await vikram.post('/api/auth/phone/confirm/start');
  const taken = plant('confirm_phone');
  assert.equal((await vikram.post('/api/auth/phone/confirm', { code: taken })).json.error?.code, 'PHONE_IN_USE');
  h.db.run('UPDATE users SET phone = ?, phone_verified_at = ? WHERE id = ?', [VIKRAM, new Date().toISOString(), vikramId]);

  // staff cannot use the confirmation routes
  const coach = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  assert.equal((await coach.post('/api/auth/phone/confirm/start')).status, 403);
});

test('the preview helper: seeded members’ sign-in codes only, never a confirmation code, one refusal, only in demo mode', async () => {
  fresh();
  // a member who registered (not seeded) and whose number is confirmed: a real code is sent, the helper refuses
  const c = client(h.app);
  const reg = await c.post('/api/auth/register', { email: `phone.${Date.now()}@example.test`, password: 'Phone-Person-2026!', name: 'Noor Test', phone: '+919811122233', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' });
  assert.equal(reg.status, 201);
  h.db.run('UPDATE users SET phone_verified_at = ? WHERE id = ?', [new Date().toISOString(), (reg.json.user as { id: string }).id]);
  assert.equal((await start('+919811122233')).status, 202);
  assert.equal(rows()[0]!.code_hash !== null, true, 'a real code was sent');
  const refused = await preview('+919811122233');
  assert.equal(refused.status, 404);
  assert.equal(refused.json.error?.code, 'NO_CODE_WAITING');
  assert.ok(!('code' in refused.json));
  const unknown = await preview('+919999999999');
  assert.equal(unknown.text, refused.text, 'one refusal for every number without a preview code: it never tells whether a number has an account');

  // (a) a self-registered @demo.bioptime.test account cannot get a confirmation code from the helper
  fresh();
  const intruder = client(h.app);
  const reg2 = await intruder.post('/api/auth/register', { email: `intruder.${Date.now()}@demo.bioptime.test`, password: 'Phone-Person-2026!', name: 'Intruder Test', phone: '+919811177788', acceptTerms: true, acceptPrivacy: true, termsVersion: '2026-10-17' });
  assert.equal(reg2.status, 201, JSON.stringify(reg2.json));
  const intruderId = (reg2.json.user as { id: string }).id;
  assert.equal((await intruder.post('/api/auth/phone/confirm/start')).status, 202);
  assert.equal(rows().filter((r) => r.purpose === 'confirm_phone' && r.code_hash).length, 1, 'a confirmation code exists');
  const none = await preview('+919811177788');
  assert.equal(none.status, 404);
  assert.equal(none.text, unknown.text, 'the same refusal as for an unknown number');
  for (const guess of ['000000', '123456']) assert.equal((await intruder.post('/api/auth/phone/confirm', { code: guess })).json.error?.code, 'PHONE_CODE_INVALID');
  assert.equal(phoneVerifiedAt(intruderId), null, 'the number stays unconfirmed');
  await start('+919811177788');
  assert.equal(rows().filter((r) => r.purpose === 'sign_in' && r.code_hash).length, 0, 'an unconfirmed number gets no sign-in code');
  assert.equal((await preview('+919811177788')).status, 404);

  // (b) a seeded member who changes their number cannot confirm the new number through the helper
  fresh();
  const karthikId = userId(h.ctx, 'karthik.reddy@demo.bioptime.test');
  const karthik = client(h.app);
  await karthik.login('karthik.reddy@demo.bioptime.test', DEMO_PASSWORDS.member);
  try {
    const changed = await karthik.patch('/api/me/profile', { phone: '+919811188899' });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal(phoneVerifiedAt(karthikId), null, 'changing the number clears the confirmation');
    assert.equal((await karthik.post('/api/auth/phone/confirm/start')).status, 202);
    assert.equal((await preview('+919811188899')).status, 404, 'no confirmation code from the helper');
    await start('+919811188899');
    assert.equal(rows().filter((r) => r.purpose === 'sign_in' && r.code_hash).length, 0, 'no sign-in code for the unconfirmed new number');
    assert.equal((await preview('+919811188899')).status, 404);
    assert.equal(phoneVerifiedAt(karthikId), null);
    // nor through the old number: it is no longer on any account
    await start(KARTHIK);
    assert.equal((await preview(KARTHIK)).status, 404);
  } finally { h.db.run('UPDATE users SET phone = ?, phone_verified_at = ? WHERE id = ?', [KARTHIK, new Date().toISOString(), karthikId]); }

  // the number never travels in a URL: the helper is a POST, and the GET form does not exist
  assert.equal((await client(h.app).get(`/api/auth/demo/phone-code?phone=${encodeURIComponent(ANANYA)}`)).status, 404);

  assert.throws(() => phone.previewCode({ ...h.ctx, config: { ...h.ctx.config, isDemo: false } }, ANANYA), /not available/);
  const dev = await makeApp({ seed: false, env: { BIOPTIME_MODE: 'development' } });
  try {
    const r = await client(dev.app).post('/api/auth/demo/phone-code', { phone: ANANYA });
    assert.equal(r.status, 404, 'the route does not exist outside demo mode');
    // and the start answer names no preview helper there, and says that no code will arrive
    dev.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'phone_sign_in'");
    const s = await client(dev.app).post('/api/auth/phone/start', { phone: ANANYA });
    assert.equal(s.status, 202, JSON.stringify(s.json));
    assert.equal('previewCodePath' in s.json, false);
    assert.equal(s.json.delivered, false);
    assert.equal(s.json.message, 'Text messages are not sent from this copy of Bioptime, so no code will arrive. Sign in with your email and password.');
  } finally { await dev.app.close(); dev.db.close(); }
});

test('delivery is described truthfully: while SMS is the outbox, no text message is promised (server, portal and app)', async () => {
  fresh();
  const r = await start(ANANYA);
  assert.equal(r.status, 202);
  assert.equal(r.json.delivered, false, 'the outbox delivers nothing');
  assert.equal(r.json.message, 'Text messages are not sent from this copy of Bioptime. If this is the confirmed number of one of the prepared member accounts, use Fill in the preview code. A code works once, for 10 minutes.');
  assert.doesNotMatch(String(r.json.message), /on its way|we text|\bdemo\b/i);
  // the six-digit check names no text message either
  assert.doesNotMatch(JSON.stringify((await verify(ANANYA, '12')).json), /text message/i);
  // with a real SMS provider (none exists yet: SMS_PROVIDER accepts only "outbox") the answer says a code is on its way
  const real = { ...h.ctx, config: { ...h.ctx.config, SMS_PROVIDER: 'provider' } } as unknown as Ctx;
  assert.equal(phone.smsDelivered(real), true);
  assert.match(phone.startMessage(real), /a code is on its way/);
  assert.equal(phone.smsDelivered(h.ctx), false);

  // the portal page and the app's form take the delivery wording from the answer and never say "we text". In the
  // client app the form is one component (src/flow/auth/PhoneCodeForm) drawn by the sign-in's Phone segment and by the
  // /(auth)/phone screen, so the guarded strings live there once
  for (const rel of ['apps/dashboard/src/pages/auth/PhoneSignIn.tsx', 'apps/mobile/src/flow/auth/PhoneCodeForm.tsx']) {
    const src = fs.readFileSync(PLATFORM + rel, 'utf8');
    assert.doesNotMatch(src, /We text/, rel);
    assert.match(src, /setDelivered\(r\.delivered === true\)/, `${rel}: reads delivered from the answer`);
    assert.match(src, /hint=\{delivered \? 'From the text message\./, `${rel}: "From the text message" only when one is sent`);
    assert.equal((src.match(/From the text message/g) ?? []).length, 1, `${rel}: nowhere else`);
    assert.doesNotMatch(src, /\?phone=/, `${rel}: the number never goes in a URL`);
  }
  // both entry points draw that form and carry none of the wording themselves, nor the number in a URL
  for (const rel of ['apps/mobile/src/app/(auth)/phone.tsx', 'apps/mobile/src/app/(auth)/sign-in.tsx']) {
    const src = fs.readFileSync(PLATFORM + rel, 'utf8');
    assert.match(src, /import \{ PhoneCodeForm \} from '@\/flow\/auth\/PhoneCodeForm';/, `${rel}: draws the shared form`);
    assert.match(src, /<PhoneCodeForm onSignedIn=\{/, rel);
    assert.doesNotMatch(src, /\?phone=/, `${rel}: the number never goes in a URL`);
    assert.doesNotMatch(src, /We text|From the text message|code sent to your phone/, `${rel}: no delivery wording of its own`);
  }
});

test('production refuses phone sign-in while SMS is the outbox', () => {
  const prod = { ...h.ctx, config: { ...h.ctx.config, isProduction: true, isDemo: false, BIOPTIME_MODE: 'production' as const } } as Ctx;
  assert.match(phone.phoneSignInRequirement(prod) ?? '', /SMS_PROVIDER/);
  assert.equal(phone.phoneSignInRequirement(h.ctx), null, 'demo mode may use the outbox');
  for (const call of [() => phone.startPhoneSignIn(prod, ANANYA), () => phone.verifyPhoneSignIn(prod, { phone: ANANYA, code: '123456', kind: 'web' }), () => phone.startPhoneConfirmation(prod, userId(h.ctx, DEMO.member)), () => phone.confirmPhone(prod, userId(h.ctx, DEMO.member), '123456')]) {
    assert.throws(call, (e: { code?: string; status?: number }) => e.code === 'PHONE_SIGN_IN_UNAVAILABLE' && e.status === 503);
  }
});

test('production refuses to switch phone sign-in on while SMS is the outbox (SMS_NOT_CONFIGURED); switching it off still works', () => {
  const owner = ownerCtx();
  const prod = { ...owner, config: { ...owner.config, isProduction: true, isDemo: false, BIOPTIME_MODE: 'production' as const } } as Ctx;
  const stored = () => h.db.get<{ enabled: number }>("SELECT enabled FROM feature_flags WHERE key = 'phone_sign_in'")!.enabled;
  const audits = () => h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'feature_flag.update' AND target_id = 'phone_sign_in'")!.n;
  setFlag(owner, 'phone_sign_in', { enabled: false }, 'phone test: off');
  try {
    const before = audits();
    assert.throws(() => setFlag(prod, 'phone_sign_in', { enabled: true }, 'phone test: production on'), (e: { code?: string; status?: number; message?: string; details?: { code?: string; missing?: string } }) =>
      e.code === 'INVALID_STATE' && e.status === 409 && e.details?.code === 'SMS_NOT_CONFIGURED' && /SMS_PROVIDER/.test(e.details?.missing ?? '') && /Phone sign-in cannot be switched on/.test(e.message ?? ''));
    assert.equal(stored(), 0, 'still off');
    assert.equal(audits(), before, 'a refused switch writes no audit row');
    // what may still happen in production: keeping it off (with an audience change), and a demo server switching it on
    assert.doesNotThrow(() => setFlag(prod, 'phone_sign_in', { enabled: false, audience: { roles: ['member'] } }, 'phone test: production stays off'));
    assert.equal(stored(), 0);
    assert.equal(phone.phoneSignInRequirement(owner), null, 'demo mode has nothing missing');
  } finally {
    setFlag(owner, 'phone_sign_in', { enabled: true, audience: {} }, 'phone test: on');
  }
  assert.equal(stored(), 1, 'demo mode switches it on again');
});

test('GET /public/config leaves phone_sign_in out while it is unavailable, so no client offers a link that answers 503', async () => {
  const prod = { ...h.ctx, config: { ...h.ctx.config, isProduction: true, isDemo: false, BIOPTIME_MODE: 'production' as const } } as Ctx;
  assert.equal(h.db.get<{ enabled: number }>("SELECT enabled FROM feature_flags WHERE key = 'phone_sign_in'")!.enabled, 1, 'the switch is on');
  assert.ok(enabledFeatures(h.ctx).includes('phone_sign_in'), 'demo mode: on and offered');
  const offered = enabledFeatures(prod);
  assert.ok(!offered.includes('phone_sign_in'), 'production with the SMS outbox: on, but not offered');
  assert.deepEqual(offered, enabledFeatures(h.ctx).filter((k) => k !== 'phone_sign_in'), 'every other switch is reported as before');
  // the route itself, on a server that runs as production for one request
  const config = h.config as { isProduction: boolean };
  config.isProduction = true;
  let features: string[];
  try {
    const r = await client(h.app).get('/api/public/config');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    features = r.json.features as string[];
  } finally { config.isProduction = false; }
  assert.ok(!features.includes('phone_sign_in'), 'not in the features a production server publishes');
  fresh();
  assert.equal((await start(ANANYA)).status, 202, 'back in demo mode the routes answer again');
  assert.ok(((await client(h.app).get('/api/public/config')).json.features as string[]).includes('phone_sign_in'));
  fresh();
});

test('the Integrations page says where phone sign-in codes go while SMS is the outbox', async () => {
  const owner = client(h.app);
  await owner.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const items = (await owner.get('/api/admin/integrations')).json.items as Array<{ key: string; status: string; note: string; usedBy: string[] }>;
  const sms = items.find((i) => i.key === 'sms')!;
  assert.equal(sms.status, 'simulated');
  assert.deepEqual(sms.usedBy, [], 'no module sends SMS');
  assert.equal(sms.note, 'Recorded in the outbox (Operations), never delivered. No module sends SMS. Phone sign-in codes are recorded in the outbox with the digits withheld; production refuses phone sign-in until an SMS provider exists.');
});

test('switched off: the routes answer FEATURE_DISABLED and the clients are not told it is on', async () => {
  setFlag(ownerCtx(), 'phone_sign_in', { enabled: false }, 'phone test: off');
  try {
    assert.equal((await start(ANANYA)).json.error?.code, 'FEATURE_DISABLED');
    assert.equal((await verify(ANANYA, '123456')).json.error?.code, 'FEATURE_DISABLED');
    assert.equal((await preview(ANANYA)).json.error?.code, 'FEATURE_DISABLED');
    assert.ok(!((await client(h.app).get('/api/public/config')).json.features as string[]).includes('phone_sign_in'));
  } finally { setFlag(ownerCtx(), 'phone_sign_in', { enabled: true }, 'phone test: on'); }
});

test('numbers are read as people type them', () => {
  assert.equal(phone.normalisePhone('+91 97000 00011'), ANANYA);
  assert.equal(phone.normalisePhone('9700000011'), ANANYA);
  assert.equal(phone.normalisePhone('09700000011'), ANANYA);
  assert.equal(phone.normalisePhone('919700000011'), ANANYA);
  assert.equal(phone.normalisePhone('0091 97000 00011'), ANANYA);
  assert.equal(phone.normalisePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(phone.normalisePhone('12345'), null);
  assert.equal(phone.normalisePhone('not a number'), null);
});
