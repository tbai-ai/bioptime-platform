/* Identity: registration, verification, sign-in with lockout, password reset, coach invitations, admin provisioning, MFA,
   account states. Passwords are scrypt hashes; every token is stored hashed and expires; nothing here trusts the client. */
import { ACCOUNT_TRANSITIONS, type AccountState, type Role } from '@bioptime/domain';
import type { Ctx } from '../context.js';
import { ids, randomId } from '../lib/ids.js';
import { AppError, errors } from '../lib/errors.js';
import { hashPassword, verifyPassword, randomToken, sha256, totpSecret, verifyTotp, otpauthUri } from '../lib/crypto.js';
import { addDays, addHours, addMinutes } from '../lib/time.js';
import { j } from '../db/db.js';
import { audit, emit } from '../domain/audit.js';
import { clearVerificationNudges, notify } from '../domain/notifications.js';
import { createSession, revokeAllSessions, type SessionKind } from './sessions.js';

export type UserRow = {
  id: string; email: string; phone: string | null; password_hash: string | null; role: Role; state: AccountState; name: string;
  email_verified_at: string | null; phone_verified_at: string | null; mfa_secret: string | null; mfa_enabled: number;
  failed_logins: number; locked_until: string | null; last_login_at: string | null; created_at: string; updated_at: string;
};

export function getUser(ctx: Ctx, id: string): UserRow | undefined { return ctx.db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]); }
export function getUserByEmail(ctx: Ctx, email: string): UserRow | undefined { return ctx.db.get<UserRow>('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]); }
/** The coach whose Coach ID (coach_profiles.coach_code, BPC-0001, shown on the coach's profile) this is: surrounding
 *  spaces trimmed, letter case ignored. Codes are issued in capitals by nextCode, so the comparison is on capitals. */
export function getUserByCoachId(ctx: Ctx, coachId: string): UserRow | undefined {
  const code = coachId.trim().toUpperCase();
  if (!code) return undefined;
  return ctx.db.get<UserRow>("SELECT u.* FROM users u JOIN coach_profiles c ON c.user_id = u.id WHERE UPPER(c.coach_code) = ? AND u.role = 'coach'", [code]);
}
const isPrivilegedRole = (role: Role) => role === 'admin' || role === 'owner';

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, phone: u.phone, role: u.role, state: u.state, name: u.name, emailVerified: !!u.email_verified_at, phoneVerified: !!u.phone_verified_at, mfaEnabled: !!u.mfa_enabled, createdAt: u.created_at, lastLoginAt: u.last_login_at };
}

const MAX_FAILED = 5, LOCK_MINUTES = 10;
/** Checked against when no account matches (or the account has no password yet), so that answer costs exactly one scrypt,
 *  as a wrong password does: the response time never tells whether an email or Coach ID exists. Made once, at load. */
const TIMING_EQUALISER_HASH = hashPassword('timing-equaliser');

/* ---------- registration ---------- */
/** The providers (Google, Apple; the demo stand-in) linked to an account, for the sign-in message and the reset rule
 *  (api/auth/social.ts owns the rows; the query sits here so this file never imports that one). */
export function socialProvidersOf(ctx: Ctx, userId: string): string[] {
  return ctx.db.all<{ provider: string }>('SELECT provider FROM user_identities WHERE user_id = ? ORDER BY created_at', [userId]).map((r) => r.provider);
}
const providerWords = (providers: string[]) => providers.map((p) => (p === 'google' ? 'Google' : p === 'apple' ? 'Apple' : 'the stand-in')).join(' or ');

/** The next human-readable code (mirrors domain/members.nextCode; kept here so auth never imports the members domain). */
export function nextCode(ctx: Ctx, family: 'coach' | 'member'): string {
  const row = ctx.db.get<{ next: number }>('UPDATE id_sequences SET next = next + 1 WHERE name = ? RETURNING next - 1 AS next', [family]);
  if (!row) throw errors.internal('Code sequence missing');
  return family === 'coach' ? `BPC-${String(row.next).padStart(4, '0')}` : `BPM-${String(row.next).padStart(5, '0')}`;
}

export function registerMember(ctx: Ctx, input: { email: string; password: string; name: string; phone?: string; termsVersion: string; marketingConsent?: boolean }): { user: UserRow; verificationToken: string } {
  const existing = getUserByEmail(ctx, input.email);
  if (existing) throw errors.conflict('An account with this email already exists. Sign in, or reset your password.', 'EMAIL_IN_USE');
  const now = ctx.now();
  const id = ids.user();
  return ctx.db.tx(() => {
    ctx.db.insert('users', { id, email: input.email, phone: input.phone ?? null, password_hash: hashPassword(input.password), role: 'member', state: 'pending_verification', name: input.name, created_at: now, updated_at: now });
    ctx.db.insert('member_profiles', { user_id: id, member_code: nextCode(ctx, 'member'), created_at: now, updated_at: now });
    for (const kind of ['terms', 'privacy'] as const) ctx.db.insert('member_consents', { id: ids.consent(), user_id: id, kind, version: input.termsVersion, granted: 1, ip: ctx.ip ?? null, at: now });
    ctx.db.insert('member_consents', { id: ids.consent(), user_id: id, kind: 'marketing', version: input.termsVersion, granted: input.marketingConsent ? 1 : 0, ip: ctx.ip ?? null, at: now });
    ctx.db.insert('notification_preferences', { user_id: id, updated_at: now });
    const verificationToken = issueToken(ctx, id, 'email_verify', addDays(now, 3));
    emit(ctx, 'MemberRegistered', { type: 'user', id }, { email: input.email });
    // the link (with its token) is the email's: kept on the notification for the email channel, never returned by the
    // in-app inbox (GET /notifications strips it: domain/notifications.ts inboxData), as for every link below
    notify(ctx, { userId: id, category: 'verification', title: 'Verify your email', body: 'Open the link we sent to confirm your email and continue to onboarding.', data: { verifyUrl: `${ctx.config.PUBLIC_ORIGIN}/verify?token=${verificationToken}` }, channels: ['email'] });
    audit({ ...ctx, actor: { id, role: 'member', email: input.email, name: input.name } }, 'member.register', { type: 'user', id }, null);
    return { user: getUser(ctx, id)!, verificationToken };
  });
}

