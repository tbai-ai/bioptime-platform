/* LabStack operations (feature flag 'labstackOps'). No migration: every figure is computed from records Bioptime
   already keeps (bloodwork_bookings, booking_events, bloodwork_tests, support_tasks, vendor_events, integration_status,
   jobs_log, audit_events). Nothing is fetched from LabStack and nothing is written.

   LabStack administration lives only in the admin workspace, behind the labstack.manage permission
   (/admin/integrations/labstack). It is never linked from the coach workspace, the client app or the website.

   Route (def() with auth 'admin', permission labstack.manage and feature 'labstackOps'):
     GET /admin/integrations/labstack/operations
       The operations metrics the admin LabStack page shows, laid out like the LabStack console's home ("streams at a
       glance"):
       - streams: every order type the console knows (lab orders: home sample, center visit, sample drop-off, kit
         based, camp; appointments: online, center visit, home visit; pharma orders: home delivery, store pickup).
         Bioptime places one of them only, HOME_SAMPLE (api/domain/bloodwork.ts placeWithVendor), so that is the only
         type with figures; every other type is reported as not booked through Bioptime (null figures, never 0).
       - counters: breaching now, escalations open, lab orders today, home collections today.
       - breaching: the bookings breaching now, oldest deadline first (the rule is BREACHING NOW below; a rescheduled
         booking is measured against its new slot).
       - escalations: open operations tasks of the laboratory kinds plus failed laboratory calls in the last 24 hours
         that no task stands for (one incident counted once: a failure that opened or joined a task is counted under
         that task while it is open, and not at all once it is closed). bySource splits the total.
       - activity: booking events of the last 24 hours, newest first.
       - catalogue: tests enabled, hidden, priced and unpriced, packages, the last sync and the next one due.
       - health: webhook and safety-net health, failed calls, a rejected key.
       - partnerKey: whether LABSTACK_PARTNER_KEY is set (never its value) and what is missing before LabStack's widget
         can be opened from Bioptime pages.

   Privacy and secrets: the payload carries booking references, test names, statuses and member names, never a phone,
   email, address, PIN code or date of birth; administrators without members.view_restricted get the restricted keys
   stripped as everywhere else. Every string is passed through redactSecrets, so a secret value that reached a stored
   failure message or task detail is replaced before it leaves the server. No jobs, events, private files, adherence
   provider or demo rows. */
import type { FastifyInstance } from 'fastify';
import { LAB_STATUSES, type LabStatus } from '@bioptime/domain';
import type { ApiModule } from './types.js';
import type { Ctx } from '../context.js';
import type { Config } from '../config.js';
import { def } from '../http/route.js';
import { hasPermission } from '../auth/permissions.js';
import { adminRestrictedKeys, stripRestricted } from '../auth/fieldPolicy.js';
import { j } from '../db/db.js';
import { addHours, addMinutes, dateInZone, zonedToIso } from '../lib/time.js';
import { expectedBy, type LabFailure } from '../domain/bloodwork.js';

const FEATURE = 'labstackOps';
const TAG = 'labstackOps';

/* ---------- the console's streams, and the one Bioptime uses ---------- */

export type StreamKey = 'lab_orders' | 'appointments' | 'pharma_orders';
/** The order types as LabStack's console names them (its sidebar filters use these keys). */
export const STREAMS: ReadonlyArray<{ key: StreamKey; label: string; types: ReadonlyArray<{ key: string; label: string }> }> = [
  { key: 'lab_orders', label: 'Lab Orders', types: [{ key: 'HOME_SAMPLE', label: 'Home sample' }, { key: 'CENTER_VISIT', label: 'Center visit' }, { key: 'SAMPLE_DROP_OFF', label: 'Sample drop-off' }, { key: 'KIT_BASED', label: 'Kit based' }, { key: 'CAMP', label: 'Camp' }] },
  { key: 'appointments', label: 'Appointments', types: [{ key: 'ONLINE', label: 'Online' }, { key: 'CENTER_VISIT', label: 'Center visit' }, { key: 'HOME_VISIT', label: 'Home visit' }] },
  { key: 'pharma_orders', label: 'Pharma Orders', types: [{ key: 'HOME_DELIVERY', label: 'Home delivery' }, { key: 'PICKUP', label: 'Store pickup' }] },
];
/** Every Bioptime booking is a home collection: placeWithVendor sends orderType HOME_SAMPLE for each one. */
export const BIOPTIME_STREAM: StreamKey = 'lab_orders';
export const BIOPTIME_ORDER_TYPE = 'HOME_SAMPLE';

