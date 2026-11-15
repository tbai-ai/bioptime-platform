/* Nutrition for the member app (30 October 2026, 0042_nutrition_search.sql): the published library searched by members
   (published items only, values only as entered with their source), saved dishes (idempotent, private to the member,
   published items only), a dish from the library logged with its portion, and today's totals on GET /me/nutrition,
   which add up planned meals logged as planned and dishes times their portion from sourced values only and count every
   other eaten meal as missing. The feature flag covers the new routes; the data export names the dish and portion
   without ids. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId, type Client } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { Db } from '../../src/db/db.js';
import { setFlag } from '../../src/domain/features.js';
import { buildArchive } from '../../src/domain/dataExport.js';
import * as n from '../../src/domain/nutrition.js';

let h: Awaited<ReturnType<typeof makeApp>>;
after(async () => { await h.app.close(); h.db.close(); });

const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const member = async (email: string): Promise<Client> => { const c = client(h.app); await c.login(email, DEMO_PASSWORDS.member, 'member'); return c; };
const SOURCE = 'Packet label, test brand, read 30 October 2026';
const reason = 'test: library entry';

/** A small library of its own: sourced foods, an unsourced one, a draft and an archived one, and two recipes. */
function library() {
  const admin = as(DEMO.admin);
  const team = { source: 'team' as const, status: 'published' as const };
  const oats = n.createFood(admin, { name: 'Test oats porridge', servingLabel: '1 bowl', servingGrams: 250, kcal: 210, proteinG: 7.5, carbsG: 36, fatG: 4, fibreG: 5, sourceRef: SOURCE, tags: ['Breakfast', 'grains'] }, team, reason);
  const paneer = n.createFood(admin, { name: 'Test paneer tikka', servingLabel: '6 pieces', kcal: 280, proteinG: 18, sourceRef: SOURCE, tags: ['high protein'] }, team, reason);
  const plain = n.createFood(admin, { name: 'Test plain khichdi', tags: ['comfort'] }, team, reason);
  const draft = n.createFood(admin, { name: 'Test draft upma', kcal: 190, sourceRef: SOURCE }, { source: 'team', status: 'draft' }, reason);
  const archived = n.createFood(admin, { name: 'Test archived idli', kcal: 60, sourceRef: SOURCE }, team, reason);
  n.setFoodStatus(admin, archived.id, 'archived', reason);
  const odd = n.createFood(admin, { name: 'Test 100% fruit_bowl', kcal: 90, sourceRef: SOURCE }, team, reason);
  const bowl = n.createRecipe(admin, { kind: 'team' }, { title: 'Test oats and paneer bowl', servings: 2, tags: ['lunch'], ingredients: [{ foodId: oats.id, label: 'Oats', quantity: 2, unit: 'servings' }, { foodId: paneer.id, label: 'Paneer', quantity: 1, unit: 'serving' }] }, team, reason);
  const unknown = n.createRecipe(admin, { kind: 'team' }, { title: 'Test khichdi pot', servings: 4, tags: ['dinner'], ingredients: [{ foodId: plain.id, label: 'Khichdi', quantity: 4, unit: 'servings' }] }, team, reason);
  const draftRecipe = n.createRecipe(admin, { kind: 'team' }, { title: 'Test draft recipe', tags: ['lunch'] }, { source: 'team', status: 'draft' }, reason);
  return { oats, paneer, plain, draft, archived, odd, bowl, unknown, draftRecipe };
}
let lib: ReturnType<typeof library>;
before(async () => { h = await makeApp(); lib = library(); });

