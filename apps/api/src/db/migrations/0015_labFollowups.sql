-- M7 Lab follow-ups and preparation reminders (feature flag `labFollowups`). Depends only on 0001 to 0008: users,
-- report_metadata, appointments, bloodwork_bookings, coaching_plans, and the foundation's reminders queue (rows with
-- ref_type 'lab_preparation', which this migration does not touch).
--
-- A follow-up is a structured next step written after a report has been reviewed and released: a consultation, a
-- retest, a plan change or a note. The coach writes it for an assigned client who shares health information; the
-- Bioptime team writes it on a report it released itself. It may point at the appointment, the booking (the retest)
-- or the coaching plan that carries it out. Nothing here holds a default retest interval or a clinical rule: the due
-- date is whatever the coach or the team chose, and may stay empty.

CREATE TABLE lab_followups (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES report_metadata (id),
  member_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- the member's assigned coach when a coach wrote it; NULL for a follow-up the Bioptime team wrote on a team release
  coach_id TEXT REFERENCES users (id),
  kind TEXT NOT NULL CHECK (kind IN ('consultation', 'retest', 'plan_change', 'note')),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 3 AND 2000),
  -- a local calendar date (YYYY-MM-DD) chosen by the writer; NULL when none was set
  due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  appointment_id TEXT REFERENCES appointments (id),
  booking_id TEXT REFERENCES bloodwork_bookings (id),
  plan_id TEXT REFERENCES coaching_plans (id),
  created_by TEXT NOT NULL REFERENCES users (id),
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('coach', 'admin', 'owner')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_reason TEXT CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 300),
  CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  -- each link belongs to the kind that uses it: a consultation's appointment, a retest's booking, a plan change's plan
  CHECK (appointment_id IS NULL OR kind = 'consultation'),
  CHECK (booking_id IS NULL OR kind = 'retest'),
  CHECK (plan_id IS NULL OR kind = 'plan_change')
);
CREATE INDEX lab_followups_member ON lab_followups (member_id, status);
CREATE INDEX lab_followups_report ON lab_followups (report_id);
CREATE INDEX lab_followups_coach ON lab_followups (coach_id, status);
CREATE INDEX lab_followups_due ON lab_followups (status, due_date);
