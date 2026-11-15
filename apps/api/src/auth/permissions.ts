/* Authorisation decisions in one place. Every route and service asks here; routes never rely on hiding links. */
import type { Ctx } from '../context.js';
import { AppError, errors } from '../lib/errors.js';

/** Two-factor authentication is mandatory for administrators and owners (30 October 2026): a session of a privileged
 *  account whose authenticator is not enrolled (one opened before the rule, or after an owner reset the account's MFA)
 *  reaches nothing. The portal signs out on this answer and the person signs in again, which starts enrolment
 *  (POST /auth/login → MFA_ENROLMENT_REQUIRED with an enrolment token). Only sign-out is exempt (def's allowWithoutMfa). */
export function mfaEnrolmentRequired(): AppError {
  return new AppError('MFA_ENROLMENT_REQUIRED', 403, 'Two-factor authentication is required for administrator accounts. Sign in again to set up your authenticator app.');
}

export function requireActor(ctx: Ctx) {
  if (!ctx.actor) throw errors.unauthorised();
  if ((ctx.actor.role === 'admin' || ctx.actor.role === 'owner') && !mfaSatisfied(ctx.actor)) throw mfaEnrolmentRequired();
  return ctx.actor;
}

/** Fails closed for anything opened from a session (it carries a sessionId; api/auth/sessions.ts resolveSession, the only
 *  source of actors for HTTP requests, always sets mfaEnrolled): such an actor passes only when it says positively that
 *  the authenticator is enrolled, so a future path that builds a session actor and forgets the flag is refused, not let
 *  through. Actors built in code with no session (the seed, module sample data, jobs, tests) are refused only when they
 *  say mfaEnrolled: false. */
function mfaSatisfied(actor: NonNullable<Ctx['actor']>): boolean {
  return actor.sessionId !== undefined ? actor.mfaEnrolled === true : actor.mfaEnrolled !== false;
}

export function requireRole(ctx: Ctx, ...roles: Array<'member' | 'coach' | 'admin' | 'owner'>) {
  const actor = requireActor(ctx);
  if (!roles.includes(actor.role)) throw errors.forbidden();
  return actor;
}

export function requirePrivileged(ctx: Ctx) { return requireRole(ctx, 'admin', 'owner'); }
export function requireOwner(ctx: Ctx) { return requireRole(ctx, 'owner'); }

/* ---------- granular administrator permissions ----------
   Owners hold every permission. Administrators start with the default set and an owner (or an administrator holding
   permissions.manage) can grant or revoke single permissions, which is how limited operational roles are made:
   a content editor is an administrator with only content.manage, for example. Coaches and members hold none. */
export const PERMISSIONS = [
  'members.view_restricted', 'entitlements.adjust', 'custom_plans.approve', 'content.publish', 'labstack.manage',
  'members.manage', 'coaches.manage', 'assignments.manage', 'packages.manage', 'custom_plans.manage', 'orders.manage',
  'content.manage', 'theme.manage', 'settings.manage', 'integrations.manage', 'reports.view', 'audit.view', 'operations.manage',
  'permissions.manage', 'admins.manage',
  // growth (24 October 2026): discovery calls, corporate enquiries and newsletter subscribers. Listed here rather than in
  // MODULE_PERMISSIONS so the Users and permissions page shows it without a module heading of its own (api/http/routes/cms.ts
  // names one per module permission); an administrator default, like operations.manage, which guards website enquiries
  'growth.manage',
] as const;
/** The module permissions added by the foundation (M0). They are real permissions (routes require them, owners hold
 *  them, administrators get the defaults below), kept in their own list because the Users and permissions page lists
 *  PERMISSIONS: they join that page when the main integration widens its listing (api/http/routes/cms.ts). */
export const MODULE_PERMISSIONS = ['library.manage', 'learning.manage', 'sessions.manage', 'announcements.manage', 'imports.manage', 'ai.manage', 'modules.manage'] as const;
export const ALL_PERMISSIONS = [...PERMISSIONS, ...MODULE_PERMISSIONS] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];
export const PERMISSION_LABELS: Record<Permission, string> = {
  'members.view_restricted': 'View members’ restricted contact fields (phone, address, date of birth)', 'entitlements.adjust': 'Adjust entitlements by hand', 'custom_plans.approve': 'Approve bespoke plans', 'content.publish': 'Publish website content', 'labstack.manage': 'Manage the LabStack integration',
  'members.manage': 'Manage members (state, recovery, data requests)', 'coaches.manage': 'Manage coaches', 'assignments.manage': 'Assign and reassign coaches',
  'packages.manage': 'Manage packages and coupons', 'custom_plans.manage': 'Review bespoke plans', 'orders.manage': 'Refund and reconcile orders',
  'content.manage': 'Edit and publish website content', 'theme.manage': 'Edit and publish the theme', 'settings.manage': 'Change runtime settings and notification templates',
  'integrations.manage': 'Operate integrations (sync, safety net)', 'reports.view': 'View and export reports', 'audit.view': 'View the audit log',
  'operations.manage': 'Own and resolve operational exceptions', 'growth.manage': 'Handle discovery calls, corporate enquiries and newsletter subscribers', 'permissions.manage': 'Change other administrators’ permissions', 'admins.manage': 'Provision administrators and change roles',
  'library.manage': 'Manage the food, recipe, exercise and check-in libraries', 'learning.manage': 'Manage courses', 'sessions.manage': 'Manage live sessions and webinars',
  'announcements.manage': 'Manage announcements', 'imports.manage': 'Run bulk imports', 'ai.manage': 'View Coach AI usage', 'modules.manage': 'Switch modules on and off (feature flags)',
};
// administrators start with everything except managing permissions, other administrators, the laboratory integration,
// bulk imports, Coach AI usage and the module switches
const NOT_DEFAULT: ReadonlySet<Permission> = new Set<Permission>(['permissions.manage', 'admins.manage', 'labstack.manage', 'imports.manage', 'ai.manage', 'modules.manage']);
const ADMIN_DEFAULTS: Permission[] = ALL_PERMISSIONS.filter((p) => !NOT_DEFAULT.has(p));

