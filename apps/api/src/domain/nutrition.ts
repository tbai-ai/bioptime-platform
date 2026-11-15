/* M5 Nutrition: nutrition profiles, the food and recipe library, versioned meal plans with slots, meal logs with
   private photos, coach feedback on a logged meal, plan totals and adherence.

   Meal plans mirror coaching plans (api/domain/plans.ts): a published version is frozen, editing opens the next draft,
   the history stays, and the member is told when a plan is published or revised.

   Nothing here invents a number. Nutrient values, portion notes and targets are typed by a coach or the Bioptime team;
   a nutrient value is accepted only with the source it was read from (source_ref); totals add up only the values that
   were entered and say when something is missing. Coach feedback on a meal reuses coach_notes (ref_type 'meal_log').

   For the member app (30 October 2026, 0042_nutrition_search.sql): members search the published foods and recipes, save
   the ones they like (nutrition_favourites) and log a dish from the library with the portion they ate (half, one, one
   and a half or two servings). Today's totals on GET /me/nutrition add up planned meals logged as planned and dishes
   from the library times their portion, from values entered with their source only; a meal without such values is
   counted as missing, never guessed. */
import type { Ctx } from '../context.js';
import { j } from '../db/db.js';
import { errors } from '../lib/errors.js';
import { randomId } from '../lib/ids.js';
import { addDays, dateInZone } from '../lib/time.js';
import { coachHasMember, requireHealthAccess } from '../auth/permissions.js';
import { audit, emit } from './audit.js';
import { notify } from './notifications.js';
import { sanitizeRichText } from './content.js';
import { liveAsset } from './assets.js';
import { removePrivateFile, savePrivateFile, storageRequirement, type FileRow } from './files.js';
import { isEnabled } from './features.js';
import {
  MEAL_OUTCOME_LABELS, MEAL_PHOTO_MAX_BYTES, MEAL_SLOT_LABELS, MEAL_SLOTS, NUTRIENT_KEYS, PLAN_DAY_LABELS, type FavouriteInput, type FoodInput,
  type MealLogInput, type MealOutcome, type MealSlot, type MealSlotInput, type MealTargets, type MemberLibraryQuery, type NutrientKey,
  type NutritionProfileInput, type RecipeInput, type RestrictionKind,
} from '@bioptime/domain/modules/nutrition';

/* ---------- ids and small helpers ---------- */

export const nutritionIds = {
  food: () => randomId('fod'),
  recipe: () => randomId('rcp'),
  ingredient: () => randomId('rci'),
  mealPlan: () => randomId('mpl'),
  mealPlanVersion: () => randomId('mpv'),
  mealPlanSlot: () => randomId('mps'),
  mealLog: () => randomId('mlg'),
};

/** The member's local date (Asia/Kolkata, the platform's zone for people). */
export function localToday(ctx: Ctx): string { return dateInZone(ctx.now()); }

/** Plan day of a local date: 1 is Monday, 7 is Sunday. */
export function planDayOf(date: string): number {
  const d = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(`${d}T00:00:00.000Z`, 1).slice(0, 10)) out.push(d);
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const nutrientColumn: Record<NutrientKey, 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fibre_g'> = { kcal: 'kcal', protein_g: 'protein_g', carbs_g: 'carbs_g', fat_g: 'fat_g', fibre_g: 'fibre_g' };

/** The latest coach_sharing consent, read exactly as requireHealthAccess reads it: no recorded consent is no consent. */
export function sharesWithCoach(ctx: Ctx, memberId: string): boolean {
  const consent = ctx.db.get<{ granted: number }>("SELECT granted FROM member_consents WHERE user_id = ? AND kind = 'coach_sharing' ORDER BY at DESC LIMIT 1", [memberId]);
  return !!consent?.granted;
}

/* ---------- nutrition profiles ---------- */

type ProfileRow = { member_id: string; diet_pattern: string | null; restrictions: string; dislikes: string; cuisines: string; meals_per_day: number | null; notes: string; updated_at: string; updated_by: string | null };
export type NutritionProfile = { memberId: string; dietPattern: string | null; restrictions: Array<{ label: string; kind: RestrictionKind }>; dislikes: string[]; cuisines: string[]; mealsPerDay: number | null; notes: string; updatedAt: string | null; updatedByRole: string | null };

export function getProfile(ctx: Ctx, memberId: string): NutritionProfile {
  const r = ctx.db.get<ProfileRow>('SELECT * FROM nutrition_profiles WHERE member_id = ?', [memberId]);
  if (!r) return { memberId, dietPattern: null, restrictions: [], dislikes: [], cuisines: [], mealsPerDay: null, notes: '', updatedAt: null, updatedByRole: null };
  const by = r.updated_by ? ctx.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', [r.updated_by]) : undefined;
  return { memberId, dietPattern: r.diet_pattern, restrictions: j.out(r.restrictions, []), dislikes: j.out(r.dislikes, []), cuisines: j.out(r.cuisines, []), mealsPerDay: r.meals_per_day, notes: r.notes, updatedAt: r.updated_at, updatedByRole: by?.role ?? null };
}

/** Saves the member's nutrition profile (by the member, or by the assigned coach with health access). Audited without
 *  the labels themselves: the audit log records which fields changed, not what the member eats or avoids. */
