/* Sign in with Google and Apple, for members only (routes in api/http/routes/auth.ts; migration 0036_social_identities.sql).

   - The client (the app, later the portal) runs the provider's own flow and sends the resulting ID token here. The
     server verifies it itself, with Node's crypto and nothing else: RS256 signature against the provider's published
     keys (Google https://www.googleapis.com/oauth2/v3/certs, Apple https://appleid.apple.com/auth/keys; cached an hour,
     refetched once when a token names a key the cache does not hold), the issuer, the audience (one of the configured
     client IDs, bundle IDs or the Services ID), the expiry, and the nonce when the client gives one. Google must say the
     email is verified; Apple's emails are verified by construction (its relay addresses included).
   - What happens next depends only on what the server already knows: a linked identity (provider + subject) signs that
     member in; otherwise a member whose email the provider verified is linked and signed in (if that account's email
     was never verified, its unproven password, phone confirmation and sessions are dropped first: see link());
     otherwise the verified identity is kept for 10 minutes under a one-time token (stored hashed) and the client is asked for the policy
     acceptances (409 ACCOUNT_SETUP_NEEDED). The account is then made from the stored identity, never from what the
     client says: role member, email verified, no password (password sign-in points such an account at its provider
     button, and the forgotten-password link lets it set one). Consents, referral, welcome and audit follow
     /auth/register.
   - Never staff: an identity whose email belongs to a coach, administrator or owner is refused (WRONG_WORKSPACE) and
     nothing is linked. No route here can create or sign in anything but a member.
   - Provider "standin" exists in demo mode only (BIOPTIME_MODE=demo): it behaves like a verified identity for any
     email, so testers can try the whole flow without a Google Cloud project or an Apple Developer account. Outside demo
     mode it answers 404 and GET /public/config reports standin: false.
   - Unlinking an identity is refused when it would leave the member no way to sign in (no password, no other identity).
   - Apple's web and Android flow posts form data back to a server; POST /auth/social/apple/return takes that post and
     303-redirects to the app's scheme (or the portal's sign-in page) with the identity token, which is then verified
     through POST /auth/social/login like any other. The token is never logged. */
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import type { Ctx } from '../context.js';
import type { Config } from '../config.js';
import { ids, randomId } from '../lib/ids.js';
import { AppError, errors } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { addDays, addMinutes } from '../lib/time.js';
import { audit, emit } from '../domain/audit.js';
import { clearVerificationNudges, notify } from '../domain/notifications.js';
import { recordAtSignUp } from '../domain/referrals.js';
import { createSession, revokeAllSessions, type SessionKind } from './sessions.js';
import { getUser, getUserByEmail, nextCode, type UserRow } from './service.js';

export const SOCIAL_PROVIDERS = ['google', 'apple', 'standin'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
export type KeyedProvider = 'google' | 'apple';
export const PENDING_MINUTES = 10;

// viewer-visible names (no "demo" label anywhere a person reads: owner decision of 24 October 2026)
export const PROVIDER_LABELS: Record<SocialProvider, string> = { google: 'Google', apple: 'Apple', standin: 'the stand-in' };

/** What the provider vouched for, after verification. */
export type VerifiedIdentity = { provider: SocialProvider; subject: string; email: string | null; emailVerified: boolean; name: string | null };

/* ---------- the providers' signing keys ---------- */

export type Jwk = { kty?: string; kid?: string; alg?: string; use?: string; n?: string; e?: string };
export type JwksFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

export const KEY_URLS: Record<KeyedProvider, string> = { google: 'https://www.googleapis.com/oauth2/v3/certs', apple: 'https://appleid.apple.com/auth/keys' };
const ISSUERS: Record<KeyedProvider, string[]> = { google: ['https://accounts.google.com', 'accounts.google.com'], apple: ['https://appleid.apple.com'] };
const KEYS_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

/** The default fetcher: the provider's JWKS document over HTTPS, three seconds at most. */
export const defaultJwksFetcher: JwksFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const body = (await res.json()) as { keys?: unknown };
  if (!body || !Array.isArray(body.keys)) throw new Error(`${url} returned no keys`);
  return { keys: body.keys as Jwk[] };
};

/** The providers' public keys, cached an hour, one fetch at a time per provider, a failure remembered ten minutes (so
 *  GET /public/config never waits on an unreachable provider more than once in a while). The fetcher is replaceable:
 *  the tests serve keys of their own and never touch the network. */
