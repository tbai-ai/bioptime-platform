/* The coach and admin workspaces' navigation: the five tabs of each and the registry of everything else the web
   workspace lists (its "More" screen), with the same gates as the portal's Shell (apps/dashboard/src/shell/Shell.tsx)
   and module runtime (src/modules/runtime.tsx):
   - a link that names a `permission` shows only while the administrator holds it (several: all of them, or any one
     with `any`); owners hold everything (lib/auth can);
   - a link that names a `module` shows only while that module's flag is in GET /public/config → features, plus its
     `feature` sub-flag when it names one (lib/features);
   - LabStack is confined to the admin workspace behind labstack.manage, whatever else is declared;
   - the Modules page is listed for the admin workspace (every app module contributes UI, as hasModuleUi says on the web).
   Routes are expo-router paths under src/app/coach/... and src/app/admin/...; the next phase creates those screens, so
   this file is the one place to look up what exists and what it is called. The order and the group headings
   (Libraries, Learning, Growth, Support) are the web's. Hiding is a courtesy: the server enforces every permission and
   flag again. */
import { useAuth } from './auth';
import { useFeatures } from './features';
import type { ModuleKey } from './modules';

export type WorkspaceKey = 'coach' | 'admin';

/** One link in a workspace: where it goes, what it needs. `badge` reads the workspace's home payload
 *  (GET /coach/home or GET /admin/overview) for a count, exactly as the web Shell does. */
export type NavLink = {
  key: string;
  label: string;
  /** An expo-router href ('/coach/bloodwork'). */
  route: string;
  /** One line under the label on the More screen. */
  sub?: string;
  /** An Ionicons name. */
  icon: string;
  permission?: string | string[];
  any?: boolean;
  module?: ModuleKey;
  feature?: string;
  group?: string;
  badge?: (home: unknown) => number | undefined;
};

/** A tab of the workspace's tab bar. `name` is the route file in the group; `permission` is what its screen needs. */
export type WorkspaceTab = { name: string; title: string; icon: string; permission?: string; badge?: (home: unknown) => number | undefined };

const len = (v: unknown) => (Array.isArray(v) ? v.length : undefined) || undefined;
const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
const at = (home: unknown, ...path: string[]) => path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), home);

export const COACH_TABS: WorkspaceTab[] = [
  { name: 'index', title: 'Today', icon: 'today-outline' },
  { name: 'clients', title: 'Clients', icon: 'people-outline', badge: (h) => len(at(h, 'clientsWithoutPlan')) },
  { name: 'calendar', title: 'Calendar', icon: 'calendar-outline', badge: (h) => len(at(h, 'requestedAppointments')) },
  { name: 'messages', title: 'Messages', icon: 'chatbubbles-outline', badge: (h) => len(at(h, 'unreadConversations')) },
  { name: 'more', title: 'More', icon: 'ellipsis-horizontal-circle-outline' },
];

export const ADMIN_TABS: WorkspaceTab[] = [
  { name: 'index', title: 'Overview', icon: 'speedometer-outline', permission: 'reports.view' },
  { name: 'members', title: 'Members', icon: 'people-outline', permission: 'members.manage' },
  { name: 'operations', title: 'Operations', icon: 'construct-outline', permission: 'operations.manage', badge: (h) => num(at(h, 'exceptions', 'open')) },
  { name: 'messages', title: 'Messages', icon: 'chatbubbles-outline', permission: 'members.manage' },
  { name: 'more', title: 'More', icon: 'ellipsis-horizontal-circle-outline' },
];

/** The coach workspace beyond its tabs, in the web's order (core items with the modules' items spliced where the
 *  web puts them, then the groups). */
export const COACH_NAV: NavLink[] = [
  { key: 'sessions', label: 'Live sessions', sub: 'Sessions and webinars you host', route: '/coach/sessions', icon: 'videocam-outline', module: 'sessions' },
  { key: 'bloodwork', label: 'Bloodwork', sub: 'Reports to review and your clients’ bookings', route: '/coach/bloodwork', icon: 'water-outline', badge: (h) => len(at(h, 'reportsToReview')) },
  { key: 'announcements', label: 'Announcements', sub: 'Write to all your clients at once', route: '/coach/announcements', icon: 'megaphone-outline', module: 'messaging' },
  { key: 'ai', label: 'Coach AI', sub: 'Drafts to edit before anything is sent', route: '/coach/ai', icon: 'sparkles-outline', module: 'ai' },
  { key: 'profile', label: 'My profile', sub: 'As members see it', route: '/coach/profile', icon: 'person-circle-outline' },
  { key: 'settings', label: 'Settings', sub: 'Working hours, availability and security', route: '/coach/settings', icon: 'settings-outline' },
  { key: 'help', label: 'Help', sub: 'Help articles and questions to the team', route: '/coach/help', icon: 'help-circle-outline', module: 'support' },
  { key: 'checkin-templates', label: 'Check-in templates', sub: 'The questions your clients answer', route: '/coach/checkin-templates', icon: 'clipboard-outline', module: 'progress', group: 'Libraries' },
  { key: 'nutrition-library', label: 'Nutrition library', sub: 'Foods and recipes for plans', route: '/coach/nutrition-library', icon: 'nutrition-outline', module: 'nutrition', group: 'Libraries' },
  { key: 'exercise-library', label: 'Exercise library', sub: 'Exercises, templates and programmes', route: '/coach/exercise-library', icon: 'barbell-outline', module: 'workouts', group: 'Libraries' },
  { key: 'courses', label: 'Courses', sub: 'Courses for your clients', route: '/coach/courses', icon: 'school-outline', module: 'learning', group: 'Learning' },
  { key: 'training', label: 'Training', sub: 'Your own training courses', route: '/coach/training', icon: 'book-outline', module: 'learning', group: 'Learning' },
  { key: 'discovery-calls', label: 'Discovery calls', sub: 'Calls the team assigned to you', route: '/coach/discovery-calls', icon: 'call-outline', module: 'growth', group: 'Growth' },
];

