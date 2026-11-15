/* M5 Nutrition: the shared vocabulary and request schemas for meal plans, the food and recipe library, nutrition
   profiles and meal logs (apps/api/src/domain/nutrition.ts, apps/api/src/http/routes/nutrition.ts).

   Nothing here carries a nutrient value, a portion size or a calorie target: every number a plan or a food shows is
   typed by a coach or the Bioptime team, and a nutrient value is accepted only with the source it was read from. */
import { z } from 'zod';

/** Meal slots, in the order a day shows them. */
export const MEAL_SLOTS = ['breakfast', 'mid_morning', 'lunch', 'evening', 'dinner', 'other'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
export const MEAL_SLOT_LABELS: Record<MealSlot, string> = { breakfast: 'Breakfast', mid_morning: 'Mid-morning', lunch: 'Lunch', evening: 'Evening', dinner: 'Dinner', other: 'Other' };

/** What happened to a planned meal: eaten as planned, swapped for something else, skipped, or an extra meal. */
export const MEAL_OUTCOMES = ['as_planned', 'swapped', 'skipped', 'extra'] as const;
export type MealOutcome = (typeof MEAL_OUTCOMES)[number];
export const MEAL_OUTCOME_LABELS: Record<MealOutcome, string> = { as_planned: 'As planned', swapped: 'Swapped', skipped: 'Skipped', extra: 'Extra' };

/** How a restriction is meant. The label itself is typed by the member or the coach: there is no built-in medical list. */
export const RESTRICTION_KINDS = ['allergy', 'intolerance', 'avoid', 'religious', 'other'] as const;
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];

/** Where a food came from. licensed_dataset stays unused until a food-composition dataset is licensed (pending configuration). */
export const FOOD_SOURCES = ['coach', 'team', 'licensed_dataset'] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];
export const LIBRARY_STATUSES = ['draft', 'published', 'archived'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];
export const MEAL_PLAN_STATUSES = ['draft', 'published', 'archived'] as const;

/** The nutrient fields of a food, per serving; every one optional and null until someone enters it with a source. */
export const NUTRIENT_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
/** The keys a plan's targets may carry; each optional, typed by the coach. */
export const TARGET_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;

/** Plan days: 1 is Monday and 7 is Sunday (the member's local week, Asia/Kolkata by default). */
export const PLAN_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const PLAN_DAY_LABELS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const shortText = (max: number) => z.string().trim().max(max);
const tagList = z.array(z.string().trim().min(1).max(40)).max(20);
const amount = z.number().finite().min(0).max(100000);

export const restrictionSchema = z.object({ label: z.string().trim().min(1).max(80), kind: z.enum(RESTRICTION_KINDS) });
export const nutritionProfileSchema = z.object({
  dietPattern: shortText(80).nullable().optional(),
  restrictions: z.array(restrictionSchema).max(30).optional(),
  dislikes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  cuisines: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  mealsPerDay: z.number().int().min(1).max(10).nullable().optional(),
  notes: shortText(2000).optional(),
});
export type NutritionProfileInput = z.infer<typeof nutritionProfileSchema>;

/** A food. Nutrient values are per serving and need sourceRef (the label, publication or dataset they were read from). */
export const foodInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  servingLabel: shortText(80).optional(),
  servingGrams: z.number().finite().positive().max(10000).nullable().optional(),
  kcal: amount.nullable().optional(),
  proteinG: amount.nullable().optional(),
  carbsG: amount.nullable().optional(),
  fatG: amount.nullable().optional(),
  fibreG: amount.nullable().optional(),
  sourceRef: shortText(300).nullable().optional(),
  tags: tagList.optional(),
});
export type FoodInput = z.infer<typeof foodInputSchema>;

export const ingredientSchema = z.object({ foodId: z.string().min(1).max(64).nullable().optional(), label: z.string().trim().min(1).max(120), quantity: z.number().finite().positive().max(100000).nullable().optional(), unit: shortText(20).optional() });
export const recipeInputSchema = z.object({
  title: z.string().trim().min(2).max(160),
  summary: shortText(600).optional(),
  method: z.string().max(10000).optional(),
  servings: z.number().int().min(1).max(100).nullable().optional(),
  prepMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  tags: tagList.optional(),
  imageAssetId: z.string().min(1).max(64).nullable().optional(),
  ingredients: z.array(ingredientSchema).max(60).optional(),
});
export type RecipeInput = z.infer<typeof recipeInputSchema>;