export class ProviderKeys {
  private fetcher: JwksFetcher;
  private readonly cache = new Map<KeyedProvider, { keys: Jwk[]; at: number }>();
  private readonly failures = new Map<KeyedProvider, { at: number; error: string }>();
  private readonly inFlight = new Map<KeyedProvider, Promise<Jwk[]>>();
  constructor(fetcher: JwksFetcher = defaultJwksFetcher) { this.fetcher = fetcher; }

  useFetcher(fetcher: JwksFetcher): void { this.fetcher = fetcher; this.cache.clear(); this.failures.clear(); }

  /** 'fresh' while keys are held, 'failed' within ten minutes of a failed fetch, 'unknown' otherwise. Never fetches. */
  state(provider: KeyedProvider): 'fresh' | 'failed' | 'unknown' {
    const c = this.cache.get(provider);
    if (c && Date.now() - c.at < KEYS_TTL_MS) return 'fresh';
    const f = this.failures.get(provider);
    if (f && Date.now() - f.at < FAILURE_TTL_MS) return 'failed';
    return 'unknown';
  }

  /** The keys, from the cache or fetched; refresh forces a fetch (a token named a key the cache lacks: a rotation). */
  async keys(provider: KeyedProvider, opts: { refresh?: boolean } = {}): Promise<Jwk[]> {
    const c = this.cache.get(provider);
    if (!opts.refresh && c && Date.now() - c.at < KEYS_TTL_MS) return c.keys;
    const f = this.failures.get(provider);
    if (!opts.refresh && f && Date.now() - f.at < FAILURE_TTL_MS) throw new Error(f.error);
    let p = this.inFlight.get(provider);
    if (!p) {
      p = this.fetcher(KEY_URLS[provider]).then((r) => {
        const keys = (r.keys ?? []).filter((k) => k && typeof k === 'object');
        this.cache.set(provider, { keys, at: Date.now() });
        this.failures.delete(provider);
        return keys;
      }, (e: unknown) => {
        const error = e instanceof Error ? e.message : String(e);
        this.failures.set(provider, { at: Date.now(), error });
        throw new Error(error);
      }).finally(() => this.inFlight.delete(provider));
      this.inFlight.set(provider, p);
    }
    return p;
  }

  /** Whether tokens from this provider can be verified now: keys held, or fetched on this call. */
  async available(provider: KeyedProvider): Promise<boolean> {
    try { return (await this.keys(provider)).length > 0; } catch { return false; }
  }

  /** Fetches both providers' keys in the background (server start-up); failures are only remembered. */
  warm(providers: KeyedProvider[]): void { for (const p of providers) void this.keys(p).catch(() => {}); }
}

/* ---------- configuration ---------- */

/** The audiences a provider's token may name on this server; empty when the provider is not set up. */
export function audiencesFor(config: Config, provider: KeyedProvider): string[] {
  return provider === 'google' ? Object.values(config.googleClientIds).filter((v): v is string => !!v) : config.appleAudiences;
}

/** What GET /public/config tells the clients: which buttons to show and the public identifiers each flow needs. */
export async function publicSignInConfig(config: Config, keys: ProviderKeys): Promise<{ google: boolean; apple: boolean; standin: boolean; googleClientIds?: { web?: string; ios?: string; android?: string }; appleServicesId?: string }> {
  const google = audiencesFor(config, 'google').length > 0;
  const apple = audiencesFor(config, 'apple').length > 0 && (await keys.available('apple'));
  return {
    google, apple, standin: config.isDemo,
    ...(google ? { googleClientIds: config.googleClientIds } : {}),
    ...(apple && config.APPLE_SIGN_IN_SERVICES_ID ? { appleServicesId: config.APPLE_SIGN_IN_SERVICES_ID } : {}),
  };
}

/* ---------- ID token verification ---------- */

const invalid = (reason: string) => new AppError('TOKEN_INVALID', 401, 'That sign-in could not be verified. Try again.', { reason });
const unavailable = (provider: SocialProvider) => new AppError('PROVIDER_UNAVAILABLE', 404, `Sign in with ${PROVIDER_LABELS[provider]} is not available on this server.`);