test('0042: nutrition_favourites is keyed by member, kind and item; a meal log names a food or recipe and a portion of 0.5, 1, 1.5 or 2', () => {
  const pk = h.db.all<{ name: string; pk: number }>("PRAGMA table_info('nutrition_favourites')").filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  assert.deepEqual(pk, ['member_id', 'kind', 'ref_id']);
  const cols = h.db.all<{ name: string }>("PRAGMA table_info('meal_logs')").map((c) => c.name);
  for (const c of ['food_id', 'recipe_id', 'portion']) assert.ok(cols.includes(c), `meal_logs.${c}`);
  const fks = h.db.all<{ table: string; from: string }>("PRAGMA foreign_key_list('meal_logs')").map((f) => `${f.from}>${f.table}`);
  assert.ok(fks.includes('food_id>foods') && fks.includes('recipe_id>recipes'));
  const ananya = userId(h.ctx, DEMO.member);
  const row = (portion: number) => ({ id: `mlg_probe_${portion}`, member_id: ananya, date: '2026-10-30', slot: 'other', description: 'probe', outcome: 'extra', source: 'member', created_at: 'x', updated_at: 'x', food_id: lib.oats.id, portion });
  assert.throws(() => h.db.insert('meal_logs', row(3)), /CHECK/);
  assert.throws(() => h.db.insert('nutrition_favourites', { member_id: ananya, kind: 'meal', ref_id: 'x', created_at: 'x' }), /CHECK/);
  // a database that already holds meal logs takes the migration and keeps them
  const db = new Db(':memory:');
  try { db.migrate(); assert.ok(db.get("SELECT 1 FROM schema_migrations WHERE version = '0042_nutrition_search.sql'")); } finally { db.close(); }
});