/* ---------- the rules ---------- */

/** Bookings that are still open (the same definition as the status card's "open orders"). */
const TERMINAL: ReadonlySet<LabStatus> = new Set<LabStatus>(['completed', 'cancelled']);
/** Statuses that mean the laboratory has not yet reported the sample collected. */
const BEFORE_COLLECTION: ReadonlySet<LabStatus> = new Set<LabStatus>(['confirmed', 'scheduled']);
/** Statuses after collection and before results: the only ones whose report can be overdue. */
const AFTER_COLLECTION: ReadonlySet<LabStatus> = new Set<LabStatus>(['sample_collected', 'processing']);

/* BREACHING NOW. A booking breaches when the laboratory has not moved it by a deadline Bioptime already holds:
   1. collection overdue: the booking is still 'confirmed' or 'scheduled' and its current collection slot (slot_at)
      has passed, i.e. the laboratory has not reported the sample collected by the start of the booked slot. This is
      the only way a booking before collection breaches: its report cannot be late while the sample is not taken.
   2. report overdue: the booking is 'sample_collected' or 'processing' (collected, no results yet) and its report
      deadline has passed. The report deadline is computed from the CURRENT slot: slot + the test's turnaround + four
      hours, computed by api/domain/bloodwork.ts expectedBy, the helper the order uses to set expected_report_by and
      a reschedule uses to recompute it. Computing it here from the current slot also keeps rows written before
      reschedules recomputed it (whose stored value belongs to the old slot) from reporting a booking days before its
      collection as late. When the turnaround text gives no number, the stored expected_report_by is used only if it
      falls after the current slot (one at or before the slot predates a move); otherwise it never breaches this way.
   Completed, cancelled and results-ready bookings never breach. No grace period is added to either deadline: the
   project holds no LabStack service level to take one from. The list is ordered by the missed deadline, oldest first.
   Times are compared as instants (slots may be stored with a +05:30 offset). */
export const BREACHING_RULE = 'A booking breaches when its collection slot has passed and the laboratory has not reported the sample collected (still confirmed or scheduled), or when the sample is collected and its report deadline (the current slot plus the laboratory’s turnaround plus four hours, so a rescheduled booking follows its new slot) has passed without results. Completed and cancelled bookings never breach; no grace period is added.';

/* ESCALATIONS OPEN. Open or in-progress operations tasks of the laboratory kinds, plus failed calls to the laboratory in
   the last 24 hours (recorded in integration_status by api/domain/bloodwork.ts recordFailure) that no task stands for,
   one entry per call name. One incident is counted once. A failed catalogue sync opens (or joins) a vendor_sync_failure
   task, a failed order placement a failed_booking task on its booking, and a failed cancellation after a webhook a
   failed_booking task too; the failure record names that task (taskId). While the task is open, the failure is counted
   under it (escalations.coveredFailedCalls) and not listed again. Once the task is closed the incident is over: the
   failure is no longer an open escalation (escalations.closedFailedCalls). Health still counts every failed call.
   A failure that names a booking but no task opened none (an order the laboratory refused outright: the booking is
   cancelled) and is listed as a call. Failures recorded before records named their task or booking are matched by
   kind and time instead: a task of the matching kind that was open when the call failed (opened no later than a
   minute after it, and not closed before it). */
