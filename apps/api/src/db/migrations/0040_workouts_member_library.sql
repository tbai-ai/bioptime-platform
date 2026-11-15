-- Workouts for the member app (30 October 2026): safety notes on library exercises, and a session's frozen copy of
-- each exercise's description, muscle groups, equipment and safety notes. Additive only; depends on 0014.
--
-- A session keeps the exercise text it was given when its programme version was published (the name, category and
-- instructions already were: 0014), so a later library edit never changes a session a member has. Publishing now also
-- copies these four (api/domain/workouts.ts publishDraft). Sessions published before this file get them copied once
-- from the library as it is now: there was no earlier copy to keep. Media are not copied: a session item shows its
-- exercise's current clip (exercises.media_ref), so a clip withdrawn after review disappears everywhere at once.
ALTER TABLE exercises ADD COLUMN safety_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE workout_session_items ADD COLUMN exercise_description TEXT NOT NULL DEFAULT '';
ALTER TABLE workout_session_items ADD COLUMN exercise_muscles TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(exercise_muscles));
ALTER TABLE workout_session_items ADD COLUMN exercise_equipment TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(exercise_equipment));
ALTER TABLE workout_session_items ADD COLUMN exercise_safety TEXT NOT NULL DEFAULT '';

UPDATE workout_session_items SET
  exercise_description = (SELECT e.description FROM exercises e WHERE e.id = workout_session_items.exercise_id),
  exercise_muscles = (SELECT e.muscle_groups FROM exercises e WHERE e.id = workout_session_items.exercise_id),
  exercise_equipment = (SELECT e.equipment FROM exercises e WHERE e.id = workout_session_items.exercise_id)
WHERE exercise_id IN (SELECT id FROM exercises);
