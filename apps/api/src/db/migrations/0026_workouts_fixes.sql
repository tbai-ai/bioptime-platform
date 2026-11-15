-- Round 6 (workouts): a revision's title and start date stay with the draft until the coach publishes it.
--
-- Before this, editing the draft revision of a published workout programme wrote the new title and start date straight
-- onto workout_programs, so the member's Workouts page (and their data export) showed the coach's unpublished working
-- title and start date before the revision was published. They are now kept on the draft version and copied onto the
-- programme when that version is published. NULL on every existing row means "unchanged by this version": the
-- programme's own title and start date apply, as before. Additive only: nothing existing changes.
ALTER TABLE workout_program_versions ADD COLUMN title TEXT;
ALTER TABLE workout_program_versions ADD COLUMN start_date TEXT;