const LEGACY_MATCH_MS = 60_000;
const CALL_COVERED_BY: Record<string, (t: { kind: string; ref_type: string | null }) => boolean> = {
  catalogue_sync: (t) => t.kind === 'vendor_sync_failure',
  placeOrder: (t) => t.kind === 'failed_booking' && t.ref_type === 'booking',
};
const LAB_TASK_KINDS: Record<string, string> = {
  failed_booking: 'Failed booking',
  collection_rebook: 'Collection to rebook',
  missing_report_notification: 'Missing report',
  report_values_failed: 'Report values failed',
  unknown_webhook: 'Update for an unknown order',
  vendor_sync_failure: 'Catalogue sync failed',
  integration_error: 'Webhook silence',
};
/** integration_error is shared with other integrations: only the laboratory's rows count. */
const LAB_INTEGRATION_REFS = ['labstack', 'webhook_silence'];
export const ESCALATION_RULE = 'Open or in-progress operations tasks about the laboratory (failed bookings, collections to rebook, missing reports, report values that failed, updates for unknown orders, catalogue sync failures, webhook silence), plus calls to LabStack that failed in the last 24 hours without opening a task, one entry per call. Each incident is counted once: a failure that opened a task (a catalogue sync, an order placement, a cancellation) is counted under that task while it is open, and no longer counts once the task is closed.';

/** The same six-hour threshold the safety net uses before it opens a webhook-silence task. */
const WEBHOOK_SILENCE_HOURS = 6;
const LIST_LIMIT = 200;
const ACTIVITY_LIMIT = 100;

/* ---------- helpers ---------- */

const ms = (iso: string | null | undefined): number | null => { if (!iso) return null; const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };
const minutesSince = (iso: string, now: number): number => Math.max(0, Math.round((now - (ms(iso) ?? now)) / 60_000));
const statusOf = (s: string): LabStatus => s as LabStatus;

type IntegrationState = { lastCatalogueSync?: string; catalogueCount?: number; lastWebhook?: string; lastSafetyNet?: string; keyRejectedAt?: string; failures?: LabFailure[] };
type BookingLite = { id: string; reference: string; member_id: string; member_name: string | null; test_name: string | null; test_turnaround: string | null; status: string; vendor_status: string | null; vendor_order_id: string | null; vendor_pending: number; slot_at: string; expected_report_by: string | null; flag: string | null; created_at: string };
/** The report deadline of a collected booking, as an instant (rule 2 of BREACHING NOW): the current slot plus the
    turnaround plus four hours; without a usable turnaround, the stored expected_report_by when it falls after the slot. */
export function reportDeadline(b: { slot_at: string; expected_report_by: string | null; test_turnaround: string | null }): number | null {
  const slot = ms(b.slot_at);
  if (slot === null) return null;
  const computed = ms(expectedBy(new Date(slot).toISOString(), b.test_turnaround));
  if (computed !== null) return computed;
  const stored = ms(b.expected_report_by);
  return stored !== null && stored > slot ? stored : null;
}
type TaskRow = { id: string; kind: string; status: string; title: string; detail: string; ref_type: string | null; ref_id: string | null; created_at: string; updated_at: string; owner_name: string | null };

export type BreachItem = { bookingId: string; reference: string; memberId: string; memberName: string | null; testName: string | null; stream: StreamKey; orderType: string; status: LabStatus; vendorStatus: string | null; vendorOrderPlaced: boolean; kind: 'collection_overdue' | 'report_overdue'; kindLabel: string; dueAt: string; overdueMinutes: number; flag: string | null };
export type EscalationItem = { id: string; source: 'task' | 'vendor_call'; kind: string; kindLabel: string; title: string; detail: string; status: string; ownerName: string | null; openedAt: string; lastAt: string; ageMinutes: number; stream: StreamKey | 'integration'; orderType: string | null; bookingId: string | null; reference: string | null; memberName: string | null; count: number };

/** Names of the server secrets whose values must never appear in a response. */
const SECRET_KEYS = ['LABSTACK_API_KEY', 'LABSTACK_API_KEY_NEXT', 'LABSTACK_WEBHOOK_VALUE', 'LABSTACK_PARTNER_KEY', 'SESSION_SECRET', 'TOKEN_SECRET', 'PAYMENT_WEBHOOK_SECRET'] as const;
export function secretValues(config: Config): string[] {
  return SECRET_KEYS.map((k) => String((config as unknown as Record<string, unknown>)[k] ?? '')).filter((v) => v.length >= 8);
}
/** Replace every occurrence of a secret value in any string of the payload. */
export function redactSecrets<T>(value: T, secrets: string[]): T {
  if (!secrets.length) return value;
  if (typeof value === 'string') { let s: string = value; for (const x of secrets) if (s.includes(x)) s = s.split(x).join('[redacted]'); return s as T; }
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, secrets)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactSecrets(v, secrets)])) as T;
  return value;
}