function decodePart(s: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw invalid('malformed');
  let out: unknown;
  try { out = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { throw invalid('malformed'); }
  if (!out || typeof out !== 'object' || Array.isArray(out)) throw invalid('malformed');
  return out as Record<string, unknown>;
}

const sha256Hex = (s: string) => sha256(s);

/** Verifies a Google or Apple ID token: signature (RS256, the provider's key named by kid), issuer, audience, time,
 *  nonce when given, and a verified email. Returns what the provider vouched for. */
export async function verifyIdToken(keys: ProviderKeys, provider: KeyedProvider, token: string, opts: { audiences: string[]; nonce?: string; now?: number }): Promise<VerifiedIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p))) throw invalid('malformed');
  const [h, p, s] = parts as [string, string, string];
  const header = decodePart(h);
  if (header.alg !== 'RS256') throw invalid('alg'); // no "none", no HMAC: only what the providers sign with
  if (typeof header.kid !== 'string' || !header.kid) throw invalid('unknown_key');
  let list: Jwk[];
  try {
    list = await keys.keys(provider);
    if (!list.some((k) => k.kid === header.kid)) list = await keys.keys(provider, { refresh: true });
  } catch {
    throw errors.upstream(`${PROVIDER_LABELS[provider]} sign-in is not reachable right now. Try again in a few minutes, or sign in with your email and password.`, { provider });
  }
  const jwk = list.find((k) => k.kid === header.kid && (k.kty ?? 'RSA') === 'RSA' && !!k.n && !!k.e && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
  if (!jwk) throw invalid('unknown_key');
  let ok = false;
  try {
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n!, e: jwk.e! }, format: 'jwk' });
    ok = verifySignature('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  } catch { ok = false; }
  if (!ok) throw invalid('signature');
  const claims = decodePart(p);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (typeof claims.iss !== 'string' || !ISSUERS[provider].includes(claims.iss)) throw invalid('issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!opts.audiences.length || !aud.some((a) => typeof a === 'string' && opts.audiences.includes(a))) throw invalid('audience');
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw invalid('expired');
  if (typeof claims.iat === 'number' && claims.iat > now + 300) throw invalid('not_yet_valid');
  if (typeof claims.nbf === 'number' && claims.nbf > now + 60) throw invalid('not_yet_valid');
  if (typeof claims.sub !== 'string' || !claims.sub) throw invalid('subject');
  if (opts.nonce) {
    // Apple's native flow carries the SHA-256 of the nonce the app chose; Google's web flow carries the nonce itself
    const n = typeof claims.nonce === 'string' ? claims.nonce : '';
    if (!n || (n !== opts.nonce && n !== sha256Hex(opts.nonce))) throw invalid('nonce');
  }
  const email = typeof claims.email === 'string' && claims.email.trim() ? claims.email.trim().toLowerCase() : null;
  const verifiedClaim = claims.email_verified === true || claims.email_verified === 'true';
  // Google must say so explicitly; Apple verifies every address it hands out (relay addresses included)
  const emailVerified = !!email && (provider === 'apple' ? claims.email_verified !== false && claims.email_verified !== 'false' : verifiedClaim);
  if (provider === 'google' && (!email || !emailVerified)) throw invalid('email_unverified');
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 120) : null;
  return { provider, subject: claims.sub, email, emailVerified, name };
}

/* ---------- resolving what the client sent ---------- */

export type SocialInput = {
  provider: SocialProvider; idToken?: string; nonce?: string; standinEmail?: string; standinName?: string;
  pendingToken?: string; acceptTerms?: boolean; acceptPrivacy?: boolean; termsVersion?: string; marketingConsent?: boolean; referralCode?: string; name?: string;
};

