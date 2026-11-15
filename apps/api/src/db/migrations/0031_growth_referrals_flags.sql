-- The switches of the two modules added on 24 October 2026, off like every module (the demo seed switches them on):
-- growth (discovery calls, package finder, newsletter, health calculators, corporate enquiries, the public webinars
-- page) and referrals (member referral codes and referred sign-ups). Their own tables come in 0033 and 0034.
INSERT OR IGNORE INTO feature_flags (key, enabled, audience, description, updated_at) VALUES
  ('growth', 0, '{}', 'Growth: discovery calls, package finder, newsletter, health calculators, corporate enquiries, public webinars page', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('referrals', 0, '{}', 'Referrals: member referral codes and referred sign-ups', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
