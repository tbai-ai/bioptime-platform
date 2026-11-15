-- Sign in with Google and Apple for members (api/auth/social.ts, routes in api/http/routes/auth.ts). Additive only;
-- depends on 0001 (users).
--
-- users.password_hash is already nullable in 0001_init.sql (invited members have no password until they activate), so
-- no table rebuild is needed: a member who joins with Google or Apple simply has password_hash NULL until they set one
-- from the forgotten-password link. Password sign-in tells such an account to use its provider button.
--
-- One row per provider identity linked to an account: (provider, subject) is the provider's stable id for the person
-- ("sub" in the ID token), never the email, which can change on the provider's side. The email column keeps the
-- verified email the provider gave at link time, so the member can recognise the identity on their Settings page.
-- The 'standin' provider exists only in demo mode (BIOPTIME_MODE=demo): it behaves like a verified identity for any
-- email, so testers can try the whole flow without a Google Cloud project or an Apple Developer account.
CREATE TABLE user_identities (
  id TEXT PRIMARY KEY,                                   -- uid_
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'standin')),
  subject TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, subject)
);
CREATE INDEX user_identities_user ON user_identities (user_id, provider);

-- A sign-in with a verified identity that has no account yet: the server keeps the verified identity for 10 minutes
-- under a one-time token (stored hashed), and the client comes back with that token plus the policy acceptances to
-- create the account. Nothing the client says about the identity is trusted: the account is made from this row.
CREATE TABLE social_sign_ups (
  id TEXT PRIMARY KEY,                                   -- ssu_
  token_hash TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'standin')),
  subject TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  ip TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX social_sign_ups_created ON social_sign_ups (created_at);