/** The identity the client proved: a verified Google or Apple token, or (demo mode only) the stand-in. */
export async function resolveIdentity(ctx: Ctx, keys: ProviderKeys, input: SocialInput): Promise<VerifiedIdentity> {
  if (input.provider === 'standin') {
    if (!ctx.config.isDemo) throw unavailable('standin');
    const email = (input.standinEmail ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw errors.validation([{ path: 'standinEmail', message: 'Enter an email address' }], 'standinEmail: Enter an email address');
    return { provider: 'standin', subject: `standin:${email}`, email, emailVerified: true, name: input.standinName?.trim().slice(0, 120) || null };
  }
  const audiences = audiencesFor(ctx.config, input.provider);
  if (!audiences.length) throw unavailable(input.provider);
  if (!input.idToken) throw errors.validation([{ path: 'idToken', message: 'The sign-in token is missing' }], 'idToken: The sign-in token is missing');
  return verifyIdToken(keys, input.provider, input.idToken, { audiences, nonce: input.nonce });
}

/* ---------- identities on file ---------- */

type IdentityRow = { id: string; user_id: string; provider: SocialProvider; subject: string; email: string | null; created_at: string };

function identityRow(ctx: Ctx, provider: SocialProvider, subject: string): IdentityRow | undefined {
  return ctx.db.get<IdentityRow>('SELECT * FROM user_identities WHERE provider = ? AND subject = ?', [provider, subject]);
}
function identitiesOf(ctx: Ctx, userId: string): IdentityRow[] {
  return ctx.db.all<IdentityRow>('SELECT * FROM user_identities WHERE user_id = ? ORDER BY created_at', [userId]);
}

function assertMember(user: UserRow): void {
  if (user.role !== 'member') throw errors.forbidden('This sign-in is for members. Coaches and the Bioptime team sign in with their email and password.', 'WRONG_WORKSPACE');
}
function assertOpen(user: UserRow): void {
  if (user.state === 'suspended') throw errors.forbidden('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
  if (user.state === 'deactivated' || user.state === 'closed') throw errors.forbidden('This account is closed.', 'ACCOUNT_CLOSED');
  if (user.state === 'invited') throw errors.forbidden('Finish setting up your account from the invitation link first.', 'INVITATION_PENDING');
}

/** Links the identity to the member. The provider's verified email, when it is the account's own, verifies the account
 *  (a registration that never opened its link, for example) exactly as the emailed link would.
 *
 *  When that email was never verified before, nothing on the account was proven by the address's owner: whoever
 *  registered it chose its password and its phone, and may not be the person the provider just vouched for (register a
 *  victim's email with your own password, wait for them to tap Sign in with Google). So when the provider holder
 *  arrives at such an account by email (`by: 'sign_in'`, not a signed-in member linking their own account), the
 *  account is handed to them and the unproven credentials go: the password is cleared, the phone is unconfirmed again,
 *  every open session is revoked. Password sign-in then answers SIGN_IN_WITH_PROVIDER and only the inbox can set a new
 *  password (the forgotten-password link). A member whose email was verified keeps everything. */
function link(ctx: Ctx, user: UserRow, identity: VerifiedIdentity, by: 'sign_in' | 'member'): void {
  const now = ctx.now();
  const verifies = !user.email_verified_at && identity.emailVerified && identity.email === user.email;
  const claimed = verifies && by === 'sign_in';
  let sessionsRevoked = 0;
  if (claimed) {
    ctx.db.update('users', user.id, { password_hash: null, phone_verified_at: null, failed_logins: 0, locked_until: null, updated_at: now });
    sessionsRevoked = revokeAllSessions(ctx, user.id);
  }
  ctx.db.insert('user_identities', { id: randomId('uid'), user_id: user.id, provider: identity.provider, subject: identity.subject, email: identity.email, created_at: now });
  if (verifies) {
    ctx.db.update('users', user.id, { email_verified_at: now, state: user.state === 'pending_verification' ? 'onboarding' : user.state, updated_at: now });
    clearVerificationNudges(ctx, user.id);
    emit(ctx, 'EmailVerified', { type: 'user', id: user.id });
    audit(asUser(ctx, user), 'auth.email_verified', { type: 'user', id: user.id }, null, { by: identity.provider });
  }
  audit(asUser(ctx, user), 'auth.social_link', { type: 'user', id: user.id }, null, {
    provider: identity.provider, email: identity.email,
    ...(claimed ? { claimed: true, passwordCleared: !!user.password_hash, phoneUnconfirmed: !!user.phone_verified_at, sessionsRevoked } : {}),
  });
  if (claimed && (user.password_hash || user.phone_verified_at || sessionsRevoked)) {
    notify(ctx, { userId: user.id, category: 'security', title: 'Your account now signs in with ' + PROVIDER_LABELS[identity.provider], body: `Your email was confirmed by ${PROVIDER_LABELS[identity.provider]}. The password${user.phone_verified_at ? ' and the phone confirmation' : ''} chosen when this account was registered no longer apply, and other devices were signed out. Set a password any time from the forgotten-password link. If you did not expect this, contact support.`, channels: ['email'] });
  }
}

const asUser = (ctx: Ctx, u: UserRow, sessionId?: string): Ctx => ({ ...ctx, actor: { id: u.id, role: u.role, email: u.email, name: u.name, ...(sessionId ? { sessionId } : {}) } });

export type SocialSignIn = { user: UserRow; token: string; sessionId: string; expiresAt: string; outcome: 'signed_in' | 'linked' | 'created' };

function startSession(ctx: Ctx, user: UserRow, provider: SocialProvider, session: { kind: SessionKind; userAgent?: string }, outcome: SocialSignIn['outcome']): SocialSignIn {
  ctx.db.update('users', user.id, { failed_logins: 0, locked_until: null, updated_at: ctx.now() });
  const s = createSession(ctx, user, session.kind, { ip: ctx.ip, userAgent: session.userAgent });
  audit(asUser(ctx, user, s.sessionId), 'auth.social_signin', { type: 'user', id: user.id }, null, { provider, kind: session.kind, outcome });
  audit(asUser(ctx, user, s.sessionId), 'auth.login', { type: 'user', id: user.id }, null, { kind: session.kind, method: provider });
  return { user: getUser(ctx, user.id)!, ...s, outcome };
}

/* ---------- the sign-in ---------- */

/** POST /auth/social/login without a pendingToken: a linked identity signs in; a member with the verified email is
 *  linked and signed in; otherwise the identity is kept and ACCOUNT_SETUP_NEEDED (409) carries the one-time token. */
export function signInWithIdentity(ctx: Ctx, identity: VerifiedIdentity, session: { kind: SessionKind; userAgent?: string }): SocialSignIn {
  const found = ctx.db.tx((): SocialSignIn | null => {
    const linked = identityRow(ctx, identity.provider, identity.subject);
    if (linked) {
      const user = getUser(ctx, linked.user_id);
      if (!user) throw invalid('subject');
      assertMember(user);
      assertOpen(user);
      return startSession(ctx, user, identity.provider, session, 'signed_in');
    }
    if (identity.email && identity.emailVerified) {
      const byEmail = getUserByEmail(ctx, identity.email);
      if (byEmail) {
        assertMember(byEmail); // never links a staff account, and tells the caller so
        assertOpen(byEmail);
        link(ctx, byEmail, identity, 'sign_in');
        return startSession(ctx, getUser(ctx, byEmail.id)!, identity.provider, session, 'linked');
      }
    }
    return null;
  });
  if (found) return found;
  if (!identity.email || !identity.emailVerified) throw invalid('email_unverified'); // an account needs an email the provider verified
  const pendingToken = issuePending(ctx, identity);
  throw new AppError('ACCOUNT_SETUP_NEEDED', 409, 'Almost there: accept the terms and the privacy notice to create your Bioptime account.', { pendingToken, email: identity.email, name: identity.name, expiresInMinutes: PENDING_MINUTES });
}

type PendingRow = { id: string; provider: SocialProvider; subject: string; email: string; name: string | null; expires_at: string; used_at: string | null };

function issuePending(ctx: Ctx, identity: VerifiedIdentity): string {
  const token = randomToken(32);
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM social_sign_ups WHERE created_at < ?', [addDays(now, -1)]);
    ctx.db.insert('social_sign_ups', { id: randomId('ssu'), token_hash: sha256(token), provider: identity.provider, subject: identity.subject, email: identity.email!, name: identity.name, ip: ctx.ip ?? null, expires_at: addMinutes(now, PENDING_MINUTES), used_at: null, created_at: now });
  });
  return token;
}

