-- The member assistant behind an off switch (30 October 2026; api/domain/assistant.ts). Additive only; depends on 0001
-- (users, settings) and 0008 (member_consents as rebuilt there).
--
-- The assistant answers a member's questions through the AI provider seam (api/adapters/ai.ts). It stays off: the
-- switch below starts off, AI_PROVIDER accepts only "none", and no key is held anywhere, so nothing is ever generated
-- or sent. It is "on" for a member only when the switch is on, a provider that answers members is configured, the 'ai'
-- module is on for them and they gave the assistant_processing consent under the current wording.

-- member_consents gains the kind assistant_processing (recorded only through POST /me/assistant/consent, never through
-- POST /me/consents). SQLite cannot change a CHECK list in place, so the table is rebuilt as 0008 did: no foreign key
-- points at it, every row is copied as it is, rowids included (the latest consent of a kind is read by time, then by
-- rowid), and its index is made again.
CREATE TABLE member_consents_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('terms','privacy','health_data','coach_sharing','lab_consent','marketing','push','progress_photos','ai_processing','community','assistant_processing')),
  version TEXT NOT NULL,
  granted INTEGER NOT NULL,
  ip TEXT,
  at TEXT NOT NULL
);
INSERT INTO member_consents_next (rowid, id, user_id, kind, version, granted, ip, at) SELECT rowid, id, user_id, kind, version, granted, ip, at FROM member_consents ORDER BY rowid;
DROP TABLE member_consents;
ALTER TABLE member_consents_next RENAME TO member_consents;
CREATE INDEX member_consents_user ON member_consents (user_id, kind, at);

-- The member's conversation with the assistant: their messages and its answers, nothing else. model and prompt_version
-- say what wrote an answer (null on the member's own messages). Withdrawing the consent deletes the member's rows.
CREATE TABLE assistant_messages (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('member', 'assistant')),
  body TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX assistant_messages_member ON assistant_messages (member_id, created_at);

-- The switch (PUT /admin/assistant, settings.manage): "off" until an administrator turns it on. Anything but "on" is off.
INSERT INTO settings (key, value, updated_at, updated_by)
  SELECT 'member_assistant', '"off"', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
  WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'member_assistant');
