-- M2 Progress: measurable goals with milestones, structured check-ins (templates, weekly schedules, the check-ins
-- themselves with the coach's reply) and progress photos (private files, their own consent, shared photo by photo).
-- Depends only on 0001 to 0008: users, file_metadata (0001, references added by 0008), progress_entries (rebuilt by 0008).
-- Range charts and adherence read existing tables and need no schema.

-- Goals. A goal with a metric, a starting value and a target is marked achieved automatically when a value logged after
-- the goal was set reaches the target (in the direction from start to target); every other goal only by a person.
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  metric TEXT,
  baseline_value REAL,
  target_value REAL,
  unit TEXT,
  target_date TEXT CHECK (target_date IS NULL OR target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'paused', 'dropped')),
  created_by TEXT NOT NULL REFERENCES users (id),
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('member', 'coach')),
  achieved_at TEXT,
  -- how it was achieved: target_reached (a logged value reached the target) or marked (a person said so)
  achieved_how TEXT CHECK (achieved_how IS NULL OR achieved_how IN ('target_reached', 'marked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX goals_member ON goals (member_id, status, created_at);

CREATE TABLE goal_milestones (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals (id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  target_value REAL,
  due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  achieved_at TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL
);
CREATE INDEX goal_milestones_goal ON goal_milestones (goal_id, sort);

-- Check-in templates. scope library: written and published by an administrator holding library.manage, open to every
-- coach; scope coach: a coach's own, usable by that coach only. questions is JSON
-- [{key, label, type: scale_1_5 | number | text | yes_no, metric?}]; an answer tied to a metric becomes a progress entry.
CREATE TABLE checkin_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  description TEXT NOT NULL DEFAULT '',
  questions TEXT NOT NULL CHECK (json_valid(questions) AND json_type(questions) = 'array'),
  scope TEXT NOT NULL CHECK (scope IN ('library', 'coach')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX checkin_templates_scope ON checkin_templates (scope, status, created_by);

-- Weekly check-in schedules: one active schedule per member. weekday is 0 (Sunday) to 6 in the member's zone (India).
CREATE TABLE checkin_schedules (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users (id),
  template_id TEXT NOT NULL REFERENCES checkin_templates (id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE UNIQUE INDEX checkin_schedules_one_active ON checkin_schedules (member_id) WHERE active = 1;

-- Check-ins. The template's title and questions are copied when the check-in is requested, so editing a template never
-- changes what a member was asked. A requested check-in becomes missed when the next one of its schedule falls due.
-- response is the coach's reply, shown to the member; the coach's private observations are coach_notes rows with
-- ref_type 'checkin' and visibility private.
CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users (id),
  template_id TEXT NOT NULL REFERENCES checkin_templates (id),
  schedule_id TEXT REFERENCES checkin_schedules (id),
  title TEXT NOT NULL,
  questions TEXT NOT NULL CHECK (json_valid(questions)),
  due_date TEXT NOT NULL CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'submitted', 'reviewed', 'missed')),
  answers TEXT CHECK (answers IS NULL OR json_valid(answers)),
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES users (id),
  response TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (schedule_id, due_date)
);
CREATE INDEX checkins_member ON checkins (member_id, status, due_date);
CREATE INDEX checkins_coach ON checkins (coach_id, status);

-- Progress photos. The bytes are a private file (file_metadata kind progress_photo, PRIVATE_FILES_DIR), opened only
-- through a 5-minute token. A coach opens a photo only while it is shared, the member's progress_photos and
-- coach_sharing consents are both current and the coach is assigned; administrators see counts only.
CREATE TABLE progress_photos (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES file_metadata (id),
  pose TEXT NOT NULL CHECK (pose IN ('front', 'side', 'back', 'other')),
  taken_at TEXT NOT NULL,
  share_with_coach INTEGER NOT NULL DEFAULT 0 CHECK (share_with_coach IN (0, 1)),
  consent_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX progress_photos_member ON progress_photos (member_id, deleted_at, taken_at);
CREATE UNIQUE INDEX progress_photos_file ON progress_photos (file_id);