export function setProfile(ctx: Ctx, memberId: string, input: NutritionProfileInput): NutritionProfile {
  const current = getProfile(ctx, memberId);
  // the first spelling of a repeated label wins (Shellfish, shellfish → Shellfish)
  const firstOf = <T,>(items: T[], key: (t: T) => string) => { const seen = new Map<string, T>(); for (const t of items) if (!seen.has(key(t))) seen.set(key(t), t); return [...seen.values()]; };
  const dedupe = (list: string[]) => firstOf(list.map((s) => s.trim()).filter(Boolean), (s) => s.toLowerCase());
  const next = {
    diet_pattern: input.dietPattern !== undefined ? (input.dietPattern?.trim() || null) : current.dietPattern,
    restrictions: input.restrictions !== undefined ? firstOf(input.restrictions.map((r) => ({ label: r.label.trim(), kind: r.kind })), (r) => `${r.kind}|${r.label.toLowerCase()}`) : current.restrictions,
    dislikes: input.dislikes !== undefined ? dedupe(input.dislikes) : current.dislikes,
    cuisines: input.cuisines !== undefined ? dedupe(input.cuisines) : current.cuisines,
    meals_per_day: input.mealsPerDay !== undefined ? input.mealsPerDay : current.mealsPerDay,
    notes: input.notes !== undefined ? input.notes.trim() : current.notes,
  };
  const now = ctx.now();
  ctx.db.run(`INSERT INTO nutrition_profiles (member_id, diet_pattern, restrictions, dislikes, cuisines, meals_per_day, notes, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(member_id) DO UPDATE SET diet_pattern = excluded.diet_pattern, restrictions = excluded.restrictions, dislikes = excluded.dislikes, cuisines = excluded.cuisines, meals_per_day = excluded.meals_per_day, notes = excluded.notes, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  [memberId, next.diet_pattern, j.in(next.restrictions), j.in(next.dislikes), j.in(next.cuisines), next.meals_per_day, next.notes, now, ctx.actor?.id ?? null]);
  audit(ctx, 'nutrition_profile.update', { type: 'user', id: memberId }, null, { fields: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined), byRole: ctx.actor?.role ?? 'system' });
  return getProfile(ctx, memberId);
}

/* ---------- the food and recipe library ---------- */

type FoodRow = { id: string; name: string; serving_label: string; serving_grams: number | null; kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fibre_g: number | null; source: string; source_ref: string | null; tags: string; status: string; created_by: string | null; created_at: string; updated_at: string };
type RecipeRow = { id: string; title: string; summary: string; method: string; servings: number | null; prep_minutes: number | null; tags: string; image_asset_id: string | null; status: string; source: string; created_by: string | null; created_at: string; updated_at: string };
type IngredientRow = { id: string; recipe_id: string; food_id: string | null; label: string; quantity: number | null; unit: string; sort: number };

export function presentFood(f: FoodRow) {
  const entered = NUTRIENT_KEYS.filter((k) => f[nutrientColumn[k]] !== null);
  return {
    id: f.id, name: f.name, servingLabel: f.serving_label, servingGrams: f.serving_grams,
    kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, fibre_g: f.fibre_g,
    nutrientsEntered: entered, source: f.source, sourceRef: f.source_ref, tags: j.out<string[]>(f.tags, []), status: f.status,
    createdBy: f.created_by, createdAt: f.created_at, updatedAt: f.updated_at,
  };
}
export type PresentedFood = ReturnType<typeof presentFood>;

function foodRow(ctx: Ctx, id: string): FoodRow | undefined { return ctx.db.get<FoodRow>('SELECT * FROM foods WHERE id = ?', [id]); }
function recipeRow(ctx: Ctx, id: string): RecipeRow | undefined { return ctx.db.get<RecipeRow>('SELECT * FROM recipes WHERE id = ?', [id]); }

export function presentRecipe(ctx: Ctx, r: RecipeRow) {
  const image = liveAsset(ctx, r.image_asset_id); // an image deleted earlier reads as no image, not a broken link (cr-6)
  const ingredients = ctx.db.all<IngredientRow & { food_name: string | null }>('SELECT i.*, f.name AS food_name FROM recipe_ingredients i LEFT JOIN foods f ON f.id = i.food_id WHERE i.recipe_id = ? ORDER BY i.sort', [r.id]);
  return {
    id: r.id, title: r.title, summary: r.summary, method: r.method, servings: r.servings, prepMinutes: r.prep_minutes, tags: j.out<string[]>(r.tags, []),
    imageAssetId: image?.assetId ?? null, imageUrl: image?.url ?? null, status: r.status, source: r.source,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    ingredients: ingredients.map((i) => ({ id: i.id, foodId: i.food_id, foodName: i.food_name, label: i.label, quantity: i.quantity, unit: i.unit, sort: i.sort })),
  };
}
export type PresentedRecipe = ReturnType<typeof presentRecipe>;

/** Who is creating or using library items: a coach sees published items and their own drafts; the team sees everything. */
export type LibraryScope = { kind: 'coach'; coachId: string } | { kind: 'team' };

function usable(scope: LibraryScope, row: { status: string; created_by: string | null }): boolean {
  if (scope.kind === 'team') return row.status !== 'archived';
  return row.status === 'published' || (row.status === 'draft' && row.created_by === scope.coachId);
}

export function listFoods(ctx: Ctx, scope: LibraryScope, opts: { status?: string; q?: string } = {}) {
  const where: string[] = [];
  const params: string[] = [];
  if (scope.kind === 'coach') { where.push("(status = 'published' OR (status = 'draft' AND created_by = ?))"); params.push(scope.coachId); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.q) { where.push('name LIKE ?'); params.push(`%${opts.q.replace(/[%_]/g, '')}%`); }
  return ctx.db.all<FoodRow>(`SELECT * FROM foods ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY status = 'archived', name LIMIT 500`, params).map(presentFood);
}

export function listRecipes(ctx: Ctx, scope: LibraryScope, opts: { status?: string; q?: string } = {}) {
  const where: string[] = [];
  const params: string[] = [];
  if (scope.kind === 'coach') { where.push("(status = 'published' OR (status = 'draft' AND created_by = ?))"); params.push(scope.coachId); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  if (opts.q) { where.push('title LIKE ?'); params.push(`%${opts.q.replace(/[%_]/g, '')}%`); }
  return ctx.db.all<RecipeRow>(`SELECT * FROM recipes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY status = 'archived', title LIMIT 500`, params).map((r) => presentRecipe(ctx, r));
}

/** A nutrient value (or a serving weight) is accepted only with the source it was read from. */
function assertSourced(values: { servingGrams?: number | null; kcal?: number | null; proteinG?: number | null; carbsG?: number | null; fatG?: number | null; fibreG?: number | null }, sourceRef: string | null | undefined): void {
  const anyValue = [values.servingGrams, values.kcal, values.proteinG, values.carbsG, values.fatG, values.fibreG].some((v) => v !== null && v !== undefined);
  if (anyValue && !(sourceRef && sourceRef.trim().length >= 3)) throw errors.badRequest('Nutrient values need their source: name the label, publication or dataset they were read from (sourceRef). Leave the values empty when there is none.', 'SOURCE_REQUIRED');
}

/** The licensed food-composition dataset is pending configuration: none is chosen. */
export const LICENSED_DATASET_MISSING = 'A licensed food-composition dataset: none is chosen, so foods with source "licensed_dataset" and their importer stay unused until there is a licence';
/** No automatic estimate from a photo or from text: that needs an AI provider, and AI_PROVIDER accepts only "none". */
export const ESTIMATE_MISSING = 'An AI provider and its data-processing agreement: AI_PROVIDER accepts only "none", so no nutrient or calorie value is ever estimated from a photo or a description';

export function createFood(ctx: Ctx, input: FoodInput, opts: { source: 'coach' | 'team'; status?: 'draft' | 'published' }, reason?: string | null) {
  assertSourced(input, input.sourceRef);
  const now = ctx.now();
  const id = nutritionIds.food();
  ctx.db.insert('foods', {
    id, name: input.name.trim(), serving_label: input.servingLabel?.trim() ?? '', serving_grams: input.servingGrams ?? null,
    kcal: input.kcal ?? null, protein_g: input.proteinG ?? null, carbs_g: input.carbsG ?? null, fat_g: input.fatG ?? null, fibre_g: input.fibreG ?? null,
    source: opts.source, source_ref: input.sourceRef?.trim() || null, tags: j.in(input.tags ?? []), status: opts.status ?? 'draft',
    created_by: ctx.actor?.id ?? null, created_at: now, updated_at: now,
  });
  audit(ctx, 'food.create', { type: 'food', id }, reason ?? null, { source: opts.source, status: opts.status ?? 'draft', nutrientsEntered: NUTRIENT_KEYS.filter((k) => (input as Record<string, unknown>)[camel(k)] !== undefined && (input as Record<string, unknown>)[camel(k)] !== null) });
  return presentFood(foodRow(ctx, id)!);
}

const camel = (k: NutrientKey) => ({ kcal: 'kcal', protein_g: 'proteinG', carbs_g: 'carbsG', fat_g: 'fatG', fibre_g: 'fibreG' } as const)[k];

export function updateFood(ctx: Ctx, id: string, patch: Partial<FoodInput>, reason: string) {
  const f = foodRow(ctx, id);
  if (!f) throw errors.notFound('Food');
  const merged = {
    servingGrams: patch.servingGrams !== undefined ? patch.servingGrams : f.serving_grams,
    kcal: patch.kcal !== undefined ? patch.kcal : f.kcal, proteinG: patch.proteinG !== undefined ? patch.proteinG : f.protein_g,
    carbsG: patch.carbsG !== undefined ? patch.carbsG : f.carbs_g, fatG: patch.fatG !== undefined ? patch.fatG : f.fat_g, fibreG: patch.fibreG !== undefined ? patch.fibreG : f.fibre_g,
  };
  const sourceRef = patch.sourceRef !== undefined ? patch.sourceRef : f.source_ref;
  assertSourced(merged, sourceRef);
  ctx.db.update('foods', id, {
    name: patch.name?.trim(), serving_label: patch.servingLabel?.trim(), serving_grams: patch.servingGrams, kcal: patch.kcal, protein_g: patch.proteinG,
    carbs_g: patch.carbsG, fat_g: patch.fatG, fibre_g: patch.fibreG, source_ref: patch.sourceRef !== undefined ? (patch.sourceRef?.trim() || null) : undefined,
    tags: patch.tags ? j.in(patch.tags) : undefined, updated_at: ctx.now(),
  });
  audit(ctx, 'food.update', { type: 'food', id }, reason, { changed: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) });
  return presentFood(foodRow(ctx, id)!);
}

export function setFoodStatus(ctx: Ctx, id: string, status: 'draft' | 'published' | 'archived', reason: string) {
  const f = foodRow(ctx, id);
  if (!f) throw errors.notFound('Food');
  if (f.status === status) return presentFood(f);
  ctx.db.update('foods', id, { status, updated_at: ctx.now() });
  audit(ctx, 'food.status', { type: 'food', id }, reason, { from: f.status, to: status });
  return presentFood(foodRow(ctx, id)!);
}

function checkIngredients(ctx: Ctx, scope: LibraryScope, list: RecipeInput['ingredients']): NonNullable<RecipeInput['ingredients']> {
  for (const i of list ?? []) {
    if (!i.foodId) continue;
    const f = foodRow(ctx, i.foodId);
    if (!f || !usable(scope, f)) throw errors.badRequest(`Ingredient "${i.label}" points at a food that is not in your library`, 'FOOD_UNAVAILABLE');
  }
  return list ?? [];
}

function checkImage(ctx: Ctx, assetId: string | null | undefined): void {
  if (!assetId) return;
  if (!ctx.db.get('SELECT 1 FROM assets WHERE id = ? AND deleted_at IS NULL', [assetId])) throw errors.badRequest('That image is not in the asset library', 'ASSET_UNKNOWN');
}

function writeIngredients(ctx: Ctx, recipeId: string, list: NonNullable<RecipeInput['ingredients']>): void {
  ctx.db.run('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [recipeId]);
  list.forEach((i, sort) => ctx.db.insert('recipe_ingredients', { id: nutritionIds.ingredient(), recipe_id: recipeId, food_id: i.foodId ?? null, label: i.label.trim(), quantity: i.quantity ?? null, unit: i.unit?.trim() ?? '', sort }));
}

export function createRecipe(ctx: Ctx, scope: LibraryScope, input: RecipeInput, opts: { source: 'coach' | 'team'; status?: 'draft' | 'published' }, reason?: string | null) {
  const ingredients = checkIngredients(ctx, scope, input.ingredients);
  checkImage(ctx, input.imageAssetId);
  const now = ctx.now();
  const id = nutritionIds.recipe();
  ctx.db.tx(() => {
    ctx.db.insert('recipes', {
      id, title: input.title.trim(), summary: input.summary?.trim() ?? '', method: sanitizeRichText(input.method ?? ''), servings: input.servings ?? null, prep_minutes: input.prepMinutes ?? null,
      tags: j.in(input.tags ?? []), image_asset_id: input.imageAssetId ?? null, status: opts.status ?? 'draft', source: opts.source, created_by: ctx.actor?.id ?? null, created_at: now, updated_at: now,
    });
    writeIngredients(ctx, id, ingredients);
    audit(ctx, 'recipe.create', { type: 'recipe', id }, reason ?? null, { source: opts.source, status: opts.status ?? 'draft', ingredients: ingredients.length });
  });
  return presentRecipe(ctx, recipeRow(ctx, id)!);
}

export function updateRecipe(ctx: Ctx, id: string, patch: Partial<RecipeInput>, reason: string) {
  const r = recipeRow(ctx, id);
  if (!r) throw errors.notFound('Recipe');
  const ingredients = patch.ingredients !== undefined ? checkIngredients(ctx, { kind: 'team' }, patch.ingredients) : null;
  if (patch.imageAssetId !== undefined) checkImage(ctx, patch.imageAssetId);
  ctx.db.tx(() => {
    ctx.db.update('recipes', id, {
      title: patch.title?.trim(), summary: patch.summary?.trim(), method: patch.method !== undefined ? sanitizeRichText(patch.method) : undefined,
      servings: patch.servings, prep_minutes: patch.prepMinutes, tags: patch.tags ? j.in(patch.tags) : undefined, image_asset_id: patch.imageAssetId, updated_at: ctx.now(),
    });
    if (ingredients) writeIngredients(ctx, id, ingredients);
    audit(ctx, 'recipe.update', { type: 'recipe', id }, reason, { changed: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) });
  });
  return presentRecipe(ctx, recipeRow(ctx, id)!);
}

export function setRecipeStatus(ctx: Ctx, id: string, status: 'draft' | 'published' | 'archived', reason: string) {
  const r = recipeRow(ctx, id);
  if (!r) throw errors.notFound('Recipe');
  if (r.status === status) return presentRecipe(ctx, r);
  ctx.db.update('recipes', id, { status, updated_at: ctx.now() });
  audit(ctx, 'recipe.status', { type: 'recipe', id }, reason, { from: r.status, to: status });
  return presentRecipe(ctx, recipeRow(ctx, id)!);
}

/* ---------- totals: only the values someone entered ---------- */

type Sums = Record<NutrientKey, number> & { counted: Record<NutrientKey, number> };
const emptySums = (): Sums => ({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0, counted: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 } });

/** One serving's values (null where unknown) and the sources they were read from. */
type Serving = { values: Record<NutrientKey, number | null>; sources: string[] };
const unknownServing = (): Serving => ({ values: { kcal: null, protein_g: null, carbs_g: null, fat_g: null, fibre_g: null }, sources: [] });
/** A source as assertSourced accepts one. Every value is entered with one; a value without one is never counted. */
const sourced = (ref: string | null): ref is string => !!ref && ref.trim().length >= 3;

/** One serving of a food: its entered values, null where nothing was entered, with their source. */
function foodServing(f: FoodRow): Serving {
  if (!sourced(f.source_ref)) return unknownServing();
  return { values: { kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, fibre_g: f.fibre_g }, sources: [f.source_ref.trim()] };
}

/** One serving of a recipe, from its ingredients' entered values: an ingredient counts when it is linked to a food and
 *  its quantity is in servings of that food, or in grams of a food whose serving weight was entered. Anything else
 *  leaves the value unknown (null) rather than guessed. The sources are those of the foods whose values were used. */
function recipeServing(ctx: Ctx, recipeId: string): Serving {
  const r = recipeRow(ctx, recipeId);
  if (!r || !r.servings) return unknownServing();
  const ingredients = ctx.db.all<IngredientRow>('SELECT * FROM recipe_ingredients WHERE recipe_id = ?', [recipeId]);
  if (!ingredients.length) return unknownServing();
  const out: Record<NutrientKey, number | null> = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
  const sources = new Set<string>();
  for (const i of ingredients) {
    const f = i.food_id ? foodRow(ctx, i.food_id) : undefined;
    const serving = f ? foodServing(f) : null;
    const unit = i.unit.trim().toLowerCase();
    const factor = !f || i.quantity === null ? null : ['serving', 'servings'].includes(unit) ? i.quantity : ['g', 'gram', 'grams'].includes(unit) && f.serving_grams ? i.quantity / f.serving_grams : null;
    for (const k of NUTRIENT_KEYS) {
      const v = serving ? serving.values[k] : null;
      out[k] = out[k] === null || factor === null || v === null ? null : out[k]! + v * factor;
    }
    if (serving && factor !== null) for (const s of serving.sources) sources.add(s);
  }
  for (const k of NUTRIENT_KEYS) if (out[k] !== null) out[k] = out[k]! / r.servings;
  return { values: out, sources: NUTRIENT_KEYS.some((k) => out[k] !== null) ? [...sources] : [] };
}

type SlotRow = { id: string; plan_version_id: string; day: number; slot: MealSlot; time_hint: string | null; recipe_id: string | null; food_id: string | null; title: string; portion_note: string; sort: number };

/** Totals per plan day: sums of the entered values, one serving per slot. complete is false when any slot of the day has
 *  no value for some nutrient (a slot without a food or recipe, a food without values, a recipe without servings). */
export function planTotals(ctx: Ctx, versionId: string) {
  const slots = ctx.db.all<SlotRow>('SELECT * FROM meal_plan_slots WHERE plan_version_id = ? ORDER BY day, sort', [versionId]);
  const days = new Map<number, { sums: Sums; slots: number; missing: number }>();
  for (const s of slots) {
    const day = days.get(s.day) ?? { sums: emptySums(), slots: 0, missing: 0 };
    day.slots++;
    const f = s.food_id ? foodRow(ctx, s.food_id) : undefined;
    const serving = f ? foodServing(f).values : s.recipe_id ? recipeServing(ctx, s.recipe_id).values : null;
    let slotMissing = !serving;
    for (const k of NUTRIENT_KEYS) {
      const v = serving?.[k] ?? null;
      if (v === null) { slotMissing = true; continue; }
      day.sums[k] += v;
      day.sums.counted[k]++;
    }
    if (slotMissing) day.missing++;
    days.set(s.day, day);
  }
  const out = [...days.entries()].sort((a, b) => a[0] - b[0]).map(([day, d]) => ({
    day, slots: d.slots, slotsMissingValues: d.missing, complete: d.missing === 0,
    kcal: d.sums.counted.kcal ? round1(d.sums.kcal) : null, protein_g: d.sums.counted.protein_g ? round1(d.sums.protein_g) : null,
    carbs_g: d.sums.counted.carbs_g ? round1(d.sums.carbs_g) : null, fat_g: d.sums.counted.fat_g ? round1(d.sums.fat_g) : null, fibre_g: d.sums.counted.fibre_g ? round1(d.sums.fibre_g) : null,
  }));
  return { days: out, complete: out.length > 0 && out.every((d) => d.complete), note: 'Sums only the nutrient values someone entered (one serving per slot). A day marked incomplete has slots without entered values, so its sums are lower bounds, not estimates.' };
}

/* ---------- the published library for members: search and saved dishes ---------- */

const roundValues = (values: Record<NutrientKey, number | null>) => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, values[k] === null ? null : round1(values[k]!)])) as Record<NutrientKey, number | null>;
const savedKey = (kind: 'food' | 'recipe', id: string) => `${kind}|${id}`;

/** The dishes the member saved, as savedKey()s. */
function savedDishes(ctx: Ctx, memberId: string): Set<string> {
  return new Set(ctx.db.all<{ kind: 'food' | 'recipe'; ref_id: string }>('SELECT kind, ref_id FROM nutrition_favourites WHERE member_id = ?', [memberId]).map((r) => savedKey(r.kind, r.ref_id)));
}

/** A published food as a member sees it: the values of one serving with their source (null where none was entered),
 *  its tags and whether they saved it; never who added it. */
function memberFood(f: FoodRow, saved: Set<string>) {
  const s = foodServing(f);
  return {
    kind: 'food' as const, id: f.id, name: f.name, servingLabel: f.serving_label, servingGrams: s.sources.length ? f.serving_grams : null,
    perServing: roundValues(s.values), nutrientsEntered: NUTRIENT_KEYS.filter((k) => s.values[k] !== null), sources: s.sources,
    tags: j.out<string[]>(f.tags, []), saved: saved.has(savedKey('food', f.id)),
  };
}

/** A published recipe as a member sees it: one serving's values from its ingredients' sourced values (null where any
 *  is unknown), the foods' sources, the ingredients, the image and whether they saved it. */
function memberRecipe(ctx: Ctx, r: RecipeRow, saved: Set<string>) {
  const s = recipeServing(ctx, r.id);
  const ingredients = ctx.db.all<IngredientRow & { food_name: string | null }>('SELECT i.*, f.name AS food_name FROM recipe_ingredients i LEFT JOIN foods f ON f.id = i.food_id WHERE i.recipe_id = ? ORDER BY i.sort', [r.id]);
  return {
    kind: 'recipe' as const, id: r.id, title: r.title, summary: r.summary, method: r.method, servings: r.servings, prepMinutes: r.prep_minutes,
    imageUrl: liveAsset(ctx, r.image_asset_id)?.url ?? null,
    perServing: roundValues(s.values), nutrientsEntered: NUTRIENT_KEYS.filter((k) => s.values[k] !== null), sources: s.sources,
    ingredients: ingredients.map((i) => ({ label: i.label, quantity: i.quantity, unit: i.unit, foodName: i.food_name })),
    tags: j.out<string[]>(r.tags, []), saved: saved.has(savedKey('recipe', r.id)),
  };
}

function libraryCursor(name: string, id: string): string { return Buffer.from(JSON.stringify([name, id])).toString('base64url'); }
function readLibraryCursor(cursor: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string') return [v[0], v[1]];
  } catch { /* refused below */ }
  throw errors.badRequest('cursor: pass the nextCursor of the previous page', 'CURSOR_INVALID');
}
const likeAny = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** The filters both searches share: words in the name (or title) or in a tag, one tag exactly (any case), and the page. */
function libraryWhere(nameColumn: string, opts: MemberLibraryQuery): { where: string[]; params: string[] } {
  const where = ["x.status = 'published'"];
  const params: string[] = [];
  if (opts.q) {
    const like = likeAny(opts.q);
    where.push(`(x.${nameColumn} LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM json_each(x.tags) t WHERE t.value LIKE ? ESCAPE '\\'))`);
    params.push(like, like);
  }
  if (opts.tag) { where.push('EXISTS (SELECT 1 FROM json_each(x.tags) t WHERE lower(t.value) = lower(?))'); params.push(opts.tag); }
  if (opts.cursor) {
    const [name, id] = readLibraryCursor(opts.cursor);
    where.push(`(x.${nameColumn} > ? OR (x.${nameColumn} = ? AND x.id > ?))`);
    params.push(name, name, id);
  }
  return { where, params };
}

const VALUES_NOTE = 'Values are per serving, as the Bioptime team or a coach entered them with their source. A value no one entered is empty: nothing is estimated.';

/** GET /me/foods: published foods only, by name, a page at a time. */
export function memberFoods(ctx: Ctx, memberId: string, opts: MemberLibraryQuery = {}) {
  const limit = opts.limit ?? 50;
  const { where, params } = libraryWhere('name', opts);
  const rows = ctx.db.all<FoodRow>(`SELECT x.* FROM foods x WHERE ${where.join(' AND ')} ORDER BY x.name, x.id LIMIT ?`, [...params, limit + 1]);
  const page = rows.slice(0, limit);
  const saved = savedDishes(ctx, memberId);
  return { items: page.map((f) => memberFood(f, saved)), nextCursor: rows.length > limit ? libraryCursor(page[page.length - 1]!.name, page[page.length - 1]!.id) : null, note: VALUES_NOTE };
}

/** GET /me/recipes: published recipes only, by title, a page at a time. */
export function memberRecipes(ctx: Ctx, memberId: string, opts: MemberLibraryQuery = {}) {
  const limit = opts.limit ?? 50;
  const { where, params } = libraryWhere('title', opts);
  const rows = ctx.db.all<RecipeRow>(`SELECT x.* FROM recipes x WHERE ${where.join(' AND ')} ORDER BY x.title, x.id LIMIT ?`, [...params, limit + 1]);
  const page = rows.slice(0, limit);
  const saved = savedDishes(ctx, memberId);
  return { items: page.map((r) => memberRecipe(ctx, r, saved)), nextCursor: rows.length > limit ? libraryCursor(page[page.length - 1]!.title, page[page.length - 1]!.id) : null, note: VALUES_NOTE };
}

/** The member's saved dishes that are still in the library, the latest saved first. */
export function memberFavourites(ctx: Ctx, memberId: string) {
  const saved = savedDishes(ctx, memberId);
  const foods = ctx.db.all<FoodRow>("SELECT x.* FROM nutrition_favourites v JOIN foods x ON x.id = v.ref_id WHERE v.member_id = ? AND v.kind = 'food' AND x.status = 'published' ORDER BY v.created_at DESC, v.rowid DESC", [memberId]);
  const recipes = ctx.db.all<RecipeRow>("SELECT x.* FROM nutrition_favourites v JOIN recipes x ON x.id = v.ref_id WHERE v.member_id = ? AND v.kind = 'recipe' AND x.status = 'published' ORDER BY v.created_at DESC, v.rowid DESC", [memberId]);
  return { foods: foods.map((f) => memberFood(f, saved)), recipes: recipes.map((r) => memberRecipe(ctx, r, saved)) };
}

/** The published food or recipe a member saves or logs; anything else (a draft, an archived item, another id) is not
 *  in the library as far as the member can see. */
function libraryDish(ctx: Ctx, ref: { foodId?: string | null; recipeId?: string | null }): { kind: 'food' | 'recipe'; id: string; name: string } {
  if (ref.foodId && ref.recipeId) throw errors.badRequest('A meal is one food or one recipe from the library, not both', 'DISH_INVALID');
  if (ref.foodId) {
    const f = foodRow(ctx, ref.foodId);
    if (!f || f.status !== 'published') throw errors.badRequest('That food is not in the library', 'FOOD_UNAVAILABLE');
    return { kind: 'food', id: f.id, name: f.name };
  }
  const r = ref.recipeId ? recipeRow(ctx, ref.recipeId) : undefined;
  if (!r || r.status !== 'published') throw errors.badRequest('That recipe is not in the library', 'RECIPE_UNAVAILABLE');
  return { kind: 'recipe', id: r.id, name: r.title };
}

/** Save or unsave a dish (PUT /me/nutrition/favourites). Idempotent: saving a saved dish or unsaving one that is not
 *  saved changes nothing and records nothing. Only a published dish can be saved; unsaving always works. */
export function setFavourite(ctx: Ctx, memberId: string, input: FavouriteInput) {
  const exists = !!ctx.db.get('SELECT 1 FROM nutrition_favourites WHERE member_id = ? AND kind = ? AND ref_id = ?', [memberId, input.kind, input.id]);
  if (input.saved) {
    libraryDish(ctx, input.kind === 'food' ? { foodId: input.id } : { recipeId: input.id });
    if (!exists) {
      ctx.db.insert('nutrition_favourites', { member_id: memberId, kind: input.kind, ref_id: input.id, created_at: ctx.now() });
      audit(ctx, 'nutrition.favourite', { type: 'user', id: memberId }, null, { kind: input.kind, refId: input.id, saved: true });
    }
  } else if (exists) {
    ctx.db.run('DELETE FROM nutrition_favourites WHERE member_id = ? AND kind = ? AND ref_id = ?', [memberId, input.kind, input.id]);
    audit(ctx, 'nutrition.favourite', { type: 'user', id: memberId }, null, { kind: input.kind, refId: input.id, saved: false });
  }
  return { kind: input.kind, id: input.id, saved: input.saved };
}

/* ---------- meal plans ---------- */

type PlanRow = { id: string; member_id: string; coach_id: string; programme_id: string | null; title: string; status: string; current_version: number; created_at: string; updated_at: string; archived_at: string | null; coach_name: string; member_name: string };
/** title (0025_nutrition_fixes.sql): a new title typed while a published plan has this draft open; NULL keeps the plan's. */
type VersionRow = { id: string; plan_id: string; version: number; summary: string; targets: string; status: string; title: string | null; created_by: string; created_at: string; published_at: string | null };

function planRow(ctx: Ctx, id: string): PlanRow | undefined {
  return ctx.db.get<PlanRow>('SELECT p.*, c.name AS coach_name, m.name AS member_name FROM meal_plans p JOIN users c ON c.id = p.coach_id JOIN users m ON m.id = p.member_id WHERE p.id = ?', [id]);
}

export function presentSlots(ctx: Ctx, versionId: string) {
  return ctx.db.all<SlotRow>('SELECT * FROM meal_plan_slots WHERE plan_version_id = ? ORDER BY day, sort', [versionId]).map((s) => {
    const f = s.food_id ? foodRow(ctx, s.food_id) : undefined;
    const r = s.recipe_id ? recipeRow(ctx, s.recipe_id) : undefined;
    return {
      id: s.id, day: s.day, slot: s.slot, timeHint: s.time_hint, title: s.title, portionNote: s.portion_note, sort: s.sort,
      food: f ? { id: f.id, name: f.name, servingLabel: f.serving_label, servingGrams: f.serving_grams, kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g, fibre_g: f.fibre_g, sourceRef: f.source_ref, status: f.status } : null,
      recipe: r ? { id: r.id, title: r.title, summary: r.summary, method: r.method, servings: r.servings, prepMinutes: r.prep_minutes, imageUrl: liveAsset(ctx, r.image_asset_id)?.url ?? null, status: r.status } : null,
    };
  });
}

function presentVersion(ctx: Ctx, v: VersionRow) {
  return { id: v.id, version: v.version, status: v.status, summary: v.summary, targets: j.out<MealTargets>(v.targets, {}), createdAt: v.created_at, publishedAt: v.published_at, slots: presentSlots(ctx, v.id), totals: planTotals(ctx, v.id) };
}

/** A meal plan with its version history. `version` is the draft when includeDraft asks for it and one exists, else the
 *  version the member sees (the current published one). */
export function presentMealPlan(ctx: Ctx, planId: string, opts: { includeDraft?: boolean } = {}) {
  const p = planRow(ctx, planId);
  if (!p) throw errors.notFound('Meal plan');
  const versions = ctx.db.all<VersionRow>('SELECT * FROM meal_plan_versions WHERE plan_id = ? ORDER BY version DESC', [planId]);
  const published = versions.find((v) => v.status === 'published' && v.version === p.current_version) ?? null;
  const draft = versions.find((v) => v.status === 'draft') ?? null;
  const shown = opts.includeDraft && draft ? draft : published;
  // the member sees the published title; the coach sees the one their open draft will publish
  const title = (opts.includeDraft && draft?.title) || p.title;
  return {
    id: p.id, memberId: p.member_id, memberName: p.member_name, coachId: p.coach_id, coachName: p.coach_name, programmeId: p.programme_id, title, status: p.status,
    currentVersion: p.current_version, createdAt: p.created_at, updatedAt: p.updated_at, archivedAt: p.archived_at, hasDraft: !!draft,
    version: shown ? presentVersion(ctx, shown) : null,
    versions: (opts.includeDraft ? versions : versions.filter((v) => v.status === 'published')).map((v) => ({ id: v.id, version: v.version, status: v.status, summary: v.summary, createdAt: v.created_at, publishedAt: v.published_at })),
  };
}
export type PresentedMealPlan = ReturnType<typeof presentMealPlan>;

/** The foods and recipes a plan already uses (in its latest version: the open draft, else the last published one). */
type OnPlan = { foods: Set<string>; recipes: Set<string> };
function itemsOnPlan(ctx: Ctx, planId: string): OnPlan {
  const latest = ctx.db.get<{ id: string }>('SELECT id FROM meal_plan_versions WHERE plan_id = ? ORDER BY version DESC LIMIT 1', [planId]);
  const rows = latest ? ctx.db.all<{ food_id: string | null; recipe_id: string | null }>('SELECT food_id, recipe_id FROM meal_plan_slots WHERE plan_version_id = ?', [latest.id]) : [];
  return { foods: new Set(rows.flatMap((r) => (r.food_id ? [r.food_id] : []))), recipes: new Set(rows.flatMap((r) => (r.recipe_id ? [r.recipe_id] : []))) };
}

/** Checks every slot's food or recipe against what the plan's author may use, and fills a missing title from it. A food
 *  or recipe the plan already uses stays usable (for example a previous coach's draft after a handover, or an item
 *  the team archived since): only newly added ones are checked against the acting coach's library. */
function resolveSlots(ctx: Ctx, coachId: string, slots: MealSlotInput[], onPlan: OnPlan = { foods: new Set(), recipes: new Set() }) {
  const scope: LibraryScope = { kind: 'coach', coachId };
  return slots.map((s, i) => {
    if (s.foodId && s.recipeId) throw errors.badRequest(`Slot ${i + 1}: a slot holds a food or a recipe, not both`, 'SLOT_INVALID');
    let title = s.title?.trim() ?? '';
    if (s.foodId) {
      const f = foodRow(ctx, s.foodId);
      if (!f || !(onPlan.foods.has(f.id) || usable(scope, f))) throw errors.badRequest(`Slot ${i + 1}: that food is not in your library`, 'FOOD_UNAVAILABLE');
      title = title || f.name;
    }
    if (s.recipeId) {
      const r = recipeRow(ctx, s.recipeId);
      if (!r || !(onPlan.recipes.has(r.id) || usable(scope, r))) throw errors.badRequest(`Slot ${i + 1}: that recipe is not in your library`, 'RECIPE_UNAVAILABLE');
      title = title || r.title;
    }
    if (title.length < 2) throw errors.validation([{ path: `slots.${i}.title`, message: 'Name the meal, or pick a food or recipe' }], `Slot ${i + 1}: name the meal, or pick a food or recipe`);
    return { day: s.day, slot: s.slot, time_hint: s.timeHint?.trim() || null, food_id: s.foodId ?? null, recipe_id: s.recipeId ?? null, title, portion_note: s.portionNote?.trim() ?? '' };
  });
}

function writeSlots(ctx: Ctx, versionId: string, slots: ReturnType<typeof resolveSlots>): void {
  ctx.db.run('DELETE FROM meal_plan_slots WHERE plan_version_id = ?', [versionId]);
  const order = (s: { day: number; slot: MealSlot }) => s.day * 10 + MEAL_SLOTS.indexOf(s.slot);
  [...slots].sort((a, b) => order(a) - order(b)).forEach((s, sort) => ctx.db.insert('meal_plan_slots', { id: nutritionIds.mealPlanSlot(), plan_version_id: versionId, ...s, sort }));
}

export function createMealPlan(ctx: Ctx, input: { coachId: string; memberId: string; programmeId?: string | null; title: string; summary?: string; targets?: MealTargets; slots?: MealSlotInput[] }) {
  const slots = resolveSlots(ctx, input.coachId, input.slots ?? []);
  const now = ctx.now();
  const id = nutritionIds.mealPlan();
  ctx.db.tx(() => {
    ctx.db.insert('meal_plans', { id, member_id: input.memberId, coach_id: input.coachId, programme_id: input.programmeId ?? null, title: input.title.trim(), status: 'draft', current_version: 0, created_at: now, updated_at: now });
    const vid = nutritionIds.mealPlanVersion();
    ctx.db.insert('meal_plan_versions', { id: vid, plan_id: id, version: 1, summary: input.summary?.trim() ?? '', targets: j.in(input.targets ?? {}), status: 'draft', created_by: ctx.actor?.id ?? input.coachId, created_at: now });
    writeSlots(ctx, vid, slots);
    audit(ctx, 'meal_plan.create', { type: 'meal_plan', id }, null, { memberId: input.memberId, slots: slots.length });
  });
  return presentMealPlan(ctx, id, { includeDraft: true });
}

/** Edits the draft; on a published plan the first edit opens the next version as a copy of the last one. */
export function updateMealPlanDraft(ctx: Ctx, planId: string, patch: { title?: string; summary?: string; targets?: MealTargets; slots?: MealSlotInput[] }) {
  const p = planRow(ctx, planId);
  if (!p) throw errors.notFound('Meal plan');
  if (p.status === 'archived') throw errors.state('This meal plan is archived; start a new one');
  const slots = patch.slots ? resolveSlots(ctx, ctx.actor?.role === 'coach' ? ctx.actor.id : p.coach_id, patch.slots, itemsOnPlan(ctx, planId)) : null;
  const now = ctx.now();
  ctx.db.tx(() => {
    let draft = ctx.db.get<{ id: string; version: number }>("SELECT id, version FROM meal_plan_versions WHERE plan_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1", [planId]);
    if (!draft) {
      // a published plan gets a new draft version; the published one stays live until the draft is published
      const last = ctx.db.get<VersionRow>('SELECT * FROM meal_plan_versions WHERE plan_id = ? ORDER BY version DESC LIMIT 1', [planId])!;
      const vid = nutritionIds.mealPlanVersion();
      ctx.db.insert('meal_plan_versions', { id: vid, plan_id: planId, version: last.version + 1, summary: last.summary, targets: last.targets, status: 'draft', created_by: ctx.actor?.id ?? p.coach_id, created_at: now });
      for (const s of ctx.db.all<SlotRow>('SELECT * FROM meal_plan_slots WHERE plan_version_id = ? ORDER BY sort', [last.id])) {
        ctx.db.insert('meal_plan_slots', { id: nutritionIds.mealPlanSlot(), plan_version_id: vid, day: s.day, slot: s.slot, time_hint: s.time_hint, recipe_id: s.recipe_id, food_id: s.food_id, title: s.title, portion_note: s.portion_note, sort: s.sort });
      }
      draft = { id: vid, version: last.version + 1 };
    }
    // a plan the member has seen keeps its published title until this draft is published; one never published has
    // nothing to keep, so its title changes at once
    const title = patch.title?.trim();
    const seenByMember = p.current_version > 0;
    ctx.db.update('meal_plan_versions', draft.id, { summary: patch.summary?.trim(), targets: patch.targets ? j.in(patch.targets) : undefined, title: seenByMember ? title : undefined });
    if (slots) writeSlots(ctx, draft.id, slots);
    ctx.db.update('meal_plans', planId, { title: seenByMember ? undefined : title, updated_at: now });
    audit(ctx, 'meal_plan.update_draft', { type: 'meal_plan', id: planId }, null, { version: draft.version, changed: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) });
  });
  return presentMealPlan(ctx, planId, { includeDraft: true });
}

/** Publishing freezes the draft, makes it the version the member sees and tells the member. */
export function publishMealPlan(ctx: Ctx, planId: string) {
  return ctx.db.tx(() => {
    const p = planRow(ctx, planId);
    if (!p) throw errors.notFound('Meal plan');
    if (p.status === 'archived') throw errors.state('This meal plan is archived; start a new one');
    const draft = ctx.db.get<VersionRow>("SELECT * FROM meal_plan_versions WHERE plan_id = ? AND status = 'draft' ORDER BY version DESC LIMIT 1", [planId]);
    if (!draft) throw errors.state('Nothing to publish: there is no draft version');
    const slots = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM meal_plan_slots WHERE plan_version_id = ?', [draft.id])!.n;
    if (!slots) throw errors.badRequest('Add at least one meal before publishing', 'PLAN_EMPTY');
    const now = ctx.now();
    ctx.db.update('meal_plan_versions', draft.id, { status: 'published', published_at: now });
    ctx.db.update('meal_plans', planId, { status: 'published', current_version: draft.version, title: draft.title ?? undefined, updated_at: now });
    // the plan's title is typed by the coach and can say something about the member's health, so it stays out of the
    // notification altogether (an email template may quote the body); the member reads it in the app
    notify(ctx, { userId: p.member_id, category: 'nutrition', title: draft.version === 1 ? 'Your meal plan is ready' : 'Your meal plan was updated', body: 'Your meals for each day of the week are ready to see.', data: { mealPlanId: planId, version: draft.version }, sensitive: true });
    emit(ctx, 'MealPlanPublished', { type: 'meal_plan', id: planId }, { memberId: p.member_id, version: draft.version });
    audit(ctx, 'meal_plan.publish', { type: 'meal_plan', id: planId }, null, { version: draft.version, slots });
    return presentMealPlan(ctx, planId, { includeDraft: true });
  });
}

export function archiveMealPlan(ctx: Ctx, planId: string, reason: string) {
  const p = planRow(ctx, planId);
  if (!p) throw errors.notFound('Meal plan');
  if (p.status === 'archived') throw errors.state('This meal plan is already archived');
  const now = ctx.now();
  ctx.db.update('meal_plans', planId, { status: 'archived', archived_at: now, updated_at: now });
  audit(ctx, 'meal_plan.archive', { type: 'meal_plan', id: planId }, reason, { previous: p.status });
  return presentMealPlan(ctx, planId, { includeDraft: true });
}

/** The member's meal plan: the most recently published one that is not archived, at its current version. */
export function memberMealPlan(ctx: Ctx, memberId: string) {
  const p = ctx.db.get<{ id: string }>("SELECT id FROM meal_plans WHERE member_id = ? AND status = 'published' ORDER BY updated_at DESC LIMIT 1", [memberId]);
  return p ? presentMealPlan(ctx, p.id) : null;
}

export function listMealPlans(ctx: Ctx, memberId: string) {
  return ctx.db.all<{ id: string }>("SELECT id FROM meal_plans WHERE member_id = ? ORDER BY status = 'archived', updated_at DESC", [memberId]).map((r) => presentMealPlan(ctx, r.id, { includeDraft: true }));
}

/** The meal plans of every member the coach is currently assigned to (active or paused), as one list for the coach's
 *  Meal plans page and dashboard (GET /coach/meal-plans): what each client's Nutrition tab lists, summarised (no
 *  slots), without the member's own nutrition preferences or logs, so no health record is read and nothing is audited
 *  as a health view. The title and summary are those of the open draft when there is one (as the coach's editor shows
 *  them), else the published version's. Filters: status, one member, a text search over the title and the member's
 *  name. counts are over the coach's whole list, before the filters. */
export function coachMealPlans(ctx: Ctx, coachId: string, opts: { status?: 'draft' | 'published' | 'archived'; memberId?: string; q?: string } = {}) {
  const mine = "p.member_id IN (SELECT a.member_id FROM coach_assignments a WHERE a.coach_id = ? AND a.status IN ('active','paused'))";
  const where: string[] = [mine];
  const params: string[] = [coachId];
  if (opts.status) { where.push('p.status = ?'); params.push(opts.status); }
  if (opts.memberId) { where.push('p.member_id = ?'); params.push(opts.memberId); }
  if (opts.q) {
    const like = `%${opts.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    where.push("(p.title LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  type Row = PlanRow & { d_id: string | null; d_title: string | null; d_summary: string | null; v_id: string | null; v_summary: string | null; v_published_at: string | null };
  const rows = ctx.db.all<Row>(`SELECT p.*, m.name AS member_name, c.name AS coach_name,
      d.id AS d_id, d.title AS d_title, d.summary AS d_summary, v.id AS v_id, v.summary AS v_summary, v.published_at AS v_published_at
    FROM meal_plans p JOIN users m ON m.id = p.member_id JOIN users c ON c.id = p.coach_id
    LEFT JOIN meal_plan_versions d ON d.plan_id = p.id AND d.status = 'draft'
    LEFT JOIN meal_plan_versions v ON v.plan_id = p.id AND v.status = 'published' AND v.version = p.current_version
    WHERE ${where.join(' AND ')}
    ORDER BY CASE p.status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, p.updated_at DESC LIMIT 500`, params);
  // meals and days of the shown version, and how its meals repeat (frequency): 'daily' when all seven days hold the
  // same meals (slot and title), 'weekly' when the meals change across the week or skip days, 'empty' with no meals
  const shape = (versionId: string | null): { meals: number; days: number; frequency: 'daily' | 'weekly' | 'empty' } => {
    const slots = versionId ? ctx.db.all<{ day: number; slot: string; title: string }>('SELECT day, slot, title FROM meal_plan_slots WHERE plan_version_id = ? ORDER BY day, sort', [versionId]) : [];
    const byDay = new Map<number, string>();
    for (const x of slots) byDay.set(x.day, `${byDay.get(x.day) ?? ''}|${x.slot}:${x.title.trim().toLowerCase()}`);
    const frequency = !slots.length ? 'empty' : byDay.size === 7 && new Set(byDay.values()).size === 1 ? 'daily' : 'weekly';
    return { meals: slots.length, days: byDay.size, frequency };
  };
  const items = rows.map((r) => ({
    id: r.id, memberId: r.member_id, memberName: r.member_name, coachId: r.coach_id, coachName: r.coach_name,
    title: r.d_title || r.title, status: r.status, currentVersion: r.current_version, hasDraft: !!r.d_id,
    summary: (r.d_id ? r.d_summary : r.v_summary) ?? '', ...shape(r.d_id ?? r.v_id),
    publishedAt: r.v_published_at, createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at,
  }));
  const counts = ctx.db.get<{ total: number; draft: number; published: number; archived: number; withDraft: number }>(`SELECT COUNT(*) total, SUM(p.status = 'draft') draft, SUM(p.status = 'published') published, SUM(p.status = 'archived') archived,
      SUM(EXISTS (SELECT 1 FROM meal_plan_versions dv WHERE dv.plan_id = p.id AND dv.status = 'draft')) withDraft FROM meal_plans p WHERE ${mine}`, [coachId])!;
  return { items, counts: { total: counts.total ?? 0, draft: counts.draft ?? 0, published: counts.published ?? 0, archived: counts.archived ?? 0, withOpenDraft: counts.withDraft ?? 0 } };
}

/** "Assign this plan to another client" on the coach's Meal plans page: a new draft meal plan for one of the coach's
 *  clients, with the meals and targets of one of the coach's plans (its open draft when there is one, else the version
 *  its client sees, else its latest). The caller (the route) has checked that both clients are the coach's. Every
 *  food and recipe is checked against the coach's own library, as for a new plan: a previous coach's draft item on the
 *  source plan is refused (FOOD_UNAVAILABLE / RECIPE_UNAVAILABLE) rather than spread to another client. Nothing reaches
 *  the client until the coach publishes the draft. Audited as meal_plan.create plus meal_plan.copy (from which plan). */
export function copyMealPlan(ctx: Ctx, input: { coachId: string; sourcePlanId: string; memberId: string; title?: string; summary?: string }) {
  const src = planRow(ctx, input.sourcePlanId);
  if (!src) throw errors.notFound('Meal plan');
  const version = ctx.db.get<VersionRow>("SELECT * FROM meal_plan_versions WHERE plan_id = ? ORDER BY CASE WHEN status = 'draft' THEN 0 WHEN status = 'published' AND version = ? THEN 1 ELSE 2 END, version DESC LIMIT 1", [src.id, src.current_version]);
  const slots: MealSlotInput[] = version ? ctx.db.all<SlotRow>('SELECT * FROM meal_plan_slots WHERE plan_version_id = ? ORDER BY day, sort', [version.id]).map((s) => ({ day: s.day, slot: s.slot, timeHint: s.time_hint, recipeId: s.recipe_id, foodId: s.food_id, title: s.title, portionNote: s.portion_note })) : [];
  const programme = ctx.db.get<{ id: string }>("SELECT id FROM programmes WHERE member_id = ? AND status = 'active' ORDER BY start_at DESC LIMIT 1", [input.memberId]);
  return ctx.db.tx(() => {
    const out = createMealPlan(ctx, { coachId: input.coachId, memberId: input.memberId, programmeId: programme?.id ?? null, title: input.title?.trim() || version?.title || src.title, summary: input.summary ?? version?.summary ?? '', targets: j.out<MealTargets>(version?.targets, {}), slots });
    audit(ctx, 'meal_plan.copy', { type: 'meal_plan', id: out.id }, null, { from: src.id, fromVersion: version?.version ?? null, memberId: input.memberId, slots: slots.length });
    return out;
  });
}

/** When a member gets a new coach, their open meal plans move to that coach (the outbox runs this on CoachAssigned). */
export function handOverMealPlans(ctx: Ctx, memberId: string, coachId: string): number {
  const plans = ctx.db.all<{ id: string; coach_id: string }>("SELECT id, coach_id FROM meal_plans WHERE member_id = ? AND status != 'archived' AND coach_id != ?", [memberId, coachId]);
  for (const p of plans) {
    ctx.db.update('meal_plans', p.id, { coach_id: coachId, updated_at: ctx.now() });
    audit(ctx, 'meal_plan.handover', { type: 'meal_plan', id: p.id }, 'the member was assigned a new coach', { from: p.coach_id, to: coachId });
  }
  return plans.length;
}

/* ---------- meal logs ---------- */

/** food_id, recipe_id and portion (0042_nutrition_search.sql): the published dish a log was picked from and the portion
 *  eaten; null on every other log. */
type LogRow = { id: string; member_id: string; slot_id: string | null; date: string; slot: MealSlot; description: string; outcome: string; photo_file_id: string | null; note: string | null; source: string; created_by: string | null; created_at: string; updated_at: string; deleted_at: string | null; food_id: string | null; recipe_id: string | null; portion: number | null };

/** What one logged meal adds to a day: a planned meal logged as planned adds one serving of its slot's food or recipe
 *  (as the plan's totals count it); a dish from the library adds one serving times the portion. A swap or an extra meal
 *  without a dish, and a planned meal logged as planned that names neither, add nothing (null); a skipped meal is not
 *  eaten (null). Values are those entered with their source, read now. */
type LogValues = { values: Record<NutrientKey, number | null>; from: 'plan' | 'dish'; sources: string[] };
function logValues(ctx: Ctx, l: LogRow, cache: Map<string, Serving>): LogValues | null {
  if (l.outcome === 'skipped') return null;
  const serving = (foodId: string | null, recipeId: string | null): Serving | null => {
    const key = foodId ? savedKey('food', foodId) : recipeId ? savedKey('recipe', recipeId) : null;
    if (!key) return null;
    let s = cache.get(key);
    if (!s) { const f = foodId ? foodRow(ctx, foodId) : undefined; s = foodId ? (f ? foodServing(f) : unknownServing()) : recipeServing(ctx, recipeId!); cache.set(key, s); }
    return s;
  };
  if (l.food_id || l.recipe_id) {
    const s = serving(l.food_id, l.recipe_id)!;
    const portion = l.portion ?? 1;
    return { values: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, s.values[k] === null ? null : s.values[k]! * portion])) as Record<NutrientKey, number | null>, from: 'dish', sources: s.sources };
  }
  if (l.slot_id && l.outcome === 'as_planned') {
    const planned = ctx.db.get<{ food_id: string | null; recipe_id: string | null }>('SELECT food_id, recipe_id FROM meal_plan_slots WHERE id = ?', [l.slot_id]);
    const s = planned ? serving(planned.food_id, planned.recipe_id) : null;
    return s ? { values: s.values, from: 'plan', sources: s.sources } : null;
  }
  return null;
}

