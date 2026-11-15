/* Formatting the coach workspace shares with the web portal (apps/dashboard/src/lib/format.ts): the status → pill tone
   map, plural(), actionLabel(), wellnessLabel(), the IST day helpers. Nothing here fetches. */
import { fmtDate } from '@/lib/format';

export type Tone = 'info' | 'success' | 'warning' | 'error' | 'sample';

/** The portal's STATUS_PILL table (format.ts:35-37); neutral reads as the plain info tone here. */
const STATUS_PILL: Record<string, Tone> = {
  active: 'success', activated: 'success', paid: 'success', completed: 'success', results_ready: 'success', published: 'success', resolved: 'success', assigned: 'success', accepted: 'success', available: 'success', done: 'success', released: 'success',
  scheduled: 'info', confirmed: 'info', onboarding: 'info', invited: 'info', proposal_sent: 'info', under_review: 'info', scoping: 'info',
  requested: 'warning', pending: 'warning', pending_payment: 'warning', open: 'warning', draft: 'warning', processing: 'warning', sample_collected: 'warning', in_progress: 'warning', refund_pending: 'warning', payment_pending: 'warning', enquiry_received: 'warning', awaiting_professional_input: 'warning', awaiting_internal_approval: 'warning', new: 'warning', pending_verification: 'warning', partial: 'warning',
  exception: 'error', failed: 'error', no_show: 'error', suspended: 'error',
  cancelled: 'info', ended: 'info', paused: 'info', refunded: 'info', dismissed: 'info', declined: 'info', expired: 'info', closed: 'info', exhausted: 'info',
};
export function pillTone(status?: string | null): Tone { return (status && STATUS_PILL[status]) || 'info'; }

/** A count with its noun: '1 active client', '3 reports'. */
export function plural(n: number | undefined | null, one: string, many = `${one}s`): string { const k = n ?? 0; return `${k} ${k === 1 ? one : many}`; }

/** An audit action key as words: 'member.record_viewed' reads 'Member record viewed'. */
export function actionLabel(action?: string | null): string {
  if (!action) return '—';
  const t = action.replace(/\./g, ' ').replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The wellness score's qualifier: the stored default 'sample' reads as an estimate, like a missing one. */
export function wellnessLabel(l: string | null | undefined, fallback = 'estimate'): string { return !l || l === 'sample' ? fallback : l; }

/** A calendar date (YYYY-MM-DD) in the brand's format. */
export function fmtDay(d?: string | null): string { return d ? fmtDate(`${d}T12:00:00Z`) : '—'; }

/** Today in IST as YYYY-MM-DD, plus `days`. */
export function addDaysIst(days: number): string { return new Date(Date.now() + days * 86400000 + 330 * 60000).toISOString().slice(0, 10); }
export function todayIst(): string { return addDaysIst(0); }

/** A local IST date and clock time as the ISO instant the API expects. */
export function istToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Minutes after midnight as HH:MM, and back. */
export function minutesToClock(min: number): string { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
export function clockToMinutes(t: string): number | null { const m = /^(\d{2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }

export function initials(name?: string | null): string { return String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join(''); }

export function fmtBytes(n: number): string { return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(n % (1024 * 1024) === 0 ? 0 : 1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`; }

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
