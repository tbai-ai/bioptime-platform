/* Admin analytics from the real tables. Revenue counts only verified (captured) payments. In demo mode the numbers are
   synthetic and say so. */
import type { Ctx } from '../context.js';
import { addDays } from '../lib/time.js';

export function overview(ctx: Ctx) {
  const now = ctx.now();
  const d30 = addDays(now, -30), d7 = addDays(now, 7);
  const n = (sql: string, params: (string | number)[] = []) => ctx.db.get<{ n: number }>(sql, params)?.n ?? 0;
  const coaches = ctx.db.all<{ user_id: string; display_name: string; caseload_limit: number; available: number; load: number }>("SELECT c.user_id, c.display_name, c.caseload_limit, c.available, (SELECT COUNT(*) FROM coach_assignments a WHERE a.coach_id = c.user_id AND a.status = 'active') AS load FROM coach_profiles c JOIN users u ON u.id = c.user_id WHERE u.state = 'active'");
  const utilisation = coaches.length ? Math.round(100 * coaches.reduce((s, c) => s + c.load, 0) / Math.max(1, coaches.reduce((s, c) => s + c.caseload_limit, 0))) : 0;
  return {
    demo: ctx.config.isDemo,
    members: { total: n("SELECT COUNT(*) n FROM users WHERE role = 'member'"), active: n("SELECT COUNT(*) n FROM users WHERE role = 'member' AND state = 'active'"), onboarding: n("SELECT COUNT(*) n FROM users WHERE role = 'member' AND state IN ('pending_verification','onboarding')"), new30d: n("SELECT COUNT(*) n FROM users WHERE role = 'member' AND created_at >= ?", [d30]) },
    orders: { new30d: n('SELECT COUNT(*) n FROM orders WHERE created_at >= ?', [d30]), pendingPayment: n("SELECT COUNT(*) n FROM orders WHERE status = 'pending_payment'"), activated30d: n("SELECT COUNT(*) n FROM orders WHERE activated_at >= ?", [d30]) },
    revenue: { verifiedInr30d: n("SELECT COALESCE(SUM(amount_paise), 0) n FROM payments WHERE status = 'captured' AND signature_verified = 1 AND updated_at >= ?", [d30]) / 100, verifiedInrAll: n("SELECT COALESCE(SUM(amount_paise), 0) n FROM payments WHERE status = 'captured' AND signature_verified = 1") / 100, refundedInr: n("SELECT COALESCE(SUM(amount_paise), 0) n FROM refunds WHERE status = 'completed'") / 100, note: ctx.config.isDemo ? 'Simulated payments; no money moved.' : 'Captured, signature-verified payments only.' },
    programmes: { active: n("SELECT COUNT(*) n FROM programmes WHERE status = 'active'"), endingIn7d: n("SELECT COUNT(*) n FROM programmes WHERE status = 'active' AND end_at <= ?", [d7]) },
    assignments: { unassigned: n("SELECT COUNT(*) n FROM assignment_requests WHERE status IN ('open','exception')"), exceptions: n("SELECT COUNT(*) n FROM assignment_requests WHERE status = 'exception'") },
    coaches: { active: coaches.length, available: coaches.filter((c) => c.available).length, utilisationPct: utilisation, byCoach: coaches.map((c) => ({ coachId: c.user_id, name: c.display_name, caseload: c.load, limit: c.caseload_limit, available: !!c.available })) },
    appointments: { upcoming7d: n("SELECT COUNT(*) n FROM appointments WHERE status IN ('requested','scheduled') AND start_at BETWEEN ? AND ?", [now, d7]), requested: n("SELECT COUNT(*) n FROM appointments WHERE status = 'requested'") },
    bloodwork: Object.fromEntries(ctx.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM bloodwork_bookings GROUP BY status').map((r) => [r.status, r.n])),
    reportsAwaitingReview: n('SELECT COUNT(*) n FROM report_metadata WHERE reviewed_at IS NULL'),
    exceptions: { open: n("SELECT COUNT(*) n FROM support_tasks WHERE status IN ('open','in_progress')"), byKind: Object.fromEntries(ctx.db.all<{ kind: string; n: number }>("SELECT kind, COUNT(*) n FROM support_tasks WHERE status IN ('open','in_progress') GROUP BY kind").map((r) => [r.kind, r.n])) },
    customPlans: Object.fromEntries(ctx.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM custom_plan_requests GROUP BY status').map((r) => [r.status, r.n])),
    enquiries: { new: n("SELECT COUNT(*) n FROM enquiries WHERE status = 'new'") },
    ordersByWeek: ctx.db.all<{ week: string; n: number; inr: number }>("SELECT strftime('%Y-W%W', created_at) AS week, COUNT(*) n, COALESCE(SUM(CASE WHEN status IN ('paid','activated') THEN total_paise ELSE 0 END), 0) / 100.0 AS inr FROM orders WHERE created_at >= ? GROUP BY week ORDER BY week", [addDays(now, -84)]),
    generatedAt: now,
  };
}