/** The totals of a day's logs (GET /me/nutrition todayTotals): each nutrient summed over the meals that have a sourced
 *  value for it (null when none has), how many meals counted for each, how many meals were eaten (all but skipped
 *  ones) and how many of those add no value at all (missing), and the sources the counted values were read from.
 *  Nothing is estimated: a meal without values is named, never guessed. */
function mealTotals(ctx: Ctx, rows: LogRow[]) {
  const sums = emptySums();
  const sources = new Set<string>();
  const cache = new Map<string, Serving>();
  let meals = 0, missing = 0;
  for (const l of rows) {
    if (l.outcome === 'skipped' || l.deleted_at) continue;
    meals++;
    const v = logValues(ctx, l, cache);
    const known = v ? NUTRIENT_KEYS.filter((k) => v.values[k] !== null) : [];
    if (!known.length) { missing++; continue; }
    for (const k of known) { sums[k] += v!.values[k]!; sums.counted[k]++; }
    for (const s of v!.sources) sources.add(s);
  }
  return {
    kcal: sums.counted.kcal ? round1(sums.kcal) : null, protein_g: sums.counted.protein_g ? round1(sums.protein_g) : null, carbs_g: sums.counted.carbs_g ? round1(sums.carbs_g) : null,
    fat_g: sums.counted.fat_g ? round1(sums.fat_g) : null, fibre_g: sums.counted.fibre_g ? round1(sums.fibre_g) : null,
    counted: sums.counted, meals, missing, sources: [...sources],
    note: 'Adds up only values entered with their source: a planned meal logged as planned counts its planned food or recipe, and a dish picked from the library counts one serving times the portion. A swap or an extra meal without a dish has no values and is counted as missing; skipped meals add nothing. Nothing is estimated.',
  };
}

