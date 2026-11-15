/* Phone sign-in: a member signs in with a six-digit code sent by SMS to the phone number they confirmed, and confirms
   that number, while signed in, with the same kind of code. Routes in api/http/routes/auth.ts, behind the switch
   'phone_sign_in' (migration 0035_phone_sign_in.sql).

   - Codes come from the operating system's random source (crypto.randomInt), work once, for 10 minutes, with 5
     attempts. Only an HMAC of the code (with the row id, under TOKEN_SECRET) is stored, and only an HMAC of the number.
     The comparison is constant-time; each attempt is counted and committed before the comparison.
   - Asking for a code answers the same way whether or not the number belongs to a member: a number with no member
     (or a staff account, or a member whose number is not confirmed) gets no SMS, and its request is still counted
     against the number's limit, so neither the answer nor the limit tells whether an account exists. Members only:
     coaches, administrators and owners never sign in this way. (The work differs slightly: a member's request also
     writes the outbox row and the audit event. The answers are identical and the per-number limit bounds sampling.)
   - Limits: per number (3 codes in 15 minutes, 5 in 24 hours, here) and per caller address (the routes' rate limits).
   - Delivery: the SMS adapter is the outbox today (SMS_PROVIDER accepts only "outbox"), which delivers nothing; the
     outbox records the message with the six digits withheld, so no code is ever written down. The answers say so
     (delivered: false, "Text messages are not sent from this copy of Bioptime"), the same for every number. Production
     refuses phone sign-in while SMS is the outbox (PHONE_SIGN_IN_UNAVAILABLE), whatever the switch says.
   - Demo mode only: so that people trying the product can sign in without a real SMS, a SIGN-IN code sent to one of
     the seeded members is also kept in this process's memory, for its 10 minutes and never on disk, for the preview
     helper POST /auth/demo/phone-code (the number travels in the body, never in a URL). That route exists only in demo
     mode. Codes to confirm a number are never kept for it: sign-in codes go only to confirmed numbers, and in demo mode
     only the seed confirms numbers (a confirmation code is readable nowhere: the outbox withholds the digits), so the
     helper covers only the seeded members' seed-confirmed numbers. A self-registered account, even one with an
     @demo.bioptime.test address, and a seeded member who changes their number cannot confirm a number through it.
     Every number without a live preview code gets the same refusal, so the helper never tells whether a number has an
     account.
   - Every code sent, failed attempt, sign-in and confirmation is audited. */
import { randomInt } from 'node:crypto';
import type { Ctx } from '../context.js';
import type { Db } from '../db/db.js';
import { ids, randomId } from '../lib/ids.js';
import { AppError, errors } from '../lib/errors.js';
import { hmacHex, safeEqual } from '../lib/crypto.js';
import { addHours, addMinutes } from '../lib/time.js';
import { audit } from '../domain/audit.js';
import { createSession, type SessionKind } from './sessions.js';
import type { UserRow } from './service.js';

export const PHONE_SIGN_IN_FLAG = 'phone_sign_in';
export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;
/** Codes per number: at most `max` asked for in any `minutes` (requests for numbers with no member count too). */
export const PHONE_LIMITS: ReadonlyArray<{ minutes: number; max: number }> = [{ minutes: 15, max: 3 }, { minutes: 24 * 60, max: 5 }];
/** Rows are deleted this long after they were made (longer than the widest limit window). */
const KEEP_HOURS = 48;
const SEEDED_DOMAIN = '@demo.bioptime.test';
const CLOSED_STATES = new Set(['invited', 'suspended', 'deactivated', 'closed']);

export type PhonePurpose = 'sign_in' | 'confirm_phone';
type CodeRow = { id: string; purpose: PhonePurpose; phone_key: string; user_id: string | null; code_hash: string | null; attempts: number; max_attempts: number; expires_at: string; used_at: string | null; created_at: string };

/* ---------- numbers ---------- */

/** A phone number as people type it, in international form (+919812345678), or null when it cannot be one. Spaces,
 *  dashes, dots and brackets are dropped; 00 becomes +; a ten-digit number starting 6 to 9 (with or without a leading 0)
 *  is read as an Indian mobile number (+91), the numbers Bioptime's members use today. */
