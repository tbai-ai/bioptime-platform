/* M5 Nutrition, the coach's library and meal plan editor: the shapes of GET /coach/nutrition-library and
   GET /coach/meal-plans/:id, the labels the web uses (apps/dashboard/src/modules/nutrition/shared.tsx) and the
   request bodies the schemas in packages/domain/src/modules/nutrition.ts accept. */
export type Food = {
  id: string; name: string; servingLabel: string; servingGrams: number | null; kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fibre_g: number | null;
  nutrientsEntered: string[]; source: string; sourceRef: string | null; tags: string[]; status: string; createdBy: string | null; createdAt: string; updatedAt: string;
};
export type Ingredient = { id?: string; foodId: string | null; foodName?: string | null; label: string; quantity: number | null; unit: string };
export type Recipe = {
  id: string; title: string; summary: string; method: string; servings: number | null; prepMinutes: number | null; tags: string[]; imageAssetId: string | null; imageUrl: string | null;
  status: string; source: string; createdBy: string | null; createdAt: string; updatedAt: string; ingredients: Ingredient[];
};
export type Library = { foods: Food[]; recipes: Recipe[]; licensedDataset: { configured: boolean; missing: string } };

export type Slot = { id: string; day: number; slot: string; timeHint: string | null; title: string; portionNote: string | null; food: { id: string; name: string; servingLabel?: string } | null; recipe: { id: string; title: string } | null };
export type DayTotals = { day: number; kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fibre_g: number | null; complete: boolean; slots: number; slotsMissingValues: number };
export type PlanVersion = { id: string; version: number; status: string; summary: string; targets: Record<string, number>; createdAt: string; publishedAt: string | null; slots: Slot[]; totals: { days: DayTotals[]; note: string } };
export type MealPlan = {
  id: string; memberId: string; memberName: string; title: string; status: 'draft' | 'published' | 'archived'; currentVersion: number; hasDraft: boolean;
  version: PlanVersion | null; versions: Array<{ id: string; version: number; status: string; summary: string; createdAt: string; publishedAt: string | null }>;
};

export const SLOTS = ['breakfast', 'mid_morning', 'lunch', 'evening', 'dinner', 'other'] as const;
export const SLOT_LABEL: Record<string, string> = { breakfast: 'Breakfast', mid_morning: 'Mid-morning', lunch: 'Lunch', evening: 'Evening', dinner: 'Dinner', other: 'Other' };
export const DAY_LABEL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAYS = [1, 2, 3, 4, 5, 6, 7];
export type NutrientKey = 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fibre_g';
export const NUTRIENTS: Array<{ key: NutrientKey; label: string; unit: string; body: 'kcal' | 'proteinG' | 'carbsG' | 'fatG' | 'fibreG' }> = [
  { key: 'kcal', label: 'Energy', unit: 'kcal', body: 'kcal' }, { key: 'protein_g', label: 'Protein', unit: 'g', body: 'proteinG' }, { key: 'carbs_g', label: 'Carbohydrate', unit: 'g', body: 'carbsG' },
  { key: 'fat_g', label: 'Fat', unit: 'g', body: 'fatG' }, { key: 'fibre_g', label: 'Fibre', unit: 'g', body: 'fibreG' },
];
export const TARGETS = NUTRIENTS.filter((n) => n.key !== 'fibre_g');

/** The values someone entered for a food, or the web's plain statement that there are none. */
export function nutrientLine(item: Record<string, unknown> | null | undefined): string {
  if (!item) return '';
  const parts = NUTRIENTS.filter((n) => typeof item[n.key] === 'number').map((n) => `${n.label.toLowerCase()} ${item[n.key]} ${n.unit}`);
  return parts.length ? parts.join(' · ') : 'Nutrient values not entered';
}

/** "Energy 1800 kcal · Protein 90 g". */
export function targetsLine(targets: Record<string, number> | undefined): string {
  const t = targets ?? {};
  return TARGETS.filter((x) => typeof t[x.key] === 'number').map((x) => `${x.label} ${t[x.key]} ${x.unit}`).join(' · ');
}

/** "{label} {qty} {unit}, …" as the web's recipes table reads the ingredients. */
export function ingredientsLine(ings: Ingredient[] | undefined): string {
  return (ings ?? []).map((i) => `${i.label}${i.quantity ? ` ${i.quantity}${i.unit ? ` ${i.unit}` : ''}` : ''}`).join(', ') || '—';
}

/** A recipe's method as plain text: the API keeps it as sanitised rich text (sanitizeRichText: a few basic tags, the
 *  rest escaped), so line breaks become new lines, the tags go and the escapes are read back. */
export function methodText(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** The slot a meal row sends: the schema's mealSlotInputSchema. */
export type SlotDraft = { day: number; slot: string; timeHint: string; ref: string; title: string; portionNote: string };
export function slotBody(s: SlotDraft) {
  return {
    day: s.day, slot: s.slot, timeHint: s.timeHint.trim() || null, title: s.title.trim() || undefined, portionNote: s.portionNote.trim() || undefined,
    ...(s.ref.startsWith('food:') ? { foodId: s.ref.slice(5) } : s.ref.startsWith('recipe:') ? { recipeId: s.ref.slice(7) } : {}),
  };
}
export function slotRef(s: Slot): string { return s.food ? `food:${s.food.id}` : s.recipe ? `recipe:${s.recipe.id}` : ''; }