function presentLogs(ctx: Ctx, rows: LogRow[]) {
  const feedback = new Map<string, Array<{ id: string; body: string; coachName: string; createdAt: string }>>();
  if (rows.length) {
    const notes = ctx.db.all<{ id: string; body: string; ref_id: string; created_at: string; coach_name: string }>(`SELECT n.id, n.body, n.ref_id, n.created_at, u.name AS coach_name FROM coach_notes n JOIN users u ON u.id = n.coach_id WHERE n.ref_type = 'meal_log' AND n.visibility = 'client' AND n.ref_id IN (${rows.map(() => '?').join(', ')}) ORDER BY n.created_at`, rows.map((r) => r.id));
    for (const n of notes) feedback.set(n.ref_id, [...(feedback.get(n.ref_id) ?? []), { id: n.id, body: n.body, coachName: n.coach_name, createdAt: n.created_at }]);
  }
  const cache = new Map<string, Serving>();
  return rows.map((r) => {
    const v = logValues(ctx, r, cache);
    const dish = r.food_id ? { kind: 'food' as const, id: r.food_id, name: foodRow(ctx, r.food_id)?.name ?? null } : r.recipe_id ? { kind: 'recipe' as const, id: r.recipe_id, name: recipeRow(ctx, r.recipe_id)?.title ?? null } : null;
    return {
      id: r.id, memberId: r.member_id, slotId: r.slot_id, date: r.date, slot: r.slot, description: r.description, outcome: r.outcome, note: r.note, source: r.source, photoFileId: r.photo_file_id, hasPhoto: !!r.photo_file_id, createdAt: r.created_at, updatedAt: r.updated_at, feedback: feedback.get(r.id) ?? [],
      dish, portion: r.portion,
      // what this meal adds to the day's totals: null when it adds nothing (see logValues)
      values: v && NUTRIENT_KEYS.some((k) => v.values[k] !== null) ? { ...roundValues(v.values), from: v.from, sources: v.sources } : null,
    };
  });
}
export type PresentedLog = ReturnType<typeof presentLogs>[number];