export function normalisePhone(raw: string): string | null {
  let s = String(raw ?? '').trim().replace(/[\s().-]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^0?[6-9]\d{9}$/.test(s)) s = '+91' + s.slice(-10);
  else if (/^[1-9]\d{7,14}$/.test(s)) s = '+' + s;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** The spellings a stored number may have for this international number (with and without +, and the ten local
 *  digits for an Indian number). */
function spellings(e164: string): string[] {
  const out = [e164, e164.slice(1)];
  if (e164.startsWith('+91') && e164.length === 13) out.push(e164.slice(3));
  return out;
}

/** "+91••••••0011": enough for a person to recognise their own number. */
export function maskPhone(e164: string): string { return e164.slice(0, 3) + '•'.repeat(Math.max(0, e164.length - 7)) + e164.slice(-4); }

const phoneKey = (ctx: Ctx, e164: string) => hmacHex(ctx.config.TOKEN_SECRET, `phone-sign-in:number:${e164}`);
const codeHash = (ctx: Ctx, id: string, code: string) => hmacHex(ctx.config.TOKEN_SECRET, `phone-sign-in:code:${id}:${code}`);
const ipKey = (ctx: Ctx) => (ctx.ip ? hmacHex(ctx.config.TOKEN_SECRET, `phone-sign-in:ip:${ctx.ip}`) : null);
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/* ---------- availability ---------- */

/** What is missing before phone sign-in may run here, or null. Production refuses to send sign-in codes through the
 *  outbox, which delivers nothing. Also what the switch should check before it is turned on (see forMainSession). */
export function phoneSignInRequirement(ctx: Ctx): string | null {
  if (ctx.config.isProduction && ctx.config.SMS_PROVIDER === 'outbox') return 'An SMS provider: SMS_PROVIDER accepts only "outbox", and production refuses to send sign-in codes through the outbox, which delivers nothing';
  return null;
}

function assertAvailable(ctx: Ctx): void {
  if (phoneSignInRequirement(ctx)) throw new AppError('PHONE_SIGN_IN_UNAVAILABLE', 503, 'Signing in with a code sent to your phone is not available yet. Sign in with your email and password.');
}

/** Whether a code really reaches the phone: false while the SMS adapter is the outbox, which delivers nothing. */
export function smsDelivered(ctx: Ctx): boolean { return ctx.config.SMS_PROVIDER !== 'outbox'; }

/** The answer to "send me a code", the same for every number: it depends only on how this server delivers SMS and on
 *  whether the preview helper exists (demo mode). True today: with the outbox, no text message is sent. */
export function startMessage(ctx: Ctx): string {
  if (smsDelivered(ctx)) return `If this is the confirmed phone number of a Bioptime member account, a code is on its way. It works once, for ${CODE_MINUTES} minutes.`;
  if (ctx.config.isDemo) return `Text messages are not sent from this copy of Bioptime. If this is the confirmed number of one of the prepared member accounts, use Fill in the preview code. A code works once, for ${CODE_MINUTES} minutes.`;
  return 'Text messages are not sent from this copy of Bioptime, so no code will arrive. Sign in with your email and password.';
}

/* ---------- shared steps ---------- */

function purgeOld(ctx: Ctx): void {
  ctx.db.run('DELETE FROM phone_sign_in_codes WHERE created_at < ?', [addHours(ctx.now(), -KEEP_HOURS)]);
}

/** Refuses when the number has had its share of codes. Counts every request for the number, with or without a member. */
function checkPhoneLimit(ctx: Ctx, key: string, purpose: 'sign_in' | 'confirm_phone'): void {
  const tail = purpose === 'sign_in' ? ', or sign in with your email and password.' : '.';
  for (const l of PHONE_LIMITS) {
    const n = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM phone_sign_in_codes WHERE phone_key = ? AND created_at > ?', [key, addMinutes(ctx.now(), -l.minutes)])?.n ?? 0;
    if (n >= l.max) throw errors.tooMany(l.minutes <= 60 ? `Several codes have just been asked for this number. Wait ${l.minutes} minutes before asking again${tail}` : `This number has had as many codes as it may have today. Try again tomorrow${tail}`);
  }
}

/** The members whose confirmed number this is (normally one). */
function membersWithConfirmedPhone(ctx: Ctx, e164: string, exceptId?: string): UserRow[] {
  const s = spellings(e164);
  return ctx.db.all<UserRow>(`SELECT * FROM users WHERE role = 'member' AND phone_verified_at IS NOT NULL AND phone IN (${s.map(() => '?').join(', ')}) AND id != ?`, [...s, exceptId ?? '']);
}

/** The SMS adapter (the outbox today). The six digits are withheld from the record: the outbox delivers nothing, and a
 *  code is never written down. */
function sendCode(ctx: Ctx, to: string, purpose: PhonePurpose): void {
  const body = purpose === 'sign_in'
    ? `Your Bioptime sign-in code is •••••• (the digits are not kept in this record). It works once, for ${CODE_MINUTES} minutes. Bioptime never asks you for it.`
    : `Your Bioptime code to confirm this number is •••••• (the digits are not kept in this record). It works once, for ${CODE_MINUTES} minutes.`;
  ctx.db.insert('outbox_messages', { id: ids.outbox(), channel: 'sms', to_address: to, subject: null, body, notification_id: null, status: 'logged', created_at: ctx.now() });
}

/** A new code row for this member and number; older unused codes of the same purpose stop working. */
function issue(ctx: Ctx, user: UserRow, e164: string, key: string, purpose: PhonePurpose): { id: string; expiresAt: string } {
  const now = ctx.now();
  ctx.db.run('UPDATE phone_sign_in_codes SET used_at = ? WHERE used_at IS NULL AND purpose = ? AND (phone_key = ? OR user_id = ?)', [now, purpose, key, user.id]);
  const id = randomId('psc');
  const code = newCode();
  const expiresAt = addMinutes(now, CODE_MINUTES);
  ctx.db.insert('phone_sign_in_codes', { id, purpose, phone_key: key, user_id: user.id, code_hash: codeHash(ctx, id, code), ip_key: ipKey(ctx), attempts: 0, max_attempts: CODE_ATTEMPTS, expires_at: expiresAt, used_at: null, created_at: now });
  sendCode(ctx, user.phone ?? e164, purpose);
  rememberForPreview(ctx, user, key, purpose, { id, code });
  audit(ctx, purpose === 'sign_in' ? 'auth.phone_code_sent' : 'auth.phone_confirm_code_sent', { type: 'user', id: user.id }, null, { expiresAt, to: maskPhone(e164) });
  return { id, expiresAt };
}

const NO_HASH = '0'.repeat(64);

/** Counts one attempt on the newest live request that matches, committed before the comparison, and compares in
 *  constant time. A request that sent no code (a number with no member) takes the same steps and never matches, so a
 *  wrong guess costs the same either way. Returns the row on a match, null otherwise. */
function attempt(ctx: Ctx, find: { sql: string; params: string[] }, code: string, purpose: PhonePurpose): CodeRow | null {
  const now = ctx.now();
  const row = ctx.db.tx(() => {
    const r = ctx.db.get<CodeRow>(`SELECT * FROM phone_sign_in_codes WHERE purpose = ? AND used_at IS NULL AND expires_at > ? AND attempts < max_attempts AND ${find.sql} ORDER BY created_at DESC LIMIT 1`, [purpose, now, ...find.params]);
    if (r) ctx.db.run('UPDATE phone_sign_in_codes SET attempts = attempts + 1 WHERE id = ?', [r.id]);
    return r;
  });
  const matches = safeEqual(codeHash(ctx, row?.id ?? 'none', code), row?.code_hash ?? NO_HASH) && !!row?.code_hash;
  if (matches) return row!;
  if (row?.user_id) audit(ctx, purpose === 'sign_in' ? 'auth.phone_code_failed' : 'auth.phone_confirm_failed', { type: 'user', id: row.user_id }, null, { attempts: row.attempts + 1, of: row.max_attempts });
  return null;
}

/** Marks a code used, once: false when another request used it first. */
function claim(ctx: Ctx, id: string): boolean {
  return ctx.db.run('UPDATE phone_sign_in_codes SET used_at = ? WHERE id = ? AND used_at IS NULL', [ctx.now(), id]).changes === 1;
}

const wrongCode = () => new AppError('PHONE_CODE_INVALID', 400, 'That code is not right, or it has expired. Check the number and the code, or ask for a new code.');

/* ---------- signing in ---------- */

/** POST /auth/phone/start: the same answer for every number; a code goes only to a member whose confirmed number it is. */
export function startPhoneSignIn(ctx: Ctx, e164: string): { received: true; expiresInMinutes: number; delivered: boolean } {
  assertAvailable(ctx);
  const key = phoneKey(ctx, e164);
  ctx.db.tx(() => {
    purgeOld(ctx);
    checkPhoneLimit(ctx, key, 'sign_in');
    const found = membersWithConfirmedPhone(ctx, e164).filter((u) => !CLOSED_STATES.has(u.state));
    // one member, and only a member: no code for an unknown number, a staff account, an unconfirmed number, or a
    // number confirmed on two accounts (the confirmation step refuses that; an older database might have it)
    if (found.length === 1) { issue(ctx, found[0]!, e164, key, 'sign_in'); return; }
    ctx.db.insert('phone_sign_in_codes', { id: randomId('psc'), purpose: 'sign_in', phone_key: key, user_id: null, code_hash: null, ip_key: ipKey(ctx), attempts: 0, max_attempts: CODE_ATTEMPTS, expires_at: addMinutes(ctx.now(), CODE_MINUTES), used_at: null, created_at: ctx.now() });
  });
  return { received: true, expiresInMinutes: CODE_MINUTES, delivered: smsDelivered(ctx) };
}

/** POST /auth/phone/verify: signs the member in with a live code for this number. One answer for every failure. */
export function verifyPhoneSignIn(ctx: Ctx, input: { phone: string; code: string; kind: SessionKind; userAgent?: string }): { user: UserRow; token: string; sessionId: string; expiresAt: string } {
  assertAvailable(ctx);
  const key = phoneKey(ctx, input.phone);
  const row = attempt(ctx, { sql: 'phone_key = ?', params: [key] }, input.code, 'sign_in');
  if (!row?.user_id) throw wrongCode();
  return ctx.db.tx(() => {
    if (!claim(ctx, row.id)) throw wrongCode();
    forgetPreview(ctx, key);
    const user = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [row.user_id]);
    // still a member whose confirmed number this is (a number changed since the code was sent no longer signs in)
    if (!user || user.role !== 'member' || !user.phone_verified_at || !user.phone || normalisePhone(user.phone) !== input.phone) throw wrongCode();
    if (user.state === 'suspended') throw errors.forbidden('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
    if (user.state === 'deactivated' || user.state === 'closed') throw errors.forbidden('This account is closed.', 'ACCOUNT_CLOSED');
    if (user.state === 'invited') throw errors.forbidden('Finish setting up your account from the invitation link first.', 'INVITATION_PENDING');
    const session = createSession(ctx, user, input.kind, { ip: ctx.ip, userAgent: input.userAgent });
    audit({ ...ctx, actor: { id: user.id, role: user.role, email: user.email, name: user.name, sessionId: session.sessionId } }, 'auth.login', { type: 'user', id: user.id }, null, { kind: input.kind, method: 'phone_code' });
    return { user, ...session };
  });
}

/* ---------- confirming the member's own number ---------- */

function ownNumber(ctx: Ctx, memberId: string): { user: UserRow; e164: string } {
  const user = ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [memberId]);
  if (!user || user.role !== 'member') throw errors.forbidden('Only members confirm a phone number here');
  const e164 = user.phone ? normalisePhone(user.phone) : null;
  if (!e164) throw errors.badRequest('Add your mobile number to your profile first, then confirm it.', 'PHONE_MISSING');
  return { user, e164 };
}

