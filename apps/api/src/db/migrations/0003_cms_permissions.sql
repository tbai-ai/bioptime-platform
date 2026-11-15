-- Website content management, theme tokens, granular administrator permissions, coupons, package visibility,
-- and an append-only audit log.

CREATE TABLE content_blocks (
  key TEXT PRIMARY KEY,
  draft TEXT,                       -- JSON value waiting to be published (NULL = no draft)
  published TEXT,                   -- JSON value the public website shows (NULL = the built-in default)
  draft_updated_at TEXT,
  draft_updated_by TEXT,
  published_at TEXT,
  published_by TEXT
);

CREATE TABLE user_permissions (
  user_id TEXT NOT NULL REFERENCES users (id),
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('percent','amount')),
  value INTEGER NOT NULL,            -- percent (1-100) or paise
  max_uses INTEGER,                  -- NULL = unlimited
  used INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT,
  valid_to TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE orders ADD COLUMN coupon_id TEXT REFERENCES coupons (id);
ALTER TABLE orders ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0;

ALTER TABLE packages ADD COLUMN promo_label TEXT;
ALTER TABLE packages ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;

-- The audit log can be appended to and read, never rewritten or thinned through the application connection.
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
