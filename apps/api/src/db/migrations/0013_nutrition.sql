-- M5 Nutrition: nutrition profiles, the food and recipe library, versioned meal plans with slots, and meal logs.
-- Depends only on 0001 to 0008. Coach feedback on a logged meal reuses coach_notes (ref_type 'meal_log', visibility
-- 'client'); meal photos are private files (file_metadata kind 'meal_photo', ref_type 'meal_log').
--
-- No nutrient value, portion size or calorie target is seeded or derived here: every number is typed by a coach or the
-- Bioptime team, and the API accepts a nutrient value only with the source it was read from (foods.source_ref).

-- One row per member. Restriction labels are typed by the member or the coach; there is no built-in medical list.
-- restrictions: [{"label": "...", "kind": "allergy" | "intolerance" | "avoid" | "religious" | "other"}]
CREATE TABLE nutrition_profiles (
  member_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  diet_pattern TEXT,
  restrictions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(restrictions) AND json_type(restrictions) = 'array'),
  dislikes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dislikes) AND json_type(dislikes) = 'array'),
  cuisines TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(cuisines) AND json_type(cuisines) = 'array'),
  meals_per_day INTEGER CHECK (meals_per_day IS NULL OR meals_per_day BETWEEN 1 AND 10),
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id)
);

-- Foods. Nutrient values are per serving, all nullable. source: coach (a coach's own entry), team (the Bioptime team)
-- or licensed_dataset (unused until a food-composition dataset is licensed). A coach's food starts as a draft usable in
-- that coach's plans; an administrator holding library.manage publishes it for everyone.
CREATE TABLE foods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  serving_label TEXT NOT NULL DEFAULT '',
  serving_grams REAL CHECK (serving_grams IS NULL OR serving_grams > 0),
  kcal REAL CHECK (kcal IS NULL OR kcal >= 0),
  protein_g REAL CHECK (protein_g IS NULL OR protein_g >= 0),
  carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fat_g REAL CHECK (fat_g IS NULL OR fat_g >= 0),
  fibre_g REAL CHECK (fibre_g IS NULL OR fibre_g >= 0),
  source TEXT NOT NULL CHECK (source IN ('coach', 'team', 'licensed_dataset')),
  source_ref TEXT,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX foods_status ON foods (status, name);
CREATE INDEX foods_creator ON foods (created_by, status);

-- Recipes. method is sanitised rich text (sanitizeRichText); image_asset_id points at a website asset when one exists.
CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  servings INTEGER CHECK (servings IS NULL OR servings BETWEEN 1 AND 100),
  prep_minutes INTEGER CHECK (prep_minutes IS NULL OR prep_minutes BETWEEN 1 AND 1440),
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  image_asset_id TEXT REFERENCES assets (id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  source TEXT NOT NULL DEFAULT 'team' CHECK (source IN ('coach', 'team')),
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX recipes_status ON recipes (status, title);
CREATE INDEX recipes_creator ON recipes (created_by, status);

CREATE TABLE recipe_ingredients (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  food_id TEXT REFERENCES foods (id),
  label TEXT NOT NULL,
  quantity REAL CHECK (quantity IS NULL OR quantity > 0),
  unit TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX recipe_ingredients_recipe ON recipe_ingredients (recipe_id, sort);

-- Meal plans mirror coaching plans: a published version is frozen, editing opens the next draft, the history stays.
CREATE TABLE meal_plans (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  coach_id TEXT NOT NULL REFERENCES users (id),
  programme_id TEXT REFERENCES programmes (id),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX meal_plans_member ON meal_plans (member_id, status);
CREATE INDEX meal_plans_coach ON meal_plans (coach_id, status);

-- targets: {"kcal"?, "protein_g"?, "carbs_g"?, "fat_g"?}, every key optional and typed by the coach.
CREATE TABLE meal_plan_versions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES meal_plans (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  targets TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(targets) AND json_type(targets) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (plan_id, version)
);

-- day: 1 (Monday) to 7 (Sunday) of the member's local week.
CREATE TABLE meal_plan_slots (
  id TEXT PRIMARY KEY,
  plan_version_id TEXT NOT NULL REFERENCES meal_plan_versions (id) ON DELETE CASCADE,
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 7),
  slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'mid_morning', 'lunch', 'evening', 'dinner', 'other')),
  time_hint TEXT,
  recipe_id TEXT REFERENCES recipes (id),
  food_id TEXT REFERENCES foods (id),
  title TEXT NOT NULL,
  portion_note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX meal_plan_slots_version ON meal_plan_slots (plan_version_id, day, sort);

-- Meal logs: date is the member's local date. A deleted log keeps its row (deleted_at) and loses its photo.
CREATE TABLE meal_logs (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES users (id),
  slot_id TEXT REFERENCES meal_plan_slots (id),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'mid_morning', 'lunch', 'evening', 'dinner', 'other')),
  description TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK (outcome IN ('as_planned', 'swapped', 'skipped', 'extra')),
  photo_file_id TEXT REFERENCES file_metadata (id),
  note TEXT,
  source TEXT NOT NULL CHECK (source IN ('member', 'coach')),
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX meal_logs_member_date ON meal_logs (member_id, date);
CREATE INDEX meal_logs_slot ON meal_logs (slot_id);
