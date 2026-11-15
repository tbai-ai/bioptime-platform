-- Nutrition for the member app (30 October 2026; api/domain/nutrition.ts): the dishes a member saves, and meal logs
-- that name the dish from the library they ate and the portion. Additive only; depends on 0001 (users) and 0013 (foods,
-- recipes, meal_logs).
--
-- Members search the published foods and recipes (GET /me/foods, GET /me/recipes) and save the ones they like
-- (PUT /me/nutrition/favourites): one row per member, kind and item, so saving again changes nothing. No foreign key
-- points ref_id at foods or recipes (one column names either); the API saves only published items and lists only those
-- still published.
CREATE TABLE nutrition_favourites (
  member_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('food', 'recipe')),
  ref_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (member_id, kind, ref_id)
);

-- A meal log may name the published food or recipe it was picked from (one of the two, never both: POST /me/meal-logs
-- checks it) and the portion eaten, in servings. GET /me/nutrition adds today's values from these links and from planned
-- meals logged as planned, using only values entered with their source; nothing is estimated. Existing logs name no dish
-- and count as before.
ALTER TABLE meal_logs ADD COLUMN food_id TEXT REFERENCES foods (id);
ALTER TABLE meal_logs ADD COLUMN recipe_id TEXT REFERENCES recipes (id);
ALTER TABLE meal_logs ADD COLUMN portion REAL CHECK (portion IS NULL OR portion IN (0.5, 1, 1.5, 2));