const MAX_RANGE_DAYS = 92;
const BACKDATE_DAYS = 60;

/** A date range on local dates; defaults to the last 14 days and never spans more than 92. */
export function logRange(ctx: Ctx, from?: string, to?: string): { from: string; to: string } {
  const today = localToday(ctx);
  const end = to ?? today;
  const start = from ?? addDays(`${end}T00:00:00.000Z`, -13).slice(0, 10);
  if (start > end) throw errors.badRequest('from must be on or before to', 'RANGE_INVALID');
  if (dateRange(start, end).length > MAX_RANGE_DAYS) throw errors.badRequest(`Ask for at most ${MAX_RANGE_DAYS} days at a time`, 'RANGE_TOO_LONG');
  return { from: start, to: end };
}

function logRows(ctx: Ctx, memberId: string, range: { from: string; to: string }): LogRow[] {
  return ctx.db.all<LogRow>('SELECT * FROM meal_logs WHERE member_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ? ORDER BY date DESC, created_at DESC LIMIT 500', [memberId, range.from, range.to]);
}

export function listLogs(ctx: Ctx, memberId: string, range: { from: string; to: string }) {
  return presentLogs(ctx, logRows(ctx, memberId, range));
}

function ownLog(ctx: Ctx, memberId: string, logId: string): LogRow {
  const l = ctx.db.get<LogRow>('SELECT * FROM meal_logs WHERE id = ?', [logId]);
  if (!l || l.member_id !== memberId || l.deleted_at) throw errors.notFound('Meal log');
  return l;
}

