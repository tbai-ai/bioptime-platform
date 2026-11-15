/* Shared pieces of the administrative portal's part B1 screens (Appointments, Messages, Bloodwork, the report page,
   Analytics, Operations, the audit log and notifications): the web's enumerations, label rules and record links,
   quoted from apps/dashboard/src (pages/Operations.tsx, pages/Bloodwork.tsx, lib/format.ts) so filters and wording
   match the portal. Nothing here fetches. */
import { statusTone } from '@/components/ui';
import { label } from '@/lib/format';

/** The laboratory booking statuses, in the order the portal's Bookings filter and Override dialog list them (Bloodwork.tsx:27). */
export const LAB_STATUSES = ['confirmed', 'scheduled', 'sample_collected', 'processing', 'results_ready', 'completed', 'cancelled'] as const;

/** The exception kinds the API opens (Operations.tsx:10). A kind that is not listed here but appears in the loaded
 *  queue is offered too, so a new kind can always be filtered on. */
export const TASK_KINDS = ['unassigned_member', 'failed_booking', 'collection_rebook', 'payment_mismatch', 'vendor_sync_failure', 'missing_report_notification', 'custom_plan_approval', 'overdue_appointment', 'capacity_issue', 'integration_error', 'unknown_webhook', 'report_values_failed', 'data_request', 'coach_follow_up'];
/** Exception kinds whose 'user' reference is a coach, not a member (Operations.tsx:12). */
export const COACH_REF_KINDS = new Set(['capacity_issue']);

/** The audit log's action prefixes and target types (Operations.tsx:38). */
export const AUDIT_ACTIONS = ['auth.', 'permission.', 'user.', 'package.', 'order.', 'payment.', 'assignment.', 'plan.', 'booking.', 'report.', 'content.', 'theme.', 'setting.', 'coupon.', 'integration.'];
export const AUDIT_TARGETS = ['user', 'package', 'order', 'assignment', 'plan', 'booking', 'report', 'content', 'theme', 'setting', 'coupon'];

export type TaskStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';
export const TASK_STATUS_OPTIONS: Array<{ value: string; label: string }> = [{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved' }, { value: 'dismissed', label: 'Dismissed' }, { value: 'all', label: 'All' }];

/** An audit action key as words: 'member.record_viewed' reads 'Member record viewed' (lib/format.ts:22). */
export function actionLabel(action?: string | null): string { return action ? label(action.replace(/\./g, ' ')) : '—'; }

type Tone = ReturnType<typeof statusTone>;
/** The portal's STATUS_PILL tones (lib/format.ts:35) for the statuses these screens show that the app's own
 *  statusTone (components/ui.tsx) does not name; everything else falls through to it. */
const WEB_TONES: Record<string, Tone> = {
  open: 'warning', in_progress: 'warning', resolved: 'success', dismissed: 'info', new: 'warning', closed: 'info', exception: 'error', draft: 'warning', ended: 'info', published: 'success', assigned: 'success', accepted: 'success', under_review: 'info', scoping: 'info', enquiry_received: 'warning', awaiting_professional_input: 'warning', awaiting_internal_approval: 'warning', proposal_sent: 'info', invited: 'info', exhausted: 'info', refund_pending: 'warning', logged: 'info', dead: 'error', running: 'warning', ok: 'success',
};
export function tone(status?: string | null): Tone {
  if (!status) return 'info';
  return WEB_TONES[status] ?? statusTone(status);
}

/** Where an exception's record lives in the admin workspace (Operations.tsx:30), as an expo-router href, or null. */
export function recordHref(t: { ref_type?: string | null; ref_id?: string | null; kind?: string | null }): string | null {
  switch (t.ref_type) {
    case 'assignment_request': return '/admin/assignments';
    case 'booking': return '/admin/bloodwork';
    case 'order': return '/admin/orders';
    case 'custom_plan': return '/admin/approvals';
    case 'user': return t.ref_id ? (COACH_REF_KINDS.has(t.kind ?? '') ? `/admin/coaches/${t.ref_id}` : `/admin/clients/${t.ref_id}`) : null;
    case 'report': return t.ref_id ? `/admin/reports/${t.ref_id}` : null;
    default: return null;
  }
}

/** A meeting link the portal would show as joinable (modules/sessions/shared safeLink): https only. */
export function safeLink(link?: string | null): boolean { return !!link && /^https:\/\/\S+$/i.test(link); }

/** The laboratory range of a marker as the portal prints it (Report.tsx:27). */
export function labRange(v: { matched_range?: string | null; range_low?: number | null; range_high?: number | null }): string {
  if (v.matched_range) return v.matched_range;
  const lo = v.range_low ?? null, hi = v.range_high ?? null;
  return lo !== null && hi !== null ? `${lo}–${hi}` : lo !== null ? `≥ ${lo}` : hi !== null ? `≤ ${hi}` : '—';
}
