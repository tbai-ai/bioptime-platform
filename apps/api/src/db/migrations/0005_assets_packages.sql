-- Uploaded image assets for the website (administrators only), and package enrolment rules.

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  width INTEGER,
  height INTEGER,
  uploaded_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

-- Who may enrol, when a programme starts after payment, and how many days of grace a lapsed programme keeps.
ALTER TABLE package_versions ADD COLUMN eligibility TEXT NOT NULL DEFAULT 'public' CHECK (eligibility IN ('public','invite_only','existing_members'));
ALTER TABLE package_versions ADD COLUMN start_policy TEXT NOT NULL DEFAULT 'on_payment' CHECK (start_policy IN ('on_payment','on_first_consultation'));
ALTER TABLE package_versions ADD COLUMN grace_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_days >= 0 AND grace_days <= 90);
ALTER TABLE package_versions ADD COLUMN services TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(services));
