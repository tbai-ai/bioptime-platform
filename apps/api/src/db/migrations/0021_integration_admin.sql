-- Round 6 (integration, admin): the administrator's note on a data request, kept apart from the member's own words.
--
-- Before this, PATCH /admin/data-requests/:id wrote the administrator's note over data_requests.note (the note the
-- member typed when asking for an export or deletion). The member's note now stays as written, and the team's note is
-- kept here, one per request (the latest; every change is also in the audit log with the note as its reason).
--
-- It is a table of its own, not a column on data_requests, so that no existing `SELECT * FROM data_requests` that answers
-- a member (POST /me/data-requests returns the open request as stored) can ever carry it. Only the administrator routes
-- (GET /admin/data-requests, GET /admin/members/:id, PATCH /admin/data-requests/:id, all members.manage) join it, and
-- they return it as adminNote. The member's data export never includes it. Additive only: nothing existing changes.
CREATE TABLE data_request_admin_notes (
  request_id TEXT PRIMARY KEY REFERENCES data_requests (id) ON DELETE CASCADE,
  admin_note TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
