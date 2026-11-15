-- Why a coach assignment is paused (30 October 2026). Additive only; depends on 0001 (coach_assignments,
-- coach_profiles, users).
--
-- An assignment pauses for one of three reasons, and only the reason that paused it lets it resume by itself:
--   coach_account  the coach's account was suspended, deactivated or closed (PATCH /admin/coaches/:id/state); it
--                  resumes when an administrator reactivates the account (unless the coach is away by then: it then
--                  waits for the coach's return, as coach_away)
--   coach_away     the coach was marked away (POST /admin/coaches/:id/availability, /coach/availability/status, or the
--                  end of an away period); it resumes when the coach is available again (unless the account is not
--                  active by then: it then waits for the reactivation, as coach_account)
--   manual         an administrator paused it under Assignments; nothing resumes it but an administrator
-- Read only while the assignment is paused (status changes through api/domain/assignments.ts clear it; an assignment
-- ended elsewhere, by a refund or a programme's end, may keep a stale value, which nothing reads).
ALTER TABLE coach_assignments ADD COLUMN pause_cause TEXT CHECK (pause_cause IS NULL OR pause_cause IN ('coach_account', 'coach_away', 'manual'));

-- Assignments paused before this column existed. The account-state route wrote "account <state>: <reason>" as the
-- assignment's reason: those whose coach's account is still not active were paused by it. Those whose coach is away now
-- were most likely paused by the away mark (availability resumed every paused assignment before, so this keeps that).
-- Everything else stays paused until an administrator resumes it, as before.
UPDATE coach_assignments SET pause_cause = 'coach_account'
  WHERE status = 'paused' AND reason LIKE 'account %:%'
    AND coach_id IN (SELECT id FROM users WHERE role = 'coach' AND state != 'active');
UPDATE coach_assignments SET pause_cause = 'coach_away'
  WHERE status = 'paused' AND pause_cause IS NULL
    AND coach_id IN (SELECT user_id FROM coach_profiles WHERE available = 0);
UPDATE coach_assignments SET pause_cause = 'manual' WHERE status = 'paused' AND pause_cause IS NULL;
