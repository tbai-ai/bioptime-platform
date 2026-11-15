-- M6 Workouts: the exercise library, workout templates, coach-authored programmes with versions, the sessions a
-- published version generates (each with a frozen copy of its template's exercises), and the member's set logs.
-- Depends only on 0001 to 0008. Coach feedback on a session reuses coach_notes (ref_type 'workout_session').
--
-- Set logs, the effort rating (rpe), the session duration and the member's notes are health detail: a coach sees them
-- only while the member's coach_sharing consent is current (requireHealthAccess). The schedule and each session's
-- status are visible to the assigned coach, as plan tasks are.
--
-- No media: media_asset_id (licensed images only) and media_ref (only with a video provider) stay empty until licensed
-- demonstration media and a video host exist. Categories and levels are validated by the API (packages/domain
-- modules/workouts.ts), so the lists can grow without a migration.

CREATE TABLE exercises (
  id TEXT PRIMARY KEY,                                   -- exr_
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  equipment TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(equipment)),
  muscle_groups TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(muscle_groups)),
  media_asset_id TEXT REFERENCES assets (id),
  media_ref TEXT,
  source TEXT NOT NULL CHECK (source IN ('team', 'coach')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),   -- demo rows, labelled "Sample" wherever they appear
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX exercises_status ON exercises (status, source);
CREATE INDEX exercises_author ON exercises (created_by, status);

CREATE TABLE workout_templates (
  id TEXT PRIMARY KEY,                                   -- wkt_
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level TEXT,
  est_minutes INTEGER CHECK (est_minutes IS NULL OR (est_minutes >= 1 AND est_minutes <= 600)),
  source TEXT NOT NULL CHECK (source IN ('team', 'coach')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX workout_templates_status ON workout_templates (source, status);
CREATE INDEX workout_templates_author ON workout_templates (created_by, status);

CREATE TABLE workout_template_items (
  id TEXT PRIMARY KEY,                                   -- wti_
  template_id TEXT NOT NULL REFERENCES workout_templates (id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises (id),
  block TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  sets INTEGER NOT NULL DEFAULT 1 CHECK (sets >= 1 AND sets <= 20),
  reps TEXT,                                             -- as written: "8", "8-10", "10 each side"
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 1),
  rest_seconds INTEGER CHECK (rest_seconds IS NULL OR rest_seconds >= 0),
  load_note TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX workout_template_items_template ON workout_template_items (template_id, sort);

CREATE TABLE workout_programs (
  id TEXT PRIMARY KEY,                                   -- wpg_
  member_id TEXT NOT NULL REFERENCES users (id),
  coach_id TEXT NOT NULL REFERENCES users (id),
  programme_id TEXT REFERENCES programmes (id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 1,
  start_date TEXT,                                       -- YYYY-MM-DD (IST); sessions are dated from it
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX workout_programs_member ON workout_programs (member_id, status);
CREATE INDEX workout_programs_coach ON workout_programs (coach_id, status);

CREATE TABLE workout_program_versions (
  id TEXT PRIMARY KEY,                                   -- wpv_
  program_id TEXT NOT NULL REFERENCES workout_programs (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  structure TEXT NOT NULL DEFAULT '{"weeks":[]}' CHECK (json_valid(structure)),   -- {weeks: [{week, focus?, days: [{day, templateId}]}]}
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (program_id, version)
);

-- One session per programme, week and day: a revision regenerates the sessions still scheduled and keeps the ones the
-- member completed, completed in part or skipped (they stay on the version they were done under).
CREATE TABLE workout_sessions (
  id TEXT PRIMARY KEY,                                   -- wks_
  program_id TEXT NOT NULL REFERENCES workout_programs (id) ON DELETE CASCADE,
  program_version_id TEXT NOT NULL REFERENCES workout_program_versions (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES users (id),
  template_id TEXT REFERENCES workout_templates (id),
  title TEXT NOT NULL,
  week INTEGER NOT NULL CHECK (week >= 1),
  day INTEGER NOT NULL CHECK (day >= 1 AND day <= 7),
  scheduled_date TEXT NOT NULL,                          -- YYYY-MM-DD (IST)
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'partial', 'skipped')),
  completed_at TEXT,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR (duration_minutes >= 1 AND duration_minutes <= 600)),
  rpe INTEGER CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  member_note TEXT,
  skip_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (program_id, week, day)
);
CREATE INDEX workout_sessions_member ON workout_sessions (member_id, scheduled_date);
CREATE INDEX workout_sessions_program ON workout_sessions (program_id, status);

-- The template's exercises as they were when the version was published, so later library edits never change a
-- session the member has been given.
CREATE TABLE workout_session_items (
  id TEXT PRIMARY KEY,                                   -- wsi_
  session_id TEXT NOT NULL REFERENCES workout_sessions (id) ON DELETE CASCADE,
  exercise_id TEXT REFERENCES exercises (id),
  exercise_name TEXT NOT NULL,
  exercise_category TEXT NOT NULL DEFAULT '',
  exercise_instructions TEXT NOT NULL DEFAULT '',
  block TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  sets INTEGER NOT NULL DEFAULT 1 CHECK (sets >= 1),
  reps TEXT,
  duration_seconds INTEGER,
  rest_seconds INTEGER,
  load_note TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX workout_session_items_session ON workout_session_items (session_id, sort);

CREATE TABLE workout_set_logs (
  id TEXT PRIMARY KEY,                                   -- wsl_
  session_id TEXT NOT NULL REFERENCES workout_sessions (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES workout_session_items (id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL CHECK (set_number >= 1 AND set_number <= 50),
  reps_done INTEGER CHECK (reps_done IS NULL OR (reps_done >= 0 AND reps_done <= 1000)),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR (duration_seconds >= 0 AND duration_seconds <= 86400)),
  load_kg REAL CHECK (load_kg IS NULL OR (load_kg >= 0 AND load_kg <= 1000)),
  completed INTEGER NOT NULL DEFAULT 1 CHECK (completed IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (session_id, item_id, set_number)
);
