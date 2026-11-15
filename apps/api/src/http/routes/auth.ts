import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { loginSchema, registerSchema, passwordSchema, emailSchema, coachIdSchema, totpCodeSchema } from '@bioptime/domain';
import { parse } from '../../lib/validate.js';
import { AppError, errors } from '../../lib/errors.js';
import { def, param } from '../route.js';
import { SESSION_COOKIE } from '../app.js';
import * as auth from '../../auth/service.js';
import { createSession, listSessions, revokeSession } from '../../auth/sessions.js';
import { totpCode } from '../../lib/crypto.js';
import { permissionsFor } from '../../auth/permissions.js';
import * as phone from '../../auth/phoneSignIn.js';
import * as social from '../../auth/social.js';
import { recordAtSignUp } from '../../domain/referrals.js';
import { audit } from '../../domain/audit.js';
import { isOpenPreviewAccount, OPEN_PREVIEW_ACCOUNTS, OPEN_PREVIEW_WORKSPACES, openPreviewProblem } from '../../auth/openPreview.js';

const WORKSPACES = { member: ['member'], client: ['member'], dashboard: ['coach', 'admin', 'owner'], coach: ['coach'], admin: ['admin', 'owner'] } as const;

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', expires: new Date(expiresAt) });
  // a readable hint (no secret in it) so the website's script knows whether to ask who is signed in
  reply.setCookie(SIGNED_IN_HINT, '1', { httpOnly: false, sameSite: 'lax', secure, path: '/', expires: new Date(expiresAt) });
}
const SIGNED_IN_HINT = 'bp_signed_in';

