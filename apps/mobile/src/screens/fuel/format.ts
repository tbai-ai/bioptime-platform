/* Labels and number formatting for the Fuel tab. Numbers come only from values someone entered with their source
   (never an estimate): a missing value stays missing ("—" or left out), and a portion multiplies only what is there. */
import { apiBaseSync } from '@/lib/config';
import { fx } from '@/theme';
import type { IconName } from '@/fx';
import type { Dish, MealLog, MealSlotName, NutrientKey, Nutrients, Outcome, PlanSlot, Portion } from './types';

export const SLOTS: MealSlotName[] = ['breakfast', 'mid_morning', 'lunch', 'evening', 'dinner', 'other'];
export const SLOT_LABEL: Record<string, string> = { breakfast: 'Breakfast', mid_morning: 'Mid-morning', lunch: 'Lunch', evening: 'Evening', dinner: 'Dinner', other: 'Other' };
export const OUTCOME_LABEL: Record<Outcome, string> = { as_planned: 'As planned', swapped: 'Swapped', skipped: 'Skipped', extra: 'Extra' };
export const DAY_LABEL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const PORTIONS: Portion[] = [0.5, 1, 1.5, 2];
export const PORTION_LABEL: Record<number, string> = { 0.5: 'Half', 1: '1 serving', 1.5: '1.5 servings', 2: '2 servings' };

/** The macro colours and short names (the earlier app's macro line: kcal red · P red · C amber · F gold · Fib green). */
export const MACRO: Record<NutrientKey, { short: string; label: string; unit: string; color: string; icon: IconName }> = {
  kcal: { short: '', label: 'Calories', unit: 'kcal', color: fx.red.label, icon: 'flame' },
  protein_g: { short: 'P', label: 'Protein', unit: 'g', color: fx.red.label, icon: 'beef' },
  carbs_g: { short: 'C', label: 'Carbs', unit: 'g', color: fx.hue.amber500, icon: 'wheat' },
  fat_g: { short: 'F', label: 'Fat', unit: 'g', color: fx.gold.base, icon: 'droplet' },
  fibre_g: { short: 'Fib', label: 'Fibre', unit: 'g', color: fx.hue.emerald, icon: 'salad' },
};

