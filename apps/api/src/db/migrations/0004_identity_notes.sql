-- Stable human-readable identifiers for coaches and members, a coach's professional designation, and note visibility.

-- One row per code family; the next value is taken inside the creating transaction.
CREATE TABLE id_sequences (
  name TEXT PRIMARY KEY,
  next INTEGER NOT NULL
);

ALTER TABLE coach_profiles ADD COLUMN coach_code TEXT;
ALTER TABLE coach_profiles ADD COLUMN designation TEXT;
ALTER TABLE member_profiles ADD COLUMN member_code TEXT;

-- Existing rows get codes in creation order; the sequences continue after them.
UPDATE coach_profiles SET coach_code = 'BPC-' || printf('%04d', (SELECT COUNT(*) FROM coach_profiles c2 WHERE c2.created_at < coach_profiles.created_at OR (c2.created_at = coach_profiles.created_at AND c2.user_id <= coach_profiles.user_id))) WHERE coach_code IS NULL;
UPDATE member_profiles SET member_code = 'BPM-' || printf('%05d', (SELECT COUNT(*) FROM member_profiles m2 WHERE m2.created_at < member_profiles.created_at OR (m2.created_at = member_profiles.created_at AND m2.user_id <= member_profiles.user_id))) WHERE member_code IS NULL;
INSERT INTO id_sequences (name, next) VALUES ('coach', (SELECT COUNT(*) + 1 FROM coach_profiles)), ('member', (SELECT COUNT(*) + 1 FROM member_profiles));
CREATE UNIQUE INDEX coach_profiles_code ON coach_profiles (coach_code);
CREATE UNIQUE INDEX member_profiles_code ON member_profiles (member_code);

-- Notes carry who may read them: private (the coaching team and administrators), client (shown to the member as a
-- recommendation), admin (administrative notes: administrators and the assigned coach). Laboratory data is never a note.
ALTER TABLE coach_notes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','client','admin'));
ALTER TABLE coach_notes ADD COLUMN author_role TEXT NOT NULL DEFAULT 'coach' CHECK (author_role IN ('coach','admin','owner'));