/** POST /auth/phone/confirm/start: a code to the number on the member's profile. */
export function startPhoneConfirmation(ctx: Ctx, memberId: string): { sentTo: string; expiresInMinutes: number; delivered: boolean; message: string } {
  assertAvailable(ctx);
  const { user, e164 } = ownNumber(ctx, memberId);
  if (user.phone_verified_at) throw errors.state('Your number is already confirmed.', { code: 'PHONE_ALREADY_CONFIRMED' });
  const key = phoneKey(ctx, e164);
  ctx.db.tx(() => {
    purgeOld(ctx);
    checkPhoneLimit(ctx, key, 'confirm_phone');
    issue(ctx, user, e164, key, 'confirm_phone');
  });
  const delivered = smsDelivered(ctx);
  return { sentTo: maskPhone(e164), expiresInMinutes: CODE_MINUTES, delivered, message: delivered ? `A code is on its way to ${maskPhone(e164)}. It works once, for ${CODE_MINUTES} minutes.` : 'Text messages are not sent from this copy of Bioptime, so no code will arrive and this number cannot be confirmed here.' };
}

/** POST /auth/phone/confirm: the code proves the member holds the number; it is then their confirmed number. */
export function confirmPhone(ctx: Ctx, memberId: string, code: string): { phoneVerified: true; phone: string } {
  assertAvailable(ctx);
  const { e164 } = ownNumber(ctx, memberId);
  const key = phoneKey(ctx, e164);
  // the code must have gone to the number on the profile now: changing the number makes an earlier code useless
  const row = attempt(ctx, { sql: 'user_id = ? AND phone_key = ?', params: [memberId, key] }, code, 'confirm_phone');
  if (!row) throw wrongCode();
  return ctx.db.tx(() => {
    if (!claim(ctx, row.id)) throw wrongCode();
    forgetPreview(ctx, key);
    if (membersWithConfirmedPhone(ctx, e164, memberId).length) throw errors.conflict('This number is already confirmed on another Bioptime account. Contact support to move it.', 'PHONE_IN_USE');
    const now = ctx.now();
    ctx.db.update('users', memberId, { phone_verified_at: now, updated_at: now });
    audit(ctx, 'auth.phone_confirmed', { type: 'user', id: memberId }, null, { phone: maskPhone(e164) });
    return { phoneVerified: true as const, phone: maskPhone(e164) };
  });
}