test('search: published foods and recipes only, by words in the name or a tag (any case) or one tag, a page at a time; values only with their source', async () => {
  const m = await member(DEMO.member);
  type Food = { id: string; kind: string; name: string; perServing: Record<string, number | null>; nutrientsEntered: string[]; sources: string[]; servingGrams: number | null; tags: string[]; saved: boolean; status?: string; createdBy?: string };
  const foods = async (qs: string) => { const r = await m.get(`/api/me/foods${qs}`); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json as { items: Food[]; nextCursor: string | null; note: string }; };
  const all = await foods('?limit=100');
  const names = all.items.map((f) => f.name);
  for (const x of [lib.oats, lib.paneer, lib.plain, lib.odd]) assert.ok(names.includes(x.name), `${x.name} is listed`);
  for (const x of [lib.draft, lib.archived]) assert.ok(!names.includes(x.name), `${x.name} is not`);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM foods WHERE status = 'published'")!.n, all.items.length, 'every published food, nothing else');
  assert.match(all.note, /nothing is estimated/);

  const oats = all.items.find((f) => f.id === lib.oats.id)!;
  assert.deepEqual(oats.perServing, { kcal: 210, protein_g: 7.5, carbs_g: 36, fat_g: 4, fibre_g: 5 });
  assert.deepEqual(oats.sources, [SOURCE]);
  assert.equal(oats.servingGrams, 250);
  assert.equal(oats.kind, 'food');
  assert.equal(oats.status, undefined, 'no library status');
  assert.equal(oats.createdBy, undefined, 'never who added it');
  const paneer = all.items.find((f) => f.id === lib.paneer.id)!;
  assert.deepEqual(paneer.nutrientsEntered, ['kcal', 'protein_g']);
  assert.equal(paneer.perServing.carbs_g, null, 'a value no one entered is empty, not zero');
  const plain = all.items.find((f) => f.id === lib.plain.id)!;
  assert.deepEqual([plain.nutrientsEntered, plain.sources, Object.values(plain.perServing).every((v) => v === null)], [[], [], true]);

  assert.deepEqual((await foods('?q=PORRIDGE')).items.map((f) => f.id), [lib.oats.id], 'words in the name, any case');
  assert.deepEqual((await foods('?q=breakf')).items.filter((f) => f.name.startsWith('Test ')).map((f) => f.id), [lib.oats.id], 'words in a tag');
  assert.deepEqual((await foods('?tag=high%20PROTEIN')).items.map((f) => f.id), [lib.paneer.id], 'one tag, any case');
  assert.deepEqual((await foods('?q=100%25')).items.map((f) => f.id), [lib.odd.id], 'a % in the words is a character, not a wildcard');
  assert.deepEqual((await foods('?q=t_')).items.map((f) => f.id), [lib.odd.id], 'so is an underscore');
  assert.deepEqual((await foods('?q=draft')).items, []);

  const seen: string[] = [];
  let cursor: string | null = null;
  do { const page = await foods(`?q=test&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); assert.ok(page.items.length <= 2); seen.push(...page.items.map((f) => f.id)); cursor = page.nextCursor; } while (cursor);
  assert.deepEqual(seen, (await foods('?q=test')).items.map((f) => f.id), 'pages follow each other: nothing skipped or repeated');
  assert.equal(new Set(seen).size, 4);
  assert.equal((await m.get('/api/me/foods?cursor=nonsense')).json.error?.code, 'CURSOR_INVALID');
  assert.equal((await m.get('/api/me/foods?limit=500')).status, 400);

  type Recipe = { id: string; title: string; perServing: Record<string, number | null>; nutrientsEntered: string[]; sources: string[]; ingredients: Array<{ label: string; foodName: string | null }>; imageUrl: string | null };
  const recipes = (await m.get('/api/me/recipes?q=test')).json as { items: Recipe[] };
  assert.deepEqual(recipes.items.map((r) => r.id).sort(), [lib.bowl.id, lib.unknown.id].sort(), 'published recipes only');
  const bowl = recipes.items.find((r) => r.id === lib.bowl.id)!;
  // (2 × oats + 1 × paneer) / 2 servings, per nutrient; carbs, fat and fibre are unknown because paneer has none entered
  assert.deepEqual(bowl.perServing, { kcal: 350, protein_g: 16.5, carbs_g: null, fat_g: null, fibre_g: null });
  assert.deepEqual(bowl.nutrientsEntered, ['kcal', 'protein_g']);
  assert.deepEqual(bowl.sources, [SOURCE]);
  assert.deepEqual(bowl.ingredients.map((i) => i.foodName), [lib.oats.name, lib.paneer.name]);
  const pot = recipes.items.find((r) => r.id === lib.unknown.id)!;
  assert.deepEqual([pot.nutrientsEntered, pot.sources], [[], []], 'an ingredient without values leaves the recipe without values');
  assert.deepEqual(((await m.get('/api/me/recipes?tag=DINNER')).json as { items: Recipe[] }).items.map((r) => r.id), [lib.unknown.id]);

  // members only
  const coach = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  assert.equal((await coach.get('/api/me/foods')).status, 403);
  assert.equal((await client(h.app).get('/api/me/foods')).status, 401);
});

test('saved dishes: idempotent, published items only, private to the member; unsaving always works; an item taken out of the library leaves the list', async () => {
  const a = await member(DEMO.member);
  const b = await member(DEMO.member2);
  const ananya = userId(h.ctx, DEMO.member);
  const audits = () => h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'nutrition.favourite' AND target_id = ?", [ananya])!.n;
  const before = audits();
  for (let i = 0; i < 2; i++) {
    const r = await a.put('/api/me/nutrition/favourites', { kind: 'food', id: lib.oats.id, saved: true });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { kind: 'food', id: lib.oats.id, saved: true });
  }
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM nutrition_favourites WHERE member_id = ?', [ananya])!.n, 1, 'saving twice keeps one row');
  assert.equal(audits(), before + 1, 'and records one change');
  assert.equal((await a.put('/api/me/nutrition/favourites', { kind: 'recipe', id: lib.bowl.id, saved: true })).status, 200);
  assert.equal((await a.put('/api/me/nutrition/favourites', { kind: 'food', id: lib.paneer.id, saved: true })).status, 200);

  for (const [kind, id, code] of [['food', lib.draft.id, 'FOOD_UNAVAILABLE'], ['food', lib.archived.id, 'FOOD_UNAVAILABLE'], ['recipe', lib.draftRecipe.id, 'RECIPE_UNAVAILABLE'], ['recipe', lib.oats.id, 'RECIPE_UNAVAILABLE'], ['food', 'fod_doesnotexist', 'FOOD_UNAVAILABLE']] as const) {
    const r = await a.put('/api/me/nutrition/favourites', { kind, id, saved: true });
    assert.equal(r.json.error?.code, code, `${kind} ${id}`);
  }
  assert.equal((await a.put('/api/me/nutrition/favourites', { kind: 'meal', id: lib.oats.id, saved: true })).status, 400);
  assert.equal((await a.put('/api/me/nutrition/favourites', { kind: 'food', id: lib.oats.id, saved: true, memberId: userId(h.ctx, DEMO.member2) })).status, 400, 'no other member can be named');

  type Saved = { foods: Array<{ id: string; saved: boolean }>; recipes: Array<{ id: string; saved: boolean }> };
  const mine = (await a.get('/api/me/nutrition/favourites')).json as Saved;
  assert.deepEqual(mine.foods.map((f) => f.id), [lib.paneer.id, lib.oats.id], 'the latest saved first');
  assert.deepEqual(mine.recipes.map((r) => r.id), [lib.bowl.id]);
  assert.ok([...mine.foods, ...mine.recipes].every((x) => x.saved));
  assert.ok(((await a.get('/api/me/foods?q=porridge')).json as { items: Array<{ saved: boolean }> }).items[0]!.saved, 'search marks a saved dish');
  assert.deepEqual((await b.get('/api/me/nutrition/favourites')).json, { foods: [], recipes: [] }, 'another member sees none of them');
  assert.equal(((await b.get('/api/me/foods?q=porridge')).json as { items: Array<{ saved: boolean }> }).items[0]!.saved, false);

  // an item archived after it was saved leaves the list; unsaving it still works, twice
  n.setFoodStatus(as(DEMO.admin), lib.paneer.id, 'archived', reason);
  try {
    assert.deepEqual(((await a.get('/api/me/nutrition/favourites')).json as Saved).foods.map((f) => f.id), [lib.oats.id]);
    for (let i = 0; i < 2; i++) assert.deepEqual((await a.put('/api/me/nutrition/favourites', { kind: 'food', id: lib.paneer.id, saved: false })).json, { kind: 'food', id: lib.paneer.id, saved: false });
  } finally { n.setFoodStatus(as(DEMO.admin), lib.paneer.id, 'published', reason); }
  assert.deepEqual(((await a.get('/api/me/nutrition/favourites')).json as Saved).foods.map((f) => f.id), [lib.oats.id], 'unsaved, so it does not come back');
  for (const r of h.db.all<{ data: string }>("SELECT data FROM audit_events WHERE action = 'nutrition.favourite'")) assert.deepEqual(Object.keys(JSON.parse(r.data)).sort(), ['kind', 'refId', 'saved']);
});

test('a dish from the library is logged with its portion; its sourced values times the portion join today’s totals; the rules say what fits', async () => {
  const m = await member(DEMO.member2);
  const vikram = userId(h.ctx, DEMO.member2);
  const today = n.localToday(h.ctx);
  const nutrition = async () => (await m.get('/api/me/nutrition')).json as { todayTotals: { kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fibre_g: number | null; counted: Record<string, number>; meals: number; missing: number; sources: string[]; note: string }; todayLogs: Array<{ id: string; portion: number | null; dish: { kind: string; id: string; name: string } | null; values: Record<string, unknown> | null }>; estimates: { available: boolean } };
  const startTotals = (await nutrition()).todayTotals;

  const half = await m.post('/api/me/meal-logs', { date: today, slot: 'breakfast', outcome: 'extra', foodId: lib.oats.id, portion: 1.5 });
  assert.equal(half.status, 201, JSON.stringify(half.json));
  assert.equal(half.json.description, lib.oats.name, 'the dish names the meal when nothing else does');
  assert.deepEqual(half.json.dish, { kind: 'food', id: lib.oats.id, name: lib.oats.name });
  assert.equal(half.json.portion, 1.5);
  assert.deepEqual(half.json.values, { kcal: 315, protein_g: 11.3, carbs_g: 54, fat_g: 6, fibre_g: 7.5, from: 'dish', sources: [SOURCE] });
  const row = h.db.get<{ food_id: string; recipe_id: string | null; portion: number }>('SELECT food_id, recipe_id, portion FROM meal_logs WHERE id = ?', [half.json.id as string])!;
  assert.deepEqual({ ...row }, { food_id: lib.oats.id, recipe_id: null, portion: 1.5 });

  const recipe = await m.post('/api/me/meal-logs', { date: today, slot: 'lunch', outcome: 'extra', recipeId: lib.bowl.id, description: 'Lunch bowl at home' });
  assert.equal(recipe.status, 201, JSON.stringify(recipe.json));
  assert.equal(recipe.json.portion, 1, 'one serving when no portion is given');
  assert.equal(recipe.json.description, 'Lunch bowl at home');

  const t = (await nutrition()).todayTotals;
  assert.equal(t.kcal, Math.round(((startTotals.kcal ?? 0) + 315 + 350) * 10) / 10);
  assert.equal(t.protein_g, Math.round(((startTotals.protein_g ?? 0) + 11.25 + 16.5) * 10) / 10);
  assert.equal(t.counted.kcal, startTotals.counted.kcal + 2);
  assert.equal(t.counted.carbs_g, startTotals.counted.carbs_g + 1, 'the recipe has no carbohydrate value, so it does not count there');
  assert.ok(t.sources.includes(SOURCE));
  assert.equal(t.meals, startTotals.meals + 2);
  assert.equal(t.missing, startTotals.missing);

  // changing the portion changes what the meal adds
  const patched = await m.patch(`/api/me/meal-logs/${half.json.id}`, { portion: 0.5 });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal((patched.json.values as { kcal: number }).kcal, 105);
  assert.equal((await nutrition()).todayTotals.kcal, Math.round(((startTotals.kcal ?? 0) + 105 + 350) * 10) / 10);

  const refused = async (body: Record<string, unknown>, code: string, why: string) => {
    const r = await m.post('/api/me/meal-logs', { date: today, slot: 'evening', outcome: 'extra', ...body });
    assert.equal(r.json.error?.code, code, `${why}: ${JSON.stringify(r.json)}`);
  };
  await refused({ foodId: lib.oats.id, recipeId: lib.bowl.id }, 'DISH_INVALID', 'a food and a recipe at once');
  await refused({ foodId: lib.draft.id }, 'FOOD_UNAVAILABLE', 'a draft food');
  await refused({ foodId: lib.archived.id }, 'FOOD_UNAVAILABLE', 'an archived food');
  await refused({ recipeId: lib.draftRecipe.id }, 'RECIPE_UNAVAILABLE', 'a draft recipe');
  await refused({ description: 'Fruit', portion: 1 }, 'PORTION_WITHOUT_DISH', 'a portion without a dish');
  await refused({ foodId: lib.oats.id, portion: 3 }, 'VALIDATION_FAILED', 'three servings');
  await refused({ foodId: lib.oats.id, portion: 0.75 }, 'VALIDATION_FAILED', 'three quarters');
  await refused({ foodId: lib.oats.id, outcome: 'as_planned' }, 'OUTCOME_INVALID', 'a dish as the planned meal');
  await refused({ foodId: lib.oats.id, outcome: 'skipped' }, 'OUTCOME_INVALID', 'a skipped dish');
  assert.equal((await m.patch(`/api/me/meal-logs/${half.json.id}`, { outcome: 'skipped' })).json.error?.code, 'OUTCOME_INVALID', 'a dish stays eaten');
  const unlinked = (await m.post('/api/me/meal-logs', { date: today, slot: 'evening', outcome: 'extra', description: 'Roasted chana' })).json as { id: string };
  assert.equal((await m.patch(`/api/me/meal-logs/${unlinked.id}`, { portion: 2 })).json.error?.code, 'PORTION_WITHOUT_DISH');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM meal_logs WHERE member_id = ? AND portion IS NOT NULL', [vikram])!.n, 2, 'nothing refused was stored');
  const created = h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'meal_log.create' AND target_id = ?", [half.json.id as string])!;
  assert.deepEqual({ dish: JSON.parse(created.data).dish, portion: JSON.parse(created.data).portion }, { dish: 'food', portion: 1.5 });
  for (const id of [half.json.id, recipe.json.id, unlinked.id]) assert.equal((await m.del(`/api/me/meal-logs/${id}`)).status, 200);
  assert.deepEqual((await nutrition()).todayTotals, startTotals, 'deleted meals count for nothing');
});

test('today’s totals: planned meals logged as planned count their food or recipe, dishes count times their portion, only sourced values count; other eaten meals are missing, skipped ones add nothing', async () => {
  const coachId = userId(h.ctx, DEMO.coach3);
  const deepa = DEMO.memberNoShare;
  const memberId = userId(h.ctx, deepa);
  const today = n.localToday(h.ctx);
  const day = n.planDayOf(today);
  // a plan published for today: breakfast is a sourced food, lunch a recipe whose kcal and protein are known, dinner a
  // food without values, and the evening snack a meal named only by its title
  const plan = n.createMealPlan(as(DEMO.coach3), { coachId, memberId, title: 'Test plan · totals', slots: [
    { day, slot: 'breakfast', foodId: lib.oats.id }, { day, slot: 'lunch', recipeId: lib.bowl.id }, { day, slot: 'dinner', foodId: lib.plain.id }, { day, slot: 'evening', title: 'Fruit of the season' },
  ] });
  n.publishMealPlan(as(DEMO.coach3), plan.id);
  const m = await member(deepa);
  const d = (await m.get('/api/me/nutrition')).json as { todaySlots: Array<{ id: string; slot: string }>; todayLogs: Array<{ id: string }> };
  for (const l of d.todayLogs) assert.equal((await m.del(`/api/me/meal-logs/${l.id}`)).status, 200);
  const slot = (s: string) => d.todaySlots.find((x) => x.slot === s)!.id;
  const log = async (body: Record<string, unknown>) => { const r = await m.post('/api/me/meal-logs', { date: today, ...body }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json as { id: string; values: { kcal: number | null; from: string } | null }; };

  const breakfast = await log({ slotId: slot('breakfast'), outcome: 'as_planned' });
  assert.deepEqual(breakfast.values, { kcal: 210, protein_g: 7.5, carbs_g: 36, fat_g: 4, fibre_g: 5, from: 'plan', sources: [SOURCE] });
  const lunch = await log({ slotId: slot('lunch'), outcome: 'as_planned' });
  assert.equal(lunch.values?.kcal, 350);
  const dinner = await log({ slotId: slot('dinner'), outcome: 'as_planned' });
  assert.equal(dinner.values, null, 'a planned food without values adds nothing');
  const snack = await log({ slotId: slot('evening'), outcome: 'swapped', description: 'Biscuits at work' });
  assert.equal(snack.values, null, 'a swap without a dish adds nothing');
  await log({ slot: 'other', outcome: 'skipped', description: 'Skipped the late snack' });
  await log({ slot: 'other', outcome: 'extra', foodId: lib.paneer.id, portion: 2 });

  type Totals = { kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fibre_g: number | null; counted: Record<string, number>; meals: number; missing: number; sources: string[]; note: string };
  const out = (await m.get('/api/me/nutrition')).json as { todayTotals: Totals; estimates: { available: boolean; missing: string } };
  assert.deepEqual(out.todayTotals.counted, { kcal: 3, protein_g: 3, carbs_g: 1, fat_g: 1, fibre_g: 1 });
  assert.equal(out.todayTotals.kcal, 210 + 350 + 560);
  assert.equal(out.todayTotals.protein_g, 7.5 + 16.5 + 36);
  assert.deepEqual([out.todayTotals.carbs_g, out.todayTotals.fat_g, out.todayTotals.fibre_g], [36, 4, 5], 'only the meals that have the value');
  assert.equal(out.todayTotals.meals, 5, 'every meal eaten; the skipped one is not');
  assert.equal(out.todayTotals.missing, 2, 'the planned food without values and the swap without a dish');
  assert.deepEqual(out.todayTotals.sources, [SOURCE]);
  assert.match(out.todayTotals.note, /Nothing is estimated/);
  assert.equal(out.estimates.available, false, 'no estimate is ever made');
  assert.equal(out.estimates.missing, n.ESTIMATE_MISSING);

  // a source removed from a food (only possible in the database) takes its values out of every total
  h.db.run('UPDATE foods SET source_ref = NULL WHERE id = ?', [lib.oats.id]);
  try {
    const t = ((await m.get('/api/me/nutrition')).json as { todayTotals: Totals }).todayTotals;
    assert.equal(t.counted.fibre_g, 0);
    assert.equal(t.fibre_g, null);
    assert.equal(t.kcal, 560, 'neither the oats nor the recipe made with them count');
    assert.equal(t.missing, 4);
  } finally { h.db.run('UPDATE foods SET source_ref = ? WHERE id = ?', [SOURCE, lib.oats.id]); }

  // the coach's view of the logs carries the same values (Meera may not see Deepa's logs: she does not share)
  const coachView = await (async () => { const c = client(h.app); await c.login(DEMO.coach3, DEMO_PASSWORDS.coach, 'dashboard'); return (await c.get(`/api/coach/clients/${memberId}/nutrition`)).json as { logs: unknown[]; withheld: boolean }; })();
  assert.deepEqual([coachView.withheld, coachView.logs], [true, []]);

  // the data export names the dish and the portion, never an id
  const archive = buildArchive(h.ctx, memberId, 'drq_test_nutrition_search') as { moduleSections?: Record<string, Record<string, { records: unknown }>> };
  const logs = archive.moduleSections!.nutrition!.mealLogs!.records as Array<{ description: string; dish: { kind: string; name: string } | null; portion: number | null }>;
  const paneerLog = logs.find((l) => l.dish?.name === lib.paneer.name)!;
  assert.deepEqual([paneerLog.dish, paneerLog.portion], [{ kind: 'food', name: lib.paneer.name }, 2]);
  assert.ok(logs.filter((l) => !l.dish).every((l) => l.portion === null));
  const text = JSON.stringify(logs);
  for (const prefix of ['fod_', 'rcp_', 'mlg_']) assert.ok(!text.includes(prefix), `no ${prefix} id in the export`);
});

test('the data export lists the dishes the member saved, by kind and name with when, newest first, never by id (and only theirs)', async () => {
  const memberId = userId(h.ctx, DEMO.memberNoCoach);
  const m = await member(DEMO.memberNoCoach);
  for (const [kind, id] of [['food', lib.oats.id], ['recipe', lib.bowl.id]] as const) assert.equal((await m.put('/api/me/nutrition/favourites', { kind, id, saved: true })).status, 200);
  h.db.run("UPDATE nutrition_favourites SET created_at = '2026-10-01T08:00:00.000Z' WHERE member_id = ? AND kind = 'food'", [memberId]);
  try {
    const archive = buildArchive(h.ctx, memberId, 'drq_test_saved_dishes') as { moduleSections?: Record<string, Record<string, { records: unknown }>> };
    const saved = archive.moduleSections!.nutrition!.savedDishes!.records as Array<{ kind: string; name: string; savedAt: string }>;
    assert.deepEqual(saved.map((x) => [x.kind, x.name]), [['recipe', lib.bowl.title], ['food', lib.oats.name]]);
    assert.ok(saved.every((x) => typeof x.savedAt === 'string' && x.savedAt.length > 0));
    for (const prefix of ['fod_', 'rcp_']) assert.ok(!JSON.stringify(saved).includes(prefix), `no ${prefix} id`);
    const other = buildArchive(h.ctx, userId(h.ctx, DEMO.member2), 'drq_test_saved_dishes_2') as { moduleSections?: Record<string, Record<string, { records: unknown }>> };
    assert.ok(!JSON.stringify(other.moduleSections!.nutrition!.savedDishes!.records).includes(lib.bowl.title), 'another member’s export has none of them');
  } finally {
    for (const [kind, id] of [['food', lib.oats.id], ['recipe', lib.bowl.id]] as const) await m.put('/api/me/nutrition/favourites', { kind, id, saved: false });
  }
});

test('the Nutrition switch covers the new routes', async () => {
  const m = await member(DEMO.member);
  const owner = as(DEMO.owner);
  setFlag(owner, 'nutrition', { enabled: false }, 'test: nutrition off');
  try {
    for (const r of [await m.get('/api/me/foods'), await m.get('/api/me/recipes'), await m.get('/api/me/nutrition/favourites'), await m.put('/api/me/nutrition/favourites', { kind: 'food', id: lib.oats.id, saved: true })]) assert.equal(r.json.error?.code, 'FEATURE_DISABLED');
  } finally { setFlag(owner, 'nutrition', { enabled: true }, 'test: nutrition on'); }
  assert.equal((await m.get('/api/me/foods')).status, 200);
});
