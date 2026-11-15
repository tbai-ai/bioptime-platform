-- Review fixes (22 October 2026): an internal approval on a bespoke request binds to the proposal terms it approved.
ALTER TABLE custom_plan_requests ADD COLUMN approved_hash TEXT;