/** The planned slot a log points at: it must belong to the current published version of one of this member's meal
 *  plans that is still published (not a version a newer one replaced, not an archived plan) and to the weekday of the
 *  logged date. Anything else is SLOT_UNKNOWN, so the app reloads the plan. */
function plannedSlot(ctx: Ctx, memberId: string, slotId: string, date: string): SlotRow {
  const s = ctx.db.get<SlotRow & { member_id: string; version_status: string; version: number; current_version: number; plan_status: string }>('SELECT s.*, p.member_id, v.status AS version_status, v.version, p.current_version, p.status AS plan_status FROM meal_plan_slots s JOIN meal_plan_versions v ON v.id = s.plan_version_id JOIN meal_plans p ON p.id = v.plan_id WHERE s.id = ?', [slotId]);
  if (!s || s.member_id !== memberId || s.version_status !== 'published' || s.version !== s.current_version || s.plan_status !== 'published') throw errors.badRequest('That meal is not in your current meal plan. Reload to see the latest version.', 'SLOT_UNKNOWN');
  if (s.day !== planDayOf(date)) throw errors.badRequest('That planned meal is for another day of the week', 'SLOT_DAY_MISMATCH');
  return s;
}

export function logMeal(ctx: Ctx, memberId: string, input: MealLogInput, source: 'member' | 'coach' = 'member') {
  const today = localToday(ctx);
  if (input.date > today) throw errors.badRequest('A meal cannot be logged for a future date', 'DATE_IN_FUTURE');
  if (input.date < addDays(`${today}T00:00:00.000Z`, -BACKDATE_DAYS).slice(0, 10)) throw errors.badRequest(`Meals can be logged for the last ${BACKDATE_DAYS} days`, 'DATE_TOO_OLD');
  // a dish from the library is what was eaten instead of a planned meal, or an extra meal; its name says what it was
  const dish = input.foodId || input.recipeId ? libraryDish(ctx, input) : null;
  if (!dish && input.portion !== undefined && input.portion !== null) throw errors.badRequest('A portion goes with a food or recipe from the library', 'PORTION_WITHOUT_DISH');
  if (dish && input.outcome !== 'extra' && input.outcome !== 'swapped') throw errors.badRequest('A dish from the library is logged as an extra meal, or as a swap for a planned one', 'OUTCOME_INVALID');
  let slot = input.slot;
  let description = input.description?.trim() || dish?.name || '';
  if (input.slotId) {
    if (input.outcome === 'extra') throw errors.badRequest('An extra meal is not one of the planned meals: log it without a planned meal', 'OUTCOME_INVALID');
    const s = plannedSlot(ctx, memberId, input.slotId, input.date);
    slot = s.slot;
    if (input.outcome === 'swapped' && description.length < 2) throw errors.validation([{ path: 'description', message: 'Say what you ate instead' }], 'description: say what you ate instead');
    if (!description) description = s.title;
    if (ctx.db.get('SELECT 1 FROM meal_logs WHERE member_id = ? AND slot_id = ? AND date = ? AND deleted_at IS NULL', [memberId, input.slotId, input.date])) throw errors.conflict('This planned meal is already logged for that day; change the existing entry instead', 'ALREADY_LOGGED');
  } else {
    if (!slot) throw errors.validation([{ path: 'slot', message: 'Pick the meal (breakfast, lunch …)' }], 'slot: pick the meal (breakfast, lunch …)');
    if (description.length < 2) throw errors.validation([{ path: 'description', message: 'Say what you ate (or skipped)' }], 'description: say what you ate (or skipped)');
  }
  const now = ctx.now();
  const id = nutritionIds.mealLog();
  const portion = dish ? (input.portion ?? 1) : null;
  ctx.db.insert('meal_logs', { id, member_id: memberId, slot_id: input.slotId ?? null, date: input.date, slot: slot!, description, outcome: input.outcome, photo_file_id: null, note: input.note?.trim() || null, source, created_by: ctx.actor?.id ?? null, created_at: now, updated_at: now, food_id: dish?.kind === 'food' ? dish.id : null, recipe_id: dish?.kind === 'recipe' ? dish.id : null, portion });
  audit(ctx, 'meal_log.create', { type: 'meal_log', id }, null, { memberId, date: input.date, slot, outcome: input.outcome, planned: !!input.slotId, source, dish: dish?.kind ?? null, portion });
  return presentLogs(ctx, [ctx.db.get<LogRow>('SELECT * FROM meal_logs WHERE id = ?', [id])!])[0]!;
}

