/* M5 Nutrition: meal plans, the food and recipe library, meal logging with private photos, coach feedback and targets.
   Design: docs/CAPABILITY_MAP.md section 4.1. Migration 0013_nutrition.sql; routes in api/http/routes/nutrition.ts (each
   through def() with feature: 'nutrition'); domain in api/domain/nutrition.ts.

   - fileAccess: meal photos (kind meal_photo) always open for the member and, only while the Nutrition switch is on and
     the member shares health records, for their assigned coach. Declaring it also makes production refuse local storage
     while the module is on.
   - events: CoachAssigned hands the member's open meal plans to the new coach (audited as meal_plan.handover).
   - adherence: planned meals logged as planned or swapped against the planned meals that were due.
   - exportSections: the member's preferences, published meal plans, meal logs and saved dishes for their data export.
   - seedDemo: a few foods and one recipe with every nutrient value left empty (no cited source), meal plans and a few
     logs for the fictional members, in plain words. No nutrient value, portion size or target is entered. */
import type { ApiModule, DemoSeedContext } from './types.js';
import type { Ctx } from '../context.js';
import { nutritionRoutes } from '../http/routes/nutrition.js';
import * as n from '../domain/nutrition.js';
import { addDays } from '../lib/time.js';

export const nutrition: ApiModule = {
  key: 'nutrition',
  feature: 'nutrition',
  routes: (app) => nutritionRoutes(app),
  // a member can delete their own meal logs and photos while the module is switched off
  ungated: ['DELETE /me/meal-logs/:id', 'DELETE /me/meal-logs/:id/photo'],
  jobs: [],
  events: {
    CoachAssigned: [(ctx, _event, payload) => { if (payload.memberId && payload.coachId) n.handOverMealPlans(ctx, String(payload.memberId), String(payload.coachId)); }],
  },
  fileAccess: { meal_photo: n.mealPhotoAccess },
  adherence: { key: 'nutrition', label: 'Meals as planned', compute: (ctx, memberId, range) => n.adherence(ctx, memberId, range) },
  seedDemo: (demo) => seedNutritionDemo(demo),
  // the member's data export: only what their own Nutrition screens show (no draft versions or unpublished plans, no
  // private coach notes, people by name only, meal photos by name and type)
  exportSections: [
    { key: 'profile', label: 'Your nutrition preferences: diet pattern, restrictions, dislikes, cuisines, meals per day and notes', build: (ctx, memberId) => n.exportProfile(ctx, memberId) },
    { key: 'mealPlans', label: 'Meal plans your coach published for you, every published version with its meals (drafts are not included)', build: (ctx, memberId) => n.exportMealPlans(ctx, memberId) },
    { key: 'mealLogs', label: 'Meals you logged, with your notes, your coach’s feedback and each photo by name and type (open the photo in the app)', build: (ctx, memberId) => n.exportMealLogs(ctx, memberId) },
    { key: 'savedDishes', label: 'Dishes you saved in Fuel, by name, with when you saved them', build: (ctx, memberId) => n.exportSavedDishes(ctx, memberId) },
  ],
};

function asUser(base: Ctx, id: string): Ctx {
  const u = base.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; email: string; name: string }>('SELECT id, role, email, name FROM users WHERE id = ?', [id]);
  if (!u) throw new Error(`seed: no user ${id}`);
  return { ...base, actor: { id: u.id, role: u.role, email: u.email, name: u.name } };
}

/** Demo mode only. No nutrient value is entered: none of these foods has a cited source, so their values stay empty
 *  for the team to fill in from one (the recipe says so). */
