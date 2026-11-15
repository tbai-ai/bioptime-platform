/* The libraries in their admin modes (library.manage): the nutrition library (foods and recipes), the exercise library
   and the team's workout templates. Shapes of GET /admin/foods, /admin/recipes, /admin/exercises,
   /admin/workout-templates[/:id]; the wording of the web's status dialogs (modules/nutrition/NutritionLibrary.tsx:66,
   modules/workouts/ExerciseLibrary.tsx:83, :101) and small form helpers. The coach screens' types and labels are reused
   (lib/coach/libraries/nutrition, lib/coach/workouts). Nothing here fetches. */
import type { Food, Recipe } from '@/lib/coach/libraries/nutrition';

export type Pending = { configured: boolean; missing: string };
export type FoodList = { items: Food[]; licensedDataset?: Pending; estimates?: Pending };
export type RecipeList = { items: Recipe[]; licensedDataset?: Pending; estimates?: Pending };

/** A typed number: null when empty; `bad` when what was typed is not a number. */
export function parseNum(s: string | undefined | null): { value: number | null; bad: boolean } {
  const t = (s ?? '').trim();
  if (!t) return { value: null, bad: false };
  const n = Number(t);
  return Number.isFinite(n) ? { value: n, bad: false } : { value: null, bad: true };
}
/** Keep a decimal number's characters as they are typed. */
export const decimal = (v: string) => v.replace(/[^0-9.]/g, '');
/** Keep a whole number's digits as they are typed. */
export const digits = (v: string) => v.replace(/\D/g, '');
/** "a, b ,c" → ['a', 'b', 'c']. */
export const commaList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** The nutrition library's status dialog (Publish / Archive / Return to draft) for a food or a recipe. */
export function nutritionStatusDialog(to: string, name: string): { title: string; body: string; confirm: string; danger: boolean } {
  const verb = to === 'published' ? 'Publish' : to === 'archived' ? 'Archive' : 'Return to draft';
  return {
    title: `${verb}: ${name}`,
    body: to === 'published' ? 'Every coach can then use it in their plans.' : to === 'archived' ? 'Coaches can no longer add it to plans; plans that use it keep it.' : 'Coaches other than its author stop seeing it.',
    confirm: verb, danger: to === 'archived',
  };
}

/** The exercise library's status dialog. */
export function exerciseStatusDialog(to: string, name: string): { title: string; body: string; danger: boolean } {
  const verb = to === 'published' ? 'Publish' : to === 'archived' ? 'Archive' : 'Return to draft';
  return {
    title: `${verb}: ${name}`,
    body: to === 'archived' ? 'Templates that use it keep it; new templates cannot add it. Sessions already given are unchanged.' : to === 'published' ? 'Every coach can use it once published.' : 'Coaches stop seeing it, except its author.',
    danger: to === 'archived',
  };
}

/** The team templates' status dialog. */
export function templateStatusDialog(to: string, title: string): { title: string; body: string; danger: boolean } {
  return {
    title: `${to === 'published' ? 'Publish' : 'Archive'}: ${title}`,
    body: to === 'published' ? 'Every coach can use it in programmes once published.' : 'Coaches can no longer add it to programmes; sessions already given are unchanged.',
    danger: to === 'archived',
  };
}
