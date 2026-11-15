-- Internal coach notes about a client: visible to the coach and administrators, never to the member.
CREATE TABLE coach_notes (
  id TEXT PRIMARY KEY,
  coach_id TEXT NOT NULL REFERENCES users (id),
  member_id TEXT NOT NULL REFERENCES users (id),
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','review','consultation')),
  body TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX coach_notes_member ON coach_notes (member_id, created_at);