export function authRoutes(app: FastifyInstance): void {
  const secure = app.config.isProduction;

  // referralCode: the code from a friend's link (register?ref=CODE), from the website or the app. It is the only thing
  // the client says about a referral; the referrals module checks it and records the referral while it is switched on
  // (api/domain/referrals.ts recordAtSignUp). A code that does not qualify never stops the registration.
  const registerBody = registerSchema.extend({ referralCode: z.string().trim().max(32).optional() });
  def(app, { method: 'POST', path: '/auth/register', summary: 'Create a member account (email verification follows); referralCode records a referral when it qualifies', tag: 'auth', auth: 'none', body: registerBody, rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req, reply) => {
    const { referralCode, ...input } = parse(registerBody, req.body);
    const { user, verificationToken } = auth.registerMember(req.ctx, input);
    if (referralCode) recordAtSignUp({ ...req.ctx, actor: { id: user.id, role: 'member', email: user.email, name: user.name } }, user.id, referralCode);
    const kind = req.headers['x-bioptime-client'] === 'mobile' ? 'mobile' : 'web';
    const session = auth.signIn(req.ctx, { email: input.email, password: input.password, kind, userAgent: req.headers['user-agent'] });
    if (kind === 'web') setSessionCookie(reply, session.token, session.expiresAt, secure);
    reply.code(201);
    return { user: auth.publicUser(user), session: { token: kind === 'mobile' ? session.token : undefined, expiresAt: session.expiresAt }, verification: { required: true, ...(app.config.isDemo ? { demoToken: verificationToken, note: 'Emails are not sent from this server; use this token or the outbox.' } : {}) } };
  });

  // email OR coachId, exactly one. coachId is the Coach ID on the coach's profile (BPC-0001; letter case and surrounding
  // spaces do not matter) and signs in to the coach workspace only: with any other workspace (or none) the body is
  // refused as VALIDATION_FAILED. A wrong Coach ID answers INVALID_CREDENTIALS exactly as a wrong password does, and
  // both ways share the account's lockout. An administrator or owner without an enrolled authenticator gets 403
  // MFA_ENROLMENT_REQUIRED { enrolmentToken, expiresInMinutes } instead of a session (/auth/mfa/enrol/start, confirm).
  const loginBody = z.object({
    email: emailSchema.optional(),
    coachId: coachIdSchema.optional(),
    password: loginSchema.shape.password,
    mfaCode: loginSchema.shape.mfaCode,
    workspace: z.enum(['member', 'client', 'dashboard', 'coach', 'admin']).optional(),
  }).superRefine((v, c) => {
    if (v.email === undefined && v.coachId === undefined) c.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Required' });
    if (v.email !== undefined && v.coachId !== undefined) c.addIssue({ code: z.ZodIssueCode.custom, path: ['coachId'], message: 'Sign in with an email or a Coach ID, not both' });
    if (v.coachId !== undefined && v.workspace !== 'coach') c.addIssue({ code: z.ZodIssueCode.custom, path: ['workspace'], message: 'A Coach ID signs in to the coach workspace only' });
  });
  def(app, { method: 'POST', path: '/auth/login', summary: 'Sign in with email and password, or (coach workspace) the Coach ID and password; MFA code for administrators; workspace member|client|dashboard|coach|admin', tag: 'auth', auth: 'none', body: loginBody, rateLimit: { max: 20, timeWindow: '10 minutes' }, responses: { '401': 'INVALID_CREDENTIALS (wrong email, Coach ID or password), MFA_REQUIRED (send mfaCode), MFA_INVALID', '403': 'MFA_ENROLMENT_REQUIRED: { error: { details: { enrolmentToken, expiresInMinutes: 15 } } } for an administrator or owner without an authenticator; WRONG_WORKSPACE; ACCOUNT_SUSPENDED; ACCOUNT_CLOSED; INVITATION_PENDING', '429': 'RATE_LIMITED: locked for 10 minutes after 5 failures' } }, async (req, reply) => {
    const input = parse(loginBody, req.body);
    const kind = req.headers['x-bioptime-client'] === 'mobile' ? 'mobile' : 'web';
    const expectedRoles = input.workspace ? [...WORKSPACES[input.workspace]] : undefined;
    let s: ReturnType<typeof auth.signIn>;
    try { s = auth.signIn(req.ctx, { ...(input.coachId !== undefined ? { coachId: input.coachId } : { email: input.email }), password: input.password, mfaCode: input.mfaCode, kind, userAgent: req.headers['user-agent'], expectedRoles }); }
    catch (e) {
      // demo mode only: the "code needed" answer names the preview helper (GET /auth/demo/totp, below), so the clients
      // offer "Fill in the preview code" only where it exists; the helper itself admits only seeded accounts. During
      // enrolment it answers for the secret enrol/start just issued.
      if (app.config.isDemo && e instanceof AppError && e.code === 'MFA_REQUIRED') throw new AppError('MFA_REQUIRED', 401, e.message, { previewCodePath: '/auth/demo/totp' });
      if (app.config.isDemo && e instanceof AppError && e.code === 'MFA_ENROLMENT_REQUIRED') throw new AppError(e.code, e.status, e.message, { ...(e.details as object), previewCodePath: '/auth/demo/totp' });
      throw e;
    }
    if (kind === 'web') setSessionCookie(reply, s.token, s.expiresAt, secure);
    return { user: auth.publicUser(s.user), permissions: permissionsFor(req.ctx, s.user), session: { token: kind === 'mobile' ? s.token : undefined, expiresAt: s.expiresAt, kind } };
  });

  // The open preview (owner decision, 30 October 2026; api/auth/openPreview.ts): registered only while it is effective
  // (BIOPTIME_MODE=demo and OPEN_PREVIEW=1), so everywhere else this path answers 404 NOT_FOUND like any unknown route.
  // It opens the fixed account of the workspace with no password and no authenticator code, entirely server-side, and
  // answers exactly as POST /auth/login does (web: the session cookie; X-Bioptime-Client: mobile: the bearer token).
  // The account must exist and be active (and, for admin, have its authenticator enrolled); otherwise 409. Audited as
  // auth.open_preview. The password lockout of the account is left alone: it guards password sign-in only.
  if (app.config.openPreview) {
    const openPreviewBody = z.object({ workspace: z.enum(OPEN_PREVIEW_WORKSPACES) });
    def(app, { method: 'POST', path: '/auth/open-preview', summary: 'OPEN PREVIEW ONLY (BIOPTIME_MODE=demo with OPEN_PREVIEW=1; 404 otherwise): open the workspace member|coach|admin as its fixed account without signing in; answers as /auth/login', tag: 'demo', auth: 'none', body: openPreviewBody, rateLimit: { max: 120, timeWindow: '10 minutes' }, responses: { '409': 'OPEN_PREVIEW_UNAVAILABLE: the workspace’s account is missing, not active, not of that role, or (admin) has no authenticator enrolled; the message says which' } }, async (req, reply) => {
      const { workspace } = parse(openPreviewBody, req.body);
      const kind = req.headers['x-bioptime-client'] === 'mobile' ? 'mobile' : 'web';
      const user = auth.getUserByEmail(req.ctx, OPEN_PREVIEW_ACCOUNTS[workspace]);
      const problem = openPreviewProblem(workspace, user);
      if (problem || !user) throw new AppError('OPEN_PREVIEW_UNAVAILABLE', 409, problem ?? 'This workspace cannot open on its own right now.', { workspace });
      // everyone shares this account, so its session rows keep no visitor's address or browser (the audit row has the IP)
      const s = createSession(req.ctx, user, kind, {});
      audit({ ...req.ctx, actor: { id: user.id, role: user.role, email: user.email, name: user.name, sessionId: s.sessionId } }, 'auth.open_preview', { type: 'user', id: user.id }, null, { workspace, kind, sessionId: s.sessionId }); // the session id (never the token) lets a start with the preview off sign these sessions out (endOpenPreviewSessions)
      reply.header('cache-control', 'no-store');
      if (kind === 'web') setSessionCookie(reply, s.token, s.expiresAt, secure);
      return { user: auth.publicUser(user), permissions: permissionsFor(req.ctx, user), session: { token: kind === 'mobile' ? s.token : undefined, expiresAt: s.expiresAt, kind } };
    });
  }

  def(app, { method: 'POST', path: '/auth/logout', summary: 'End the current session', tag: 'auth', auth: 'any', allowWithoutMfa: true }, async (req, reply) => {
    if (req.ctx.actor?.sessionId) revokeSession(req.ctx, req.ctx.actor.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(SIGNED_IN_HINT, { path: '/' });
    return { ok: true };
  });

  def(app, { method: 'GET', path: '/auth/me', summary: 'The signed-in account', tag: 'auth', auth: 'any' }, async (req) => {
    const u = auth.getUser(req.ctx, req.ctx.actor!.id)!;
    return { user: auth.publicUser(u), permissions: permissionsFor(req.ctx, u), session: { id: req.ctx.actor!.sessionId } };
  });

  def(app, { method: 'POST', path: '/auth/verify-email', summary: 'Verify an email with the token from the link', tag: 'auth', auth: 'none', body: z.object({ token: z.string().min(10) }) }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10) }), req.body);
    const u = auth.verifyEmail(req.ctx, token);
    return { user: auth.publicUser(u) };
  });

  def(app, { method: 'POST', path: '/auth/resend-verification', summary: 'Send the verification link again', tag: 'auth', auth: 'none', body: z.object({ email: emailSchema }), rateLimit: { max: 5, timeWindow: '10 minutes' } }, async (req) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const token = auth.resendVerification(req.ctx, email);
    return { ok: true, message: 'If that email has an unverified account, a new link is on its way.', ...(app.config.isDemo && token ? { demoToken: token, note: 'Emails are not sent from this server; use this token or the outbox.' } : {}) };
  });

  def(app, { method: 'POST', path: '/auth/password/forgot', summary: 'Request a password reset link', tag: 'auth', auth: 'none', body: z.object({ email: emailSchema }), rateLimit: { max: 5, timeWindow: '10 minutes' } }, async (req) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const token = auth.requestPasswordReset(req.ctx, email);
    return { ok: true, message: 'If that email has an account, a reset link is on its way.', ...(app.config.isDemo && token ? { demoToken: token, note: 'Emails are not sent from this server; use this token or the outbox.' } : {}) };
  });

  def(app, { method: 'POST', path: '/auth/password/reset', summary: 'Set a new password with a reset token', tag: 'auth', auth: 'none', body: z.object({ token: z.string().min(10), password: passwordSchema }), rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req) => {
    const input = parse(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
    const u = auth.resetPassword(req.ctx, input.token, input.password);
    return { user: auth.publicUser(u) };
  });

  def(app, { method: 'POST', path: '/auth/password/change', summary: 'Change the password (other sessions are signed out)', tag: 'auth', auth: 'any', body: z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }) }, async (req) => {
    const input = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
    auth.changePassword(req.ctx, req.ctx.actor!.id, input.currentPassword, input.newPassword, req.ctx.actor!.sessionId);
    return { ok: true };
  });

  // in the open preview many visitors share one account: each sees, and can end, only their own session
  const sharedPreview = (req: { ctx: { actor?: { id: string } | null } & Parameters<typeof isOpenPreviewAccount>[0] }) => app.config.openPreview && isOpenPreviewAccount(req.ctx, req.ctx.actor?.id);
  def(app, { method: 'GET', path: '/auth/sessions', summary: 'Active sessions (devices) for this account', tag: 'auth', auth: 'any' }, async (req) => {
    const items = listSessions(req.ctx, req.ctx.actor!.id);
    return { items: sharedPreview(req) ? items.filter((s) => s.id === req.ctx.actor!.sessionId) : items, current: req.ctx.actor!.sessionId };
  });
  def(app, { method: 'DELETE', path: '/auth/sessions/:id', summary: 'Sign out one session', tag: 'auth', auth: 'any' }, async (req) => {
    const id = param(req, 'id');
    const mine = (sharedPreview(req) ? [{ id: req.ctx.actor!.sessionId }] : listSessions(req.ctx, req.ctx.actor!.id)).some((s) => s.id === id);
    if (!mine) throw errors.notFound('Session');
    revokeSession(req.ctx, id);
    return { ok: true };
  });

  def(app, { method: 'POST', path: '/auth/mfa/setup', summary: 'Start MFA enrolment (admins and owners): returns the secret and otpauth URI', tag: 'auth', auth: 'admin' }, async (req) => auth.startMfaEnrolment(req.ctx, req.ctx.actor!.id));
  def(app, { method: 'POST', path: '/auth/mfa/confirm', summary: 'Confirm MFA with a code from the authenticator', tag: 'auth', auth: 'admin', body: z.object({ code: z.string().regex(/^\d{6}$/) }) }, async (req) => { auth.confirmMfaEnrolment(req.ctx, req.ctx.actor!.id, parse(z.object({ code: z.string() }), req.body).code); return { ok: true }; });
  def(app, { method: 'POST', path: '/auth/mfa/disable', summary: 'Refused for administrators and owners (403 MFA_REQUIRED_FOR_ROLE): two-factor authentication is mandatory; another owner resets a lost authenticator (POST /admin/users/:id/mfa/reset)', tag: 'auth', auth: 'admin', body: z.object({ code: z.string().regex(/^\d{6}$/) }) }, async (req) => { auth.disableMfa(req.ctx, req.ctx.actor!.id, parse(z.object({ code: z.string() }), req.body).code); return { ok: true }; });

  // Mandatory enrolment (administrators and owners; migration 0037): the enrolment token from MFA_ENROLMENT_REQUIRED is
  // good for these two calls only, for 15 minutes, once. start hands out a fresh secret (again on a repeat call);
  // confirm with a correct six-digit code switches MFA on and answers like a sign-in (web: the session cookie; mobile:
  // the token). Five wrong codes use the token up.
  const enrolStart = z.object({ enrolmentToken: z.string().min(16).max(200) });
  def(app, { method: 'POST', path: '/auth/mfa/enrol/start', summary: 'Mandatory MFA enrolment, step 1: the authenticator secret and otpauth URI for the account behind the enrolment token', tag: 'auth', auth: 'none', body: enrolStart, rateLimit: { max: 20, timeWindow: '10 minutes' }, responses: { '400': 'TOKEN_INVALID, TOKEN_USED or TOKEN_EXPIRED: sign in again for a new token', '409': 'MFA_ALREADY_ENABLED' } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return auth.startEnrolmentWithToken(req.ctx, parse(enrolStart, req.body).enrolmentToken);
  });
  const enrolConfirm = z.object({ enrolmentToken: z.string().min(16).max(200), code: totpCodeSchema });
  def(app, { method: 'POST', path: '/auth/mfa/enrol/confirm', summary: 'Mandatory MFA enrolment, step 2: a correct code switches MFA on and signs in (the sign-in response); the token works once', tag: 'auth', auth: 'none', body: enrolConfirm, rateLimit: { max: 20, timeWindow: '10 minutes' }, responses: { '400': 'MFA_INVALID { attemptsLeft } or TOKEN_INVALID, TOKEN_USED, TOKEN_EXPIRED', '409': 'MFA_ENROLMENT_NOT_STARTED, MFA_ALREADY_ENABLED' } }, async (req, reply) => {
    const i = parse(enrolConfirm, req.body);
    const kind = req.headers['x-bioptime-client'] === 'mobile' ? 'mobile' : 'web';
    const s = auth.confirmEnrolmentWithToken(req.ctx, { token: i.enrolmentToken, code: i.code, kind, userAgent: req.headers['user-agent'] });
    if (kind === 'web') setSessionCookie(reply, s.token, s.expiresAt, secure);
    return { user: auth.publicUser(s.user), permissions: permissionsFor(req.ctx, s.user), session: { token: kind === 'mobile' ? s.token : undefined, expiresAt: s.expiresAt, kind } };
  });

  // previews take the token in the body, never in the URL, so it does not reach request logs, proxies or browser history
  const previewBody = z.object({ token: z.string().min(10).max(200) });
  def(app, { method: 'POST', path: '/auth/invitations/member/preview', summary: 'Preview a member invitation (activation link); the token travels in the body', tag: 'auth', auth: 'none', body: previewBody, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req) => auth.previewMemberInvitation(req.ctx, parse(previewBody, req.body).token));
  const memberAccept = z.object({ token: z.string().min(16), password: passwordSchema, name: z.string().trim().min(2).max(120).optional(), acceptTerms: z.literal(true), acceptPrivacy: z.literal(true), termsVersion: z.string().min(1), marketingConsent: z.boolean().optional() });
  def(app, { method: 'POST', path: '/auth/invitations/member/accept', summary: 'Activate an invited member account: set the password, accept the policies; a session starts', tag: 'auth', auth: 'none', body: memberAccept, rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(memberAccept, req.body);
    const user = auth.acceptMemberInvitation(req.ctx, i);
    const kind = req.headers['x-bioptime-client'] === 'mobile' ? 'mobile' : 'web';
    const session = auth.signIn(req.ctx, { email: user.email, password: i.password, kind, userAgent: req.headers['user-agent'] });
    if (kind === 'web') setSessionCookie(reply, session.token, session.expiresAt, secure);
    return { user: auth.publicUser(user), permissions: [], ...(kind === 'mobile' ? { token: session.token, expiresAt: session.expiresAt } : {}) };
  });
  def(app, { method: 'POST', path: '/auth/invitations/preview', summary: 'Preview a coach invitation; the token travels in the body', tag: 'auth', auth: 'none', body: previewBody, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req) => auth.previewInvitation(req.ctx, parse(previewBody, req.body).token));

  const acceptSchema = z.object({
    token: z.string().min(10), password: passwordSchema, acceptPolicies: z.literal(true), policiesVersion: z.string().min(1),
    profile: z.object({ displayName: z.string().min(2).max(120), bio: z.string().max(2000).optional(), expertise: z.array(z.string()).optional(), languages: z.array(z.string()).optional(), city: z.string().optional(), timezone: z.string().optional(), scope: z.array(z.string()).optional() }),
    availability: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440), slotMinutes: z.number().int().min(15).max(120).optional() })).optional(),
  });
  def(app, { method: 'POST', path: '/auth/invitations/accept', summary: 'Accept a coach invitation: set the password, confirm the profile, activate', tag: 'auth', auth: 'none', body: acceptSchema, rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req, reply) => {
    const input = parse(acceptSchema, req.body);
    const r = auth.acceptInvitation(req.ctx, { ...input, kind: 'web', userAgent: req.headers['user-agent'] });
    setSessionCookie(reply, r.token, r.expiresAt, secure);
    return { user: auth.publicUser(r.user), session: { expiresAt: r.expiresAt } };
  });

  /* ---------- phone sign-in (switch 'phone_sign_in'; api/auth/phoneSignIn.ts) ---------- */
  // a number as people type it, read as an international number; the error never says whether it has an account
  const phoneInput = z.string().trim().min(6).max(32).transform((v, c) => {
    const n = phone.normalisePhone(v);
    if (!n) { c.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter your mobile number with its country code, like +91 98123 45678' }); return z.NEVER; }
    return n;
  });
  const sixDigits = z.string().trim().regex(/^\d{6}$/, 'Enter the six-digit code');
  const phoneStart = z.object({ phone: phoneInput, workspace: z.enum(['client', 'member']).default('client') });
  def(app, { method: 'POST', path: '/auth/phone/start', summary: 'Ask for a one-time sign-in code by SMS (members only); the same answer whether or not the number has an account; limited per number and per address', tag: 'auth', auth: 'none', feature: phone.PHONE_SIGN_IN_FLAG, body: phoneStart, rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req, reply) => {
    const input = parse(phoneStart, req.body);
    const out = phone.startPhoneSignIn(req.ctx, input.phone);
    reply.code(202);
    // the message depends only on how SMS is delivered here (delivered: false while SMS is the outbox, which sends no text
    // message) and, in demo mode, names the preview helper: the same for every number, so the clients offer "Fill in the
    // preview code" only where it exists and never claim a text message that is not sent
    return { ...out, message: phone.startMessage(req.ctx), ...(app.config.isDemo ? { previewCodePath: '/auth/demo/phone-code' } : {}) };
  });
  const phoneVerify = z.object({ phone: phoneInput, code: sixDigits, workspace: z.enum(['client', 'member']).default('client') });
  def(app, { method: 'POST', path: '/auth/phone/verify', summary: 'Sign in with the one-time code (members only; works once, for 10 minutes, 5 attempts)', tag: 'auth', auth: 'none', feature: phone.PHONE_SIGN_IN_FLAG, body: phoneVerify, rateLimit: { max: 20, timeWindow: '10 minutes' } }, async (req, reply) => {
    const input = parse(phoneVerify, req.body);
    const kind = req.headers['x-bioptime-client'] === 'mobile' ? 'mobile' : 'web';
    const s = phone.verifyPhoneSignIn(req.ctx, { phone: input.phone, code: input.code, kind, userAgent: req.headers['user-agent'] });
    if (kind === 'web') setSessionCookie(reply, s.token, s.expiresAt, secure);
    return { user: auth.publicUser(s.user), permissions: permissionsFor(req.ctx, s.user), session: { token: kind === 'mobile' ? s.token : undefined, expiresAt: s.expiresAt, kind } };
  });
  def(app, { method: 'POST', path: '/auth/phone/confirm/start', summary: 'Send a code to the number on my profile, to confirm it (members); a confirmed number can then sign in', tag: 'auth', auth: 'member', feature: phone.PHONE_SIGN_IN_FLAG, rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req, reply) => { const out = phone.startPhoneConfirmation(req.ctx, req.ctx.actor!.id); reply.code(202); return out; });
  const confirmBody = z.object({ code: sixDigits });
  def(app, { method: 'POST', path: '/auth/phone/confirm', summary: 'Confirm the number on my profile with the code (works once, for 10 minutes, 5 attempts)', tag: 'auth', auth: 'member', feature: phone.PHONE_SIGN_IN_FLAG, body: confirmBody, rateLimit: { max: 20, timeWindow: '10 minutes' } }, async (req) => phone.confirmPhone(req.ctx, req.ctx.actor!.id, parse(confirmBody, req.body).code));

  /* ---------- Sign in with Google and Apple (members only; api/auth/social.ts, migration 0036) ---------- */
  // The client runs the provider's flow and sends the ID token; the server verifies it against the provider's published
  // keys. Without a pendingToken: a linked identity signs in, a member with the verified email is linked and signed in,
  // and an unknown identity answers 409 ACCOUNT_SETUP_NEEDED { pendingToken, email, name } (the identity is kept server-side
  // for 10 minutes). With the pendingToken and the policy acceptances, the member account is created (no password; email
  // verified) and signed in. Provider "standin" (demo mode only) stands in for a verified identity of any email.
  const socialBody = z.object({
    provider: z.enum(social.SOCIAL_PROVIDERS),
    idToken: z.string().min(20).max(8192).optional(),
    nonce: z.string().min(1).max(512).optional(),
    standinEmail: z.string().trim().max(254).optional(),
    standinName: z.string().trim().max(120).optional(),
    pendingToken: z.string().min(16).max(200).optional(),
    acceptTerms: z.boolean().optional(),
    acceptPrivacy: z.boolean().optional(),
    termsVersion: z.string().max(40).optional(),
    marketingConsent: z.boolean().optional(),
    referralCode: z.string().trim().max(32).optional(),
    name: z.string().trim().min(2).max(120).optional(),
  });
  def(app, { method: 'POST', path: '/auth/social/login', summary: 'Sign in or sign up with Google or Apple (members only): verifies the ID token server-side; 409 ACCOUNT_SETUP_NEEDED carries a 10-minute pendingToken, sent back with acceptTerms, acceptPrivacy and termsVersion to create the account; provider standin exists in demo mode only', tag: 'auth', auth: 'none', body: socialBody, rateLimit: { max: 20, timeWindow: '10 minutes' }, responses: { '201': 'The account was just created (outcome "created")', '409': 'ACCOUNT_SETUP_NEEDED: { error: { details: { pendingToken, email, name, expiresInMinutes } } }; the client sends pendingToken back with the acceptances', '404': 'PROVIDER_UNAVAILABLE: that provider is not set up on this server (standin outside demo mode)', '502': 'UPSTREAM_UNAVAILABLE: the provider’s signing keys could not be fetched' } }, async (req, reply) => {
    const input = parse(socialBody, req.body);
    const kind = req.headers['x-bioptime-client'] === 'mobile' ? 'mobile' : 'web';
    const session = { kind, userAgent: req.headers['user-agent'] } as const;
    const s = input.pendingToken
      ? social.completeSignUp(req.ctx, { ...input, pendingToken: input.pendingToken }, session)
      : social.signInWithIdentity(req.ctx, await social.resolveIdentity(req.ctx, app.services.identity, input), session);
    if (kind === 'web') setSessionCookie(reply, s.token, s.expiresAt, secure);
    if (s.outcome === 'created') reply.code(201);
    return { user: auth.publicUser(s.user), permissions: permissionsFor(req.ctx, s.user), session: { token: kind === 'mobile' ? s.token : undefined, expiresAt: s.expiresAt, kind }, outcome: s.outcome };
  });
  def(app, { method: 'GET', path: '/auth/social/identities', summary: 'The Google / Apple identities linked to my account, and whether a password is set', tag: 'auth', auth: 'member' }, async (req) => social.listIdentities(req.ctx, req.ctx.actor!.id));
  const linkBody = socialBody.pick({ provider: true, idToken: true, nonce: true, standinEmail: true, standinName: true });
  def(app, { method: 'POST', path: '/auth/social/link', summary: 'Link a Google / Apple identity to my account (the same token verification as signing in)', tag: 'auth', auth: 'member', body: linkBody, rateLimit: { max: 20, timeWindow: '10 minutes' } }, async (req) => {
    const input = parse(linkBody, req.body);
    return social.linkIdentity(req.ctx, req.ctx.actor!.id, await social.resolveIdentity(req.ctx, app.services.identity, input));
  });
  def(app, { method: 'DELETE', path: '/auth/social/identities/:provider', summary: 'Unlink a Google / Apple identity (refused, LAST_SIGN_IN_METHOD, when nothing else could sign me in)', tag: 'auth', auth: 'member' }, async (req) => {
    const provider = param(req, 'provider');
    if (!(social.SOCIAL_PROVIDERS as readonly string[]).includes(provider)) throw errors.notFound('Provider');
    return social.unlinkIdentity(req.ctx, req.ctx.actor!.id, provider as social.SocialProvider);
  });
  // Apple's web and Android flow (response_mode form_post) posts code, id_token, state and user to this address; the
  // answer is a 303 to the app's scheme, bioptime://social/apple?id_token=…&state=…[&user=…][&error=…], or, when the
  // state starts with "web:", to PUBLIC_ORIGIN/login/client?apple=return#id_token=…&state=… (the token in the fragment,
  // which no server receives). Nothing is verified or logged here: the client posts the token to /auth/social/login.
  def(app, { method: 'POST', path: '/auth/social/apple/return', summary: 'Apple’s form post (code, id_token, state, user) → 303 to bioptime://social/apple?id_token=…&state=… (or the portal’s sign-in page when state starts with "web:"); the token is only carried, never verified or logged here', tag: 'auth', auth: 'none', rateLimit: { max: 30, timeWindow: '10 minutes' }, responses: { '303': 'Redirect to the app scheme or the portal with id_token, state, user and error' } }, async (req, reply) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    reply.header('cache-control', 'no-store');
    return reply.redirect(social.appleReturnLocation(app.config, body), 303);
  });

  if (app.config.isDemo) {
    // demo only: the live sign-in code last sent to a seeded member's confirmed number, so people trying the product can
    // sign in without a real SMS (the portal and the app offer "Fill in the preview code" in demo mode only); never a code
    // to confirm a number; the same refusal for every other number. The number travels in the body, never in the URL,
    // so it does not reach request logs, proxies or browser history.
    const phonePreviewBody = z.object({ phone: phoneInput });
    def(app, { method: 'POST', path: '/auth/demo/phone-code', summary: 'DEMO ONLY: the live sign-in code last sent to a seeded member’s confirmed number; the number in the body (one refusal for every other number)', tag: 'demo', auth: 'none', feature: phone.PHONE_SIGN_IN_FLAG, body: phonePreviewBody, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return { ...phone.previewCode(req.ctx, parse(phonePreviewBody, req.body).phone), preview: true };
    });

    // demo only: the current TOTP code for a seeded account, so a tester can sign in to the admin workspace without an authenticator
    def(app, { method: 'GET', path: '/auth/demo/totp', summary: 'DEMO ONLY: current MFA code for a seeded privileged account', tag: 'demo', auth: 'none', query: z.object({ email: z.string() }) }, async (req) => {
      const email = String((req.query as Record<string, string>).email ?? '');
      if (!email.endsWith('@demo.bioptime.test')) throw errors.forbidden('Only seeded demo accounts');
      const u = auth.getUserByEmail(req.ctx, email);
      if (!u?.mfa_secret) throw errors.notFound('MFA account');
      return { email, code: totpCode(u.mfa_secret), validForSeconds: 30 - (Math.floor(Date.now() / 1000) % 30), demo: true };
    });
  }
}
