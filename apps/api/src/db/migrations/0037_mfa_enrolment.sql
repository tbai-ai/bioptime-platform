-- Mandatory two-factor authentication for administrators and owners (owner decision, 30 October 2026). Additive only;
-- depends on 0001 (users).
--
-- An administrator or owner whose authenticator is not enrolled no longer gets a session from a password alone:
-- POST /auth/login answers 403 MFA_ENROLMENT_REQUIRED with a one-time enrolment token (15 minutes, stored hashed here),
-- which is good only for POST /auth/mfa/enrol/start (a fresh secret) and POST /auth/mfa/enrol/confirm (a correct
-- six-digit code switches MFA on and signs the person in). The token is used once; wrong codes are counted on the token
-- (it is used up after five). Each token needs the account's password, which the sign-in lockout already guards.
--
-- auth_tokens.kind is fixed by a CHECK in 0001, and an enrolment token must never be accepted as a password reset
-- link, so enrolment tokens have their own table rather than a new purpose on an existing kind.
CREATE TABLE mfa_enrolments (
  id TEXT PRIMARY KEY,                                   -- mfe_
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,                                       -- when enrol/start last issued a secret for this token
  expires_at TEXT NOT NULL,
  used_at TEXT,                                          -- set when the enrolment completed (or the token was given up)
  created_at TEXT NOT NULL
);
CREATE INDEX mfa_enrolments_user ON mfa_enrolments (user_id, used_at);