export const targetsSchema = z.object({ kcal: amount.optional(), protein_g: amount.optional(), carbs_g: amount.optional(), fat_g: amount.optional() }).strict();
export type MealTargets = z.infer<typeof targetsSchema>;

export const mealSlotInputSchema = z.object({
  day: z.number().int().min(1).max(7),
  slot: z.enum(MEAL_SLOTS),
  timeHint: shortText(40).nullable().optional(),
  recipeId: z.string().min(1).max(64).nullable().optional(),
  foodId: z.string().min(1).max(64).nullable().optional(),
  title: shortText(160).optional(),
  portionNote: shortText(300).optional(),
});
export type MealSlotInput = z.infer<typeof mealSlotInputSchema>;

export const mealPlanCreateSchema = z.object({
  memberId: z.string().min(1).max(64),
  title: z.string().trim().min(2).max(160),
  summary: shortText(2000).optional(),
  targets: targetsSchema.optional(),
  slots: z.array(mealSlotInputSchema).max(84).optional(),
});
export const mealPlanPatchSchema = mealPlanCreateSchema.omit({ memberId: true }).partial();

/** The portions a member logs a dish from the library in: half, one, one and a half or two servings. */
export const PORTIONS = [0.5, 1, 1.5, 2] as const;
export type Portion = (typeof PORTIONS)[number];
const portion = z.number().refine((p) => (PORTIONS as readonly number[]).includes(p), { message: 'A portion is 0.5, 1, 1.5 or 2 servings' });

/** A meal log. A dish picked from the published library (foodId or recipeId) carries the portion eaten (1 when not
 *  given); its values count in today's totals only as they were entered, with their source. */
export const mealLogInputSchema = z.object({
  date: isoDate,
  slot: z.enum(MEAL_SLOTS).optional(),
  slotId: z.string().min(1).max(64).nullable().optional(),
  description: shortText(500).optional(),
  outcome: z.enum(MEAL_OUTCOMES),
  note: shortText(1000).nullable().optional(),
  foodId: z.string().min(1).max(64).nullable().optional(),
  recipeId: z.string().min(1).max(64).nullable().optional(),
  portion: portion.nullable().optional(),
});
export type MealLogInput = z.infer<typeof mealLogInputSchema>;
export const mealLogPatchSchema = z.object({ description: shortText(500).optional(), outcome: z.enum(MEAL_OUTCOMES).optional(), note: shortText(1000).nullable().optional(), portion: portion.optional() });

/** What a member saves from the published library (GET and PUT /me/nutrition/favourites). */
export const FAVOURITE_KINDS = ['food', 'recipe'] as const;
export type FavouriteKind = (typeof FAVOURITE_KINDS)[number];
export const favouriteSchema = z.object({ kind: z.enum(FAVOURITE_KINDS), id: z.string().min(1).max(64), saved: z.boolean() }).strict();
export type FavouriteInput = z.infer<typeof favouriteSchema>;

/** Searching the published library (GET /me/foods, GET /me/recipes): words in the name or a tag, one tag, a page at a
 *  time (cursor: the nextCursor of the previous page). */
export const memberLibraryQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type MemberLibraryQuery = z.infer<typeof memberLibraryQuerySchema>;

/** Meal photos: PNG, JPEG or WebP, checked by content, at most 4 MB, sent as base64 in JSON like every upload. */
export const MEAL_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const mealPhotoSchema = z.object({ filename: z.string().trim().min(1).max(200).optional(), dataBase64: z.string().min(8).max(Math.ceil(MEAL_PHOTO_MAX_BYTES * 1.4)) });

export const mealFeedbackSchema = z.object({ body: z.string().trim().min(2).max(2000) });
export const libraryStatusSchema = z.object({ status: z.enum(LIBRARY_STATUSES), reason: z.string().trim().min(3).max(500) });
