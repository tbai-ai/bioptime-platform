-- M9 Message attachments and announcements (feature flag 'messaging', seeded off by 0008_foundation.sql).
-- References only tables from 0001 to 0008: users, conversations, messages, file_metadata.

-- Files added to a member and coach conversation. The bytes are a private file (file_metadata, kind
-- 'message_attachment', stored outside every static mount); the type is read from the magic bytes (PNG, JPEG, WebP or
-- PDF) and the size is capped at 5 MB. message_id stays NULL while the file waits in the sender's composer and is set
-- when the message is sent; an unsent file is discarded by the sender or by the clean-up job (deleted_at).
CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES messages (id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES file_metadata (id),
  name TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 5242880),
  sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX message_attachments_message ON message_attachments (message_id);
CREATE INDEX message_attachments_conversation ON message_attachments (conversation_id, created_at);
CREATE INDEX message_attachments_pending ON message_attachments (uploaded_by, message_id, deleted_at);
CREATE UNIQUE INDEX message_attachments_file ON message_attachments (file_id);

-- Announcements to members: from the team (announcements.manage) or from a coach to their own assigned clients.
-- body is plain text, sanitised on save (tags and control characters removed). audience is
-- {"roles": ["member"], "packageIds"?: [...], "coachId"?: "usr_..."}: members only; packageIds narrows to members with an
-- active or paused programme of one of those packages; coachId to the members that coach is currently assigned to (a
-- coach's announcement always carries its own id). Who sees one is decided when they read, so a withdrawn announcement
-- disappears at once.
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  audience TEXT NOT NULL DEFAULT '{"roles":["member"]}' CHECK (json_valid(audience)),
  origin TEXT NOT NULL CHECK (origin IN ('team', 'coach')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'withdrawn')),
  publish_at TEXT,
  created_by TEXT NOT NULL REFERENCES users (id),
  published_by TEXT REFERENCES users (id),
  published_at TEXT,
  withdrawn_by TEXT REFERENCES users (id),
  withdrawn_at TEXT,
  withdraw_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status != 'scheduled' OR publish_at IS NOT NULL),
  CHECK (status != 'published' OR published_at IS NOT NULL)
);
CREATE INDEX announcements_status ON announcements (status, publish_at);
CREATE INDEX announcements_creator ON announcements (created_by, created_at);

-- Who has read which announcement.
CREATE TABLE announcement_reads (
  announcement_id TEXT NOT NULL REFERENCES announcements (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX announcement_reads_user ON announcement_reads (user_id);
