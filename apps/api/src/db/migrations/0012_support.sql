-- M4 Support requests, help centre, data export, imports and coach onboarding (api/modules/support.ts).
-- Depends only on 0001 (users, file_metadata) and 0008 (the SUP reference sequence, progress_entries.source = 'import').
-- Data exports fill the existing data_requests.file_id; the coach onboarding checklist is computed and has no table.

-- The module's parts have their own switches, managed on /admin/modules beside the module flag (support), which every
-- part needs as well. They start as the module flag stands when this migration runs (off in production; on in a demo
-- seeded after the foundation), so applying the migration changes nothing anyone can see.
INSERT OR IGNORE INTO feature_flags (key, enabled, audience, description, updated_at) VALUES
  ('support_requests', COALESCE((SELECT enabled FROM feature_flags WHERE key = 'support'), 0), '{}', 'M4 part: support requests (two-way threads with the Bioptime team)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('help_centre', COALESCE((SELECT enabled FROM feature_flags WHERE key = 'support'), 0), '{}', 'M4 part: help centre articles in the portal and the app', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('imports', COALESCE((SELECT enabled FROM feature_flags WHERE key = 'support'), 0), '{}', 'M4 part: bulk imports of members and historical progress (administrators with imports.manage)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Support requests: a two-way thread between a member or coach (the requester) and the Bioptime team. Staff notes
-- (internal = 1) never reach the requester. reference is SUP-1001 … from the SUP sequence (demo rows: SUP-DEMO-n).
CREATE TABLE support_requests (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  requester_id TEXT NOT NULL REFERENCES users (id),
  requester_role TEXT NOT NULL CHECK (requester_role IN ('member','coach','admin','owner')),
  category TEXT NOT NULL CHECK (category IN ('account','billing','bloodwork','app','coaching','privacy','other')),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting_on_requester','resolved','closed')),
  assigned_to TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT,
  resolved_at TEXT
);
CREATE INDEX support_requests_requester ON support_requests (requester_id, updated_at);
CREATE INDEX support_requests_status ON support_requests (status, updated_at);

CREATE TABLE support_messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES support_requests (id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users (id),
  body TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1)),
  file_id TEXT REFERENCES file_metadata (id),
  created_at TEXT NOT NULL
);
CREATE INDEX support_messages_request ON support_messages (request_id, created_at);

-- Help centre articles for the portal and the app. body is rich text sanitised on save (the CMS allowlist); audience
-- member, coach or all. Bioptime writes the content: nothing clinical, no service levels, no legal text is seeded.
CREATE TABLE help_articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL CHECK (audience IN ('member','coach','all')),
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  sort INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id),
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX help_articles_listing ON help_articles (status, audience, sort);

-- Bulk imports (members, historical progress). A CSV is staged and validated in a dry run (nothing outside these two
-- tables is written); applying creates the records once; invitations go out only when an administrator sends them.
-- file_id stays NULL: the private file store accepts only content-sniffed types (PNG, JPEG, WebP, PDF), so the CSV's
-- name and SHA-256 are kept instead, and every row is kept here with its errors and outcome.
CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('members','progress_history')),
  status TEXT NOT NULL CHECK (status IN ('uploaded','validated','applied','failed','cancelled')),
  file_id TEXT REFERENCES file_metadata (id),
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  applied_count INTEGER NOT NULL DEFAULT 0,
  invited_count INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(errors)),
  created_by TEXT NOT NULL REFERENCES users (id),
  applied_by TEXT REFERENCES users (id),
  invited_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  validated_at TEXT,
  applied_at TEXT,
  invited_at TEXT
);
CREATE INDEX import_jobs_created ON import_jobs (created_at);

CREATE TABLE import_rows (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES import_jobs (id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  errors TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(errors)),
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','valid','invalid','created','skipped','invited')),
  created_record_id TEXT,
  UNIQUE (job_id, row_no)
);
CREATE INDEX import_rows_job ON import_rows (job_id, outcome);