function seedNutritionDemo(demo: DemoSeedContext): void {
  const { owner, adminId, coachIds, memberIds } = demo;
  if (!owner.config.isDemo) return;
  const admin = asUser(owner, adminId);
  const team = { kind: 'team' as const };
  const reason = 'initial data: library entries, nutrient values left empty';
  const food = (name: string, tags: string[]) => n.createFood(admin, { name, tags }, { source: 'team', status: 'published' }, reason);
  const dal = food('Moong dal', ['lentils']);
  const rice = food('Steamed rice', ['grains']);
  const curd = food('Plain curd', ['dairy']);
  const fruit = food('Seasonal fruit', ['fruit']);
  const poha = food('Vegetable poha', ['breakfast']);
  const recipe = n.createRecipe(admin, team, {
    title: 'Dal and rice bowl',
    summary: 'Moong dal with steamed rice. The method, servings and nutrient values are still to be added by the Bioptime team.',
    method: 'The Bioptime team adds the method.',
    tags: ['lunch'],
    ingredients: [{ foodId: dal.id, label: 'Moong dal' }, { foodId: rice.id, label: 'Steamed rice' }],
  }, { source: 'team', status: 'published' }, reason);

  // a coach's own draft food, usable only in that coach's plans until the team publishes it
  const coach0 = asUser(owner, coachIds[0]!);
  n.createFood(coach0, { name: 'Ragi dosa', tags: ['breakfast'] }, { source: 'coach', status: 'draft' });

  const week = (days: number[]) => days.flatMap((day) => [
    { day, slot: 'breakfast' as const, foodId: poha.id, timeHint: 'Morning' },
    { day, slot: 'lunch' as const, recipeId: recipe.id },
    { day, slot: 'evening' as const, foodId: fruit.id },
    { day, slot: 'dinner' as const, foodId: curd.id, title: 'Curd with the day’s vegetables' },
  ]);

  // Ananya (shares health records with Asha): a published plan, a few logs and one piece of coach feedback
  const ananya = memberIds[0]!;
  // written and published a week ago, so the last week's planned meals count as due
  const weekAgo: Ctx = { ...coach0, now: () => addDays(owner.now(), -7) };
  const p1 = n.createMealPlan(weekAgo, { coachId: coachIds[0]!, memberId: ananya, title: 'Regular meals', summary: 'Meal timing and simple swaps. No targets are set.', slots: week([1, 2, 3, 4, 5, 6, 7]) });
  n.publishMealPlan(weekAgo, p1.id);
  const member0 = asUser(owner, ananya);
  const today = n.localToday(owner);
  const logs: Array<{ back: number; slot: 'breakfast' | 'lunch' | 'evening' | 'dinner'; outcome: 'as_planned' | 'swapped' | 'skipped'; description?: string }> = [
    { back: 2, slot: 'breakfast', outcome: 'as_planned' }, { back: 2, slot: 'lunch', outcome: 'swapped', description: 'Had chapati instead of rice' }, { back: 2, slot: 'dinner', outcome: 'as_planned' },
    { back: 1, slot: 'breakfast', outcome: 'as_planned' }, { back: 1, slot: 'evening', outcome: 'skipped', description: 'Skipped: a late meeting' }, { back: 1, slot: 'lunch', outcome: 'as_planned' },
  ];
  let swapped = '';
  for (const l of logs) {
    const date = addDays(`${today}T00:00:00.000Z`, -l.back).slice(0, 10);
    const slot = p1.version!.slots.find((s) => s.day === n.planDayOf(date) && s.slot === l.slot);
    const row = n.logMeal(member0, ananya, { date, slotId: slot?.id ?? null, slot: l.slot, outcome: l.outcome, description: l.description ?? (slot ? undefined : 'As planned') }, 'member');
    if (l.outcome === 'swapped') swapped = row.id;
  }
  n.logMeal(member0, ananya, { date: today, slot: 'other', outcome: 'extra', description: 'A handful of roasted chana' }, 'member');
  if (swapped) n.feedbackOnLog(coach0, coachIds[0]!, swapped, 'A good swap. Keep the dal with it.');
  n.setProfile(member0, ananya, { dietPattern: 'Vegetarian', restrictions: [{ label: 'Avoids peanuts', kind: 'avoid' }], cuisines: ['South Indian'], mealsPerDay: 4, notes: 'Prefers home-cooked meals on weekdays.' });

  // Priya (Asha's client): a draft the coach has not published yet
  n.createMealPlan(coach0, { coachId: coachIds[0]!, memberId: memberIds[8]!, title: 'Three days a week', summary: 'Breakfast, lunch, an evening snack and dinner on three days. Not yet published.', slots: week([1, 3, 5]) });

  // Deepa (does not share health records with Meera): the coach sees the plan, never her logs or restrictions
  const coach2: Ctx = { ...asUser(owner, coachIds[2]!), now: () => addDays(owner.now(), -3) };
  const deepa = memberIds[2]!;
  const p3 = n.createMealPlan(coach2, { coachId: coachIds[2]!, memberId: deepa, title: 'Simple routine', summary: 'The same simple meals on five days of the week.', slots: week([1, 2, 3, 4, 5]) });
  n.publishMealPlan(coach2, p3.id);
  const member2 = asUser(owner, deepa);
  const yesterday = addDays(`${today}T00:00:00.000Z`, -1).slice(0, 10);
  const slot = n.memberMealPlan(member2, deepa)?.version?.slots.find((s) => s.day === n.planDayOf(yesterday) && s.slot === 'breakfast');
  n.logMeal(member2, deepa, slot ? { date: yesterday, slotId: slot.id, outcome: 'as_planned' } : { date: yesterday, slot: 'breakfast', outcome: 'as_planned', description: 'As planned' }, 'member');
}
