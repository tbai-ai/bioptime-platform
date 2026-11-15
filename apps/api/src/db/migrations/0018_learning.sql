-- M10 Learning: courses, their modules and lessons, enrolments and per-learner lesson progress.
-- Depends only on 0001 to 0008.
--
-- Who may take a course is its audience: every member, members with an active programme of one of the listed packages
-- (access by package entitlement), only members a coach assigned it to, or coaches (coach training). Courses and
-- lessons are written by administrators holding learning.manage; members see published lessons of published courses
-- only. A course is published only with at least one published lesson; a video lesson is published only once a video
-- hosting provider is configured (VIDEO_PROVIDER accepts only "none" today), so video_provider and video_ref stay empty.
--
-- Nothing is invented: course and lesson text comes from Bioptime's professionals. Demo rows carry sample = 1 and say
-- "Sample" in their titles. No accreditation, certificates or CPD.

CREATE TABLE courses (
  id TEXT PRIMARY KEY,                                   -- crs_
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  cover_asset_id TEXT REFERENCES assets (id),            -- a website image (public), optional
  audience TEXT NOT NULL DEFAULT 'all_members' CHECK (audience IN ('all_members', 'packages', 'assigned_only', 'coaches')),
  package_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(package_ids)),   -- packages.id list, for audience 'packages'
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),   -- demo rows, labelled "Sample" wherever they appear
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  archived_at TEXT
);
CREATE INDEX courses_status ON courses (status, audience);

CREATE TABLE course_modules (
  id TEXT PRIMARY KEY,                                   -- cmd_
  course_id TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX course_modules_course ON course_modules (course_id, sort);

CREATE TABLE lessons (
  id TEXT PRIMARY KEY,                                   -- lsn_
  module_id TEXT NOT NULL REFERENCES course_modules (id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'written' CHECK (kind IN ('written', 'video', 'checklist')),
  body TEXT NOT NULL DEFAULT '',                         -- rich text kept to the CMS allowlist (sanitizeRichText)
  video_provider TEXT,                                   -- set only once a video host is configured
  video_ref TEXT,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR (duration_minutes >= 1 AND duration_minutes <= 600)),
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX lessons_module ON lessons (module_id, sort);

-- member_id is the learner: a member, or a coach for a course with the audience 'coaches'.
CREATE TABLE course_enrollments (
  id TEXT PRIMARY KEY,                                   -- cen_
  course_id TEXT NOT NULL REFERENCES courses (id),
  member_id TEXT NOT NULL REFERENCES users (id),
  source TEXT NOT NULL CHECK (source IN ('self', 'coach_assigned', 'package')),
  assigned_by TEXT REFERENCES users (id),
  assigned_note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'withdrawn')),
  enrolled_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (course_id, member_id)
);
CREATE INDEX course_enrollments_member ON course_enrollments (member_id, status);
CREATE INDEX course_enrollments_course ON course_enrollments (course_id, status);

CREATE TABLE lesson_progress (
  enrollment_id TEXT NOT NULL REFERENCES course_enrollments (id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons (id),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (enrollment_id, lesson_id)
);
CREATE INDEX lesson_progress_lesson ON lesson_progress (lesson_id);
