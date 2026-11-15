-- Referrals (api/modules/referrals.ts): each member's personal referral code, and the members who joined with one.
-- Additive only; depends on 0001 (users, orders) and 0031 (the referrals switch, off until an administrator or the demo
-- seed switches it on).
--
-- A referral is recorded only by the server at registration (POST /auth/register with referralCode): the client sends
-- the code and nothing else; who referred whom is read from referral_codes, the status starts at signed_up and moves to
-- paying_member when the new member's first order is paid (the OrderPaid event, emitted only after a signature-verified
-- capture). Self-referrals and second referrals of the same member are refused.
--
-- Rewards are an owner decision that has not been made: nothing about a reward is stored here, and no screen promises one.

-- One code per member, made the first time the member opens Refer a friend. Eight characters from an alphabet without
-- look-alikes (no 0/O, 1/I/L), stored in capitals; matched without regard to case.
CREATE TABLE referral_codes (
  member_id TEXT PRIMARY KEY REFERENCES users (id),
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- A member who joined with someone's code. referred_id is unique: a member is referred once, by one person.
CREATE TABLE referrals (
  id TEXT PRIMARY KEY,                                   -- rfl_
  referrer_id TEXT NOT NULL REFERENCES users (id),
  referred_id TEXT NOT NULL UNIQUE REFERENCES users (id),
  code TEXT NOT NULL,                                    -- the code used at sign-up, as stored in referral_codes
  status TEXT NOT NULL DEFAULT 'signed_up' CHECK (status IN ('signed_up', 'paying_member')),
  signed_up_at TEXT NOT NULL,
  became_paying_at TEXT,
  first_order_id TEXT REFERENCES orders (id),            -- the paid order that made them a paying member
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (referrer_id <> referred_id)
);
CREATE INDEX referrals_referrer ON referrals (referrer_id, signed_up_at);
CREATE INDEX referrals_status ON referrals (status, signed_up_at);
