-- Review fixes (22 October 2026): a pending coach invitation whose account is no longer invited (closed, suspended or
-- already active) is withdrawn, so it neither previews nor lists as pending.
UPDATE coach_invitations SET status = 'revoked', revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE status = 'pending' AND email IN (SELECT email FROM users WHERE role != 'coach' OR state != 'invited');