/** Whole numbers stay whole; others keep one decimal (11.2 g). */
export function num(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
/** Calories read as whole numbers, grouped the Indian way. */
export function kcal(v: number): string {
  return Math.round(v).toLocaleString('en-IN');
}
export const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** A dish's values for a portion: only the values someone entered, each times the portion. */
export function scaled(values: Partial<Nutrients> | null | undefined, portion = 1): Nutrients {
  const out = {} as Nutrients;
  for (const k of ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g'] as NutrientKey[]) {
    const v = values?.[k];
    out[k] = has(v) ? v * portion : null;
  }
  return out;
}
export const anyValue = (v: Partial<Nutrients> | null | undefined) => !!v && (['kcal', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g'] as NutrientKey[]).some((k) => has(v[k]));

/** Spoken summary of a dish's entered values (dish cards and rows announce only what is there). */
export function spokenValues(v: Partial<Nutrients> | null | undefined): string {
  if (!anyValue(v)) return 'no nutrient values entered';
  const parts: string[] = [];
  if (has(v!.kcal)) parts.push(`${kcal(v!.kcal)} kilocalories`);
  for (const k of ['protein_g', 'carbs_g', 'fat_g', 'fibre_g'] as NutrientKey[]) if (has(v![k])) parts.push(`${MACRO[k].label.toLowerCase()} ${num(v![k]!)} grams`);
  return parts.join(', ');
}

export const dishName = (d: Pick<Dish, 'kind' | 'name' | 'title'>) => (d.kind === 'recipe' ? d.title : d.name) ?? '';
export const dishKey = (d: { kind: string; id: string }) => `${d.kind}:${d.id}`;

/** The serving a dish's values are for ("1 jar · 250 g", "1 serving"). */
export function servingText(d: Pick<Dish, 'kind' | 'servingLabel' | 'servingGrams' | 'servings'>): string {
  if (d.kind === 'food') return [d.servingLabel || '1 serving', has(d.servingGrams) ? `${num(d.servingGrams)} g` : null].filter(Boolean).join(' · ');
  return d.servings && d.servings > 1 ? `1 of ${d.servings} servings` : '1 serving';
}

/** The values a planned slot stands for: its food's own (they come with the slot) or its recipe's per serving from
 *  the library (`recipes`, by id). Null when nothing was entered. */
export function slotValues(s: PlanSlot, recipes: Map<string, Dish>): Nutrients | null {
  if (s.food) return anyValue(s.food) ? scaled(s.food) : null;
  if (s.recipe) { const r = recipes.get(s.recipe.id); return r && anyValue(r.perServing) ? scaled(r.perServing) : null; }
  return null;
}

/** "420 kcal · P35 C55 F8": the plan card's compact mono line (only the values that are there). */
export function compactMacros(v: Nutrients | null): string | null {
  if (!v || !anyValue(v)) return null;
  const head = has(v.kcal) ? `${kcal(v.kcal)} kcal` : null;
  const tail = (['protein_g', 'carbs_g', 'fat_g'] as NutrientKey[]).filter((k) => has(v[k])).map((k) => `${MACRO[k].short}${Math.round(v[k]!)}`).join(' ');
  return [head, tail || null].filter(Boolean).join(' · ');
}

/** The plan's day of a local date (1 Monday … 7 Sunday). */
export function planDayOf(date: string): number { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; }
/** A local date `offset` days from `today` (YYYY-MM-DD). */
export function shiftDate(today: string, offset: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** The meal a dish most likely belongs to at this hour (India time), for the dish sheet's first choice. */
export function slotForNow(now = new Date()): MealSlotName {
  const h = Math.floor(((now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440) / 60);
  if (h >= 4 && h < 11) return 'breakfast';
  if (h === 11) return 'mid_morning';
  if (h >= 12 && h < 16) return 'lunch';
  if (h >= 16 && h < 19) return 'evening';
  if (h >= 19 && h < 23) return 'dinner';
  return 'other';
}

/** A server path made absolute (recipe images may come as /api/… paths). */
export function absoluteUrl(u?: string | null): string | null {
  if (!u) return null;
  return /^https?:\/\//.test(u) ? u : `${apiBaseSync()}${u.startsWith('/') ? '' : '/'}${u}`;
}

/** The earlier app's dish fallback colour, picked by a stable hash of the id. */
export function dishTint(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return fx.map.dishTint[h % fx.map.dishTint.length];
}

/** An icon for a dish without a photo (never a stock photo of food the member did not eat). */
export function dishIcon(d: { kind?: string; tags?: string[] | null; slot?: string | null }): IconName {
  const tags = (d.tags ?? []).map((t) => t.toLowerCase());
  if (tags.some((t) => ['drink', 'tea', 'coffee', 'juice'].includes(t))) return 'glass-water';
  if (tags.some((t) => ['fruit'].includes(t))) return 'apple';
  if (tags.some((t) => ['rice', 'grains', 'bread', 'cereal'].includes(t))) return 'wheat';
  if (tags.some((t) => ['egg', 'eggs'].includes(t))) return 'egg';
  if (d.kind === 'recipe') return 'chef-hat';
  if (d.slot === 'breakfast') return 'sunrise';
  return 'salad';
}

/** What a log row says under its title: the meal, the plan's time hint, the portion. */
export function logMeta(l: MealLog, s?: PlanSlot | null): string {
  const portion = l.dish && has(l.portion) ? `${num(l.portion)} × serving` : null;
  return [SLOT_LABEL[l.slot] ?? l.slot, s?.timeHint || null, portion, s?.portionNote || null].filter(Boolean).join(' · ');
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A recipe's method as plain text: the API keeps it as sanitised rich text (a few basic tags, the rest escaped), so
 *  paragraph and line breaks become new lines, list items bullets, the tags go and the escapes are read back. */
export function methodText(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}
