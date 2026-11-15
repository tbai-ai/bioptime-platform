/* Open preview (owner decision, 30 October 2026: "remove the login for now from the app and the website"). A
   reversible demo-only mode: with BIOPTIME_MODE=demo and OPEN_PREVIEW=1 (config.openPreview; any other mode with
   OPEN_PREVIEW=1 refuses to start, api/config.ts), POST /auth/open-preview opens the fixed account of a workspace
   without a password or an authenticator code, server-side: no credential, code or secret is ever handed to a client.
   Turning it off is one environment change (unset OPEN_PREVIEW) and a restart; with it unset none of this is
   registered.

   While it is on, anyone with the link acts as these three accounts, so the administrative actions that could make
   this server contact arbitrary hosts, read or write outside its data folders, lock the owner out of the demo, or leave
   a lasting way in after the preview is switched off are refused with 403 OPEN_PREVIEW_RESTRICTED (OPEN_PREVIEW_RESTRICTED
   below; def() in api/http/route.ts applies it after the role, permission and feature checks; the audit of every
   route is in docs/DECISIONS.md, "Open preview"). Everything else in the admin dashboard works. */
import type { FastifyRequest } from 'fastify';
import type { Ctx } from '../context.js';
import type { Role } from '@bioptime/domain';
import { AppError } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { audit } from '../domain/audit.js';

/** The account each workspace opens (seeded in demo mode by api/seed/seed.ts). */
export const OPEN_PREVIEW_ACCOUNTS = {
  member: 'priya.nair@demo.bioptime.test',
  coach: 'asha.menon@demo.bioptime.test',
  admin: 'rohan@demo.bioptime.test',
} as const;
export type OpenPreviewWorkspace = keyof typeof OPEN_PREVIEW_ACCOUNTS;
export const OPEN_PREVIEW_WORKSPACES = Object.keys(OPEN_PREVIEW_ACCOUNTS) as [OpenPreviewWorkspace, ...OpenPreviewWorkspace[]];
/** The roles a workspace's account must hold (the same as POST /auth/login's workspaces). */
export const OPEN_PREVIEW_ROLES: Record<OpenPreviewWorkspace, readonly Role[]> = { member: ['member'], coach: ['coach'], admin: ['admin', 'owner'] };
const WORKSPACE_WORDS: Record<OpenPreviewWorkspace, string> = { member: 'client', coach: 'coach', admin: 'admin' };

const PREVIEW_EMAILS: ReadonlySet<string> = new Set(Object.values(OPEN_PREVIEW_ACCOUNTS));

/** Is this user one of the three accounts the open preview signs everyone in as? */
export function isOpenPreviewAccount(ctx: Ctx, userId: string | undefined | null): boolean {
  if (!userId) return false;
  const u = ctx.db.get<{ email: string }>('SELECT email FROM users WHERE id = ?', [userId]);
  return !!u && PREVIEW_EMAILS.has(u.email);
}

/** Why the workspace's account cannot be opened (a plain sentence for the sign-in page), or null when it can: the
 *  account must exist, be active, hold the workspace's role and, for the admin workspace, have its authenticator
 *  enrolled (a privileged session without one reaches nothing; api/auth/permissions.ts). */
export function openPreviewProblem(workspace: OpenPreviewWorkspace, user: { role: Role; state: string; mfa_enabled: number } | undefined): string | null {
  const email = OPEN_PREVIEW_ACCOUNTS[workspace];
  const lead = `The ${WORKSPACE_WORDS[workspace]} workspace cannot open on its own right now`;
  if (!user) return `${lead}: its account (${email}) is not on this server. Sign in with a password instead.`;
  if (!OPEN_PREVIEW_ROLES[workspace].includes(user.role)) return `${lead}: its account (${email}) is no longer a ${WORKSPACE_WORDS[workspace]} account. Sign in with a password instead.`;
  if (user.state !== 'active') return `${lead}: its account (${email}) is ${user.state.replace(/_/g, ' ')}, not active. Sign in with a password instead.`;
  if ((user.role === 'admin' || user.role === 'owner') && !user.mfa_enabled) return `${lead}: its account (${email}) has no authenticator app set up. Sign in with the password to set one up.`;
  return null;
}

/** Turning the preview off ends what it opened: on a start with the preview off, every session it opened that is still
 *  live (its id is in an auth.open_preview audit row) is revoked, so a visitor's 30-day client or coach session does
 *  not outlive the switch. Sessions opened with a password are untouched. Returns how many were revoked (audited once,
 *  as auth.open_preview_ended, when there were any). */
export function endOpenPreviewSessions(ctx: Ctx): number {
  const now = ctx.now();
  const n = ctx.db.run("UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at > ? AND id IN (SELECT json_extract(data, '$.sessionId') FROM audit_events WHERE action = 'auth.open_preview')", [now, now]).changes;
  if (n) audit(ctx, 'auth.open_preview_ended', null, 'the open preview is off: the sessions it opened were signed out', { sessionsRevoked: n });
  return n;
}

/* ---------- what stays switched off while the preview is on ---------- */

type Restriction = {
  /** The plain message the caller sees. */
  message: string;
  /** Why it is refused, for the audit in docs/DECISIONS.md and the OpenAPI note. */
  why: 'lockout' | 'lasting-access';
  /** Refused only when this answers true (the route acts on, or as, a preview account or a staff account); always
   *  refused without it. */
  when?: (req: FastifyRequest) => boolean;
};