export function issueToken(ctx: Ctx, userId: string | null, kind: 'email_verify' | 'password_reset' | 'phone_verify' | 'coach_invite', expiresAt: string, payload: Record<string, unknown> = {}): string {
  const token = randomToken(32);
  if (userId) ctx.db.run('UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL', [ctx.now(), userId, kind]);
  ctx.db.insert('auth_tokens', { id: ids.token(), user_id: userId, kind, token_hash: sha256(token), payload: j.in(payload), expires_at: expiresAt, used_at: null, created_at: ctx.now() });
  return token;
}

function consumeToken(ctx: Ctx, token: string, kind: string): { user_id: string | null; payload: Record<string, unknown>; id: string } {
  const row = ctx.db.get<{ id: string; user_id: string | null; kind: string; payload: string; expires_at: string; used_at: string | null }>('SELECT * FROM auth_tokens WHERE token_hash = ?', [sha256(token)]);
  if (!row || row.kind !== kind) throw errors.badRequest('This link is not valid. Request a new one.', 'TOKEN_INVALID');
  if (row.used_at) throw errors.badRequest('This link has already been used.', 'TOKEN_USED');
  if (row.expires_at < ctx.now()) throw errors.badRequest('This link has expired. Request a new one.', 'TOKEN_EXPIRED');
  ctx.db.run('UPDATE auth_tokens SET used_at = ? WHERE id = ?', [ctx.now(), row.id]);
  return { user_id: row.user_id, payload: j.out(row.payload, {}), id: row.id };
}

export function verifyEmail(ctx: Ctx, token: string): UserRow {
  return ctx.db.tx(() => {
    const t = consumeToken(ctx, token, 'email_verify');
    const user = getUser(ctx, t.user_id!);
    if (!user) throw errors.notFound('Account');
    const now = ctx.now();
    const nextState: AccountState = user.state === 'pending_verification' ? (user.role === 'member' ? 'onboarding' : 'active') : user.state;
    ctx.db.update('users', user.id, { email_verified_at: user.email_verified_at ?? now, state: nextState, updated_at: now });
    clearVerificationNudges(ctx, user.id);
    emit(ctx, 'EmailVerified', { type: 'user', id: user.id });
    audit({ ...ctx, actor: { id: user.id, role: user.role, email: user.email, name: user.name } }, 'auth.email_verified', { type: 'user', id: user.id });
    return getUser(ctx, user.id)!;
  });
}

export function resendVerification(ctx: Ctx, email: string): string | null {
  const user = getUserByEmail(ctx, email);
  if (!user || user.email_verified_at) return null; // never reveal whether an email exists
  const token = issueToken(ctx, user.id, 'email_verify', addDays(ctx.now(), 3));
  notify(ctx, { userId: user.id, category: 'verification', title: 'Verify your email', body: 'Open the link we sent to confirm your email.', data: { verifyUrl: `${ctx.config.PUBLIC_ORIGIN}/verify?token=${token}` }, channels: ['email'] });
  return token;
}

/* ---------- sign in ---------- */
/** Sign in with an email, or (coaches) with the Coach ID on their profile, and the password. Both ways share the
 *  account's lockout, and a wrong Coach ID answers exactly as a wrong password does. Administrators and owners need their
 *  authenticator code; one whose authenticator is not enrolled gets no session from the password alone: the answer is
 *  MFA_ENROLMENT_REQUIRED with a one-time enrolment token (mandatory 2FA, 30 October 2026; enrolWithToken below). */