/** The partner key counts as set when it has a value that is not a placeholder. Only this boolean leaves the server. */
export function partnerKeyConfigured(config: Config): boolean {
  const v = (config.LABSTACK_PARTNER_KEY ?? '').trim();
  return !!v && !/demo|change-me/i.test(v);
}

/* ---------- the metrics ---------- */

export function operations(ctx: Ctx, vendor: { mode: 'standin' | 'live'; name: string }) {
  const nowIso = ctx.now();
  const now = ms(nowIso)!;
  const dayAgo = addHours(nowIso, -24);
  const today = dateInZone(nowIso);
  const todayStart = zonedToIso(today, 0);
  const isToday = (iso: string | null | undefined) => { const t = ms(iso); return t !== null && dateInZone(new Date(t).toISOString()) === today; };
  const state = j.out<IntegrationState>(ctx.db.get<{ status: string }>("SELECT status FROM integration_status WHERE integration = 'labstack'")?.status, {});

  /* bookings: every Bioptime booking is a HOME_SAMPLE lab order */
  const bookings = ctx.db.all<BookingLite>('SELECT b.id, b.reference, b.member_id, u.name AS member_name, t.name AS test_name, t.turnaround AS test_turnaround, b.status, b.vendor_status, b.vendor_order_id, b.vendor_pending, b.slot_at, b.expected_report_by, b.flag, b.created_at FROM bloodwork_bookings b LEFT JOIN users u ON u.id = b.member_id LEFT JOIN bloodwork_tests t ON t.id = b.test_id');
  const byStatus = Object.fromEntries(LAB_STATUSES.map((s) => [s, 0])) as Record<LabStatus, number>;
  for (const b of bookings) if (b.status in byStatus) byStatus[statusOf(b.status)]++;
  const open = bookings.filter((b) => !TERMINAL.has(statusOf(b.status)));
  const ordersToday = bookings.filter((b) => isToday(b.created_at)).length;
  const collectionsToday = bookings.filter((b) => b.status !== 'cancelled' && isToday(b.slot_at)).length;

  /* breaching now (rule above) */
  const breaching: BreachItem[] = [];
  for (const b of open) {
    const status = statusOf(b.status);
    const slot = ms(b.slot_at);
    let kind: BreachItem['kind'] | null = null;
    let dueAt = '';
    if (BEFORE_COLLECTION.has(status)) {
      if (slot !== null && slot < now) { kind = 'collection_overdue'; dueAt = new Date(slot).toISOString(); }
    } else if (AFTER_COLLECTION.has(status)) {
      const due = reportDeadline(b);
      if (due !== null && due < now) { kind = 'report_overdue'; dueAt = new Date(due).toISOString(); }
    }
    if (!kind) continue;
    breaching.push({
      bookingId: b.id, reference: b.reference, memberId: b.member_id, memberName: b.member_name, testName: b.test_name, stream: BIOPTIME_STREAM, orderType: BIOPTIME_ORDER_TYPE,
      status, vendorStatus: b.vendor_status, vendorOrderPlaced: !!b.vendor_order_id, kind, kindLabel: kind === 'collection_overdue' ? 'Collection overdue' : 'Report overdue',
      dueAt, overdueMinutes: minutesSince(dueAt, now), flag: b.flag,
    });
  }
  breaching.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.reference.localeCompare(b.reference));

  /* escalations open: laboratory tasks, then failed calls in the last 24 hours */
  const kinds = Object.keys(LAB_TASK_KINDS).filter((k) => k !== 'integration_error');
  const tasks = ctx.db.all<TaskRow>(
    `SELECT t.id, t.kind, t.status, t.title, t.detail, t.ref_type, t.ref_id, t.created_at, t.updated_at, u.name AS owner_name FROM support_tasks t LEFT JOIN users u ON u.id = t.owner_id
     WHERE t.status IN ('open','in_progress') AND (t.kind IN (${kinds.map(() => '?').join(', ')}) OR (t.kind = 'integration_error' AND t.ref_type = 'integration' AND t.ref_id IN (${LAB_INTEGRATION_REFS.map(() => '?').join(', ')})))
     ORDER BY t.created_at, t.id`, [...kinds, ...LAB_INTEGRATION_REFS]);
  const bookingById = new Map(bookings.map((b) => [b.id, b]));
  const bookingFor = (t: TaskRow): BookingLite | undefined => {
    if (!t.ref_id) return undefined;
    if (t.ref_type === 'booking') return bookingById.get(t.ref_id);
    if (t.ref_type === 'report') { const r = ctx.db.get<{ booking_id: string }>('SELECT booking_id FROM report_metadata WHERE id = ?', [t.ref_id]); return r ? bookingById.get(r.booking_id) : undefined; }
    if (t.ref_type === 'vendor_order') return bookings.find((b) => b.vendor_order_id === t.ref_id);
    return undefined;
  };
  const escalations: EscalationItem[] = tasks.map((t) => {
    const b = bookingFor(t);
    // a task about one order belongs to the lab-orders stream; one about the integration as a whole (catalogue sync,
    // webhook silence) to none of the order streams
    const orderLevel = t.ref_type === 'booking' || t.ref_type === 'report' || t.ref_type === 'vendor_order';
    return {
      id: t.id, source: 'task', kind: t.kind, kindLabel: LAB_TASK_KINDS[t.kind] ?? t.kind, title: t.title, detail: t.detail, status: t.status, ownerName: t.owner_name,
      openedAt: t.created_at, lastAt: t.updated_at, ageMinutes: minutesSince(t.created_at, now),
      stream: orderLevel ? BIOPTIME_STREAM : 'integration', orderType: orderLevel ? BIOPTIME_ORDER_TYPE : null,
      bookingId: b?.id ?? null, reference: b?.reference ?? null, memberName: b?.member_name ?? null, count: 1,
    };
  });
  const recentFailures = (state.failures ?? []).filter((f) => { const t = ms(f.at); return t !== null && t >= now - 24 * 3_600_000; });
  // one incident, one entry: the task a failure opened or joined stands for it (rule above)
  const listedTaskIds = new Set(tasks.map((t) => t.id));
  const isOpenStatus = (status: string) => status === 'open' || status === 'in_progress';
  const namedIds = [...new Set(recentFailures.map((f) => f.taskId).filter((x): x is string => !!x))];
  const named = new Map(namedIds.length ? ctx.db.all<{ id: string; status: string }>(`SELECT id, status FROM support_tasks WHERE id IN (${namedIds.map(() => '?').join(', ')})`, namedIds).map((t) => [t.id, t] as const) : []);
  const legacy = (f: LabFailure) => !f.taskId && !f.bookingId && !!CALL_COVERED_BY[f.call];
  const legacyTasks = recentFailures.some(legacy)
    ? ctx.db.all<{ id: string; kind: string; status: string; ref_type: string | null; created_at: string; closed_at: string | null }>("SELECT id, kind, status, ref_type, created_at, COALESCE(resolved_at, updated_at) AS closed_at FROM support_tasks WHERE kind IN ('vendor_sync_failure', 'failed_booking')")
    : [];
  const taskState = (f: LabFailure): 'open' | 'closed' | null => {
    if (f.taskId) {
      const t = named.get(f.taskId);
      if (!t) return null; // the named task is gone: the failure is listed as a call
      return isOpenStatus(t.status) ? (listedTaskIds.has(t.id) ? 'open' : null) : 'closed';
    }
    if (!legacy(f)) return null; // no task stands for it
    const covers = CALL_COVERED_BY[f.call]!;
    const at = ms(f.at)!;
    const openThen = legacyTasks.filter((t) => covers(t) && (ms(t.created_at) ?? Infinity) <= at + LEGACY_MATCH_MS && (isOpenStatus(t.status) || (ms(t.closed_at) ?? -Infinity) >= at));
    if (!openThen.length) return null;
    return openThen.some((t) => isOpenStatus(t.status) && listedTaskIds.has(t.id)) ? 'open' : openThen.some((t) => isOpenStatus(t.status)) ? null : 'closed';
  };
  const coveredFailedCalls: Record<string, number> = {};
  const closedFailedCalls: Record<string, number> = {};
  const byCall = new Map<string, LabFailure[]>();
  for (const f of recentFailures) {
    const t = taskState(f);
    if (t === 'open') coveredFailedCalls[f.call] = (coveredFailedCalls[f.call] ?? 0) + 1;
    else if (t === 'closed') closedFailedCalls[f.call] = (closedFailedCalls[f.call] ?? 0) + 1;
    else byCall.set(f.call, [...(byCall.get(f.call) ?? []), f]);
  }
  for (const [call, list] of byCall) {
    const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
    const first = sorted[0]!, last = sorted[sorted.length - 1]!;
    escalations.push({
      id: `vendor_call:${call}`, source: 'vendor_call', kind: 'failed_vendor_call', kindLabel: 'Failed laboratory call', title: `${list.length} failed ${call} call${list.length === 1 ? '' : 's'} to LabStack in 24 h`,
      detail: last.message, status: 'open', ownerName: null, openedAt: first.at, lastAt: last.at, ageMinutes: minutesSince(first.at, now),
      stream: 'integration', orderType: null, bookingId: null, reference: null, memberName: null, count: list.length,
    });
  }
  escalations.sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id));

  /* recent activity: booking events of the last 24 hours, newest first */
  const activityTotal = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM booking_events WHERE at >= ?', [dayAgo])?.n ?? 0;
  const activity = ctx.db.all<{ at: string; booking_id: string; reference: string; test_name: string | null; from_status: string | null; to_status: string; vendor_status: string | null; source: string; note: string | null }>(
    'SELECT e.at, e.booking_id, b.reference, t.name AS test_name, e.from_status, e.to_status, e.vendor_status, e.source, e.note FROM booking_events e JOIN bloodwork_bookings b ON b.id = e.booking_id LEFT JOIN bloodwork_tests t ON t.id = b.test_id WHERE e.at >= ? ORDER BY e.at DESC, e.rowid DESC LIMIT ?',
    [dayAgo, ACTIVITY_LIMIT]).map((e) => ({ at: e.at, bookingId: e.booking_id, reference: e.reference, testName: e.test_name, from: e.from_status, to: e.to_status, vendorStatus: e.vendor_status, source: e.source, note: e.note, stream: BIOPTIME_STREAM, orderType: BIOPTIME_ORDER_TYPE }));

  /* catalogue */
  const cat = ctx.db.get<Record<string, number | null>>(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN active = 1 AND hidden = 0 AND price_paise IS NOT NULL THEN 1 ELSE 0 END) AS enabled,
      SUM(CASE WHEN active = 1 AND hidden = 0 AND price_paise IS NOT NULL AND kind = 'test' THEN 1 ELSE 0 END) AS enabled_tests,
      SUM(CASE WHEN active = 1 AND hidden = 0 AND price_paise IS NOT NULL AND kind = 'package' THEN 1 ELSE 0 END) AS enabled_packages,
      SUM(CASE WHEN active = 1 AND hidden = 1 THEN 1 ELSE 0 END) AS hidden,
      SUM(CASE WHEN active = 1 AND price_paise IS NOT NULL THEN 1 ELSE 0 END) AS priced,
      SUM(CASE WHEN active = 1 AND price_paise IS NULL THEN 1 ELSE 0 END) AS unpriced,
      SUM(CASE WHEN active = 1 AND hidden = 0 AND price_paise IS NULL THEN 1 ELSE 0 END) AS visible_unpriced
    FROM bloodwork_tests`) ?? {};
  const n = (v: number | null | undefined) => Number(v ?? 0);
  const lastJob = (job: string) => { const r = ctx.db.get<{ started_at: string; finished_at: string | null; ok: number | null }>('SELECT started_at, finished_at, ok FROM jobs_log WHERE job = ? ORDER BY started_at DESC LIMIT 1', [job]); return r ? { startedAt: r.started_at, finishedAt: r.finished_at, ok: r.ok === null ? null : !!r.ok } : null; };
  const syncHours = ctx.config.LABSTACK_CATALOGUE_SYNC_HOURS;
  const lastSyncFailure = [...(state.failures ?? [])].filter((f) => f.call === 'catalogue_sync').sort((a, b) => b.at.localeCompare(a.at))[0];
  const labsSeen = ctx.db.get<{ n: number }>('SELECT COUNT(DISTINCT lab_id) n FROM bloodwork_bookings WHERE lab_id IS NOT NULL')?.n ?? 0;

  /* webhook and safety-net health */
  const hooks = ctx.db.all<{ outcome: string | null; n: number }>("SELECT outcome, COUNT(*) n FROM vendor_events WHERE vendor = 'labstack' AND kind = 'order_webhook' AND received_at >= ? GROUP BY outcome", [dayAgo]);
  const hookCounts = { applied: 0, repeat: 0, unknown_order: 0, other: 0, total: 0 };
  for (const h of hooks) { const k = (h.outcome === 'applied' || h.outcome === 'repeat' || h.outcome === 'unknown_order') ? h.outcome : 'other'; hookCounts[k] += h.n; hookCounts.total += h.n; }
  const rejected24h = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'labstack.webhook_rejected' AND at >= ?", [dayAgo])?.n ?? 0;
  const lastWebhook = state.lastWebhook ?? null;
  const webhookState: 'ok' | 'silent' | 'none_yet' = !lastWebhook ? 'none_yet' : open.length > 0 && (ms(lastWebhook) ?? 0) < now - WEBHOOK_SILENCE_HOURS * 3_600_000 ? 'silent' : 'ok';
  const everyMinutes = ctx.config.LABSTACK_SAFETY_NET_MINUTES;
  const lastSafetyNet = state.lastSafetyNet ?? null;
  // a run missing for two whole intervals is late
  const safetyState: 'ok' | 'late' | 'never' = !lastSafetyNet ? 'never' : (ms(lastSafetyNet) ?? 0) < now - 2 * everyMinutes * 60_000 ? 'late' : 'ok';
  const failuresByCall: Record<string, number> = {};
  for (const f of recentFailures) failuresByCall[f.call] = (failuresByCall[f.call] ?? 0) + 1;

  /* partner key and widget: configured or not, never the value */
  const pkConfigured = partnerKeyConfigured(ctx.config);
  const widgetMissing = [
    ...(pkConfigured ? [] : ['LABSTACK_PARTNER_KEY in the server environment, generated by the LabStack account owner in the console under Widget configs → Access (shown once)']),
    'LabStack’s token API documentation, which the project does not have: without it no widget token is minted and no token call is implemented',
  ];

  /* the console's streams, with Bioptime's figures where Bioptime books that type */
  const breachingHome = breaching.length;
  const escalationsHome = escalations.filter((e) => e.stream === BIOPTIME_STREAM).length;
  const streams = STREAMS.map((s) => {
    const types = s.types.map((t) => {
      const used = s.key === BIOPTIME_STREAM && t.key === BIOPTIME_ORDER_TYPE;
      return used
        ? { key: t.key, label: t.label, used: true, total: bookings.length, open: open.length, breaching: breachingHome, escalations: escalationsHome, today: ordersToday, collectionsToday, byStatus }
        : { key: t.key, label: t.label, used: false, total: null, open: null, breaching: null, escalations: null, today: null, collectionsToday: null, byStatus: null };
    });
    const used = types.some((t) => t.used);
    return { key: s.key, label: s.label, used, open: used ? open.length : null, breaching: used ? breachingHome : null, escalations: used ? escalationsHome : null, today: used ? ordersToday : null, types };
  });
  const countBy = <T extends { stream: string }>(list: T[]) => ({ lab_orders: list.filter((x) => x.stream === 'lab_orders').length, appointments: list.filter((x) => x.stream === 'appointments').length, pharma_orders: list.filter((x) => x.stream === 'pharma_orders').length, integration: list.filter((x) => x.stream === 'integration').length });

  return {
    generatedAt: nowIso,
    timezone: 'Asia/Kolkata',
    today: { date: today, from: todayStart },
    vendor: { name: vendor.name, mode: vendor.mode, simulated: vendor.mode === 'standin' },
    source: 'Bioptime’s own records: bookings Bioptime placed with LabStack, its operations tasks and the integration log. Orders booked directly in the LabStack console are not included.',
    rules: { breaching: BREACHING_RULE, escalations: ESCALATION_RULE, ordersToday: 'Bookings created today (India time); home collections today are bookings, not cancelled, whose slot falls today.', activity: 'Booking status changes and notes of the last 24 hours, newest first.' },
    counters: { breachingNow: breaching.length, escalationsOpen: escalations.length, labOrdersToday: ordersToday, collectionsToday, openLabOrders: open.length },
    streams,
    breaching: { total: breaching.length, byStream: countBy(breaching), truncated: breaching.length > LIST_LIMIT, items: breaching.slice(0, LIST_LIMIT) },
    escalations: {
      total: escalations.length, byStream: countBy(escalations), truncated: escalations.length > LIST_LIMIT, items: escalations.slice(0, LIST_LIMIT),
      // the total split by where it comes from: open tasks, and calls that failed in the last 24 hours with no task
      bySource: { tasks: escalations.filter((e) => e.source === 'task').length, failedCalls: escalations.filter((e) => e.source === 'vendor_call').length, failedCallFailures: escalations.filter((e) => e.source === 'vendor_call').reduce((sum, e) => sum + e.count, 0) },
      coveredFailedCalls, closedFailedCalls,
    },
    activity: { since: dayAgo, total: activityTotal, truncated: activityTotal > ACTIVITY_LIMIT, items: activity },
    catalogue: {
      total: n(cat.total), active: n(cat.active), enabled: n(cat.enabled), enabledTests: n(cat.enabled_tests), enabledPackages: n(cat.enabled_packages),
      hidden: n(cat.hidden), priced: n(cat.priced), unpriced: n(cat.unpriced), visibleUnpriced: n(cat.visible_unpriced),
      lastSync: state.lastCatalogueSync ?? null, vendorItemsAtLastSync: state.catalogueCount ?? null, syncEveryHours: syncHours,
      nextSyncDue: state.lastCatalogueSync && ctx.config.jobsEnabled ? addMinutes(state.lastCatalogueSync, syncHours * 60) : null,
      lastSyncFailure: lastSyncFailure ? { at: lastSyncFailure.at, message: lastSyncFailure.message } : null,
      lastJob: lastJob('labstack_catalogue'), labsSeen,
    },
    health: {
      jobsEnabled: ctx.config.jobsEnabled,
      webhook: { state: webhookState, lastReceivedAt: lastWebhook, received24h: hookCounts, rejected24h, silenceHours: WEBHOOK_SILENCE_HOURS },
      safetyNet: { state: safetyState, lastRunAt: lastSafetyNet, everyMinutes, lastJob: lastJob('labstack_safety_net') },
      failedCalls24h: recentFailures.length, failedCallsByCall: failuresByCall,
      keyRejectedAt: state.keyRejectedAt ?? null,
    },
    partnerKey: {
      variable: 'LABSTACK_PARTNER_KEY', configured: pkConfigured,
      widget: { state: 'pending_configuration' as const, tokenMinting: 'not_implemented' as const, missing: widgetMissing },
      generatedIn: 'LabStack console → Widget configs → Access (by the account owner; shown once)',
    },
  };
}

/* ---------- route ---------- */

/** Administrators without members.view_restricted never receive restricted keys (the payload carries none; this is the safety net). */
const restrictedView = <T,>(ctx: Ctx, payload: T): T => (hasPermission(ctx, 'members.view_restricted') ? payload : stripRestricted(payload, adminRestrictedKeys()));

export function labstackOpsRoutes(app: FastifyInstance): void {
  def(app, { method: 'GET', path: '/admin/integrations/labstack/operations', summary: 'LabStack operations from Bioptime’s records: bookings by order type and status, breaching now, open escalations, today, recent activity, catalogue, webhook and safety-net health, partner-key state (never a value)', tag: TAG, auth: 'admin', permission: 'labstack.manage', feature: FEATURE }, async (req) => {
    const payload = operations(req.ctx, { mode: app.services.vendor.mode, name: app.services.vendor.name });
    return redactSecrets(restrictedView(req.ctx, payload), secretValues(req.ctx.config));
  });
}

export const labstackOps: ApiModule = {
  key: 'labstackOps',
  feature: 'labstackOps',
  routes: (app) => labstackOpsRoutes(app),
  jobs: [],
};