export function updateLog(ctx: Ctx, memberId: string, logId: string, patch: { description?: string; outcome?: MealLogInput['outcome']; note?: string | null; portion?: number }) {
  const l = ownLog(ctx, memberId, logId);
  // the rules logMeal applies, applied again to the entry as it would be after the change
  if (patch.outcome === 'extra' && l.slot_id) throw errors.badRequest('A planned meal cannot become an extra meal; log the extra separately', 'OUTCOME_INVALID');
  const dish = !!(l.food_id || l.recipe_id);
  if (dish && patch.outcome !== undefined && patch.outcome !== 'extra' && patch.outcome !== 'swapped') throw errors.badRequest('A dish from the library stays an extra meal or a swap; log the planned meal separately', 'OUTCOME_INVALID');
  if (!dish && patch.portion !== undefined) throw errors.badRequest('A portion goes with a food or recipe from the library', 'PORTION_WITHOUT_DISH');
  if (patch.description !== undefined && patch.description.trim().length < 2) throw errors.validation([{ path: 'description', message: 'Say what you ate (or skipped)' }], 'description: say what you ate (or skipped)');
  // a planned meal that becomes a swap says what was eaten instead, as it must when logged as one; the planned meal's
  // own name, which a planned entry carries by default, does not say that
  if (l.slot_id && patch.outcome === 'swapped' && l.outcome !== 'swapped' && patch.description === undefined) throw errors.validation([{ path: 'description', message: 'Say what you ate instead' }], 'description: say what you ate instead');
  ctx.db.update('meal_logs', logId, { description: patch.description?.trim(), outcome: patch.outcome, note: patch.note !== undefined ? (patch.note?.trim() || null) : undefined, portion: patch.portion, updated_at: ctx.now() });
  audit(ctx, 'meal_log.update', { type: 'meal_log', id: logId }, null, { changed: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined), outcome: patch.outcome ?? l.outcome });
  return presentLogs(ctx, [ctx.db.get<LogRow>('SELECT * FROM meal_logs WHERE id = ?', [logId])!])[0]!;
}

/** Soft-deletes a log and removes its photo from disk. */
export function deleteLog(ctx: Ctx, memberId: string, logId: string) {
  const l = ownLog(ctx, memberId, logId);
  ctx.db.tx(() => {
    if (l.photo_file_id) removePrivateFile(ctx, l.photo_file_id, 'meal log deleted by the member');
    ctx.db.update('meal_logs', logId, { deleted_at: ctx.now(), photo_file_id: null, updated_at: ctx.now() });
    audit(ctx, 'meal_log.delete', { type: 'meal_log', id: logId }, null, { memberId, hadPhoto: !!l.photo_file_id });
  });
  return { ok: true };
}

export const MEAL_PHOTO_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Stores a photo of a logged meal as a private file (kind meal_photo), replacing any earlier one. Nothing is estimated
 *  from it. */
export function attachPhoto(ctx: Ctx, memberId: string, logId: string, input: { dataBase64: string; filename?: string }) {
  const l = ownLog(ctx, memberId, logId);
  const buffer = Buffer.from(input.dataBase64, 'base64');
  const saved = savePrivateFile(ctx, { ownerId: memberId, kind: 'meal_photo', buffer, allowedMimes: MEAL_PHOTO_MIMES, maxBytes: MEAL_PHOTO_MAX_BYTES, ref: { type: 'meal_log', id: logId }, name: input.filename });
  ctx.db.tx(() => {
    if (l.photo_file_id) removePrivateFile(ctx, l.photo_file_id, 'replaced by a new meal photo');
    ctx.db.update('meal_logs', logId, { photo_file_id: saved.id, updated_at: ctx.now() });
    audit(ctx, 'meal_log.photo', { type: 'meal_log', id: logId }, null, { action: l.photo_file_id ? 'replace' : 'attach', fileId: saved.id });
  });
  return presentLogs(ctx, [ctx.db.get<LogRow>('SELECT * FROM meal_logs WHERE id = ?', [logId])!])[0]!;
}

export function removePhoto(ctx: Ctx, memberId: string, logId: string) {
  const l = ownLog(ctx, memberId, logId);
  if (!l.photo_file_id) throw errors.notFound('Photo');
  ctx.db.tx(() => {
    removePrivateFile(ctx, l.photo_file_id!, 'meal photo removed by the member');
    ctx.db.update('meal_logs', logId, { photo_file_id: null, updated_at: ctx.now() });
    audit(ctx, 'meal_log.photo', { type: 'meal_log', id: logId }, null, { action: 'remove', fileId: l.photo_file_id });
  });
  return presentLogs(ctx, [ctx.db.get<LogRow>('SELECT * FROM meal_logs WHERE id = ?', [logId])!])[0]!;
}

/** Who may open a meal photo through the shared file link (api/domain/files.ts): the member, always (their own data,
 *  also while the Nutrition switch is off), and their assigned coach only while the Nutrition switch is on and the member
 *  shares health records with them. Administrators are not admitted (a meal photo is health information, not an
 *  administrative record). The switch is read alone, as the Progress photo rule reads it. */
export function mealPhotoAccess(ctx: Ctx, file: FileRow): boolean {
  if (!ctx.actor || file.ref_type !== 'meal_log' || !file.ref_id) return false;
  const log = ctx.db.get<{ member_id: string; deleted_at: string | null; photo_file_id: string | null }>('SELECT member_id, deleted_at, photo_file_id FROM meal_logs WHERE id = ?', [file.ref_id]);
  if (!log || log.deleted_at || log.photo_file_id !== file.id || log.member_id !== file.owner_id) return false;
  if (ctx.actor.role === 'member') return ctx.actor.id === log.member_id;
  if (ctx.actor.role === 'coach') return isEnabled(ctx, 'nutrition') && coachHasMember(ctx, ctx.actor.id, log.member_id) && sharesWithCoach(ctx, log.member_id);
  return false;
}

/** Coach feedback on a logged meal: a client-visible coach note pointing at the log. The coach must be assigned and the
 *  member must share health records with them. The member is told without the detail (sensitive). */
export function feedbackOnLog(ctx: Ctx, coachId: string, logId: string, body: string) {
  const l = ctx.db.get<LogRow>('SELECT * FROM meal_logs WHERE id = ?', [logId]);
  if (!l || l.deleted_at) throw errors.notFound('Meal log');
  if (!coachHasMember(ctx, coachId, l.member_id)) throw errors.forbidden('Not your client', 'NO_ACCESS');
  requireHealthAccess(ctx, l.member_id);
  const id = randomId('cnt');
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.insert('coach_notes', { id, coach_id: coachId, member_id: l.member_id, kind: 'note', visibility: 'client', author_role: 'coach', body: body.trim(), ref_type: 'meal_log', ref_id: logId, created_at: now });
    notify(ctx, { userId: l.member_id, category: 'nutrition', title: 'Feedback on a meal you logged', body: 'Your coach left feedback on a meal. Read it with the meal in your log.', data: { mealLogId: logId, noteId: id }, sensitive: true });
    audit(ctx, 'meal_log.feedback', { type: 'meal_log', id: logId }, null, { memberId: l.member_id, noteId: id });
  });
  return { id, body: body.trim(), mealLogId: logId, createdAt: now };
}

/* ---------- adherence ---------- */

/** The published version in force on a local date: the latest published version of the member's plans whose
 *  publication date is on or before it, from a plan not archived by then. */
function versionsInForce(ctx: Ctx, memberId: string) {
  return ctx.db.all<{ id: string; published_at: string; archived_at: string | null }>("SELECT v.id, v.published_at, p.archived_at FROM meal_plan_versions v JOIN meal_plans p ON p.id = v.plan_id WHERE p.member_id = ? AND v.status = 'published' AND v.published_at IS NOT NULL ORDER BY v.published_at DESC", [memberId])
    .map((v) => ({ id: v.id, from: dateInZone(v.published_at), until: v.archived_at ? dateInZone(v.archived_at) : null }));
}

/** Meals logged as planned or swapped against the planned meals that were due (up to today). Self-reported; pct is
 *  null when nothing was due. */
