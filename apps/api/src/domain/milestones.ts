/* Milestones are derived from what actually happened to a member: records, never a score or an estimate. Each one
   carries the record it comes from, so a coach and the member read the same list and nothing is fabricated. */
import type { Ctx } from '../context.js';

export type Milestone = { key: string; title: string; achievedAt: string | null; detail: string; source: string };

export function milestonesFor(ctx: Ctx, memberId: string): Milestone[] {
  const db = ctx.db;
  const onboarding = db.get<{ at: string | null }>('SELECT onboarding_completed_at AS at FROM member_profiles WHERE user_id = ?', [memberId])?.at ?? null;
  const programme = db.get<{ at: string | null; name: string | null }>("SELECT g.start_at AS at, p.name FROM programmes g LEFT JOIN package_versions v ON v.id = g.package_version_id LEFT JOIN packages p ON p.id = v.package_id WHERE g.member_id = ? ORDER BY g.start_at LIMIT 1", [memberId]);
  const coach = db.get<{ at: string | null }>("SELECT effective_at AS at FROM coach_assignments WHERE member_id = ? AND status IN ('active','paused','ended') ORDER BY effective_at LIMIT 1", [memberId])?.at ?? null;
  const plan = db.get<{ at: string | null }>("SELECT MIN(v.published_at) AS at FROM coaching_plan_versions v JOIN coaching_plans p ON p.id = v.plan_id WHERE p.member_id = ? AND v.status = 'published'", [memberId])?.at ?? null;
  const consult = db.get<{ at: string | null }>("SELECT MIN(start_at) AS at FROM appointments WHERE member_id = ? AND status = 'completed'", [memberId])?.at ?? null;
  const collected = db.get<{ at: string | null }>("SELECT MIN(slot_at) AS at FROM bloodwork_bookings WHERE member_id = ? AND status IN ('sample_collected','processing','results_ready','completed')", [memberId])?.at ?? null;
  const firstReport = db.get<{ at: string | null; role: string | null }>('SELECT r.released_at AS at, u.role FROM report_metadata r LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.member_id = ? AND r.released_at IS NOT NULL ORDER BY r.released_at LIMIT 1', [memberId]);
  const report = firstReport?.at ?? null;
  const tasks = db.get<{ n: number; at: string | null }>("SELECT COUNT(*) n, MAX(completed_at) at FROM plan_tasks WHERE member_id = ? AND status = 'done'", [memberId]) ?? { n: 0, at: null };
  const tenth = tasks.n >= 10 ? db.get<{ at: string | null }>("SELECT completed_at AS at FROM plan_tasks WHERE member_id = ? AND status = 'done' ORDER BY completed_at LIMIT 1 OFFSET 9", [memberId])?.at ?? null : null;
  const logs = db.get<{ n: number }>("SELECT COUNT(DISTINCT substr(at, 1, 10)) n FROM progress_entries WHERE member_id = ? AND source = 'member'", [memberId])?.n ?? 0;
  const seventhLog = logs >= 7 ? db.get<{ at: string | null }>("SELECT at FROM (SELECT DISTINCT substr(at, 1, 10) AS d, MIN(at) AS at FROM progress_entries WHERE member_id = ? AND source = 'member' GROUP BY d ORDER BY d LIMIT 1 OFFSET 6)", [memberId])?.at ?? null : null;
  return [
    { key: 'onboarded', title: 'Set up and ready', achievedAt: onboarding, detail: 'Goals and consents recorded', source: 'onboarding' },
    { key: 'enrolled', title: programme?.name ? `Enrolled in ${programme.name}` : 'Enrolled in a package', achievedAt: programme?.at ?? null, detail: 'Payment verified and the programme started', source: 'programme' },
    { key: 'coached', title: 'Matched with a coach', achievedAt: coach, detail: 'A coach was assigned and confirmed', source: 'assignment' },
    { key: 'plan', title: 'First plan published', achievedAt: plan, detail: 'Your coach published a plan', source: 'coaching_plan' },
    { key: 'consultation', title: 'First consultation', achievedAt: consult, detail: 'A consultation was completed', source: 'appointment' },
    { key: 'collection', title: 'First blood sample collected', achievedAt: collected, detail: 'Collected at home by the laboratory', source: 'bloodwork_booking' },
    { key: 'report', title: 'First report reviewed', achievedAt: report, detail: firstReport?.role === 'coach' ? 'Released after your coach reviewed it' : 'Released after the Bioptime team reviewed it', source: 'report' },
    { key: 'tasks10', title: 'Ten plan tasks done', achievedAt: tenth, detail: `${tasks.n} done so far`, source: 'plan_tasks' },
    { key: 'logs7', title: 'Logged on seven days', achievedAt: seventhLog, detail: `${logs} day${logs === 1 ? '' : 's'} with an entry`, source: 'progress_entries' },
  ];
}
