/* Formatting and permission helpers the administrative portal's core screens share (group admin-a): the web's status →
   pill tone map (apps/dashboard/src/lib/format.ts STATUS_PILL), its actionLabel / plural / wellnessLabel, and the order
   in which AdminIndex (apps/dashboard/src/App.tsx) sends an administrator without reports.view to their first section. */
import { statusTone } from '@/components/ui';
import { label } from '@/lib/format';

type Tone = 'info' | 'success' | 'warning' | 'error' | 'sample';

/** The portal's STATUS_PILL, with its `neutral` drawn as the app's `info` (the app has no neutral tone and adds none). */
const STATUS_PILL: Record<string, Tone> = {
  active: 'success', activated: 'success', paid: 'success', completed: 'success', results_ready: 'success', published: 'success', scheduled: 'info', confirmed: 'info', requested: 'warning', pending: 'warning', pending_payment: 'warning', open: 'warning', draft: 'warning', processing: 'warning', sample_collected: 'warning', in_progress: 'warning', exception: 'error', failed: 'error', cancelled: 'info', ended: 'info', paused: 'info', refunded: 'info', refund_pending: 'warning', resolved: 'success', dismissed: 'info', no_show: 'error', suspended: 'error', onboarding: 'info', pending_verification: 'warning', invited: 'info', assigned: 'success', proposal_sent: 'info', accepted: 'success', declined: 'info', expired: 'info', payment_pending: 'warning', enquiry_received: 'warning', under_review: 'info', scoping: 'info', awaiting_professional_input: 'warning', awaiting_internal_approval: 'warning', new: 'warning', closed: 'info', exhausted: 'info', available: 'success',
};

/** The pill tone of a status, as the portal colours it; anything unknown falls back to the app's own statusTone. */
export function tone(s?: string | null): Tone {
  if (!s) return 'info';
  return STATUS_PILL[s] ?? statusTone(s);
}

/** The portal's label(): '—' for nothing, else underscores to spaces and a capital. */
export function labelOr(s?: string | null): string { return s ? label(s) : '—'; }

/** An audit action key as words: 'member.record_viewed' reads 'Member record viewed'. */
export function actionLabel(action?: string | null): string { return labelOr(action ? action.replace(/\./g, ' ') : action); }

/** A count with its noun: '1 marker', '3 markers'. */
export function plural(n: number, one: string, many = `${one}s`): string { return `${n} ${n === 1 ? one : many}`; }

/** The wellness score's qualifier: the stored default 'sample' reads as an estimate. */
export function wellnessLabel(l: string | null | undefined, fallback = 'estimate'): string { return !l || l === 'sample' ? fallback : l; }

/** Minutes after midnight as HH:MM (coach working hours). */
export function mm(m: number): string { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** AdminIndex's order (apps/dashboard/src/App.tsx): the first section an administrator without reports.view holds,
 *  as the app's routes (the tab group's screens for Members and Operations, plain admin screens for the rest). */
export const FIRST_SECTION: ReadonlyArray<readonly [string, string]> = [
  ['members.manage', '/(admin)/members'], ['coaches.manage', '/admin/coaches'], ['assignments.manage', '/admin/assignments'], ['packages.manage', '/admin/packages'],
  ['custom_plans.manage', '/admin/approvals'], ['orders.manage', '/admin/orders'], ['content.manage', '/admin/content'], ['theme.manage', '/admin/theme'],
  ['operations.manage', '/(admin)/operations'], ['integrations.manage', '/admin/bloodwork'], ['permissions.manage', '/admin/users'], ['settings.manage', '/admin/settings'],
  ['audit.view', '/admin/audit'], ['labstack.manage', '/admin/integrations/labstack'], ['modules.manage', '/admin/modules'],
];
export function firstPermittedSection(can: (p: string) => boolean): string | null {
  const hit = FIRST_SECTION.find(([p]) => can(p));
  return hit ? hit[1] : null;
}

/** A number as the portal shows it in a readout: '12', or '—' when absent. */
export function num(v: unknown): string { return typeof v === 'number' ? String(v) : '—'; }
