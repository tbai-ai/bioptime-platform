-- Bioptime platform · schema 0001 · SQLite dialect kept close to PostgreSQL (TEXT ids, ISO 8601 UTC timestamps, INTEGER
-- booleans, money in paise, JSON as TEXT with json_valid checks). Every business-critical record lives here once.

-- identity ---------------------------------------------------------------------------------------------------------
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('member','coach','admin','owner')),
  state TEXT NOT NULL CHECK (state IN ('invited','pending_verification','onboarding','active','suspended','deactivated','deletion_requested','closed')),
  name TEXT NOT NULL DEFAULT '',
  email_verified_at TEXT,
  phone_verified_at TEXT,
  mfa_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX users_role_state ON users (role, state);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('web','mobile')),
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX sessions_user ON sessions (user_id, revoked_at);

CREATE TABLE auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('email_verify','password_reset','phone_verify','coach_invite')),
  token_hash TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX auth_tokens_user_kind ON auth_tokens (user_id, kind);

CREATE TABLE member_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  gender TEXT,
  date_of_birth TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  address TEXT,
  goals TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(goals)),
  preferences TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(preferences)),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  onboarding_step TEXT NOT NULL DEFAULT 'profile',
  onboarding_completed_at TEXT,
  wellness_score INTEGER,
  wellness_score_label TEXT NOT NULL DEFAULT 'sample',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE onboarding_progress (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  updated_at TEXT NOT NULL
);

CREATE TABLE member_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('terms','privacy','health_data','coach_sharing','lab_consent','marketing','push')),
  version TEXT NOT NULL,
  granted INTEGER NOT NULL,
  ip TEXT,
  at TEXT NOT NULL
);
CREATE INDEX member_consents_user ON member_consents (user_id, kind, at);

CREATE TABLE coach_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  expertise TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(expertise)),
  languages TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(languages)),
  qualifications TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(qualifications)),
  scope TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope)),
  city TEXT,
  bio TEXT,
  caseload_limit INTEGER NOT NULL DEFAULT 20,
  available INTEGER NOT NULL DEFAULT 1,
  unavailable_until TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  activated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE coach_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES users (id),
  token_hash TEXT NOT NULL UNIQUE,
  profile_seed TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(profile_seed)),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

-- catalogue ----------------------------------------------------------------------------------------------------------
CREATE TABLE packages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('package','programme','bespoke')),
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE package_versions (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES packages (id),
  version INTEGER NOT NULL,
  duration_months INTEGER,
  duration_label TEXT NOT NULL,
  consultations INTEGER NOT NULL DEFAULT 0,
  bloodwork_entitlements INTEGER NOT NULL DEFAULT 0,
  entitlement_unit TEXT NOT NULL DEFAULT 'collection',
  price_paise INTEGER,
  currency TEXT NOT NULL DEFAULT 'INR',
  coaching TEXT NOT NULL DEFAULT 'standard' CHECK (coaching IN ('standard','none','as_agreed')),
  level TEXT,
  includes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(includes)),
  for_sale INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (package_id, version)
);

-- commerce -----------------------------------------------------------------------------------------------------------
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL REFERENCES users (id),
  package_version_id TEXT REFERENCES package_versions (id),
  custom_plan_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','pending_payment','paid','activated','failed','cancelled','refund_pending','refunded')),
  amount_paise INTEGER NOT NULL DEFAULT 0,
  gst_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  idempotency_key TEXT UNIQUE,
  failure_reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  paid_at TEXT,
  activated_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX orders_member ON orders (member_id, created_at);
