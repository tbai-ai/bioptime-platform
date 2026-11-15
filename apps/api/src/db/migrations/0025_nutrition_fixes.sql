-- Round 6 (nutrition): a revision's title stays with the draft until the coach publishes it.
--
-- Before this, renaming a published meal plan while editing its next draft version wrote the new title straight onto
-- meal_plans, so the member's Nutrition page (and their data export) showed the coach's unpublished working title before
-- the revision was published. The title is now kept on the draft version and copied onto the plan when that version is
-- published; a plan that was never published keeps its title on meal_plans, as before. NULL on every existing row
-- means "unchanged by this version": the plan's own title applies. Additive only: nothing existing changes.
ALTER TABLE meal_plan_versions ADD COLUMN title TEXT;
