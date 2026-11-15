-- Daily totals for progress metrics counted over a day (30 October 2026): steps counted by the member's phone and water
-- the member logs. Additive only; depends on 0001 (users, progress_entries, metric_config) and 0008 (progress_entries
-- rebuilt).
--
-- PUT /me/progress/daily keeps one entry per member, metric, India date, source and provider (api/domain/plans.ts
-- putDailyTotal): each holds that source's total for that day and is updated in place, so a phone that sends its count
-- again and again never adds entries. The entry itself is an ordinary progress entry (its time falls inside its day);
-- this table is its key, so progress_entries keeps its columns and every reader of it is unchanged. provider names the
-- device app ('phone': the step counter of the phone the member uses Bioptime on; '' for a total the member typed).
-- Nothing is backfilled: POST /me/progress may hold several values of one day, which count as they always did. A day's
-- value is the largest across its sources (never their sum: a phone and the member counting the same walk would double
-- it); water has the member as its only source.
CREATE TABLE progress_daily_totals (
  member_id TEXT NOT NULL REFERENCES users (id),
  metric TEXT NOT NULL,
  day TEXT NOT NULL,                                     -- YYYY-MM-DD, India
  source TEXT NOT NULL CHECK (source IN ('device', 'member')),
  provider TEXT NOT NULL DEFAULT '',                     -- 'phone' for a device total; '' for the member's own
  entry_id TEXT NOT NULL UNIQUE,                         -- progress_entries.id (no foreign key points at that table: 0008)
  updated_at TEXT NOT NULL,
  PRIMARY KEY (member_id, metric, day, source, provider)
);

-- Water joins the metrics on a database that already has its metric list (a new database gets it from the seed or from
-- the built-in list in api/domain/plans.ts metricConfig, which reads PROGRESS_METRICS while metric_config is empty).
INSERT INTO metric_config (metric, label, unit, enabled, min_value, max_value, sort)
  SELECT 'water_ml', 'Water', 'ml', 1, 0, 10000, 0
  WHERE EXISTS (SELECT 1 FROM metric_config) AND NOT EXISTS (SELECT 1 FROM metric_config WHERE metric = 'water_ml');