export function permissionsFor(ctx: Ctx, actor: { id: string; role: string } | null): Permission[] {
  if (!actor) return [];
  if (actor.role === 'owner') return [...ALL_PERMISSIONS];
  if (actor.role !== 'admin') return [];
  const overrides = ctx.db.all<{ permission: string; granted: number }>('SELECT permission, granted FROM user_permissions WHERE user_id = ?', [actor.id]);
  const set = new Set<Permission>(ADMIN_DEFAULTS);
  for (const o of overrides) { if (o.granted) set.add(o.permission as Permission); else set.delete(o.permission as Permission); }
  return [...set];
}
export function hasPermission(ctx: Ctx, permission: Permission): boolean { return permissionsFor(ctx, ctx.actor).includes(permission); }
export function requirePermission(ctx: Ctx, permission: Permission) {
  const actor = requireRole(ctx, 'admin', 'owner');
  if (!hasPermission(ctx, permission)) throw errors.forbidden(`This needs the "${PERMISSION_LABELS[permission]}" permission`, 'PERMISSION_DENIED');
  return actor;
}

/** Grant or revoke one permission for an administrator. Owners cannot be edited (they hold everything); nobody can
 *  take permissions.manage from themselves, so the ability to manage permissions is never lost by accident. */
export function setUserPermission(ctx: Ctx, userId: string, permission: Permission, granted: boolean, reason: string) {
  const actor = requirePermission(ctx, 'permissions.manage');
  if (!(ALL_PERMISSIONS as readonly string[]).includes(permission)) throw errors.badRequest('Unknown permission', 'PERMISSION_UNKNOWN');
  const target = ctx.db.get<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!target) throw errors.notFound('Account');
  if (target.role === 'owner') throw errors.state('Owners hold every permission; change their role instead', { code: 'OWNER_PERMISSIONS' });
  if (target.role !== 'admin') throw errors.state('Only administrator accounts carry permissions', { code: 'NOT_ADMIN' });
  if (target.id === actor.id && permission === 'permissions.manage' && !granted) throw errors.state('You cannot remove your own ability to manage permissions', { code: 'SELF_LOCKOUT' });
  const now = ctx.now();
  ctx.db.run('INSERT INTO user_permissions (user_id, permission, granted, reason, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, permission) DO UPDATE SET granted = excluded.granted, reason = excluded.reason, updated_at = excluded.updated_at, updated_by = excluded.updated_by', [userId, permission, granted ? 1 : 0, reason, now, actor.id]);
  return permissionsFor(ctx, target);
}

/** Is this coach currently assigned (active or paused) to this member? */
export function coachHasMember(ctx: Ctx, coachId: string, memberId: string): boolean {
  return !!ctx.db.get("SELECT 1 FROM coach_assignments WHERE coach_id = ? AND member_id = ? AND status IN ('active','paused')", [coachId, memberId]);
}

/** A member may read their own record; a coach their assigned members; admins everyone. */
export function requireMemberAccess(ctx: Ctx, memberId: string) {
  const actor = requireActor(ctx);
  if (actor.role === 'admin' || actor.role === 'owner') return actor;
  if (actor.role === 'member' && actor.id === memberId) return actor;
  if (actor.role === 'coach' && coachHasMember(ctx, actor.id, memberId)) return actor;
  throw errors.forbidden('You do not have access to this member', 'NO_ACCESS');
}

/** Coaches see health records only when the member shares with their coach and the coach is assigned. */
export function requireHealthAccess(ctx: Ctx, memberId: string) {
  const actor = requireMemberAccess(ctx, memberId);
  if (actor.role === 'coach') {
    const consent = ctx.db.get<{ granted: number }>("SELECT granted FROM member_consents WHERE user_id = ? AND kind = 'coach_sharing' ORDER BY at DESC LIMIT 1", [memberId]);
    // no recorded consent is no consent: health records open to the coach only on an explicit, current grant
    if (!consent?.granted) throw errors.forbidden('This member has not shared their health records with their coach', 'NOT_SHARED');
  }
  return actor;
}