export function signIn(ctx: Ctx, input: { email?: string; coachId?: string; password: string; mfaCode?: string; kind: SessionKind; userAgent?: string; expectedRoles?: Role[] }): { user: UserRow; token: string; sessionId: string; expiresAt: string } {
  const byCoachId = input.coachId !== undefined;
  const user = byCoachId ? getUserByCoachId(ctx, input.coachId!) : getUserByEmail(ctx, input.email ?? '');
  const generic = errors.unauthorised(byCoachId ? 'That Coach ID and password do not match.' : 'That email and password do not match.', 'INVALID_CREDENTIALS');
  if (!user || !user.password_hash) {
    verifyPassword(input.password, TIMING_EQUALISER_HASH); // one scrypt, as on the wrong-password path below
    // a member who joined with Google or Apple has no password yet: say so, and name the way in (api/auth/social.ts)
    const providers = user && user.role === 'member' && !byCoachId ? socialProvidersOf(ctx, user.id) : [];
    if (providers.length) throw errors.unauthorised(`This account signs in with ${providerWords(providers)}; use that button, or set a password from the forgotten-password link.`, 'SIGN_IN_WITH_PROVIDER');
    throw generic;
  }
  if (user.locked_until && user.locked_until > ctx.now()) throw errors.tooMany('Too many attempts. Try again in a few minutes.');
  const recordFailure = (action: string) => {
    const failed = user.failed_logins + 1;
    ctx.db.update('users', user.id, { failed_logins: failed, locked_until: failed >= MAX_FAILED ? addMinutes(ctx.now(), LOCK_MINUTES) : null, updated_at: ctx.now() });
    audit(ctx, action, { type: 'user', id: user.id }, null, { failed, ...(byCoachId ? { via: 'coach_id' } : {}) });
  };
  if (!verifyPassword(input.password, user.password_hash)) { recordFailure('auth.login_failed'); throw generic; }
  if (input.expectedRoles && !input.expectedRoles.includes(user.role)) throw errors.forbidden('This sign-in is for a different kind of account.', 'WRONG_WORKSPACE');
  if (user.state === 'suspended') throw errors.forbidden('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
  if (user.state === 'deactivated' || user.state === 'closed') throw errors.forbidden('This account is closed.', 'ACCOUNT_CLOSED');
  if (user.state === 'invited') throw errors.forbidden('Finish setting up your account from the invitation link first.', 'INVITATION_PENDING');
  if (user.mfa_enabled) {
    if (!input.mfaCode) throw new AppError('MFA_REQUIRED', 401, 'Enter the code from your authenticator app');
    // a wrong code counts like a wrong password: the same lockout applies, so the six digits cannot be guessed
    if (!verifyTotp(user.mfa_secret!, input.mfaCode)) { recordFailure('auth.mfa_failed'); throw errors.unauthorised('That code is not right. Check your authenticator app.', 'MFA_INVALID'); }
  } else if (isPrivilegedRole(user.role)) {
    // mandatory 2FA: the right password alone opens nothing for an administrator or owner; it starts enrolment
    const enrolmentToken = issueMfaEnrolment(ctx, user, input.kind);
    throw new AppError('MFA_ENROLMENT_REQUIRED', 403, 'Two-factor authentication is required for administrator accounts. Set up an authenticator app to continue.', { enrolmentToken, expiresInMinutes: MFA_ENROLMENT_MINUTES });
  }
  ctx.db.update('users', user.id, { failed_logins: 0, locked_until: null, updated_at: ctx.now() });
  const session = createSession(ctx, user, input.kind, { ip: ctx.ip, userAgent: input.userAgent });
  audit({ ...ctx, actor: { id: user.id, role: user.role, email: user.email, name: user.name, sessionId: session.sessionId } }, 'auth.login', { type: 'user', id: user.id }, null, { kind: input.kind, ...(byCoachId ? { via: 'coach_id' } : {}) });
  return { user, ...session };
}

/* ---------- mandatory two-factor enrolment (administrators and owners; migration 0037) ---------- */
export const MFA_ENROLMENT_MINUTES = 15;
const MFA_ENROLMENT_ATTEMPTS = 5;
type EnrolmentRow = { id: string; user_id: string; token_hash: string; attempts: number; started_at: string | null; expires_at: string; used_at: string | null; created_at: string };
const asActor = (u: UserRow, sessionId?: string) => ({ id: u.id, role: u.role, email: u.email, name: u.name, ...(sessionId ? { sessionId } : {}) });

/** A one-time enrolment token (15 minutes, stored hashed) for a privileged account without an authenticator, after a
 *  correct password. Any earlier unused token of the account stops working. */
function issueMfaEnrolment(ctx: Ctx, user: UserRow, kind: SessionKind): string {
  const token = randomToken(32);
  const now = ctx.now();
  ctx.db.run('UPDATE mfa_enrolments SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [now, user.id]);
  ctx.db.insert('mfa_enrolments', { id: randomId('mfe'), user_id: user.id, token_hash: sha256(token), attempts: 0, started_at: null, expires_at: addMinutes(now, MFA_ENROLMENT_MINUTES), used_at: null, created_at: now });
  audit({ ...ctx, actor: asActor(user) }, 'auth.mfa_enrolment_required', { type: 'user', id: user.id }, null, { kind });
  return token;
}

/** The enrolment behind a token, and its account, when the token may still be used: unknown, used, expired or worn out
 *  (five wrong codes) tokens are refused, and so is an account that changed since (suspended, closed, no longer an
 *  administrator, or enrolled meanwhile). */
function liveEnrolment(ctx: Ctx, token: string): { e: EnrolmentRow; user: UserRow } {
  const e = ctx.db.get<EnrolmentRow>('SELECT * FROM mfa_enrolments WHERE token_hash = ?', [sha256(token)]);
  if (!e) throw errors.badRequest('This set-up link is not valid. Sign in again to start over.', 'TOKEN_INVALID');
  if (e.used_at) throw errors.badRequest('This set-up step has already been used. Sign in again to start over.', 'TOKEN_USED');
  if (e.expires_at < ctx.now()) throw errors.badRequest('This set-up step has expired. Sign in again to start over.', 'TOKEN_EXPIRED');
  const user = getUser(ctx, e.user_id);
  if (!user || !isPrivilegedRole(user.role) || user.state !== 'active' || !user.password_hash) {
    ctx.db.run('UPDATE mfa_enrolments SET used_at = ? WHERE id = ?', [ctx.now(), e.id]);
    throw errors.badRequest('This set-up step no longer applies to this account. Sign in again.', 'TOKEN_INVALID');
  }
  if (user.mfa_enabled) {
    ctx.db.run('UPDATE mfa_enrolments SET used_at = ? WHERE id = ?', [ctx.now(), e.id]);
    throw errors.state('Two-factor authentication is already set up on this account. Sign in with your code.', { code: 'MFA_ALREADY_ENABLED' });
  }
  return { e, user };
}

/** POST /auth/mfa/enrol/start: a fresh authenticator secret for the account behind the enrolment token (calling it
 *  again replaces the secret). The token stays usable for the confirmation. */
export function startEnrolmentWithToken(ctx: Ctx, token: string): { secret: string; otpauthUri: string } {
  const { e, user } = liveEnrolment(ctx, token);
  const secret = totpSecret();
  const now = ctx.now();
  ctx.db.update('users', user.id, { mfa_secret: secret, mfa_enabled: 0, updated_at: now });
  ctx.db.update('mfa_enrolments', e.id, { started_at: now });
  audit({ ...ctx, actor: asActor(user) }, 'auth.mfa_enrol_started', { type: 'user', id: user.id }, null, { via: 'enrolment_token' });
  return { secret, otpauthUri: otpauthUri(secret, user.email) };
}

/** POST /auth/mfa/enrol/confirm: a correct six-digit code switches MFA on, uses the token up and opens the session
 *  the password would have opened. A wrong code is counted on the token; the fifth wears it out. */
export function confirmEnrolmentWithToken(ctx: Ctx, input: { token: string; code: string; kind: SessionKind; userAgent?: string }): { user: UserRow; token: string; sessionId: string; expiresAt: string } {
  const { e, user } = liveEnrolment(ctx, input.token);
  if (!e.started_at || !user.mfa_secret) throw errors.state('Start the set-up first: add the secret to your authenticator app, then enter its code.', { code: 'MFA_ENROLMENT_NOT_STARTED' });
  if (!verifyTotp(user.mfa_secret, input.code)) {
    const attempts = e.attempts + 1;
    const wornOut = attempts >= MFA_ENROLMENT_ATTEMPTS;
    ctx.db.update('mfa_enrolments', e.id, { attempts, used_at: wornOut ? ctx.now() : undefined });
    audit({ ...ctx, actor: asActor(user) }, 'auth.mfa_enrol_failed', { type: 'user', id: user.id }, null, { attempts, wornOut });
    throw new AppError('MFA_INVALID', 400, wornOut ? 'That code is not right, and this set-up step is used up. Sign in again to start over.' : 'That code is not right. Check the time on your phone and try again.', { attemptsLeft: Math.max(0, MFA_ENROLMENT_ATTEMPTS - attempts) });
  }
  return ctx.db.tx(() => {
    const now = ctx.now();
    // single use, even against a second confirmation racing this one
    if (ctx.db.run('UPDATE mfa_enrolments SET used_at = ? WHERE id = ? AND used_at IS NULL', [now, e.id]).changes !== 1) throw errors.badRequest('This set-up step has already been used. Sign in again to start over.', 'TOKEN_USED');
    ctx.db.update('users', user.id, { mfa_enabled: 1, failed_logins: 0, locked_until: null, updated_at: now });
    audit({ ...ctx, actor: asActor(user) }, 'auth.mfa_enabled', { type: 'user', id: user.id }, null, { via: 'enrolment_token' });
    const session = createSession(ctx, user, input.kind, { ip: ctx.ip, userAgent: input.userAgent });
    audit({ ...ctx, actor: asActor(user, session.sessionId) }, 'auth.login', { type: 'user', id: user.id }, null, { kind: input.kind, via: 'mfa_enrolment' });
    return { user: getUser(ctx, user.id)!, ...session };
  });
}

/** POST /admin/users/:id/mfa/reset: another owner (permissions.manage) clears an administrator's or owner's
 *  authenticator, with a reason. The account is signed out everywhere and must enrol again at its next sign-in. */
export function resetMfaByOwner(ctx: Ctx, targetId: string, reason: string): UserRow {
  if (!ctx.actor || ctx.actor.role !== 'owner') throw errors.forbidden('Only an owner can reset two-factor authentication');
  const target = getUser(ctx, targetId);
  if (!target || !isPrivilegedRole(target.role)) throw errors.notFound('Administrator');
  if (target.id === ctx.actor.id) throw errors.state('Another owner resets your two-factor authentication; you cannot reset your own', { code: 'SELF_MFA_RESET' });
  return ctx.db.tx(() => {
    const now = ctx.now();
    ctx.db.update('users', target.id, { mfa_enabled: 0, mfa_secret: null, updated_at: now });
    ctx.db.run('UPDATE mfa_enrolments SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [now, target.id]);
    const revoked = revokeAllSessions(ctx, target.id);
    notify(ctx, { userId: target.id, category: 'security', title: 'Your two-factor authentication was reset', body: 'An owner reset the authenticator on your Bioptime administrator account. Sign in again and set up your authenticator app. If you did not ask for this, contact a Bioptime owner.', channels: ['email'] });
    audit(ctx, 'auth.mfa_reset', { type: 'user', id: target.id }, reason, { sessionsRevoked: revoked });
    return getUser(ctx, target.id)!;
  });
}

/* ---------- password reset ---------- */
export function requestPasswordReset(ctx: Ctx, email: string): string | null {
  const user = getUserByEmail(ctx, email);
  // same response either way; an account without a password resets only when it signs in with a provider (it is how
  // such a member sets a first password), never an invited account that has not activated
  if (!user || (!user.password_hash && !(user.role === 'member' && user.state !== 'invited' && socialProvidersOf(ctx, user.id).length))) return null;
  const token = issueToken(ctx, user.id, 'password_reset', addHours(ctx.now(), 1));
  notify(ctx, { userId: user.id, category: 'security', title: 'Reset your password', body: 'Use the link we sent within an hour. If you did not ask for this, ignore it; nothing changes.', data: { resetUrl: `${ctx.config.PUBLIC_ORIGIN}/reset-password?token=${token}` }, channels: ['email'] });
  audit(ctx, 'auth.reset_requested', { type: 'user', id: user.id });
  return token;
}

/** An administrator invites a member: an account in the invited state, a single-use activation link (72 hours), no password yet. */
export function inviteMember(ctx: Ctx, input: { email: string; name: string; phone?: string; note?: string }, reason?: string): { user: UserRow; token: string } {
  const email = input.email.trim().toLowerCase();
  const existing = getUserByEmail(ctx, email);
  if (existing && (existing.role !== 'member' || existing.state !== 'invited')) throw errors.conflict('An account with this email already exists', 'EMAIL_IN_USE');
  const now = ctx.now();
  return ctx.db.tx(() => {
    const id = existing?.id ?? ids.user();
    if (!existing) {
      ctx.db.insert('users', { id, email, phone: input.phone ?? null, password_hash: null, role: 'member', state: 'invited', name: input.name, created_at: now, updated_at: now });
      ctx.db.insert('member_profiles', { user_id: id, member_code: nextCode(ctx, 'member'), created_at: now, updated_at: now });
      ctx.db.insert('notification_preferences', { user_id: id, updated_at: now });
    }
    const token = issueToken(ctx, id, 'password_reset', addHours(now, 72), { purpose: 'member_invite', invitedBy: ctx.actor?.id ?? null });
    notify(ctx, { userId: id, category: 'welcome', title: 'Your Bioptime account is ready to activate', body: 'Open the link to set your password and accept the policies. It works once and expires in 72 hours.', data: { activateUrl: `${ctx.config.PUBLIC_ORIGIN}/login/client/activate?token=${token}` }, channels: ['email'] });
    audit(ctx, 'member.invite', { type: 'user', id }, reason ?? null, { email, invitedBy: ctx.actor?.id ?? null });
    return { user: getUser(ctx, id)!, token };
  });
}

export function previewMemberInvitation(ctx: Ctx, token: string) {
  const row = ctx.db.get<{ user_id: string | null; payload: string; expires_at: string; used_at: string | null }>("SELECT user_id, payload, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND kind = 'password_reset'", [sha256(token)]);
  const payload = row ? j.out<{ purpose?: string }>(row.payload, {}) : {};
  if (!row || payload.purpose !== 'member_invite') throw errors.badRequest('This activation link is not valid. Ask Bioptime for a new one.', 'TOKEN_INVALID');
  if (row.used_at) throw errors.badRequest('This activation link has already been used. Sign in instead.', 'TOKEN_USED');
  if (row.expires_at < ctx.now()) throw errors.badRequest('This activation link has expired. Ask Bioptime for a new one.', 'TOKEN_EXPIRED');
  const user = getUser(ctx, row.user_id!);
  if (!user) throw errors.notFound('Account');
  if (user.state !== 'invited') throw errors.badRequest('This activation link no longer applies to this account. Contact Bioptime.', 'ACTIVATION_STATE');
  return { email: user.email, name: user.name, expiresAt: row.expires_at };
}

export function acceptMemberInvitation(ctx: Ctx, input: { token: string; password: string; name?: string; termsVersion: string; marketingConsent?: boolean }): UserRow {
  return ctx.db.tx(() => {
    const t = consumeToken(ctx, input.token, 'password_reset');
    if ((t.payload as { purpose?: string }).purpose !== 'member_invite') throw errors.badRequest('This link is not an activation link', 'TOKEN_INVALID');
    const user = getUser(ctx, t.user_id!);
    if (!user || user.role !== 'member') throw errors.notFound('Account');
    // only an invited account activates: a suspended or closed account keeps its state even if the link is still unexpired
    if (user.state !== 'invited') throw errors.state('This activation link no longer applies to this account. Contact Bioptime.', { code: 'ACTIVATION_STATE' });
    const now = ctx.now();
    ctx.db.update('users', user.id, { password_hash: hashPassword(input.password), name: input.name?.trim() || user.name, state: 'onboarding', email_verified_at: now, failed_logins: 0, locked_until: null, updated_at: now });
    for (const kind of ['terms', 'privacy'] as const) ctx.db.insert('member_consents', { id: ids.consent(), user_id: user.id, kind, version: input.termsVersion, granted: 1, ip: ctx.ip ?? null, at: now });
    ctx.db.insert('member_consents', { id: ids.consent(), user_id: user.id, kind: 'marketing', version: input.termsVersion, granted: input.marketingConsent ? 1 : 0, ip: ctx.ip ?? null, at: now });
    audit({ ...ctx, actor: { id: user.id, role: user.role, email: user.email, name: user.name } }, 'member.activated', { type: 'user', id: user.id });
    return getUser(ctx, user.id)!;
  });
}

export function resetPassword(ctx: Ctx, token: string, password: string): UserRow {
  return ctx.db.tx(() => {
    const t = consumeToken(ctx, token, 'password_reset');
    const purpose = (t.payload as { purpose?: string }).purpose;
    if (purpose === 'member_invite') throw errors.badRequest('Use the activation link to set up your account', 'TOKEN_INVALID');
    const user = getUser(ctx, t.user_id!);
    if (!user) throw errors.notFound('Account');
    if (purpose === 'owner_invite') return activateOwner(ctx, user, password);
    ctx.db.update('users', user.id, { password_hash: hashPassword(password), failed_logins: 0, locked_until: null, updated_at: ctx.now() });
    revokeAllSessions(ctx, user.id);
    notify(ctx, { userId: user.id, category: 'security', title: 'Your password was changed', body: 'If this was not you, reset it again and contact support.', channels: ['email'] });
    audit({ ...ctx, actor: { id: user.id, role: user.role, email: user.email, name: user.name } }, 'auth.password_reset', { type: 'user', id: user.id });
    return getUser(ctx, user.id)!;
  });
}

export function changePassword(ctx: Ctx, userId: string, current: string, next: string, keepSessionId?: string): void {
  const user = getUser(ctx, userId);
  if (!user || !verifyPassword(current, user.password_hash)) throw errors.unauthorised('Your current password is not right.', 'INVALID_CREDENTIALS');
  ctx.db.update('users', userId, { password_hash: hashPassword(next), updated_at: ctx.now() });
  revokeAllSessions(ctx, userId, keepSessionId);
  audit(ctx, 'auth.password_changed', { type: 'user', id: userId });
}

/* ---------- owner invitations (the command line: create-owner) ---------- */
/** An owner account for a real deployment, in the invited state with no password: a single-use activation link
 *  (72 hours; the reset-password page sets the password) is emailed. The command line never takes a password. After
 *  activation the owner signs in at /login/admin, where enrolling an authenticator comes before anything else
 *  (MFA_ENROLMENT_REQUIRED). Asking again for an owner still invited sends a new link (the old one stops working). */
export function inviteOwner(ctx: Ctx, input: { email: string; name: string }): { user: UserRow; token: string; activateUrl: string; expiresAt: string } {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!email.includes('@') || email.length > 254) throw errors.badRequest('Give a valid email address', 'EMAIL_INVALID');
  if (name.length < 2 || name.length > 120) throw errors.badRequest('Give the owner’s name (2 to 120 characters)', 'NAME_INVALID');
  const existing = getUserByEmail(ctx, email);
  if (existing && !(existing.role === 'owner' && existing.state === 'invited')) throw errors.conflict('That email already has an account', 'EMAIL_IN_USE');
  const now = ctx.now();
  return ctx.db.tx(() => {
    const id = existing?.id ?? ids.user();
    if (!existing) {
      ctx.db.insert('users', { id, email, password_hash: null, role: 'owner', state: 'invited', name, created_at: now, updated_at: now });
      ctx.db.insert('notification_preferences', { user_id: id, updated_at: now });
    }
    const expiresAt = addHours(now, 72);
    const token = issueToken(ctx, id, 'password_reset', expiresAt, { purpose: 'owner_invite' });
    const activateUrl = `${ctx.config.PUBLIC_ORIGIN}/reset-password?token=${token}`;
    notify(ctx, { userId: id, category: 'welcome', title: 'Your Bioptime owner account is ready to activate', body: `Open the link to set your password; it works once and expires in 72 hours. Then sign in at ${ctx.config.PUBLIC_ORIGIN}/login/admin and set up two-factor authentication, which comes before anything else.`, data: { activateUrl }, channels: ['email'] });
    audit(ctx, 'owner.invited', { type: 'user', id }, 'provisioned from the command line', { email, reissued: !!existing });
    return { user: getUser(ctx, id)!, token, activateUrl, expiresAt };
  });
}

/** The activation link of an invited owner: sets the password and activates the account (no session: the owner signs
 *  in and enrols an authenticator first). Only an owner still in the invited state activates. */
function activateOwner(ctx: Ctx, user: UserRow, password: string): UserRow {
  if (user.role !== 'owner' || user.state !== 'invited') throw errors.badRequest('This activation link no longer applies to this account.', 'ACTIVATION_STATE');
  const now = ctx.now();
  ctx.db.update('users', user.id, { password_hash: hashPassword(password), state: 'active', email_verified_at: now, mfa_enabled: 0, mfa_secret: null, failed_logins: 0, locked_until: null, updated_at: now });
  audit({ ...ctx, actor: { id: user.id, role: user.role, email: user.email, name: user.name } }, 'owner.activated', { type: 'user', id: user.id }, null, { mfa: 'enrolment required at first sign-in' });
  return getUser(ctx, user.id)!;
}

/* ---------- coach invitations ---------- */
export function inviteCoach(ctx: Ctx, input: { email: string; displayName: string; expertise?: string[]; languages?: string[]; city?: string; caseloadLimit?: number; scope?: string[] }): { invitationId: string; token: string; expiresAt: string } {
  if (!ctx.actor || (ctx.actor.role !== 'admin' && ctx.actor.role !== 'owner')) throw errors.forbidden('Only an administrator can invite a coach');
  const email = input.email.trim().toLowerCase();
  const existing = getUserByEmail(ctx, email);
  if (existing && existing.role !== 'coach') throw errors.conflict('That email already belongs to a different kind of account.', 'EMAIL_IN_USE');
  if (existing && existing.state !== 'invited') throw errors.conflict('That coach already has an account.', 'ALREADY_ACTIVE');
  const now = ctx.now();
  const expiresAt = addDays(now, 7);
  return ctx.db.tx(() => {
    ctx.db.run("UPDATE coach_invitations SET status = 'revoked', revoked_at = ? WHERE email = ? AND status = 'pending'", [now, email]);
    const userId = existing?.id ?? ids.user();
    if (!existing) {
      ctx.db.insert('users', { id: userId, email, role: 'coach', state: 'invited', name: input.displayName, created_at: now, updated_at: now });
      ctx.db.insert('coach_profiles', { user_id: userId, coach_code: nextCode(ctx, 'coach'), display_name: input.displayName, expertise: j.in(input.expertise ?? []), languages: j.in(input.languages ?? ['English']), scope: j.in(input.scope ?? ['coaching']), city: input.city ?? null, caseload_limit: input.caseloadLimit ?? 20, available: 0, created_at: now, updated_at: now });
      ctx.db.insert('notification_preferences', { user_id: userId, updated_at: now });
    }
    const token = randomToken(32);
    const id = ids.invitation();
    ctx.db.insert('coach_invitations', { id, email, invited_by: ctx.actor!.id, token_hash: sha256(token), profile_seed: j.in({ userId, ...input }), status: 'pending', expires_at: expiresAt, created_at: now });
    notify(ctx, { userId, category: 'welcome', title: 'You are invited to coach with Bioptime', body: 'Open the link to set your password, confirm your profile and activate your coach workspace. The link works once and expires in 7 days.', data: { inviteUrl: `${ctx.config.PUBLIC_ORIGIN}/dashboard/invite?token=${token}` }, channels: ['email'] });
    audit(ctx, 'coach.invited', { type: 'user', id: userId }, null, { email, invitationId: id });
    return { invitationId: id, token, expiresAt };
  });
}

export function previewInvitation(ctx: Ctx, token: string) {
  const inv = ctx.db.get<{ id: string; email: string; status: string; expires_at: string; profile_seed: string }>('SELECT * FROM coach_invitations WHERE token_hash = ?', [sha256(token)]);
  if (!inv || inv.status !== 'pending') throw errors.badRequest('This invitation is not valid any more. Ask the administrator for a new one.', 'INVITATION_INVALID');
  if (inv.expires_at < ctx.now()) { ctx.db.run("UPDATE coach_invitations SET status = 'expired' WHERE id = ?", [inv.id]); throw errors.badRequest('This invitation has expired. Ask the administrator for a new one.', 'INVITATION_EXPIRED'); }
  const invited = getUserByEmail(ctx, inv.email);
  if (!invited || invited.role !== 'coach' || invited.state !== 'invited') throw errors.badRequest('This invitation is not valid any more. Ask the administrator for a new one.', 'INVITATION_INVALID');
  const seed = j.out<{ displayName?: string; expertise?: string[]; languages?: string[]; city?: string }>(inv.profile_seed, {});
  return { email: inv.email, displayName: seed.displayName ?? '', expertise: seed.expertise ?? [], languages: seed.languages ?? ['English'], city: seed.city ?? '', expiresAt: inv.expires_at };
}

export function acceptInvitation(ctx: Ctx, input: { token: string; password: string; acceptPolicies: true; policiesVersion: string; profile: { displayName: string; bio?: string; expertise?: string[]; languages?: string[]; city?: string; timezone?: string; scope?: string[] }; availability?: Array<{ weekday: number; startMinute: number; endMinute: number; slotMinutes?: number }>; kind: SessionKind; userAgent?: string }) {
  return ctx.db.tx(() => {
    const inv = ctx.db.get<{ id: string; email: string; status: string; expires_at: string; profile_seed: string }>('SELECT * FROM coach_invitations WHERE token_hash = ?', [sha256(input.token)]);
    if (!inv || inv.status !== 'pending') throw errors.badRequest('This invitation is not valid any more.', 'INVITATION_INVALID');
    if (inv.expires_at < ctx.now()) throw errors.badRequest('This invitation has expired.', 'INVITATION_EXPIRED');
    const user = getUserByEmail(ctx, inv.email);
    if (!user || user.role !== 'coach') throw errors.state('The invited account is missing');
    // a suspended or closed account keeps its state: closing an invited coach is how an invitation is withdrawn
    if (user.state !== 'invited') throw errors.badRequest('This invitation is not valid any more.', 'INVITATION_INVALID');
    const now = ctx.now();
    ctx.db.update('users', user.id, { password_hash: hashPassword(input.password), state: 'active', email_verified_at: now, name: input.profile.displayName, updated_at: now });
    // Empty fields mean "keep what the administrator seeded"; scope is set by administrators only, never from the public accept endpoint.
    ctx.db.update('coach_profiles', user.id, {
      display_name: input.profile.displayName, bio: input.profile.bio ?? null, expertise: input.profile.expertise?.length ? j.in(input.profile.expertise) : undefined,
      languages: input.profile.languages?.length ? j.in(input.profile.languages) : undefined, city: input.profile.city?.trim() ? input.profile.city.trim() : undefined, timezone: input.profile.timezone || undefined,
      available: 1, activated_at: now, updated_at: now,
    }, 'user_id');
    for (const kind of ['terms', 'privacy'] as const) ctx.db.insert('member_consents', { id: ids.consent(), user_id: user.id, kind, version: input.policiesVersion, granted: 1, ip: ctx.ip ?? null, at: now });
    if (input.availability?.length) {
      ctx.db.run('DELETE FROM availability_rules WHERE coach_id = ?', [user.id]);
      for (const a of input.availability) ctx.db.insert('availability_rules', { id: ids.availabilityRule(), coach_id: user.id, weekday: a.weekday, start_minute: a.startMinute, end_minute: a.endMinute, slot_minutes: a.slotMinutes ?? 30, timezone: input.profile.timezone ?? 'Asia/Kolkata', active: 1 });
    }
    ctx.db.run("UPDATE coach_invitations SET status = 'accepted', accepted_at = ? WHERE id = ?", [now, inv.id]);
    const session = createSession(ctx, { id: user.id, role: 'coach' }, input.kind, { ip: ctx.ip, userAgent: input.userAgent });
    emit(ctx, 'CoachActivated', { type: 'user', id: user.id });
    audit({ ...ctx, actor: { id: user.id, role: 'coach', email: user.email, name: input.profile.displayName } }, 'coach.activated', { type: 'user', id: user.id });
    return { user: getUser(ctx, user.id)!, ...session };
  });
}

/* ---------- admin provisioning and MFA ---------- */
export function createPrivilegedUser(ctx: Ctx, input: { email: string; name: string; password: string; role: 'admin' | 'owner' }): UserRow {
  const email = input.email.trim().toLowerCase();
  if (getUserByEmail(ctx, email)) throw errors.conflict('That email already has an account', 'EMAIL_IN_USE');
  const now = ctx.now();
  const id = ids.user();
  ctx.db.insert('users', { id, email, password_hash: hashPassword(input.password), role: input.role, state: 'active', name: input.name, email_verified_at: now, created_at: now, updated_at: now });
  ctx.db.insert('notification_preferences', { user_id: id, updated_at: now });
  audit(ctx, 'admin.provisioned', { type: 'user', id }, 'provisioned from the command line or by an owner', { role: input.role });
  return getUser(ctx, id)!;
}

export function startMfaEnrolment(ctx: Ctx, userId: string): { secret: string; otpauth: string } {
  const user = getUser(ctx, userId);
  if (!user) throw errors.notFound('Account');
  // Enrolment never switches an enabled second factor off: a live session alone must not be able to downgrade the account.
  if (user.mfa_enabled) throw errors.state('MFA is already enabled on this account. To change the authenticator, disable MFA with a current code first, then set it up again.', { code: 'MFA_ALREADY_ENABLED' });
  const secret = totpSecret();
  ctx.db.update('users', userId, { mfa_secret: secret, mfa_enabled: 0, updated_at: ctx.now() });
  audit(ctx, 'auth.mfa_enrol_started', { type: 'user', id: userId });
  return { secret, otpauth: otpauthUri(secret, user.email) };
}

export function confirmMfaEnrolment(ctx: Ctx, userId: string, code: string): void {
  const user = getUser(ctx, userId);
  if (!user?.mfa_secret) throw errors.state('Start MFA set-up first');
  if (!verifyTotp(user.mfa_secret, code)) throw errors.badRequest('That code is not right. Check the time on your phone and try again.', 'MFA_INVALID');
  ctx.db.update('users', userId, { mfa_enabled: 1, updated_at: ctx.now() });
  audit(ctx, 'auth.mfa_enabled', { type: 'user', id: userId });
}

export function disableMfa(ctx: Ctx, userId: string, code: string): void {
  const user = getUser(ctx, userId);
  // mandatory for administrators and owners: switched off only by another owner's reset (resetMfaByOwner)
  if (user && isPrivilegedRole(user.role)) throw errors.forbidden('Two-factor authentication stays on for administrator accounts. If the authenticator is lost, another owner can reset it.', 'MFA_REQUIRED_FOR_ROLE');
  if (!user?.mfa_enabled || !user.mfa_secret) return;
  if (!verifyTotp(user.mfa_secret, code)) throw errors.badRequest('That code is not right.', 'MFA_INVALID');
  ctx.db.update('users', userId, { mfa_enabled: 0, mfa_secret: null, updated_at: ctx.now() });
  audit(ctx, 'auth.mfa_disabled', { type: 'user', id: userId });
}

/* ---------- account states ---------- */
export function setAccountState(ctx: Ctx, userId: string, to: AccountState, reason: string): UserRow {
  const user = getUser(ctx, userId);
  if (!user) throw errors.notFound('Account');
  // Removing a coach or client closes or deactivates the account and keeps its records (30 October 2026), so a closed
  // account can be reopened (reactivated) by an administrator, unless a deletion request is on record (closing is then
  // the end of the deletion) or the account was closed before it was ever set up (a withdrawn invitation)
  const reopen = user.state === 'closed' && to === 'active';
  if (!reopen && !ACCOUNT_TRANSITIONS[user.state].includes(to)) throw errors.state(`An account that is ${user.state} cannot become ${to}`, { from: user.state, allowed: ACCOUNT_TRANSITIONS[user.state] });
  if (reopen) {
    if (ctx.db.get("SELECT 1 FROM data_requests WHERE user_id = ? AND kind = 'deletion' AND status != 'cancelled'", [userId])) throw errors.state('This account was closed after a deletion request, so it cannot be reopened.', { code: 'DELETION_REQUESTED', from: user.state });
    if (!user.password_hash && !socialProvidersOf(ctx, userId).length) throw errors.state('This account was closed before it was ever set up, so there is nothing to reopen.', { code: 'NEVER_ACTIVATED', from: user.state });
  }
  ctx.db.update('users', userId, { state: to, updated_at: ctx.now() });
  if (to === 'suspended' || to === 'deactivated' || to === 'closed') {
    revokeAllSessions(ctx, userId);
    ctx.db.run('DELETE FROM auth_tokens WHERE user_id = ? AND used_at IS NULL', [userId]); // unused activation, reset and verification links die with the account state
    ctx.db.run("UPDATE coach_invitations SET status = 'revoked', revoked_at = ? WHERE email = ? AND status = 'pending'", [ctx.now(), user.email]); // and so do pending coach invitations
  }
  audit(ctx, 'account.state', { type: 'user', id: userId }, reason, { from: user.state, to, ...(reopen ? { reopened: true } : {}) });
  return getUser(ctx, userId)!;
}