const SUPPORT_PAGE = ['operations.manage', 'members.manage'];

/** The admin workspace beyond its tabs, in the web's order. */
export const ADMIN_NAV: NavLink[] = [
  { key: 'referrals', label: 'Referrals', sub: 'Who joined through whom', route: '/admin/referrals', icon: 'git-branch-outline', module: 'referrals', permission: 'members.manage' },
  { key: 'coaches', label: 'Coaches', sub: 'Invite, profile, availability, scope', route: '/admin/coaches', icon: 'people-outline', permission: 'coaches.manage' },
  { key: 'assignments', label: 'Assignments', sub: 'Match members with coaches', route: '/admin/assignments', icon: 'checkmark-done-outline', permission: 'assignments.manage', badge: (h) => num(at(h, 'assignments', 'unassigned')) },
  { key: 'packages', label: 'Packages', sub: 'Packages, prices and coupons', route: '/admin/packages', icon: 'cube-outline', permission: 'packages.manage' },
  { key: 'approvals', label: 'Approvals', sub: 'Bespoke plans awaiting review', route: '/admin/approvals', icon: 'shield-checkmark-outline', permission: 'custom_plans.manage', badge: (h) => num(at(h, 'exceptions', 'byKind', 'custom_plan_approval')) },
  { key: 'bloodwork', label: 'Bloodwork', sub: 'Reports, bookings and the catalogue', route: '/admin/bloodwork', icon: 'water-outline', permission: ['reports.view', 'integrations.manage'], any: true, badge: (h) => num(at(h, 'reportsAwaitingReview')) },
  { key: 'lab-follow-ups', label: 'Lab follow-ups', sub: 'Next steps after reports', route: '/admin/lab-follow-ups', icon: 'flask-outline', module: 'labFollowups', permission: 'reports.view' },
  { key: 'orders', label: 'Orders', sub: 'Payments, refunds and reconciliation', route: '/admin/orders', icon: 'receipt-outline', permission: 'orders.manage', badge: (h) => num(at(h, 'orders', 'pendingPayment')) },
  { key: 'billing', label: 'Billing', sub: 'Documents and refund requests', route: '/admin/billing', icon: 'wallet-outline', module: 'billing', permission: 'orders.manage' },
  { key: 'appointments', label: 'Appointments', sub: 'Every consultation', route: '/admin/appointments', icon: 'calendar-outline', permission: 'members.manage' },
  { key: 'sessions', label: 'Live sessions', sub: 'Sessions and webinars', route: '/admin/sessions', icon: 'videocam-outline', module: 'sessions', permission: 'sessions.manage' },
  { key: 'announcements', label: 'Announcements', sub: 'To members and coaches', route: '/admin/announcements', icon: 'megaphone-outline', module: 'messaging', permission: 'announcements.manage' },
  { key: 'content', label: 'Website content', sub: 'Edit and publish the website’s text', route: '/admin/content', icon: 'document-text-outline', permission: 'content.manage' },
  { key: 'theme', label: 'Theme', sub: 'Colours over the brand tokens', route: '/admin/theme', icon: 'color-palette-outline', permission: 'theme.manage' },
  { key: 'analytics', label: 'Analytics', sub: 'Reports and exports', route: '/admin/analytics', icon: 'analytics-outline', permission: 'reports.view' },
  { key: 'modules', label: 'Modules', sub: 'Switch modules on and off', route: '/admin/modules', icon: 'toggle-outline', permission: ['modules.manage', 'settings.manage'], any: true },
  { key: 'ai', label: 'Coach AI usage', sub: 'What the drafting assistant is used for', route: '/admin/ai', icon: 'sparkles-outline', module: 'ai', permission: 'ai.manage' },
  { key: 'integrations', label: 'Integrations', sub: 'Payments, email, SMS, push and more', route: '/admin/integrations', icon: 'link-outline', permission: 'settings.manage' },
  { key: 'labstack', label: 'LabStack', sub: 'The laboratory integration’s operations', route: '/admin/integrations/labstack', icon: 'flask-outline', permission: 'labstack.manage' },
  { key: 'audit', label: 'Audit log', sub: 'Every sign-in and every change', route: '/admin/audit', icon: 'list-outline', permission: 'audit.view' },
  { key: 'users', label: 'Users and permissions', sub: 'Administrators and what they may do', route: '/admin/users', icon: 'shield-checkmark-outline', permission: 'permissions.manage' },
  { key: 'settings', label: 'Settings', sub: 'Runtime settings and notification templates', route: '/admin/settings', icon: 'settings-outline', permission: 'settings.manage' },
  { key: 'growth-discovery-calls', label: 'Discovery calls', sub: 'Requests from the website', route: '/admin/growth/discovery-calls', icon: 'call-outline', module: 'growth', permission: 'growth.manage', group: 'Growth' },
  { key: 'growth-corporate', label: 'Corporate enquiries', sub: 'Companies asking about Bioptime', route: '/admin/growth/corporate', icon: 'mail-outline', module: 'growth', permission: 'growth.manage', group: 'Growth' },
  { key: 'growth-newsletter', label: 'Newsletter', sub: 'Subscribers from the website', route: '/admin/growth/newsletter', icon: 'mail-outline', module: 'growth', permission: 'growth.manage', group: 'Growth' },
  { key: 'learning', label: 'Courses', sub: 'Courses for members and coaches', route: '/admin/learning', icon: 'school-outline', module: 'learning', permission: 'learning.manage', group: 'Learning' },
  { key: 'checkin-templates', label: 'Check-in templates', sub: 'The questions members answer', route: '/admin/checkin-templates', icon: 'clipboard-outline', module: 'progress', permission: 'library.manage', group: 'Libraries' },
  { key: 'nutrition-library', label: 'Nutrition library', sub: 'Foods and recipes', route: '/admin/nutrition-library', icon: 'nutrition-outline', module: 'nutrition', permission: 'library.manage', group: 'Libraries' },
  { key: 'exercise-library', label: 'Exercise library', sub: 'Exercises and workout templates', route: '/admin/exercise-library', icon: 'barbell-outline', module: 'workouts', permission: 'library.manage', group: 'Libraries' },
  { key: 'support', label: 'Support requests', sub: 'Questions and data requests from members', route: '/admin/support', icon: 'chatbox-ellipses-outline', module: 'support', permission: SUPPORT_PAGE, any: true, group: 'Support' },
  { key: 'help-articles', label: 'Help articles', sub: 'What the help centre shows', route: '/admin/help-articles', icon: 'document-text-outline', module: 'support', feature: 'help_centre', permission: 'content.manage', group: 'Support' },
  { key: 'imports', label: 'Imports', sub: 'Bulk imports and their results', route: '/admin/imports', icon: 'cloud-upload-outline', module: 'support', feature: 'imports', permission: 'imports.manage', group: 'Support' },
];

