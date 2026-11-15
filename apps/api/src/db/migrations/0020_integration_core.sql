-- Integration (core): why a queued reminder was skipped instead of sent. Additive only.
-- The reminders job (api/domain/reminders.ts dispatchDue) marks a due reminder skipped, and never sends it later, when:
--   module_off        the module that queued it (by ref_type) is switched off when it falls due
--   account_inactive  the person's account is suspended, deactivated, closed or awaiting deletion
--   reminders_off     the person switched reminders off
--   quiet_hours       it falls inside the person's quiet hours and has no in-app channel
-- Rows skipped before this column existed keep NULL.
ALTER TABLE reminders ADD COLUMN skip_reason TEXT;