/* ---------- demo mode only: the preview code ---------- */

// process memory only, per database (the tests run several apps in one process); sign-in codes of seeded members only
const previewCodes = new WeakMap<Db, Map<string, { id: string; code: string }>>();

/** A seeded member whose number is confirmed (in demo mode only the seed confirms numbers) and is this number. */
function isSeededConfirmed(user: UserRow | undefined, e164: string): boolean {
  return !!user && user.role === 'member' && user.email.endsWith(SEEDED_DOMAIN) && !!user.phone_verified_at && !!user.phone && normalisePhone(user.phone) === e164;
}

function rememberForPreview(ctx: Ctx, user: UserRow, key: string, purpose: PhonePurpose, entry: { id: string; code: string }): void {
  // sign-in codes only, never a code to confirm a number: otherwise anyone could confirm a number they do not hold
  if (!ctx.config.isDemo || purpose !== 'sign_in' || !user.email.endsWith(SEEDED_DOMAIN) || !user.phone_verified_at) return;
  let m = previewCodes.get(ctx.db);
  if (!m) { m = new Map(); previewCodes.set(ctx.db, m); }
  m.set(key, entry);
}

function forgetPreview(ctx: Ctx, key: string): void { previewCodes.get(ctx.db)?.delete(key); }

const noPreview = () => new AppError('NO_CODE_WAITING', 404, 'No preview code is waiting for this number. Preview codes exist only for the prepared member accounts, for 10 minutes after a code is asked for.');

