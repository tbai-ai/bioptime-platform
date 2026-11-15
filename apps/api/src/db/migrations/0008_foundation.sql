-- Foundation (M0): the module registry's feature flags, the reminder queue, push devices, quiet hours, references on
-- private files, the consent-kind and progress-source rebuilds, and the SUP and CRN reference sequences.
-- Module migrations 0009 to 0020 are reserved in api/modules/index.ts and may depend only on 0001 to 0008.

-- Feature flags. A module's routes answer FEATURE_DISABLED while its flag is off. audience narrows an enabled flag:
-- {"roles": ["member", ...]} and/or {"packageIds": ["pkg_..."]} (members with an active programme of one of them).
CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  audience TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(audience)),
  description TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- The switches stored in settings.features, where present (bespoke and self booking default on, progress photos off).
-- They keep their values; nothing reads them yet. settings.features.messaging is not copied: the key "messaging" now
-- names the M9 module (attachments and announcements), which starts off like every module. Coach and member
-- conversations are core and stay outside any flag.
INSERT INTO feature_flags (key, enabled, audience, description, updated_at) VALUES
  ('bespoke', COALESCE((SELECT json_extract(value, '$.bespoke') FROM settings WHERE key = 'features' AND json_type(value, '$.bespoke') IN ('true', 'false')), 1), '{}', 'Bespoke plan requests (stored switch from settings.features; no route reads it yet)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('selfBooking', COALESCE((SELECT json_extract(value, '$.selfBooking') FROM settings WHERE key = 'features' AND json_type(value, '$.selfBooking') IN ('true', 'false')), 1), '{}', 'Members book consultations and tests themselves (stored switch from settings.features; no route reads it yet)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('progressPhotos', COALESCE((SELECT json_extract(value, '$.progressPhotos') FROM settings WHERE key = 'features' AND json_type(value, '$.progressPhotos') IN ('true', 'false')), 0), '{}', 'Progress photos (stored switch from settings.features; no route reads it yet)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- One flag per module, off. Production keeps them off until an administrator enables them (/admin/modules); the demo
-- seed switches them on in demo mode.
INSERT INTO feature_flags (key, enabled, audience, description, updated_at) VALUES
  ('habits', 0, '{}', 'M1 Habits and reminders', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('progress', 0, '{}', 'M2 Progress: goals, check-ins, photos, range charts and adherence', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('billing', 0, '{}', 'M3 Billing documents and refund requests', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('support', 0, '{}', 'M4 Support requests, help centre, data export, imports and coach onboarding', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('nutrition', 0, '{}', 'M5 Nutrition', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('workouts', 0, '{}', 'M6 Workouts', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('labFollowups', 0, '{}', 'M7 Lab follow-ups and preparation reminders', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('sessions', 0, '{}', 'M8 Live sessions, webinars and consultation follow-through', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('messaging', 0, '{}', 'M9 Message attachments and announcements (coach and member conversations are not behind a flag)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('learning', 0, '{}', 'M10 Learning', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ai', 0, '{}', 'M11 Coach AI drafting (provider none until one is chosen)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('labstackOps', 0, '{}', 'LabStack operations (administration stays under /admin/integrations/labstack behind labstack.manage)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- The reminder queue. Modules schedule rows; the reminders job sends the due ones through notify(), honouring the
-- reminders preference and quiet hours. One row per person, record and due time.
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  due_at TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channels TEXT NOT NULL DEFAULT '["in_app","push"]' CHECK (json_valid(channels)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'skipped', 'cancelled')),
  notification_id TEXT REFERENCES notifications (id) ON DELETE SET NULL,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, ref_type, ref_id, due_at)
);
CREATE INDEX reminders_due ON reminders (status, due_at);

-- Devices registered for push. Tokens are stored; delivery stays logged in the outbox until a push provider exists.
CREATE TABLE push_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  token TEXT NOT NULL UNIQUE,
  app_version TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX push_devices_user ON push_devices (user_id, revoked_at);

-- Quiet hours, in minutes after local midnight (the person's timezone); both null means none.
ALTER TABLE notification_preferences ADD COLUMN quiet_start_minute INTEGER CHECK (quiet_start_minute IS NULL OR (quiet_start_minute >= 0 AND quiet_start_minute < 1440));
ALTER TABLE notification_preferences ADD COLUMN quiet_end_minute INTEGER CHECK (quiet_end_minute IS NULL OR (quiet_end_minute >= 0 AND quiet_end_minute < 1440));

-- Private files: the content hash and the record a file belongs to.
ALTER TABLE file_metadata ADD COLUMN sha256 TEXT;
ALTER TABLE file_metadata ADD COLUMN ref_type TEXT;
ALTER TABLE file_metadata ADD COLUMN ref_id TEXT;
CREATE INDEX file_metadata_ref ON file_metadata (ref_type, ref_id);

-- member_consents gains the kinds progress_photos, ai_processing and community (reserved: their wording needs counsel
-- before any screen records them). SQLite cannot change a CHECK list in place, so the table is rebuilt; no foreign key
-- points at it. Every row is copied as it is.
CREATE TABLE member_consents_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('terms','privacy','health_data','coach_sharing','lab_consent','marketing','push','progress_photos','ai_processing','community')),
  version TEXT NOT NULL,
  granted INTEGER NOT NULL,
  ip TEXT,
  at TEXT NOT NULL
);
INSERT INTO member_consents_next (id, user_id, kind, version, granted, ip, at) SELECT id, user_id, kind, version, granted, ip, at FROM member_consents;
DROP TABLE member_consents;
ALTER TABLE member_consents_next RENAME TO member_consents;
CREATE INDEX member_consents_user ON member_consents (user_id, kind, at);

-- progress_entries gains the source import (migrated history, labelled "Imported"). Rebuilt the same way; no foreign
-- key points at it.
CREATE TABLE progress_entries_next (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('member','coach','device','import')),
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO progress_entries_next (id, member_id, metric, value, unit, at, source, note, created_by, created_at) SELECT id, member_id, metric, value, unit, at, source, note, created_by, created_at FROM progress_entries;
DROP TABLE progress_entries;
ALTER TABLE progress_entries_next RENAME TO progress_entries;
CREATE INDEX progress_member_metric ON progress_entries (member_id, metric, at);

-- Reference sequences for support requests (SUP-1001 …) and credit notes (CRN-1001 …).
INSERT OR IGNORE INTO sequences (name, value) VALUES ('SUP', 1000), ('CRN', 1000);