export const WORKSPACE_NAV: Record<WorkspaceKey, NavLink[]> = { coach: COACH_NAV, admin: ADMIN_NAV };
export const WORKSPACE_TABS: Record<WorkspaceKey, WorkspaceTab[]> = { coach: COACH_TABS, admin: ADMIN_TABS };

const LABSTACK_PERMISSION = 'labstack.manage';

/** The portal's permission rule: all of them, or any one with `any`; nothing needed for a link without one. */
export function permitted(can: (p: string) => boolean, permission?: string | string[], any?: boolean): boolean {
  if (!permission) return true;
  const list = ([] as string[]).concat(permission);
  return any ? list.some((p) => can(p)) : list.every((p) => can(p));
}

/** Does this link show for this person? `features` null means the flags are still loading: module links wait. */
export function navAllowed(link: NavLink, workspace: WorkspaceKey, can: (p: string) => boolean, features: Set<string> | null): boolean {
  if (link.key === 'labstack' && (workspace !== 'admin' || !can(LABSTACK_PERMISSION))) return false;
  if (!permitted(can, link.permission, link.any)) return false;
  if (link.module) { if (!features || !features.has(link.module)) return false; if (link.feature && !features.has(link.feature)) return false; }
  return true;
}

/** The links of a workspace's More screen for the signed-in person: the main list, then the groups in order. */
export function useWorkspaceNav(workspace: WorkspaceKey): { main: NavLink[]; groups: Array<{ title: string; links: NavLink[] }>; loading: boolean } {
  const { can } = useAuth();
  const features = useFeatures(true);
  const allowed = WORKSPACE_NAV[workspace].filter((l) => navAllowed(l, workspace, can, features));
  const main = allowed.filter((l) => !l.group);
  const groups: Array<{ title: string; links: NavLink[] }> = [];
  for (const l of allowed) {
    if (!l.group) continue;
    const g = groups.find((x) => x.title === l.group);
    if (g) g.links.push(l); else groups.push({ title: l.group, links: [l] });
  }
  return { main, groups, loading: !features };
}
