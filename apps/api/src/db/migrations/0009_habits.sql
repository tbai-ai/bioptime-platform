-- M1 Habits and reminders (feature flag `habits`). Depends only on 0001 to 0008: users, coaching_plans, and the
-- foundation's reminders queue (rows with ref_type 'habit') and push_devices, which this migration does not touch.
--
-- A habit is a recurring item with a schedule (every day, chosen weekdays, or a number of times a week). A member
-- writes their own; a coach writes one for an assigned client (created_by_role 'coach'), and the member then changes
-- only its reminders. One check-in per habit per local day. A missed day is derived (a due day with no check-in), never
-- stored. Nothing here holds a default reminder time or follow-up threshold: the coach, the member or the owner sets them.

CREATE TABLE habits (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  coach_id TEXT REFERENCES users (id),
  plan_id TEXT REFERENCES coaching_plans (id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  detail TEXT NOT NULL DEFAULT '',
  -- the plan editor's vocabulary (portal/pages/PlanEditor.tsx KINDS)
  kind TEXT NOT NULL DEFAULT 'habit' CHECK (kind IN ('training', 'movement', 'nutrition', 'sleep', 'habit', 'recovery', 'reflection')),
  -- {"type":"daily"} | {"type":"weekdays","weekdays":[1..7]} (1 = Monday) | {"type":"times_per_week","timesPerWeek":1..7}
  schedule TEXT NOT NULL CHECK (json_valid(schedule) AND json_extract(schedule, '$.type') IN ('daily', 'weekdays', 'times_per_week')),
  target_label TEXT,
  -- local "HH:MM" values in the member's timezone (member_profiles.timezone); empty until someone chooses them
  reminder_times TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reminder_times) AND json_type(reminder_times) = 'array'),
  reminders_on INTEGER NOT NULL DEFAULT 0 CHECK (reminders_on IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  -- pauses, as local dates, so paused days never count as due: the open pause and the closed ones [{"from","to"}]
  paused_since TEXT,
  pause_log TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(pause_log) AND json_type(pause_log) = 'array'),
  archived_on TEXT,
  archived_at TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('member', 'coach')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX habits_member ON habits (member_id, status);
CREATE INDEX habits_status ON habits (status, reminders_on);

CREATE TABLE habit_checkins (
  id TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- the member's local date (YYYY-MM-DD)
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'skipped')),
  -- the member's own words; coaches read it only while coach_sharing is granted
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (habit_id, date)
);
CREATE INDEX habit_checkins_member ON habit_checkins (member_id, date);
