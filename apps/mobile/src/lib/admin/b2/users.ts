/* Users and permissions (Admin › Users): the shapes of GET /admin/users and the sentences the web page keeps
   (apps/dashboard/src/pages/admin/Users.tsx), shared by the list and the per-administrator screen. */
import { fmtDateTime } from '../../format';

export type Perm = { key: string; label: string; module?: boolean; heading?: string };
export type Override = { permission: string; granted: number | boolean; reason: string | null; updated_at: string };
export type Admin = { id: string; email: string; name: string; role: 'admin' | 'owner'; state: string; mfaEnabled: boolean; permissions: string[]; overrides: Override[] };
export type UsersPayload = { permissions: Perm[]; items: Admin[] };

/** Short headings for the workspace permissions (the web's rotated column headings); a heading the API sends wins. */
export const CORE_HEADINGS: Record<string, string> = {
  'members.view_restricted': 'Restricted fields', 'entitlements.adjust': 'Entitlements', 'custom_plans.approve': 'Approve bespoke', 'content.publish': 'Publish content',
  'labstack.manage': 'LabStack', 'members.manage': 'Members', 'coaches.manage': 'Coaches', 'assignments.manage': 'Assignments', 'packages.manage': 'Packages',
  'custom_plans.manage': 'Review bespoke', 'orders.manage': 'Orders', 'content.manage': 'Edit content', 'theme.manage': 'Theme', 'settings.manage': 'Settings',
  'integrations.manage': 'Integrations', 'reports.view': 'Reports', 'audit.view': 'Audit log', 'operations.manage': 'Operations', 'growth.manage': 'Growth',
  'permissions.manage': 'Permissions', 'admins.manage': 'Administrators',
};

export const SAFEGUARDS = 'You cannot remove your own permission to manage permissions, demote the last owner, or change your own role. Members and coaches never appear here: public registration creates members only, coaches come from invitations.';
export const MODULE_PERMISSIONS_TEXT = 'Permissions for the modules: libraries, courses, live sessions, announcements, bulk imports, Coach AI usage and the module switches. Administrators hold the first four by default; bulk imports, Coach AI usage and the module switches have to be granted to each administrator.';
export const LEGEND = '✓ held · – not held · a marked row is an explicit override. Owners cannot be narrowed; make them an administrator first.';
export const WORKSPACES_NOTE = 'Workspaces are separated at the server: a member\'s credentials are refused at the coach and admin sign-ins, and so on.';
/** The five kinds of account: role, where it signs in, what it can do. */
export const ROLE_ROWS: Array<[string, string, string]> = [
  ['member', '/login/client', 'Their own programme, bookings, reports, messages, profile and data rights'],
  ['coach', '/login/coach', 'Assigned clients only: plans, reviews, consultations, messages, their own availability'],
  ['admin', '/login/admin', 'The permissions above, MFA required'],
  ['owner', '/login/admin', 'Everything, including permissions and other administrators; MFA required'],
];

export function holds(u: Admin, p: Perm): boolean { return u.role === 'owner' || u.permissions.includes(p.key); }
export function overrideOf(u: Admin, p: Perm): Override | undefined { return u.overrides.find((o) => o.permission === p.key); }
/** The web cell's title: how the permission came to be held or not. */
export function permissionOrigin(u: Admin, p: Perm): string {
  const ov = overrideOf(u, p);
  if (ov) return `${ov.granted ? 'Granted' : 'Revoked'} explicitly: ${ov.reason ?? ''} (${fmtDateTime(ov.updated_at)})`;
  return holds(u, p) ? 'From the default set' : 'Not held';
}
export function heading(p: Perm): string { return p.heading ?? CORE_HEADINGS[p.key] ?? p.label; }
