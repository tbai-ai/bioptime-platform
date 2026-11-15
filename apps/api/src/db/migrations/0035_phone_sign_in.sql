-- Phone sign-in (api/auth/phoneSignIn.ts, routes in api/http/routes/auth.ts): a member signs in with a six-digit code
-- sent by SMS to the phone number they confirmed, and confirms that number with the same kind of code while signed in.
-- Additive only; depends on 0001 (users, feature_flags from 0008).
--
-- The switch: phone_sign_in, off in every mode when this migration runs. It is a switch of its own, outside the module
-- registry (signing in is identity, not a module), shown on /admin/modules with the other stored switches. The demo
-- seed switches it on in demo mode only, through the referrals module's seedDemo (api/modules/referrals.ts), the way
-- the sessions module switches its public_webinars part on; a database that is not re-seeded keeps it off until an
-- administrator holding modules.manage switches it on. Production refuses phone sign-in while SMS_PROVIDER is the
-- outbox: its routes answer PHONE_SIGN_IN_UNAVAILABLE, whatever the switch says.
INSERT OR IGNORE INTO feature_flags (key, enabled, audience, description, updated_at) VALUES
  ('phone_sign_in', 0, '{}', 'Members sign in with a one-time code sent by SMS to their confirmed phone number (production refuses it while SMS is the outbox)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- One row per code asked for. Neither the number nor the code is stored: phone_key is an HMAC of the normalised number
-- (TOKEN_SECRET), code_hash an HMAC of the row id and the code. A request for a number with no member behind it leaves a
-- row without a user or a code, so the per-number limit counts every request the same way and the answer never tells
-- whether the number has an account. ip_key (an HMAC of the caller's address) is kept for the audit of abuse only;
-- the per-address limit is the route's rate limit. A code works once, for 10 minutes, with 5 attempts.
CREATE TABLE phone_sign_in_codes (
  id TEXT PRIMARY KEY,                                   -- psc_
  purpose TEXT NOT NULL CHECK (purpose IN ('sign_in', 'confirm_phone')),
  phone_key TEXT NOT NULL,
  user_id TEXT REFERENCES users (id),                    -- the member the code went to; NULL when none matched
  code_hash TEXT,                                        -- NULL when no code was sent
  ip_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  used_at TEXT,                                          -- signed in, confirmed, or replaced by a newer code
  created_at TEXT NOT NULL
);
CREATE INDEX phone_sign_in_codes_phone ON phone_sign_in_codes (phone_key, created_at);
CREATE INDEX phone_sign_in_codes_user ON phone_sign_in_codes (user_id, purpose, created_at);
CREATE INDEX phone_sign_in_codes_created ON phone_sign_in_codes (created_at);