CREATE INDEX orders_status ON orders (status);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  provider TEXT NOT NULL,
  provider_ref TEXT,
  checkout_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('created','authorised','captured','failed','refunded')),
  amount_paise INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  signature_verified INTEGER NOT NULL DEFAULT 0,
  event_id TEXT UNIQUE,
  raw TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(raw)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments (id),
  order_id TEXT NOT NULL REFERENCES orders (id),
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','processing','completed','failed')),
  reason TEXT NOT NULL,
  provider_ref TEXT,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE programmes (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  order_id TEXT REFERENCES orders (id),
  package_version_id TEXT REFERENCES package_versions (id),
  custom_plan_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','paused','ended','cancelled')),
  start_at TEXT NOT NULL,
  end_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX programmes_member ON programmes (member_id, status);

CREATE TABLE entitlements (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  order_id TEXT REFERENCES orders (id),
  programme_id TEXT REFERENCES programmes (id),
  package_version_id TEXT REFERENCES package_versions (id),
  service_type TEXT NOT NULL CHECK (service_type IN ('bloodwork','consultation')),
  unit TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  used_qty INTEGER NOT NULL DEFAULT 0,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('available','exhausted','expired','cancelled')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (used_qty + reserved_qty <= quantity)
);
CREATE INDEX entitlements_member ON entitlements (member_id, service_type, status);

CREATE TABLE entitlement_transactions (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES entitlements (id),
  kind TEXT NOT NULL CHECK (kind IN ('grant','reserve','consume','release','expire','cancel','adjust')),
  quantity INTEGER NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  idempotency_key TEXT UNIQUE,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX entitlement_tx_ref ON entitlement_transactions (ref_type, ref_id);

-- assignment ---------------------------------------------------------------------------------------------------------
CREATE TABLE assignment_requests (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  programme_id TEXT REFERENCES programmes (id),
  order_id TEXT REFERENCES orders (id),
  status TEXT NOT NULL CHECK (status IN ('open','assigned','exception','cancelled')),
  policy TEXT NOT NULL,
  recommendation TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recommendation)),
  reason TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX assignment_requests_status ON assignment_requests (status);

CREATE TABLE coach_assignments (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  coach_id TEXT REFERENCES users (id),
  programme_id TEXT REFERENCES programmes (id),
  request_id TEXT REFERENCES assignment_requests (id),
  status TEXT NOT NULL CHECK (status IN ('pending','active','paused','ended')),
  method TEXT NOT NULL CHECK (method IN ('rule','manual','override')),
  reason TEXT NOT NULL DEFAULT '',
  effective_at TEXT,
  ended_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX coach_assignments_coach ON coach_assignments (coach_id, status);
CREATE INDEX coach_assignments_member ON coach_assignments (member_id, status);

-- appointments -------------------------------------------------------------------------------------------------------
CREATE TABLE availability_rules (
  id TEXT PRIMARY KEY,
  coach_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  active INTEGER NOT NULL DEFAULT 1,
  CHECK (end_minute > start_minute)
);
CREATE INDEX availability_rules_coach ON availability_rules (coach_id, weekday);

CREATE TABLE availability_blocks (
  id TEXT PRIMARY KEY,
  coach_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  coach_id TEXT REFERENCES users (id),
  programme_id TEXT REFERENCES programmes (id),
  kind TEXT NOT NULL CHECK (kind IN ('consultation','check_in','review')),
  status TEXT NOT NULL CHECK (status IN ('requested','scheduled','completed','cancelled','no_show')),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  meeting_link TEXT,
  note TEXT,
  member_note TEXT,
  entitlement_tx_id TEXT REFERENCES entitlement_transactions (id),
  cancelled_reason TEXT,
  reminder_sent_at TEXT,
  idempotency_key TEXT UNIQUE,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX appointments_coach_time ON appointments (coach_id, start_at);
CREATE INDEX appointments_member_time ON appointments (member_id, start_at);

-- coaching plans and progress ----------------------------------------------------------------------------------------
CREATE TABLE coaching_plans (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  coach_id TEXT NOT NULL REFERENCES users (id),
  programme_id TEXT REFERENCES programmes (id),
  title TEXT NOT NULL,
  goals TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(goals)),
  status TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX coaching_plans_member ON coaching_plans (member_id, status);

CREATE TABLE coaching_plan_versions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES coaching_plans (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  structure TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(structure)),
  status TEXT NOT NULL CHECK (status IN ('draft','published')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (plan_id, version)
);

CREATE TABLE plan_tasks (
  id TEXT PRIMARY KEY,
  plan_version_id TEXT NOT NULL REFERENCES coaching_plan_versions (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'habit',
  week INTEGER,
  day INTEGER,
  due_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','done','skipped')) DEFAULT 'pending',
  completed_at TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX plan_tasks_member ON plan_tasks (member_id, status, due_at);

CREATE TABLE progress_entries (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('member','coach','device')),
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX progress_member_metric ON progress_entries (member_id, metric, at);

CREATE TABLE metric_config (
  metric TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  unit TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_value REAL,
  max_value REAL,
  sort INTEGER NOT NULL DEFAULT 0
);

-- bloodwork ----------------------------------------------------------------------------------------------------------
CREATE TABLE bloodwork_tests (
  id TEXT PRIMARY KEY,
  vendor_test_id TEXT,
  kind TEXT NOT NULL DEFAULT 'test' CHECK (kind IN ('test','package')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_paise INTEGER,
  fasting_hours INTEGER NOT NULL DEFAULT 0,
  turnaround TEXT NOT NULL DEFAULT '',
  markers INTEGER,
  preparation TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE bloodwork_bookings (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL REFERENCES users (id),
  programme_id TEXT REFERENCES programmes (id),
  test_id TEXT NOT NULL REFERENCES bloodwork_tests (id),
  status TEXT NOT NULL CHECK (status IN ('confirmed','scheduled','sample_collected','processing','results_ready','completed','cancelled')),
  slot_at TEXT NOT NULL,
  lab_id TEXT,
  vendor TEXT NOT NULL DEFAULT 'labstack',
  vendor_order_id TEXT,
  vendor_status TEXT,
  vendor_pending INTEGER NOT NULL DEFAULT 0,
  patient TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(patient)),
  pincode TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  flag TEXT,
  entitlement_id TEXT REFERENCES entitlements (id),
  entitlement_tx_id TEXT REFERENCES entitlement_transactions (id),
  payment_order_id TEXT REFERENCES orders (id),
  expected_report_by TEXT,
  last_vendor_event_at TEXT,
  cancelled_reason TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX bookings_member ON bloodwork_bookings (member_id, created_at);
CREATE INDEX bookings_status ON bloodwork_bookings (status);
CREATE INDEX bookings_vendor_order ON bloodwork_bookings (vendor_order_id);

CREATE TABLE booking_events (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bloodwork_bookings (id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  vendor_status TEXT,
  source TEXT NOT NULL CHECK (source IN ('vendor','member','coach','admin','system')),
  actor_id TEXT,
  note TEXT
);
CREATE INDEX booking_events_booking ON booking_events (booking_id, at);

CREATE TABLE vendor_events (
  id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  kind TEXT NOT NULL,
  vendor_order_id TEXT,
  reference TEXT,
  status TEXT,
  dedupe_key TEXT UNIQUE,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  outcome TEXT
);

CREATE TABLE report_metadata (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bloodwork_bookings (id),
  member_id TEXT NOT NULL REFERENCES users (id),
  vendor_link TEXT,
  storage_path TEXT,
  delivered_at TEXT NOT NULL,
  released_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES users (id),
  coach_note TEXT,
  flagged TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(flagged)),
  markers INTEGER,
  values_status TEXT NOT NULL DEFAULT 'none' CHECK (values_status IN ('none','pending','ready','failed')),
  created_at TEXT NOT NULL
);
CREATE INDEX report_metadata_member ON report_metadata (member_id, delivered_at);

CREATE TABLE report_values (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES report_metadata (id) ON DELETE CASCADE,
  marker_key TEXT,
  vendor_test_id TEXT,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  units TEXT,
  range_low REAL,
  range_high REAL,
  matched_range TEXT,
  flag TEXT,
  unmapped INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX report_values_report ON report_values (report_id);

-- messaging and notifications ----------------------------------------------------------------------------------------
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  coach_id TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  last_message_at TEXT,
  UNIQUE (member_id, coach_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users (id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  read_at TEXT
);
CREATE INDEX messages_conversation ON messages (conversation_id, created_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  event_id TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX notifications_user ON notifications (user_id, created_at);

CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  email INTEGER NOT NULL DEFAULT 1,
  sms INTEGER NOT NULL DEFAULT 1,
  push INTEGER NOT NULL DEFAULT 1,
  reminders INTEGER NOT NULL DEFAULT 1,
  marketing INTEGER NOT NULL DEFAULT 0,
  lock_screen_detail INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('in_app','email','sms','push')),
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','failed','skipped','logged')),
  provider_ref TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE outbox_messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','push')),
  to_address TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  notification_id TEXT,
  status TEXT NOT NULL DEFAULT 'logged',
  created_at TEXT NOT NULL
);

-- custom plans, support, audit, events -------------------------------------------------------------------------------
CREATE TABLE custom_plan_requests (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  member_id TEXT REFERENCES users (id),
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('enquiry_received','under_review','scoping','awaiting_professional_input','awaiting_internal_approval','proposal_sent','accepted','declined','expired','payment_pending','activated','completed')),
  goals TEXT NOT NULL,
  duration TEXT,
  budget_paise INTEGER,
  notes TEXT,
  scope TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scope)),
  proposal TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(proposal)),
  approvals TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(approvals)),
  assigned_coach_id TEXT REFERENCES users (id),
  order_id TEXT REFERENCES orders (id),
  programme_id TEXT REFERENCES programmes (id),
  owner_id TEXT REFERENCES users (id),
  proposal_sent_at TEXT,
  expires_at TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX custom_plan_status ON custom_plan_requests (status);

CREATE TABLE custom_plan_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES custom_plan_requests (id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_id TEXT,
  note TEXT,
  at TEXT NOT NULL
);

CREATE TABLE support_tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','dismissed')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ref_type TEXT,
  ref_id TEXT,
  owner_id TEXT REFERENCES users (id),
  created_by TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX support_tasks_status ON support_tasks (status, kind);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  reason TEXT,
  ip TEXT,
  data TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  at TEXT NOT NULL
);
CREATE INDEX audit_events_at ON audit_events (at);
CREATE INDEX audit_events_target ON audit_events (target_type, target_id);

CREATE TABLE domain_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  created_at TEXT NOT NULL,
  processed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT
);
CREATE INDEX domain_events_pending ON domain_events (processed_at, next_attempt_at);

CREATE TABLE jobs_log (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  detail TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE integration_status (
  integration TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(status)),
  updated_at TEXT NOT NULL
);

CREATE TABLE file_metadata (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users (id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE enquiries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  purpose TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','closed')),
  handled_by TEXT,
  handled_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE data_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  kind TEXT NOT NULL CHECK (kind IN ('export','deletion')),
  status TEXT NOT NULL CHECK (status IN ('requested','in_progress','completed','cancelled')),
  note TEXT,
  file_id TEXT REFERENCES file_metadata (id),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO sequences (name, value) VALUES ('PAY', 1000), ('BIO', 24000), ('INV', 1000), ('CPL', 100);