/** The identity behind a pending token, consumed (one use). The errors match the other one-time links'. */
function consumePending(ctx: Ctx, token: string): VerifiedIdentity {
  return ctx.db.tx(() => {
    const row = ctx.db.get<PendingRow>('SELECT * FROM social_sign_ups WHERE token_hash = ?', [sha256(token)]);
    if (!row) throw errors.badRequest('This sign-in has not been started, or has been reset. Sign in with the provider again.', 'TOKEN_INVALID');
    if (row.used_at) throw errors.badRequest('This sign-in has already been completed. Sign in with the provider again.', 'TOKEN_USED');
    if (row.expires_at < ctx.now()) throw errors.badRequest('This sign-in took too long. Sign in with the provider again.', 'TOKEN_EXPIRED');
    ctx.db.run('UPDATE social_sign_ups SET used_at = ? WHERE id = ?', [ctx.now(), row.id]);
    if (row.provider === 'standin' && !ctx.config.isDemo) throw unavailable('standin');
    return { provider: row.provider, subject: row.subject, email: row.email, emailVerified: true, name: row.name };
  });
}

/** POST /auth/social/login with a pendingToken: the account is created from the stored identity, with the policy
 *  acceptances recorded as /auth/register records them, and signed in. (If the identity or the email gained an account
 *  meanwhile, that account is used, under the same rules as a first sign-in.) */
