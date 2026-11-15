/* The shapes the Fuel tab reads (GET /me/nutrition, /me/foods, /me/recipes, /me/nutrition/favourites; API-N, 30 Oct).
   Every nutrient value is per serving as someone entered it with its source; a value nobody entered is null and is
   never shown as a number. */

export const NUTRIENT_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Nutrients = Record<NutrientKey, number | null>;
export type TargetKey = 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g';

export type MealSlotName = 'breakfast' | 'mid_morning' | 'lunch' | 'evening' | 'dinner' | 'other';
export type Outcome = 'as_planned' | 'swapped' | 'skipped' | 'extra';
export type Portion = 0.5 | 1 | 1.5 | 2;

export type SlotFood = {
  id: string; name: string; servingLabel?: string | null; servingGrams?: number | null; sourceRef?: string | null; status?: string;
} & Partial<Nutrients>;
export type SlotRecipe = { id: string; title: string; summary?: string | null; servings?: number | null; prepMinutes?: number | null; imageUrl?: string | null; status?: string };

export type PlanSlot = {
  id: string; day: number; slot: MealSlotName; timeHint?: string | null; title: string; portionNote?: string | null; sort?: number;
  food: SlotFood | null; recipe: SlotRecipe | null;
};

export type DayTotal = { day: number; slots: number; slotsMissingValues: number; complete: boolean } & Nutrients;

export type MealPlan = {
  id: string; title: string; coachName?: string | null; currentVersion?: number;
  version: {
    version: number; summary?: string | null; targets?: Partial<Record<TargetKey, number | null>> | null; slots: PlanSlot[];
    totals?: { days: DayTotal[]; complete: boolean; note?: string } | null;
  } | null;
};

export type Feedback = { id: string; body: string; coachName: string; createdAt: string };

export type MealLog = {
  id: string; slotId: string | null; date: string; slot: MealSlotName; description: string; outcome: Outcome; note?: string | null;
  hasPhoto: boolean; photoFileId?: string | null; createdAt: string; feedback: Feedback[];
  dish: { kind: 'food' | 'recipe'; id: string; name: string | null } | null; portion: number | null;
  values: (Nutrients & { from: 'plan' | 'dish'; sources: string[] }) | null;
};

export type Totals = Nutrients & { counted: Record<NutrientKey, number>; meals: number; missing: number; sources: string[]; note: string };

export type Restriction = { label: string; kind: 'allergy' | 'intolerance' | 'avoid' | 'religious' | 'other' };
export type NutritionProfile = {
  dietPattern?: string | null; restrictions?: Restriction[]; dislikes?: string[]; cuisines?: string[]; mealsPerDay?: number | null; notes?: string | null;
  updatedAt?: string | null;
};

export type Nutrition = {
  today: string; day: number; profile: NutritionProfile | null; plan: MealPlan | null; todaySlots: PlanSlot[]; todayLogs: MealLog[];
  todayTotals?: Totals | null;
  adherence?: { label?: string; due: number; done: number; pct: number | null; note?: string } | null;
  photos?: { available: boolean; missing?: string } | null;
  estimates?: { available: boolean; missing?: string } | null;
};

/** A dish from the published library: a food or a recipe. */
export type Dish = {
  kind: 'food' | 'recipe'; id: string; name?: string; title?: string; servingLabel?: string | null; servingGrams?: number | null;
  summary?: string | null; servings?: number | null; prepMinutes?: number | null; imageUrl?: string | null;
  /** A recipe's method, as the API keeps it (sanitised rich text: see methodText). */
  method?: string | null;
  perServing: Nutrients; nutrientsEntered: NutrientKey[]; sources: string[]; tags: string[]; saved: boolean;
  ingredients?: Array<{ label: string; quantity?: number | null; unit?: string | null; foodName?: string | null }>;
};

export type Page<T> = { items: T[]; nextCursor?: string | null; note?: string };
export type Favourites = { foods: Dish[]; recipes: Dish[] };

export type PlanTask = { id: string; title: string; kind: string; status: string; due_at: string; week?: number; day?: number };
