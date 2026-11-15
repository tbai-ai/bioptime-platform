-- Presentation fields for the member app's Store and Tests (30 October 2026). Additive only; depends on 0001
-- (package_versions, bloodwork_tests) and 0005 (assets).
--
-- Packages: a picture, a "compare at" price and an accent colour, each optional and set by an administrator with the
-- other terms of a version (api/domain/packages.ts insertVersion: the picture must be in the asset library, the compare
-- at price must be above the price, in paise like price_paise). They are presentation only: an order is charged
-- price_paise, never the compare at price. A revision carries them to the next version unless they change.
ALTER TABLE package_versions ADD COLUMN image_asset_id TEXT REFERENCES assets (id);
ALTER TABLE package_versions ADD COLUMN compare_at_price_paise INTEGER CHECK (compare_at_price_paise IS NULL OR compare_at_price_paise >= 100);
ALTER TABLE package_versions ADD COLUMN accent TEXT CHECK (accent IS NULL OR accent IN ('red', 'gold', 'blue'));

-- Blood tests: a picture, the tags a card shows and whether the test is the one the app features (api/domain/bloodwork.ts
-- setTestPresentation). The catalogue sync from the laboratory never touches them.
ALTER TABLE bloodwork_tests ADD COLUMN image_asset_id TEXT REFERENCES assets (id);
ALTER TABLE bloodwork_tests ADD COLUMN tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array');
ALTER TABLE bloodwork_tests ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1));