export function completeSignUp(ctx: Ctx, input: SocialInput & { pendingToken: string }, session: { kind: SessionKind; userAgent?: string }): SocialSignIn {
  const fields: Array<{ path: string; message: string }> = [];
  if (input.acceptTerms !== true) fields.push({ path: 'acceptTerms', message: 'You need to accept the terms to continue' });
  if (input.acceptPrivacy !== true) fields.push({ path: 'acceptPrivacy', message: 'You need to accept the privacy notice to continue' });
  if (!input.termsVersion?.trim()) fields.push({ path: 'termsVersion', message: 'Required' });
  if (fields.length) throw errors.validation(fields, `${fields[0]!.path}: ${fields[0]!.message}`);
  const termsVersion = input.termsVersion!.trim();
  const identity = consumePending(ctx, input.pendingToken);
  const made = ctx.db.tx((): { out: SocialSignIn; created: boolean } => {
    const linked = identityRow(ctx, identity.provider, identity.subject);
    if (linked) {
      const user = getUser(ctx, linked.user_id);
      if (!user) throw invalid('subject');
      assertMember(user); assertOpen(user);
      return { out: startSession(ctx, user, identity.provider, session, 'signed_in'), created: false };
    }
    const byEmail = getUserByEmail(ctx, identity.email!);
    if (byEmail) {
      assertMember(byEmail); assertOpen(byEmail);
      link(ctx, byEmail, identity, 'sign_in');
      return { out: startSession(ctx, getUser(ctx, byEmail.id)!, identity.provider, session, 'linked'), created: false };
    }
    const now = ctx.now();
    const id = ids.user();
    const name = (input.name?.trim() || identity.name || identity.email!.split('@')[0] || 'Member').slice(0, 120);
    // role member, always: this is the only role a public route may create, whatever the request says
    ctx.db.insert('users', { id, email: identity.email!, phone: null, password_hash: null, role: 'member', state: 'onboarding', name, email_verified_at: now, created_at: now, updated_at: now });
    ctx.db.insert('member_profiles', { user_id: id, member_code: nextCode(ctx, 'member'), created_at: now, updated_at: now });
    for (const kind of ['terms', 'privacy'] as const) ctx.db.insert('member_consents', { id: ids.consent(), user_id: id, kind, version: termsVersion, granted: 1, ip: ctx.ip ?? null, at: now });
    ctx.db.insert('member_consents', { id: ids.consent(), user_id: id, kind: 'marketing', version: termsVersion, granted: input.marketingConsent ? 1 : 0, ip: ctx.ip ?? null, at: now });
    ctx.db.insert('notification_preferences', { user_id: id, updated_at: now });
    ctx.db.insert('user_identities', { id: randomId('uid'), user_id: id, provider: identity.provider, subject: identity.subject, email: identity.email, created_at: now });
    const user = getUser(ctx, id)!;
    emit(ctx, 'MemberRegistered', { type: 'user', id }, { email: identity.email, method: identity.provider });
    emit(ctx, 'EmailVerified', { type: 'user', id });
    notify(ctx, { userId: id, category: 'welcome', title: 'Welcome to Bioptime', body: `Your account is ready: you signed in with ${PROVIDER_LABELS[identity.provider]}, so your email is already confirmed. Continue to onboarding.`, data: {} });
    audit(asUser(ctx, user), 'member.register', { type: 'user', id }, null, { method: identity.provider });
    audit(asUser(ctx, user), 'auth.account_created_social', { type: 'user', id }, null, { provider: identity.provider, email: identity.email, termsVersion, marketingConsent: !!input.marketingConsent });
    return { out: startSession(ctx, user, identity.provider, session, 'created'), created: true };
  });
  // the referral is recorded after the account stands, as /auth/register does; a code that does not qualify changes nothing
  if (made.created && input.referralCode) recordAtSignUp(asUser(ctx, made.out.user), made.out.user.id, input.referralCode);
  return made.out;
}