/** POST /auth/demo/phone-code (demo mode only): the live sign-in code last sent to a seeded member's confirmed number.
 *  Refused outside demo mode; every other number, and a seeded number with no live sign-in code, gets the same
 *  refusal (NO_CODE_WAITING), so the helper never tells whether a number has an account. */
export function previewCode(ctx: Ctx, e164: string): { code: string; expiresAt: string; validForSeconds: number } {
  if (!ctx.config.isDemo) throw errors.forbidden('Preview codes are not available on this server.', 'PREVIEW_ONLY');
  const key = phoneKey(ctx, e164);
  const entry = previewCodes.get(ctx.db)?.get(key);
  const row = entry ? ctx.db.get<CodeRow>('SELECT * FROM phone_sign_in_codes WHERE id = ?', [entry.id]) : undefined;
  const user = row?.user_id ? ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [row.user_id]) : undefined;
  const live = !!entry && !!row && row.purpose === 'sign_in' && row.phone_key === key && !row.used_at && row.expires_at > ctx.now() && row.attempts < row.max_attempts;
  if (!live || !isSeededConfirmed(user, e164)) {
    if (entry) forgetPreview(ctx, key);
    throw noPreview();
  }
  return { code: entry!.code, expiresAt: row!.expires_at, validForSeconds: Math.max(0, Math.round((Date.parse(row!.expires_at) - Date.parse(ctx.now())) / 1000)) };
}

/** The demo seed (demo mode only, called from the referrals module's seedDemo): switches phone sign-in on and confirms
 *  the seeded members' numbers, so that the code flow can be tried with the prepared accounts. Both audited. */
export function seedPhoneSignInDemo(owner: Ctx): { confirmed: number } {
  if (!owner.config.isDemo) return { confirmed: 0 };
  const now = owner.now();
  owner.db.run('UPDATE feature_flags SET enabled = 1, updated_at = ?, updated_by = ? WHERE key = ?', [now, owner.actor?.id ?? null, PHONE_SIGN_IN_FLAG]);
  audit(owner, 'feature_flag.update', { type: 'feature_flag', id: PHONE_SIGN_IN_FLAG }, 'initial data: phone sign-in switched on', { enabled: true, keys: [PHONE_SIGN_IN_FLAG] });
  const confirmed = owner.db.run("UPDATE users SET phone_verified_at = ?, updated_at = ? WHERE role = 'member' AND email LIKE ? AND phone IS NOT NULL AND phone_verified_at IS NULL", [now, now, `%${SEEDED_DOMAIN}`]).changes;
  if (confirmed) audit(owner, 'auth.phone_confirmed', { type: 'users', id: 'seeded_members' }, 'initial data: the prepared members’ phone numbers are confirmed', { count: confirmed });
  return { confirmed };
}