export function adherence(ctx: Ctx, memberId: string, range: { from: string; to: string }) {
  const today = localToday(ctx);
  const to = range.to > today ? today : range.to;
  const floor = addDays(`${to}T00:00:00.000Z`, -365).slice(0, 10); // at most a year is counted
  const from = range.from < floor ? floor : range.from;
  const versions = versionsInForce(ctx, memberId);
  const slotCache = new Map<string, SlotRow[]>();
  const slotsOf = (vid: string) => { let s = slotCache.get(vid); if (!s) { s = ctx.db.all<SlotRow>('SELECT * FROM meal_plan_slots WHERE plan_version_id = ?', [vid]); slotCache.set(vid, s); } return s; };
  const due: Array<{ date: string; slotId: string; slot: MealSlot }> = [];
  if (from <= to) {
    for (const date of dateRange(from, to)) {
      const v = versions.find((x) => x.from <= date && (!x.until || x.until > date));
      if (!v) continue;
      for (const s of slotsOf(v.id)) if (s.day === planDayOf(date)) due.push({ date, slotId: s.id, slot: s.slot });
    }
  }
  const logs = from <= to ? ctx.db.all<{ slot_id: string | null; date: string; slot: MealSlot; outcome: string }>("SELECT slot_id, date, slot, outcome FROM meal_logs WHERE member_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ? AND outcome IN ('as_planned', 'swapped')", [memberId, from, to]) : [];
  const open = new Set(due.map((d) => `${d.date}|${d.slotId}`));
  let done = 0;
  for (const l of logs.filter((x) => x.slot_id)) { const k = `${l.date}|${l.slot_id}`; if (open.delete(k)) done++; }
  for (const l of logs.filter((x) => !x.slot_id)) {
    // an entry without a planned meal counts for an open planned meal of the same kind that day
    const match = due.find((d) => d.date === l.date && d.slot === l.slot && open.has(`${d.date}|${d.slotId}`));
    if (match) { open.delete(`${match.date}|${match.slotId}`); done++; }
  }
  return { key: 'nutrition', label: 'Meals as planned', due: due.length, done, pct: due.length ? Math.round((100 * done) / due.length) : null, note: 'Planned meals logged as planned or swapped, against the planned meals that were due. Self-reported by the member.' };
}

/* ---------- the views ---------- */

/** What the member sees on Nutrition: profile, the published plan, today's planned meals and logs with their totals
 *  (mealTotals: entered, sourced values only), the last week's adherence and whether photos can be stored. */
export function memberNutrition(ctx: Ctx, memberId: string) {
  const today = localToday(ctx);
  const plan = memberMealPlan(ctx, memberId);
  const day = planDayOf(today);
  const missingStorage = storageRequirement(ctx);
  const todayRows = logRows(ctx, memberId, { from: today, to: today });
  return {
    today, day, profile: getProfile(ctx, memberId), plan,
    todaySlots: plan?.version?.slots.filter((s) => s.day === day) ?? [],
    todayLogs: presentLogs(ctx, todayRows),
    todayTotals: mealTotals(ctx, todayRows),
    adherence: adherence(ctx, memberId, { from: addDays(`${today}T00:00:00.000Z`, -6).slice(0, 10), to: today }),
    photos: missingStorage ? { available: false, missing: missingStorage } : { available: true },
    estimates: { available: false, missing: ESTIMATE_MISSING },
  };
}

/** The coach's view of a client's nutrition: meal plans always (the coach writes them); the profile, logs and adherence
 *  only while the member shares health records with the coach. */
export function coachClientNutrition(ctx: Ctx, memberId: string, shared: boolean) {
  const today = localToday(ctx);
  const range = { from: addDays(`${today}T00:00:00.000Z`, -13).slice(0, 10), to: today };
  return {
    today, healthShared: shared, withheld: !shared,
    plans: listMealPlans(ctx, memberId),
    profile: shared ? getProfile(ctx, memberId) : null,
    logs: shared ? listLogs(ctx, memberId, range) : [],
    adherence: shared ? adherence(ctx, memberId, range) : null,
    range,
  };
}

/* ---------- the member's data export (ApiModule.exportSections, read by api/domain/dataExport.ts buildArchive) ----------
   Only what the member's own Nutrition screens show, read straight from the tables (exporting changes nothing): the
   preferences they keep, every version of a meal plan that was published to them (never a draft version, never a plan
   that was not published), and the meals they logged with their own notes and their coach's feedback. People are
   named, nothing more (no ids, no contact details); a meal photo is listed by name and type only and opens in the app;
   deleted entries are left out; the coaching team's private notes on a meal never travel. */

const changedBy = (role: string | null): string | null => (role === 'member' ? 'you' : role === 'coach' ? 'your coach' : role ? 'the Bioptime team' : null);

/** The member's nutrition preferences, as the Preferences tab shows them; null when none were saved. */
export function exportProfile(ctx: Ctx, memberId: string) {
  if (!ctx.db.get('SELECT 1 FROM nutrition_profiles WHERE member_id = ?', [memberId])) return null;
  const p = getProfile(ctx, memberId);
  return { dietPattern: p.dietPattern, restrictions: p.restrictions, dislikes: p.dislikes, cuisines: p.cuisines, mealsPerDay: p.mealsPerDay, notes: p.notes, lastChangedBy: changedBy(p.updatedByRole), updatedAt: p.updatedAt };
}

function exportMeals(ctx: Ctx, versionId: string) {
  return ctx.db.all<SlotRow>('SELECT * FROM meal_plan_slots WHERE plan_version_id = ? ORDER BY day, sort', [versionId]).map((s) => {
    const f = s.food_id ? foodRow(ctx, s.food_id) : undefined;
    const r = s.recipe_id ? recipeRow(ctx, s.recipe_id) : undefined;
    return { day: PLAN_DAY_LABELS[s.day] ?? String(s.day), meal: MEAL_SLOT_LABELS[s.slot] ?? s.slot, time: s.time_hint, title: s.title, portionNote: s.portion_note || null, food: f ? { name: f.name, serving: f.serving_label || null } : null, recipe: r ? { title: r.title } : null };
  });
}

/** Every meal plan published to the member, with each published version's meals; the version in force also carries
 *  its totals of the entered values, as the Meal plan tab shows them. Draft versions and never-published plans are
 *  left out. */
export function exportMealPlans(ctx: Ctx, memberId: string) {
  const plans = ctx.db.all<PlanRow>("SELECT p.*, c.name AS coach_name, m.name AS member_name FROM meal_plans p JOIN users c ON c.id = p.coach_id JOIN users m ON m.id = p.member_id WHERE p.member_id = ? AND EXISTS (SELECT 1 FROM meal_plan_versions v WHERE v.plan_id = p.id AND v.status = 'published') ORDER BY p.created_at, p.id", [memberId]);
  return plans.map((p) => ({
    title: p.title, coach: p.coach_name, status: p.status, archivedAt: p.archived_at,
    versions: ctx.db.all<VersionRow>("SELECT * FROM meal_plan_versions WHERE plan_id = ? AND status = 'published' ORDER BY version", [p.id]).map((v) => {
      const inForce = p.status === 'published' && v.version === p.current_version;
      return { version: v.version, inForce, publishedAt: v.published_at, summary: v.summary, targets: j.out<MealTargets>(v.targets, {}), meals: exportMeals(ctx, v.id), ...(inForce ? { totalsPerDay: planTotals(ctx, v.id) } : {}) };
    }),
  }));
}

/** The dish from the library a log names, by kind and name (no id), or null. */
function dishOf(ctx: Ctx, l: LogRow): { kind: 'food' | 'recipe'; name: string | null } | null {
  if (l.food_id) return { kind: 'food', name: foodRow(ctx, l.food_id)?.name ?? null };
  if (l.recipe_id) return { kind: 'recipe', name: recipeRow(ctx, l.recipe_id)?.title ?? null };
  return null;
}

/** Every meal the member logged and kept, with the dish from the library and the portion where it named one, their
 *  note, their coach's feedback (the notes the coach wrote for them, never the team's private ones) and the photo by
 *  name and type. */
/** The dishes the member saved (Fuel › Saved), for their data export: each by kind and name with when it was saved,
 *  newest first, never by id. A dish the team has since taken out of the library keeps its name here (the member's
 *  list no longer shows it, but the save is still theirs). */
export function exportSavedDishes(ctx: Ctx, memberId: string) {
  return ctx.db.all<{ kind: 'food' | 'recipe'; created_at: string; name: string | null }>(
    `SELECT v.kind, v.created_at, COALESCE(f.name, r.title) AS name FROM nutrition_favourites v
       LEFT JOIN foods f ON v.kind = 'food' AND f.id = v.ref_id
       LEFT JOIN recipes r ON v.kind = 'recipe' AND r.id = v.ref_id
     WHERE v.member_id = ? ORDER BY v.created_at DESC, v.rowid DESC`, [memberId],
  ).map((x) => ({ kind: x.kind, name: x.name ?? 'A dish no longer in the library', savedAt: x.created_at }));
}

export function exportMealLogs(ctx: Ctx, memberId: string) {
  const rows = ctx.db.all<LogRow>('SELECT * FROM meal_logs WHERE member_id = ? AND deleted_at IS NULL ORDER BY date, created_at, id', [memberId]);
  const feedback = new Map<string, Array<{ coach: string; body: string; at: string }>>();
  for (const n of ctx.db.all<{ ref_id: string; body: string; created_at: string; coach_name: string }>("SELECT n.ref_id, n.body, n.created_at, u.name AS coach_name FROM coach_notes n JOIN users u ON u.id = n.coach_id WHERE n.member_id = ? AND n.ref_type = 'meal_log' AND n.visibility = 'client' ORDER BY n.created_at", [memberId])) {
    feedback.set(n.ref_id, [...(feedback.get(n.ref_id) ?? []), { coach: n.coach_name, body: n.body, at: n.created_at }]);
  }
  const photos = new Map(ctx.db.all<{ id: string; name: string | null; mime: string | null }>('SELECT f.id, f.name, f.mime FROM file_metadata f JOIN meal_logs l ON l.photo_file_id = f.id WHERE l.member_id = ? AND l.deleted_at IS NULL AND f.deleted_at IS NULL', [memberId]).map((f) => [f.id, f]));
  return rows.map((l) => {
    const photo = l.photo_file_id ? photos.get(l.photo_file_id) : undefined;
    return {
      date: l.date, meal: MEAL_SLOT_LABELS[l.slot] ?? l.slot, plannedMeal: !!l.slot_id, outcome: MEAL_OUTCOME_LABELS[l.outcome as MealOutcome] ?? l.outcome,
      description: l.description, dish: dishOf(ctx, l), portion: l.portion, note: l.note, loggedBy: l.source === 'coach' ? 'your coach' : 'you', loggedAt: l.created_at, changedAt: l.updated_at,
      photo: photo ? { name: photo.name, type: photo.mime } : null, coachFeedback: feedback.get(l.id) ?? [],
    };
  });
}