const PARAM_ID = (req: FastifyRequest) => (req.params as Record<string, string | undefined>).id;
const targetIsPreview = (req: FastifyRequest) => isOpenPreviewAccount(req.ctx, PARAM_ID(req));
const actorIsPreview = (req: FastifyRequest) => isOpenPreviewAccount(req.ctx, req.ctx.actor?.id);
/** A preview account, or an administrator or owner: their passwords are the owner team's way back in once signing in is
 *  on again, and demo mode hands reset links out in API responses, so anyone with the link could otherwise reset them. */
const isProtectedAccount = (ctx: Ctx, userId: string | null | undefined) => isOpenPreviewAccount(ctx, userId) || (!!userId && !!ctx.db.get("SELECT 1 FROM users WHERE id = ? AND role IN ('admin','owner')", [userId]));
const OFF = 'This is switched off while Bioptime opens without signing in';
const PREVIEW_ACCOUNT = 'This account opens Bioptime for everyone while signing in is switched off';

/** The routes refused while the open preview is on, keyed "METHOD /path" as def() declares them. The audit behind the
 *  list (every admin, integration, settings and import route) is in docs/DECISIONS.md, "Open preview". */
export const OPEN_PREVIEW_RESTRICTED: Readonly<Record<string, Restriction>> = {
  // staff accounts and their access: a privileged account made or changed by whoever holds the link would outlast the
  // preview, and a demoted or reset owner is locked out
  'POST /admin/admins': { why: 'lasting-access', message: `${OFF}: a new administrator or owner account would keep working after the preview is switched off. Create administrators once signing in is back on.` },
  'POST /admin/users/:id/role': { why: 'lockout', message: `${OFF}: changing an administrator's or owner's role could lock an owner out. Change roles once signing in is back on.` },
  'POST /admin/users/:id/mfa/reset': { why: 'lockout', message: `${OFF}: resetting two-factor authentication signs that person out and makes them set it up again. Reset it once signing in is back on.` },
  // the three preview accounts themselves: closed, suspended or deleted, they could not be opened; a password or
  // authenticator changed by a visitor would lock the owner out once the preview is switched off
  'PATCH /admin/members/:id/state': { why: 'lockout', when: targetIsPreview, message: `${PREVIEW_ACCOUNT}, so its state cannot change now. Other members' accounts can.` },
  'PATCH /admin/coaches/:id/state': { why: 'lockout', when: targetIsPreview, message: `${PREVIEW_ACCOUNT}, so its state cannot change now. Other coaches' accounts can.` },
  'POST /admin/members/:id/password-reset': { why: 'lockout', when: targetIsPreview, message: `${PREVIEW_ACCOUNT}, so its password cannot be reset now.` },
  // passwords of the preview accounts and of every administrator and owner (a reset link is not used up)
  'POST /auth/password/change': { why: 'lockout', when: (req) => isProtectedAccount(req.ctx, req.ctx.actor?.id), message: `${OFF}: the passwords of administrators, owners and the accounts it opens stay as they are. Change it once signing in is back on.` },
  'POST /auth/password/reset': { why: 'lockout', when: (req) => isProtectedAccount(req.ctx, resetTokenUser(req)), message: `${OFF}: the passwords of administrators, owners and the accounts it opens stay as they are. The link still works once signing in is back on, until it expires.` },
  // two-factor authentication of administrators and owners (these routes are theirs only): left exactly as it is
  'POST /auth/mfa/setup': { why: 'lockout', message: `${OFF}: two-factor authentication of administrators and owners stays as it is.` },
  'POST /auth/mfa/confirm': { why: 'lockout', message: `${OFF}: two-factor authentication of administrators and owners stays as it is.` },
  'POST /auth/mfa/disable': { why: 'lockout', message: `${OFF}: two-factor authentication of administrators and owners stays as it is.` },
  'POST /me/data-requests': { why: 'lockout', when: (req) => actorIsPreview(req) && (req.body as { kind?: unknown } | null)?.kind === 'deletion', message: `${PREVIEW_ACCOUNT}, so it cannot ask for its deletion now. A data export still works.` },
};

/** The account a password-reset token belongs to, without using the token up (the route itself consumes it). */
function resetTokenUser(req: FastifyRequest): string | null {
  const token = (req.body as { token?: unknown } | null)?.token;
  if (typeof token !== 'string' || !token) return null;
  return req.ctx.db.get<{ user_id: string | null }>("SELECT user_id FROM auth_tokens WHERE token_hash = ? AND kind = 'password_reset'", [sha256(token)])?.user_id ?? null;
}

/** The restriction for a route while the open preview is on, or undefined (always undefined while it is off). */
export function openPreviewRestriction(openPreview: boolean, method: string, path: string): Restriction | undefined {
  return openPreview ? OPEN_PREVIEW_RESTRICTED[`${method} ${path}`] : undefined;
}

/** Refuses the request with 403 OPEN_PREVIEW_RESTRICTED when the restriction applies to it. */
export function enforceOpenPreview(req: FastifyRequest, r: Restriction): void {
  if (!r.when || r.when(req)) throw new AppError('OPEN_PREVIEW_RESTRICTED', 403, r.message);
}

/** The OpenAPI note for a restricted route (added only while the preview is on). */
export function openPreviewNote(r: Restriction): string {
  return `OPEN_PREVIEW_RESTRICTED while the open preview is on (BIOPTIME_MODE=demo with OPEN_PREVIEW=1)${r.when ? ', when it acts on or as one of the preview accounts (or, for passwords, an administrator or owner)' : ''}`;
}
