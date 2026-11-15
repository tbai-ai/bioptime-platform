-- M8 Live sessions, webinars and consultation follow-through (api/modules/sessions.ts).
-- Depends only on 0001 (users, appointments, audit_events) and 0008 (feature_flags).
--
-- Group classes, webinars and workshops are live_sessions; people sign up through session_registrations (a member, or
-- a visitor to a public webinar who gives a name and an email). A full session puts new sign-ups on a waitlist, and a
-- cancellation promotes the person who has waited longest.
--
-- Meeting details: no video provider is chosen (MEETING_PROVIDER accepts only "none"), so nothing creates a meeting.
-- join_url is whatever the host typed (https only, checked by the API), or nothing; members are then told that their
-- coach will share how to join. Consultation summaries and follow-ups reuse coach_notes (ref_type 'appointment') and
-- support_tasks (kind 'coach_follow_up', ref_type 'appointment'), so they need no table here.

-- The module's public part has its own switch beside the module flag (sessions), which it needs as well. It starts off
-- in every mode: listing sessions to signed-out visitors is the owner's decision (/admin/modules).
INSERT OR IGNORE INTO feature_flags (key, enabled, audience, description, updated_at) VALUES
  ('public_webinars', 0, '{}', 'M8 part: public webinar listing and registration (GET /public/webinars); needs the sessions flag too', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE live_sessions (
  id TEXT PRIMARY KEY,                                   -- lvs_
  kind TEXT NOT NULL CHECK (kind IN ('group_class', 'webinar', 'workshop')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  host_id TEXT NOT NULL REFERENCES users (id),           -- a coach or an administrator
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 1),   -- NULL: no limit
  audience TEXT NOT NULL DEFAULT 'members' CHECK (audience IN ('members', 'packages', 'public')),
  package_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(package_ids)),   -- audience 'packages' only
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
  join_url TEXT,                                         -- typed by the host until a provider exists; never invented
  meeting_provider TEXT NOT NULL DEFAULT 'none',
  meeting_ref TEXT,
  cancelled_reason TEXT,
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),   -- demo rows, labelled "Sample" wherever they appear
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  cancelled_at TEXT,
  completed_at TEXT,
  CHECK (end_at > start_at)
);
CREATE INDEX live_sessions_host ON live_sessions (host_id, start_at);
CREATE INDEX live_sessions_listing ON live_sessions (status, start_at);

-- One row per person and session. user_id is set for members; name and email for a visitor's public registration
-- (email stays NULL for members: the account holds it). The waitlist is ordered by registered_at, which a new sign-up
-- after a cancellation resets. reminder_sent_at: when the session reminder was queued or logged.
CREATE TABLE session_registrations (
  id TEXT PRIMARY KEY,                                   -- lsr_
  session_id TEXT NOT NULL REFERENCES live_sessions (id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL CHECK (status IN ('registered', 'waitlisted', 'cancelled', 'attended', 'no_show')),
  registered_at TEXT NOT NULL,
  cancelled_at TEXT,
  promoted_at TEXT,
  attendance_at TEXT,
  reminder_sent_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, user_id),
  UNIQUE (session_id, email),
  CHECK (user_id IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX session_registrations_session ON session_registrations (session_id, status, registered_at);
CREATE INDEX session_registrations_user ON session_registrations (user_id, status);

-- The meeting-provider seam on consultations. A confirmed consultation used to get a placeholder link
-- (https://meet.bioptime.example/<id>) that never led to a meeting; those links are cleared, once, with one audit row.
ALTER TABLE appointments ADD COLUMN meeting_provider TEXT NOT NULL DEFAULT 'none';
ALTER TABLE appointments ADD COLUMN meeting_ref TEXT;

INSERT INTO audit_events (id, actor_id, actor_role, action, target_type, target_id, reason, ip, data, at)
SELECT 'aud_' || lower(hex(randomblob(7))), NULL, 'system', 'appointment.meeting_placeholder_cleared', 'appointment', NULL,
       'migration 0016_sessions: placeholder meeting links never led to a meeting', NULL, json_object('appointments', COUNT(*)),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM appointments WHERE meeting_link LIKE 'https://meet.bioptime.example/%' HAVING COUNT(*) > 0;
UPDATE appointments SET meeting_link = NULL WHERE meeting_link LIKE 'https://meet.bioptime.example/%';
