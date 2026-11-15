-- Growth (api/modules/growth.ts): discovery calls for prospects, newsletter subscribers with double opt-in, corporate
-- enquiries, and the team's notes on them. Additive only; depends on 0001 (users, sequences, audit_events) and 0031 (the
-- growth switch). The package finder, the health calculators and the webinars page store nothing of their own: the
-- finder reads the public catalogue, the calculators run in the visitor's browser, the webinars page uses the sessions
-- module's public routes.
--
-- Nobody here has an account: a prospect, a subscriber or a company contact is a row with an email address, never a
-- user, so public sign-up can never create an account or a staff role. Emails to them are recorded in the outbox like
-- every other email.

-- Human references: DC-1001 for a discovery call, CE-1001 for a corporate enquiry (quoted in the confirmation email).
INSERT OR IGNORE INTO sequences (name, value) VALUES ('DC', 1000), ('CE', 1000);

-- Times the team offers for a short call. A visitor may name up to three as preferences; choosing one books nothing.
CREATE TABLE growth_call_slots (
  id TEXT PRIMARY KEY,                                   -- gcs_
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'withdrawn')),
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  withdrawn_at TEXT
);
CREATE INDEX growth_call_slots_start ON growth_call_slots (status, start_at);

-- A prospect's request for a short call. phone is optional; preferred_slot_ids holds slot ids, preferred_windows the
-- visitor's own words. assigned_to is a team member (holding growth.manage) or a coach; a coach is never sent the
-- email address or the phone number.
CREATE TABLE growth_discovery_calls (
  id TEXT PRIMARY KEY,                                   -- gdc_
  reference TEXT NOT NULL UNIQUE,                        -- DC-1001
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  goals TEXT NOT NULL,
  preferred_slot_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(preferred_slot_ids)),
  preferred_windows TEXT,
  interests TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(interests)),   -- package slugs the package finder suggested
  source TEXT NOT NULL DEFAULT 'website',
  consent_version TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'booked', 'closed')),
  assigned_to TEXT REFERENCES users (id),
  booked_at TEXT,                                        -- the time the team agreed with the person, once booked
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX growth_discovery_calls_status ON growth_discovery_calls (status, created_at);
CREATE INDEX growth_discovery_calls_email ON growth_discovery_calls (email, created_at);
CREATE INDEX growth_discovery_calls_assignee ON growth_discovery_calls (assigned_to, status);

-- A company's enquiry about Bioptime for its team.
CREATE TABLE growth_corporate_enquiries (
  id TEXT PRIMARY KEY,                                   -- gce_
  reference TEXT NOT NULL UNIQUE,                        -- CE-1001
  company TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  team_size TEXT NOT NULL CHECK (team_size IN ('1-10', '11-50', '51-200', '201-1000', '1000+')),
  interests TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(interests)),
  message TEXT,
  consent_version TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'in_discussion', 'closed')),
  assigned_to TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX growth_corporate_enquiries_status ON growth_corporate_enquiries (status, created_at);
CREATE INDEX growth_corporate_enquiries_email ON growth_corporate_enquiries (email, created_at);

-- Newsletter subscribers. A sign-up is pending until the person opens the confirmation link (double opt-in); only the
-- token's hash is stored, with its expiry. The unsubscribe link is signed (TOKEN_SECRET), so it needs no column.
CREATE TABLE growth_newsletter_subscribers (
  id TEXT PRIMARY KEY,                                   -- gns_
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  consent_version TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'website',
  confirm_token_hash TEXT UNIQUE,
  confirm_expires_at TEXT,
  requested_at TEXT NOT NULL,                            -- the latest sign-up (and confirmation email)
  confirmed_at TEXT,
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX growth_newsletter_status ON growth_newsletter_subscribers (status, requested_at);

-- The team's notes on a discovery call or a corporate enquiry. Team-only: never sent to the person or to a coach.
CREATE TABLE growth_notes (
  id TEXT PRIMARY KEY,                                   -- gnt_
  ref_type TEXT NOT NULL CHECK (ref_type IN ('discovery_call', 'corporate_enquiry')),
  ref_id TEXT NOT NULL,
  author_id TEXT REFERENCES users (id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX growth_notes_ref ON growth_notes (ref_type, ref_id, created_at);
