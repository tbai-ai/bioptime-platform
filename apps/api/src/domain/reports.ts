/* Operational reports straight from the tables, with a date range, as JSON or CSV. Nothing here is a health outcome;
   every figure is a count or a verified amount. Demo mode is flagged on every report. */
import type { Ctx } from '../context.js';
import { errors } from '../lib/errors.js';

export type Report = { name: string; title: string; note: string; from: string; to: string; columns: string[]; rows: Array<Record<string, unknown>>; demo: boolean };

const REPORTS: Record<string, { title: string; note: string; run: (ctx: Ctx, from: string, to: string) => Array<Record<string, unknown>> }> = {
  enrolments: {
    title: 'Enrolments', note: 'Orders that reached activation, by package and month.',
    run: (ctx, from, to) => ctx.db.all("SELECT substr(o.activated_at, 1, 7) AS month, pk.name AS package, COUNT(*) AS activated, SUM(o.total_paise) / 100.0 AS inr FROM orders o JOIN package_versions v ON v.id = o.package_version_id JOIN packages pk ON pk.id = v.package_id WHERE o.status IN ('activated','refund_pending','refunded') AND o.activated_at >= ? AND o.activated_at < ? GROUP BY month, pk.name ORDER BY month, pk.name", [from, to]),
  },
  package_sales: {
    title: 'Package sales', note: 'Orders by status within the range; revenue counts signature-verified captures only.',
    run: (ctx, from, to) => ctx.db.all("SELECT COALESCE(pk.name, 'Bespoke') AS package, o.status, COUNT(*) AS orders, SUM(CASE WHEN o.status IN ('paid','activated','refund_pending','refunded') THEN o.total_paise ELSE 0 END) / 100.0 AS verified_inr FROM orders o LEFT JOIN package_versions v ON v.id = o.package_version_id LEFT JOIN packages pk ON pk.id = v.package_id WHERE o.created_at >= ? AND o.created_at < ? GROUP BY package, o.status ORDER BY package, o.status", [from, to]),
  },
  package_utilisation: {
    title: 'Package utilisation', note: 'Entitlements granted, used and held per active programme.',
    run: (ctx) => ctx.db.all("SELECT u.name AS member, pk.name AS package, e.service_type, SUM(e.quantity) AS granted, SUM(e.used_qty) AS used, SUM(e.reserved_qty) AS held, MIN(g.end_at) AS programme_ends FROM entitlements e JOIN programmes g ON g.id = e.programme_id JOIN users u ON u.id = e.member_id LEFT JOIN package_versions v ON v.id = g.package_version_id LEFT JOIN packages pk ON pk.id = v.package_id WHERE g.status = 'active' GROUP BY u.name, pk.name, e.service_type ORDER BY u.name, e.service_type"),
  },
  consultations: {
    title: 'Consultations', note: 'Appointments by coach and status within the range.',
    run: (ctx, from, to) => ctx.db.all('SELECT c.name AS coach, a.kind, a.status, COUNT(*) AS appointments FROM appointments a JOIN users c ON c.id = a.coach_id WHERE a.start_at >= ? AND a.start_at < ? GROUP BY c.name, a.kind, a.status ORDER BY c.name, a.kind, a.status', [from, to]),
  },
  coach_workload: {
    title: 'Coach workload', note: 'Active clients, caseload limit, upcoming appointments and reports waiting for review per coach.',
    run: (ctx) => ctx.db.all("SELECT c.name AS coach, p.caseload_limit, (SELECT COUNT(*) FROM coach_assignments a WHERE a.coach_id = c.id AND a.status = 'active') AS active_clients, (SELECT COUNT(*) FROM appointments x WHERE x.coach_id = c.id AND x.status IN ('requested','scheduled') AND x.start_at >= ?) AS upcoming_appointments, (SELECT COUNT(*) FROM report_metadata r WHERE r.reviewed_at IS NULL AND r.member_id IN (SELECT member_id FROM coach_assignments a WHERE a.coach_id = c.id AND a.status IN ('active','paused'))) AS reports_to_review, CASE WHEN p.available THEN 'available' ELSE 'away' END AS availability FROM users c JOIN coach_profiles p ON p.user_id = c.id WHERE c.role = 'coach' ORDER BY c.name", [ctx.now()]),
  },
  bloodwork: {
    title: 'Bloodwork bookings', note: 'Bookings by status and test within the range.',
    run: (ctx, from, to) => ctx.db.all('SELECT t.name AS test, b.status, COUNT(*) AS bookings, SUM(CASE WHEN b.flag IS NOT NULL THEN 1 ELSE 0 END) AS flagged FROM bloodwork_bookings b JOIN bloodwork_tests t ON t.id = b.test_id WHERE b.created_at >= ? AND b.created_at < ? GROUP BY t.name, b.status ORDER BY t.name, b.status', [from, to]),
  },
  retention: {
    title: 'Retention', note: 'Members whose programme ended in the range and whether they bought again.',
    run: (ctx, from, to) => ctx.db.all("SELECT u.name AS member, pk.name AS package, g.end_at AS ended, g.status, (SELECT COUNT(*) FROM orders o2 WHERE o2.member_id = g.member_id AND o2.status IN ('paid','activated') AND o2.created_at > g.end_at) AS later_orders FROM programmes g JOIN users u ON u.id = g.member_id LEFT JOIN package_versions v ON v.id = g.package_version_id LEFT JOIN packages pk ON pk.id = v.package_id WHERE g.end_at >= ? AND g.end_at < ? ORDER BY g.end_at", [from, to]),
  },
  failed_workflows: {
    title: 'Failed workflows', note: 'Open operational exceptions and domain events that exhausted their retries.',
    run: (ctx) => [
      ...ctx.db.all("SELECT 'support_task' AS source, kind, title, status, created_at AS at FROM support_tasks WHERE status IN ('open','in_progress') ORDER BY created_at DESC LIMIT 200"),
      ...ctx.db.all("SELECT 'dead_letter' AS source, type AS kind, COALESCE(last_error, '') AS title, 'dead' AS status, created_at AS at FROM domain_events WHERE status = 'dead' ORDER BY created_at DESC LIMIT 200"),
    ],
  },
  payments: {
    title: 'Payments', note: 'Payment records by provider and status within the range; simulated payments are labelled.',
    run: (ctx, from, to) => ctx.db.all('SELECT p.provider, p.status, COUNT(*) AS payments, SUM(p.amount_paise) / 100.0 AS inr, SUM(p.signature_verified) AS verified FROM payments p WHERE p.created_at >= ? AND p.created_at < ? GROUP BY p.provider, p.status ORDER BY p.provider, p.status', [from, to]),
  },
};
export const REPORT_NAMES = Object.keys(REPORTS);

export function runReport(ctx: Ctx, name: string, from?: string, to?: string): Report {
  const def = Object.hasOwn(REPORTS, name) ? REPORTS[name] : undefined;
  if (!def) throw errors.notFound('Report');
  const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z';
  const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : '2999-12-31T00:00:00.000Z';
  const rows = def.run(ctx, f, t).map((r) => Object.fromEntries(Object.entries(r)));
  const columns = rows.length ? Object.keys(rows[0]!) : [];
  return { name, title: def.title, note: def.note, from: f.slice(0, 10), to: t.slice(0, 10), columns, rows, demo: ctx.config.isDemo };
}

export function toCsv(report: Report): string {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [report.columns.join(','), ...report.rows.map((r) => report.columns.map((c) => esc(r[c])).join(','))];
  return `${lines.join('\n')}\n`;
}
