/* Formatting in the brand's conventions: IST, 12 October 2026, ₹12,999, tabular numbers, sentence case labels. */
const IST = 'Asia/Kolkata';

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST }).format(new Date(iso));
}
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST }).format(new Date(iso)) + ' IST';
}
export function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST }).format(new Date(iso));
}
export function fmtInr(n?: number | null): string {
  if (n === null || n === undefined) return 'On request';
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}
export function label(s?: string | null): string { return s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—'; }
/** An audit action key as words: 'member.record_viewed' reads 'Member record viewed'. */
export function actionLabel(action?: string | null): string { return label(action ? action.replace(/\./g, ' ') : action); }
/** A count with its noun: '1 marker', '3 markers', '0 unread threads'. */
export function plural(n: number, one: string, many = `${one}s`): string { return `${n} ${n === 1 ? one : many}`; }
export function relative(iso?: string | null): string {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (Math.abs(diff) < 1) return 'just now';
  if (Math.abs(diff) < 60) return `${Math.round(Math.abs(diff))} min ${diff > 0 ? 'ago' : 'from now'}`;
  if (Math.abs(diff) < 1440) return `${Math.round(Math.abs(diff) / 60)} h ${diff > 0 ? 'ago' : 'from now'}`;
  return `${Math.round(Math.abs(diff) / 1440)} d ${diff > 0 ? 'ago' : 'from now'}`;
}
export function todayIst(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date()); }
export function addDaysIst(days: number): string { return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date(Date.now() + days * 86400000)); }
export const STATUS_PILL: Record<string, string> = {
  active: 'success', activated: 'success', paid: 'success', completed: 'success', results_ready: 'success', published: 'success', scheduled: 'info', confirmed: 'info', requested: 'warning', pending: 'warning', pending_payment: 'warning', open: 'warning', draft: 'warning', processing: 'warning', sample_collected: 'warning', in_progress: 'warning', exception: 'error', failed: 'error', cancelled: 'neutral', ended: 'neutral', paused: 'neutral', refunded: 'neutral', refund_pending: 'warning', resolved: 'success', dismissed: 'neutral', no_show: 'error', suspended: 'error', onboarding: 'info', pending_verification: 'warning', invited: 'info', assigned: 'success', proposal_sent: 'info', accepted: 'success', declined: 'neutral', expired: 'neutral', payment_pending: 'warning', enquiry_received: 'warning', under_review: 'info', scoping: 'info', awaiting_professional_input: 'warning', awaiting_internal_approval: 'warning', new: 'warning', closed: 'neutral', exhausted: 'neutral', available: 'success',
};

/** The wellness score's qualifier as members and coaches read it: the stored default 'sample' (an early placeholder
    value) reads as an estimate, like a missing one. */
export function wellnessLabel(l: string | null | undefined, fallback = 'estimate'): string {
  return !l || l === 'sample' ? fallback : l;
}