/* ---------- managing one's identities (members) ---------- */

export function listIdentities(ctx: Ctx, userId: string): { items: Array<{ provider: SocialProvider; email: string | null; linkedAt: string }>; hasPassword: boolean } {
  const user = getUser(ctx, userId);
  if (!user) throw errors.notFound('Account');
  return { items: identitiesOf(ctx, userId).map((r) => ({ provider: r.provider, email: r.email, linkedAt: r.created_at })), hasPassword: !!user.password_hash };
}

/** POST /auth/social/link: a signed-in member links a verified identity to their account. */
export function linkIdentity(ctx: Ctx, userId: string, identity: VerifiedIdentity): ReturnType<typeof listIdentities> {
  return ctx.db.tx(() => {
    const user = getUser(ctx, userId);
    if (!user) throw errors.notFound('Account');
    assertMember(user);
    const existing = identityRow(ctx, identity.provider, identity.subject);
    if (existing && existing.user_id !== userId) throw errors.conflict(`That ${PROVIDER_LABELS[identity.provider]} account is already linked to another Bioptime account.`, 'IDENTITY_IN_USE');
    if (!existing) {
      if (identitiesOf(ctx, userId).some((r) => r.provider === identity.provider)) throw errors.conflict(`Your account is already linked to a different ${PROVIDER_LABELS[identity.provider]} account. Unlink it first.`, 'PROVIDER_ALREADY_LINKED');
      link(ctx, user, identity, 'member'); // the signed-in member proves both sides: nothing is cleared
    }
    return listIdentities(ctx, userId);
  });
}

/** DELETE /auth/social/identities/:provider: refused when nothing else could sign the member in. */
export function unlinkIdentity(ctx: Ctx, userId: string, provider: SocialProvider): ReturnType<typeof listIdentities> {
  return ctx.db.tx(() => {
    const user = getUser(ctx, userId);
    if (!user) throw errors.notFound('Account');
    const mine = identitiesOf(ctx, userId);
    const row = mine.find((r) => r.provider === provider);
    if (!row) throw errors.notFound(`A linked ${PROVIDER_LABELS[provider]} account`);
    if (!user.password_hash && mine.length === 1) throw errors.conflict(`This is the only way into your account. Set a password first (use the forgotten-password link), or link another provider, then unlink ${PROVIDER_LABELS[provider]}.`, 'LAST_SIGN_IN_METHOD');
    ctx.db.run('DELETE FROM user_identities WHERE id = ?', [row.id]);
    audit(ctx, 'auth.social_unlink', { type: 'user', id: userId }, null, { provider });
    return listIdentities(ctx, userId);
  });
}

/* ---------- Apple's form post (web and Android) ---------- */

const SAFE_STATE = /^[A-Za-z0-9._~:-]{0,200}$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Where Apple's form post (id_token, state, user, error) continues: the app's scheme, or, when the state starts with
 *  "web:", the portal's member sign-in page with the token in the fragment (never sent to a server). The token is only
 *  carried here; POST /auth/social/login verifies it. */
export function appleReturnLocation(config: Config, body: Record<string, unknown>): string {
  const state = typeof body.state === 'string' && SAFE_STATE.test(body.state) ? body.state : '';
  const idToken = typeof body.id_token === 'string' && JWT_SHAPE.test(body.id_token) && body.id_token.length <= 8192 ? body.id_token : '';
  const user = typeof body.user === 'string' && body.user.length <= 2048 ? body.user : '';
  const error = typeof body.error === 'string' && /^[a-z_]{1,64}$/.test(body.error) ? body.error : (idToken ? '' : 'missing_token');
  const q = new URLSearchParams();
  if (idToken) q.set('id_token', idToken);
  if (state) q.set('state', state);
  if (user) q.set('user', user);
  if (error) q.set('error', error);
  if (state.startsWith('web:')) return `${config.PUBLIC_ORIGIN}/login/client?apple=return#${q.toString()}`;
  return `bioptime://social/apple?${q.toString()}`;
}
