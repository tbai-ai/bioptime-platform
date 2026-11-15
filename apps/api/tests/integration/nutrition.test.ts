/* M5 Nutrition: permissions (the member's own data, coaches only for assigned clients and only with the health-sharing
   consent for profile, logs and photos, the library.manage permission for the team library), validation, audit, the
   field policy on every coach payload, the feature flag, and the main flows: profile, library, versioned meal plans,
   totals that flag missing values, meal logs with private photos, coach feedback, adherence and the demo seed. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId, type Client } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { setUserPermission } from '../../src/auth/permissions.js';
import { coachFieldPolicy, findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';
import { emit } from '../../src/domain/audit.js';
import { processPending } from '../../src/domain/events.js';
import { moduleByKey } from '../../src/modules/index.js';
import { assign } from '../../src/domain/assignments.js';
import { buildArchive } from '../../src/domain/dataExport.js';
import * as n from '../../src/domain/nutrition.js';
import { PREPARED_SOURCE } from '../../src/seed/showcase.js';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

let h: Awaited<ReturnType<typeof makeApp>>;
let privateDir = '';
before(async () => {
  privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioptime-nutrition-'));
  h = await makeApp({ env: { PRIVATE_FILES_DIR: privateDir } });
});
after(async () => {
  await h.app.close();
  h.db.close();
  fs.rmSync(privateDir, { recursive: true, force: true });
});

const signedIn = async (email: string, password: string, mfa = false): Promise<Client> => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const auditRow = (action: string, targetId?: string) => h.db.get<{ actor_id: string | null; actor_role: string; reason: string | null; data: string }>(`SELECT actor_id, actor_role, reason, data FROM audit_events WHERE action = ? ${targetId ? 'AND target_id = ?' : ''} ORDER BY at DESC, rowid DESC LIMIT 1`, targetId ? [action, targetId] : [action]);
const priya = () => h.db.get<{ id: string }>("SELECT id FROM users WHERE email = 'priya.nair@demo.bioptime.test'")!.id;
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);

/** No restricted key anywhere, and none of the member's contact details as a value either. */
function assertCoachSafe(payload: unknown, memberEmail?: string) {
  assert.deepEqual(findRestrictedFields(payload, restrictedKeys(coachFieldPolicy(h.ctx))), [], 'no restricted key in a coach payload');
  const text = JSON.stringify(payload);
  if (memberEmail) {
    const u = h.db.get<{ email: string; phone: string | null }>('SELECT email, phone FROM users WHERE email = ?', [memberEmail])!;
    assert.ok(!text.includes(u.email), 'no email address');
    if (u.phone) assert.ok(!text.includes(u.phone), 'no phone number');
  }
  assert.ok(!/dateOfBirth|pincode/i.test(text), 'no date of birth or PIN code');
}

test('the demo seed is in plain words (no demo or sample label): the module’s foods without values, the preview member’s with their honest source; three published plans and a draft', () => {
  const labelWords = /\bdemo\b|\bsample\b/i;
  const foods = h.db.all<{ name: string; tags: string; kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fibre_g: number | null; serving_grams: number | null; source_ref: string | null }>('SELECT * FROM foods');
  // the module's own few foods: no value without a cited source
  const unsourced = foods.filter((f) => f.source_ref === null);
  assert.deepEqual(unsourced.map((f) => f.name).sort(), ['Moong dal', 'Plain curd', 'Ragi dosa', 'Seasonal fruit', 'Steamed rice', 'Vegetable poha']);
  for (const f of unsourced) assert.deepEqual([f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fibre_g, f.serving_grams], [null, null, null, null, null, null], `${f.name}: no nutrient value without a cited source`);
  // the preview member's foods (api/seed/showcase.ts): prepared values, each with the source that says so
  const sourced = foods.filter((f) => f.source_ref !== null);
  assert.equal(sourced.length, 16);
  for (const f of sourced) {
    assert.equal(f.source_ref, PREPARED_SOURCE);
    assert.ok([f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fibre_g].every((v) => typeof v === 'number'), `${f.name}: every value entered`);
  }
  assert.doesNotMatch(PREPARED_SOURCE, /fitterify|\bdemo\b|\bsamples?\b/i, 'the source never names the earlier app or says demo');
  for (const f of foods) assert.doesNotMatch(`${f.name} ${f.tags}`, labelWords);
  for (const r of h.db.all<{ id: string; title: string; summary: string; method: string; tags: string; servings: number | null }>('SELECT id, title, summary, method, tags, servings FROM recipes')) {
    assert.doesNotMatch(`${r.title} ${r.summary} ${r.method} ${r.tags}`, labelWords);
    if (r.servings === null) { assert.match(r.summary, /servings and nutrient values are still to be added by the Bioptime team/, 'the recipe says what is missing'); continue; }
    // a plate of the preview: every ingredient one of the sourced foods, in servings
    const parts = h.db.all<{ source_ref: string | null; unit: string }>('SELECT f.source_ref, i.unit FROM recipe_ingredients i LEFT JOIN foods f ON f.id = i.food_id WHERE i.recipe_id = ?', [r.id]);
    assert.ok(parts.length && parts.every((x) => x.source_ref === PREPARED_SOURCE && /^servings?$/.test(x.unit)), `${r.title}: made of sourced foods`);
  }
  assert.deepEqual(h.db.all<{ title: string }>('SELECT title FROM meal_plans ORDER BY title').map((p) => p.title), ['Regular meals', 'Simple routine', 'Three days a week', 'Vegetarian weekdays, fish at the weekend']);
  for (const v of h.db.all<{ summary: string }>('SELECT summary FROM meal_plan_versions')) assert.doesNotMatch(v.summary, labelWords);
  for (const x of h.db.all<{ title: string }>('SELECT title FROM meal_plan_slots UNION ALL SELECT label FROM recipe_ingredients')) assert.doesNotMatch(x.title, labelWords);
  // targets only on the preview member's plan, typed by her coach; every other plan has none
  for (const v of h.db.all<{ targets: string; member_id: string }>('SELECT v.targets, p.member_id FROM meal_plan_versions v JOIN meal_plans p ON p.id = v.plan_id')) {
    if (v.member_id === priya() && v.targets !== '{}') assert.deepEqual(Object.keys(JSON.parse(v.targets)).sort(), ['carbs_g', 'fat_g', 'kcal', 'protein_g']);
    else assert.equal(v.targets, '{}', 'no calorie or macro target is invented');
  }
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM meal_plans WHERE status = 'published'")!.n, 3);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM meal_plans WHERE status = 'draft'")!.n, 1);
  for (const l of h.db.all<{ description: string | null; slot_id: string | null }>('SELECT description, slot_id FROM meal_logs')) {
    assert.ok(l.slot_id || (l.description ?? '').length > 0, 'an unplanned log says what was eaten');
    assert.doesNotMatch(l.description ?? '', labelWords);
  }
  const profile = h.db.get<{ diet_pattern: string; restrictions: string; notes: string }>('SELECT diet_pattern, restrictions, notes FROM nutrition_profiles')!;
  assert.doesNotMatch(`${profile.diet_pattern} ${profile.restrictions} ${profile.notes}`, labelWords);
  assert.ok(moduleByKey('nutrition')?.adherence, 'the module registers its adherence provider');
});

test('member: my nutrition, my plan, my profile (validated and audited without the labels)', async () => {
  const m = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const r = await m.get('/api/me/nutrition');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json as { today: string; day: number; plan: { title: string; version: { slots: Array<{ day: number }>; totals: { complete: boolean } } }; todaySlots: Array<{ day: number }>; profile: { dietPattern: string }; adherence: { due: number; done: number; pct: number | null }; photos: { available: boolean }; estimates: { available: boolean; missing: string } };
  assert.equal(d.plan.title, 'Regular meals');
  assert.equal(d.day, n.planDayOf(d.today));
  assert.ok(d.todaySlots.length > 0 && d.todaySlots.every((s) => s.day === d.day));
  assert.equal(d.plan.version.totals.complete, false, 'sample foods carry no values, so totals say incomplete');
  assert.equal(d.profile.dietPattern, 'Vegetarian');
  assert.ok(d.adherence.due > 0 && d.adherence.done >= 4 && d.adherence.pct !== null);
  assert.equal(d.photos.available, true);
  assert.equal(d.estimates.available, false);
  assert.match(d.estimates.missing, /AI_PROVIDER/);

  const other = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  assert.equal(((await other.get('/api/me/nutrition')).json as { plan: unknown }).plan, null, 'a member without a plan sees none');
  assert.equal(((await other.get('/api/me/meal-plan')).json as { plan: unknown }).plan, null);

  assert.equal((await m.put('/api/me/nutrition/profile', { restrictions: [{ label: 'Shellfish', kind: 'medical' }] })).status, 400, 'restriction kinds are a fixed list');
  assert.equal((await m.put('/api/me/nutrition/profile', { mealsPerDay: 0 })).status, 400);
  const saved = await m.put('/api/me/nutrition/profile', { restrictions: [{ label: 'Shellfish', kind: 'allergy' }, { label: 'shellfish ', kind: 'allergy' }], dislikes: ['Bitter gourd'] });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual((saved.json as { restrictions: unknown[] }).restrictions, [{ label: 'Shellfish', kind: 'allergy' }], 'duplicates fold into one');
  assert.equal((saved.json as { dietPattern: string }).dietPattern, 'Vegetarian', 'fields left out keep their value');
  const row = auditRow('nutrition_profile.update', userId(h.ctx, DEMO.member))!;
  assert.equal(row.actor_id, userId(h.ctx, DEMO.member));
  assert.ok(!row.data.includes('Shellfish'), 'the audit log records the fields, not what the member avoids');

  // members cannot reach coach or team routes
  assert.equal((await m.get(`/api/coach/clients/${userId(h.ctx, DEMO.member)}/nutrition`)).status, 403);
  assert.equal((await m.get('/api/admin/foods')).status, 403);
});

test('meal logs: validation, one entry per planned meal, edits and deletes only on my own logs', async () => {
  const m = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const other = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const d = (await m.get('/api/me/nutrition')).json as { today: string; day: number; todaySlots: Array<{ id: string; slot: string; title: string }>; plan: { version: { slots: Array<{ id: string; day: number; slot: string }> } } };
  const dinner = d.todaySlots.find((s) => s.slot === 'dinner')!;
  const tomorrow = shiftDate(d.today, 1);

  assert.equal((await m.post('/api/me/meal-logs', { date: tomorrow, slotId: dinner.id, outcome: 'as_planned' })).json.error?.code, 'DATE_IN_FUTURE');
  assert.equal((await m.post('/api/me/meal-logs', { date: shiftDate(d.today, -61), slot: 'lunch', outcome: 'extra', description: 'old' })).json.error?.code, 'DATE_TOO_OLD');
  assert.equal((await m.post('/api/me/meal-logs', { date: d.today, slot: 'lunch', outcome: 'eaten' })).status, 400, 'outcomes are a fixed list');
  assert.equal((await m.post('/api/me/meal-logs', { date: '23-10-2026', slot: 'lunch', outcome: 'extra', description: 'x' })).status, 400);
  assert.equal((await m.post('/api/me/meal-logs', { date: d.today, outcome: 'extra', description: 'Something' })).status, 400, 'an unplanned entry names its meal');
  assert.equal((await m.post('/api/me/meal-logs', { date: d.today, slot: 'lunch', outcome: 'extra' })).status, 400, 'an unplanned entry says what was eaten');
  assert.equal((await m.post('/api/me/meal-logs', { date: d.today, slotId: dinner.id, outcome: 'extra' })).json.error?.code, 'OUTCOME_INVALID');
  assert.equal((await m.post('/api/me/meal-logs', { date: d.today, slotId: dinner.id, outcome: 'swapped' })).status, 400, 'a swap says what was eaten instead');
  const otherDay = d.plan.version.slots.find((s) => s.day !== d.day)!;
  assert.equal((await m.post('/api/me/meal-logs', { date: d.today, slotId: otherDay.id, outcome: 'as_planned' })).json.error?.code, 'SLOT_DAY_MISMATCH');
  const deepaSlot = h.db.get<{ id: string }>("SELECT s.id FROM meal_plan_slots s JOIN meal_plan_versions v ON v.id = s.plan_version_id JOIN meal_plans p ON p.id = v.plan_id WHERE p.member_id = ? LIMIT 1", [userId(h.ctx, DEMO.memberNoShare)])!;
  assert.equal((await m.post('/api/me/meal-logs', { date: d.today, slotId: deepaSlot.id, outcome: 'as_planned' })).json.error?.code, 'SLOT_UNKNOWN', 'another member’s planned meal');

  const created = await m.post('/api/me/meal-logs', { date: d.today, slotId: dinner.id, outcome: 'as_planned', note: 'Demo test' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const log = created.json as { id: string; slot: string; description: string; source: string };
  assert.equal(log.slot, 'dinner');
  assert.equal(log.description, dinner.title, 'a planned meal takes its title');
  assert.equal(log.source, 'member');
  assert.equal(auditRow('meal_log.create', log.id)!.actor_id, userId(h.ctx, DEMO.member));
  assert.equal((await m.post('/api/me/meal-logs', { date: d.today, slotId: dinner.id, outcome: 'skipped' })).json.error?.code, 'ALREADY_LOGGED');

  // another member can neither read, change nor delete it
  const theirs = (await other.get('/api/me/meal-logs')).json as { items: Array<{ id: string }> };
  assert.ok(!theirs.items.some((l) => l.id === log.id));
  assert.equal((await other.patch(`/api/me/meal-logs/${log.id}`, { outcome: 'skipped' })).status, 404);
  assert.equal((await other.del(`/api/me/meal-logs/${log.id}`)).status, 404);

  const changed = await m.patch(`/api/me/meal-logs/${log.id}`, { outcome: 'swapped', description: 'Demo test · swapped for khichdi' });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  assert.equal((changed.json as { outcome: string }).outcome, 'swapped');
  assert.equal((await m.patch(`/api/me/meal-logs/${log.id}`, { outcome: 'extra' })).json.error?.code, 'OUTCOME_INVALID');
  assert.ok(auditRow('meal_log.update', log.id));

  const mine = (await m.get(`/api/me/meal-logs?from=${shiftDate(d.today, -3)}&to=${d.today}`)).json as { items: Array<{ id: string; date: string }>; adherence: { due: number; done: number } };
  assert.ok(mine.items.some((l) => l.id === log.id));
  assert.ok(mine.items.every((l) => l.date >= shiftDate(d.today, -3)));
  assert.ok(mine.adherence.done >= 1);
  assert.equal((await m.get(`/api/me/meal-logs?from=${d.today}&to=${shiftDate(d.today, -1)}`)).json.error?.code, 'RANGE_INVALID');
  assert.equal((await m.get(`/api/me/meal-logs?from=${shiftDate(d.today, -120)}&to=${d.today}`)).json.error?.code, 'RANGE_TOO_LONG');

  assert.equal((await m.del(`/api/me/meal-logs/${log.id}`)).status, 200);
  assert.ok(h.db.get<{ deleted_at: string | null }>('SELECT deleted_at FROM meal_logs WHERE id = ?', [log.id])!.deleted_at, 'soft delete');
  assert.ok(!((await m.get('/api/me/meal-logs')).json as { items: Array<{ id: string }> }).items.some((l) => l.id === log.id));
  assert.ok(auditRow('meal_log.delete', log.id));
});

test('adherence counts planned meals logged as planned or swapped against the planned meals that were due', () => {
  const memberId = userId(h.ctx, DEMO.member);
  const today = n.localToday(h.ctx);
  const from = shiftDate(today, -2), to = shiftDate(today, -1);
  const a = n.adherence(h.ctx, memberId, { from, to });
  assert.equal(a.due, 8, 'four planned meals a day for two days');
  assert.equal(a.done, 5, 'the seed logged four as planned and one swap; the skip does not count');
  assert.equal(a.pct, 63);
  const provider = moduleByKey('nutrition')!.adherence!;
  assert.deepEqual(provider.compute(h.ctx, memberId, { from, to }), a, 'the registered provider is the same computation');
  const none = n.adherence(h.ctx, userId(h.ctx, DEMO.member2), { from, to });
  assert.equal(none.due, 0);
  assert.equal(none.pct, null, 'nothing due: no percentage');
});

test('coaches: only assigned clients; plans always, profile and logs only with the health-sharing consent; payloads pass the field policy', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach); // Ananya's and Priya's coach
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach); // Vikram's coach
  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach); // Deepa's coach; Deepa does not share
  const ananya = userId(h.ctx, DEMO.member), deepa = userId(h.ctx, DEMO.memberNoShare);

  assert.equal((await rahul.get(`/api/coach/clients/${ananya}/nutrition`)).json.error?.code, 'NO_ACCESS', 'an unassigned coach gets 403');
  const own = await asha.get(`/api/coach/clients/${ananya}/nutrition`);
  assert.equal(own.status, 200, JSON.stringify(own.json));
  const ownData = own.json as { healthShared: boolean; profile: { dietPattern: string } | null; logs: unknown[]; plans: Array<{ id: string; status: string }>; adherence: { due: number } | null };
  assert.equal(ownData.healthShared, true);
  assert.ok(ownData.profile && ownData.logs.length > 0 && ownData.adherence);
  assert.ok(ownData.plans.some((p) => p.status === 'published'));
  assertCoachSafe(own.json, DEMO.member);
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'health.viewed' AND target_id = ? AND data LIKE '%nutrition%'", [ananya]), 'reading health detail is audited');

  const withheld = await meera.get(`/api/coach/clients/${deepa}/nutrition`);
  assert.equal(withheld.status, 200);
  const w = withheld.json as { healthShared: boolean; withheld: boolean; profile: unknown; logs: unknown[]; adherence: unknown; plans: Array<{ title: string; version: { slots: unknown[] } }> };
  assert.equal(w.healthShared, false);
  assert.equal(w.withheld, true);
  assert.equal(w.profile, null, 'no restrictions without consent');
  assert.deepEqual(w.logs, [], 'no logs without consent');
  assert.equal(w.adherence, null);
  assert.equal(w.plans[0]!.title, 'Simple routine', 'the coach still sees the plan they wrote');
  assert.ok(w.plans[0]!.version.slots.length > 0);
  assertCoachSafe(withheld.json, DEMO.memberNoShare);
  assert.equal((await meera.put(`/api/coach/clients/${deepa}/nutrition/profile`, { dietPattern: 'x' })).json.error?.code, 'NOT_SHARED');
  const deepaLog = h.db.get<{ id: string }>('SELECT id FROM meal_logs WHERE member_id = ? AND deleted_at IS NULL', [deepa])!;
  assert.equal((await meera.post(`/api/coach/meal-logs/${deepaLog.id}/feedback`, { body: 'Looks good' })).json.error?.code, 'NOT_SHARED');

  // an assigned coach with consent may record the profile as the member told them
  const prof = await asha.put(`/api/coach/clients/${ananya}/nutrition/profile`, { cuisines: ['South Indian', 'Bengali'] });
  assert.equal(prof.status, 200, JSON.stringify(prof.json));
  assertCoachSafe(prof.json, DEMO.member);
  assert.equal(auditRow('nutrition_profile.update', ananya)!.actor_role, 'coach');
  assert.equal((await rahul.put(`/api/coach/clients/${ananya}/nutrition/profile`, { cuisines: ['x'] })).json.error?.code, 'NO_ACCESS');

  // meal plans of someone else's client stay closed
  const plan = h.db.get<{ id: string }>("SELECT id FROM meal_plans WHERE member_id = ? AND status = 'published'", [ananya])!;
  for (const r of [await rahul.get(`/api/coach/meal-plans/${plan.id}`), await rahul.patch(`/api/coach/meal-plans/${plan.id}`, { title: 'Taken over' }), await rahul.post(`/api/coach/meal-plans/${plan.id}/publish`), await rahul.post(`/api/coach/meal-plans/${plan.id}/archive`, { reason: 'test: not mine' })]) assert.equal(r.json.error?.code, 'NO_ACCESS');
  assert.equal((await rahul.post('/api/coach/meal-plans', { memberId: ananya, title: 'Not my client' })).json.error?.code, 'NO_ACCESS');
  const ananyaLog = h.db.get<{ id: string }>('SELECT id FROM meal_logs WHERE member_id = ? AND deleted_at IS NULL', [ananya])!;
  assert.equal((await rahul.post(`/api/coach/meal-logs/${ananyaLog.id}/feedback`, { body: 'Not mine' })).json.error?.code, 'NO_ACCESS');
  assert.equal((await asha.get('/api/admin/foods')).status, 403, 'coaches never reach the team library administration');
});

test('the library: coaches see published items and their own drafts; nutrient values need a source; library.manage for the team', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);

  const lib = (await asha.get('/api/coach/nutrition-library')).json as { foods: Array<{ name: string; status: string }>; recipes: unknown[]; licensedDataset: { configured: boolean; missing: string } };
  assert.ok(lib.foods.some((f) => f.status === 'draft' && /Ragi dosa/.test(f.name)), 'my own draft');
  assert.equal(lib.licensedDataset.configured, false);
  assert.match(lib.licensedDataset.missing, /licensed food-composition dataset/);
  assertCoachSafe(lib);
  const theirs = (await rahul.get('/api/coach/nutrition-library')).json as { foods: Array<{ name: string }> };
  assert.ok(!theirs.foods.some((f) => /Ragi dosa/.test(f.name)), 'another coach’s draft stays private');

  assert.equal((await asha.post('/api/coach/foods', { name: 'Test food', kcal: 120 })).json.error?.code, 'SOURCE_REQUIRED', 'a value without its source is refused');
  const coachFood = await asha.post('/api/coach/foods', { name: 'Test food · coach entry', servingLabel: '1 piece', kcal: 120, proteinG: 4, sourceRef: 'Test fixture: values typed for this test only' });
  assert.equal(coachFood.status, 201, JSON.stringify(coachFood.json));
  assert.equal((coachFood.json as { status: string; source: string }).status, 'draft');
  assert.equal((coachFood.json as { source: string }).source, 'coach');
  const recipe = await asha.post('/api/coach/recipes', { title: 'Test recipe · coach', method: '<p>Mix <script>alert(1)</script>well</p>', ingredients: [{ foodId: (coachFood.json as { id: string }).id, label: 'Coach entry', quantity: 2, unit: 'serving' }], servings: 2 });
  assert.equal(recipe.status, 201, JSON.stringify(recipe.json));
  assert.ok(!(recipe.json as { method: string }).method.includes('<script>'), 'the method is sanitised');
  assert.equal((await rahul.post('/api/coach/recipes', { title: 'Borrowing', ingredients: [{ foodId: (coachFood.json as { id: string }).id, label: 'x' }] })).json.error?.code, 'FOOD_UNAVAILABLE', 'another coach’s draft cannot be used');

  // the team library: library.manage
  const created = await admin.post('/api/admin/foods', { name: 'Test food · team entry', kcal: 50, sourceRef: 'Test fixture', status: 'draft' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const foodId = (created.json as { id: string }).id;
  assert.equal((await admin.post(`/api/admin/foods/${foodId}/status`, { status: 'published' })).status, 400, 'a status change needs a reason');
  const pub = await admin.post(`/api/admin/foods/${foodId}/status`, { status: 'published', reason: 'test: checked against its source' });
  assert.equal((pub.json as { status: string }).status, 'published');
  const row = auditRow('food.status', foodId)!;
  assert.equal(row.reason, 'test: checked against its source');
  assert.equal(row.actor_id, userId(h.ctx, DEMO.admin));
  assert.equal((await admin.patch(`/api/admin/foods/${foodId}`, { kcal: 55 })).status, 400, 'a correction needs a reason');
  assert.equal((await admin.patch(`/api/admin/foods/${foodId}`, { sourceRef: null, reason: 'test: drop the source' })).json.error?.code, 'SOURCE_REQUIRED', 'values cannot lose their source');
  const fixed = await admin.patch(`/api/admin/foods/${foodId}`, { kcal: 55, reason: 'test: corrected from the label' });
  assert.equal((fixed.json as { kcal: number }).kcal, 55);
  assert.ok(auditRow('food.update', foodId));
  const adminRecipe = await admin.post('/api/admin/recipes', { title: 'Test recipe · team', ingredients: [{ foodId, label: 'Team entry', quantity: 1, unit: 'serving' }] });
  assert.equal(adminRecipe.status, 201);
  const rid = (adminRecipe.json as { id: string }).id;
  assert.equal((await admin.post(`/api/admin/recipes/${rid}/status`, { status: 'published', reason: 'test: publish' })).status, 200);
  assert.equal((await admin.patch(`/api/admin/recipes/${rid}`, { servings: 1, reason: 'test: one serving' })).status, 200);
  assert.ok(auditRow('recipe.status', rid) && auditRow('recipe.update', rid) && auditRow('recipe.create', rid));
  // a recipe counts from its ingredients' entered values, per serving; anything not entered stays unknown
  const recipePlan = n.createMealPlan(as(DEMO.coach), { coachId: userId(h.ctx, DEMO.coach), memberId: userId(h.ctx, DEMO.member), title: 'Test plan · recipe totals', slots: [{ day: 4, slot: 'lunch', recipeId: (recipe.json as { id: string }).id }, { day: 5, slot: 'lunch', recipeId: rid }] });
  const byDay = (day: number) => recipePlan.version!.totals.days.find((x) => x.day === day)!;
  assert.deepEqual([byDay(4).kcal, byDay(4).protein_g, byDay(4).carbs_g, byDay(4).complete], [120, 4, null, false], 'two servings of the food over two recipe servings');
  assert.deepEqual([byDay(5).kcal, byDay(5).protein_g], [55, null]);
  const list = (await admin.get('/api/admin/foods')).json as { items: Array<{ id: string }>; licensedDataset: { configured: boolean } };
  assert.ok(list.items.some((f) => f.id === foodId));
  assert.equal(list.licensedDataset.configured, false);
  assert.ok(((await asha.get('/api/coach/nutrition-library')).json as { foods: Array<{ id: string }> }).foods.some((f) => f.id === foodId), 'published team food reaches coaches');

  // without library.manage the administrator is refused
  setUserPermission(as(DEMO.owner), userId(h.ctx, DEMO.admin), 'library.manage', false, 'test: revoke');
  try {
    assert.equal((await admin.get('/api/admin/foods')).json.error?.code, 'PERMISSION_DENIED');
    assert.equal((await admin.post('/api/admin/foods', { name: 'Refused' })).json.error?.code, 'PERMISSION_DENIED');
  } finally { setUserPermission(as(DEMO.owner), userId(h.ctx, DEMO.admin), 'library.manage', true, 'test: restore'); }
});

test('meal plans: drafts, publishing freezes a version and keeps the history, totals flag missing values', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const member = await signedIn('priya.nair@demo.bioptime.test', DEMO_PASSWORDS.member);
  const memberId = priya();

  // two foods with entered values (and their source), one without
  const valued = (await admin.post('/api/admin/foods', { name: 'Test food · valued A', kcal: 100, proteinG: 5, carbsG: 10, fatG: 2, fibreG: 1, sourceRef: 'Test fixture', status: 'published' })).json as { id: string };
  const valued2 = (await admin.post('/api/admin/foods', { name: 'Test food · valued B', kcal: 50, proteinG: 1, carbsG: 4, fatG: 0, fibreG: 3, sourceRef: 'Test fixture', status: 'published' })).json as { id: string };
  const bare = (await admin.post('/api/admin/foods', { name: 'Test food · no values', status: 'published' })).json as { id: string };

  assert.equal((await asha.post('/api/coach/meal-plans', { memberId, title: 'T', slots: [] })).status, 400, 'title too short');
  assert.equal((await asha.post('/api/coach/meal-plans', { memberId, title: 'Test plan', slots: [{ day: 8, slot: 'lunch', title: 'x' }] })).status, 400, 'days run 1 to 7');
  assert.equal((await asha.post('/api/coach/meal-plans', { memberId, title: 'Test plan', slots: [{ day: 1, slot: 'brunch', title: 'Eggs' }] })).status, 400, 'slots are a fixed list');
  assert.equal((await asha.post('/api/coach/meal-plans', { memberId, title: 'Test plan', slots: [{ day: 1, slot: 'lunch' }] })).status, 400, 'a slot needs a name, a food or a recipe');
  assert.equal((await asha.post('/api/coach/meal-plans', { memberId, title: 'Test plan', slots: [{ day: 1, slot: 'lunch', foodId: valued.id, recipeId: 'rcp_x' }] })).json.error?.code, 'SLOT_INVALID');
  assert.equal((await asha.post('/api/coach/meal-plans', { memberId, title: 'Test plan', targets: { kcal: 1800, sugar_g: 10 } })).status, 400, 'only the four target keys');

  const created = await asha.post('/api/coach/meal-plans', { memberId, title: 'Test plan · Priya', summary: 'v1', targets: { protein_g: 60 }, slots: [{ day: 1, slot: 'breakfast', foodId: valued.id }, { day: 1, slot: 'lunch', foodId: valued2.id, portionNote: 'as agreed' }, { day: 2, slot: 'lunch', foodId: bare.id }, { day: 3, slot: 'dinner', title: 'Home-cooked dinner' }] });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const plan = created.json as { id: string; status: string; version: { status: string; slots: Array<{ title: string; food: { name: string } | null }>; targets: Record<string, number>; totals: { complete: boolean; days: Array<{ day: number; kcal: number | null; protein_g: number | null; fibre_g: number | null; complete: boolean; slotsMissingValues: number }> } } };
  assertCoachSafe(created.json, 'priya.nair@demo.bioptime.test');
  assert.equal(plan.status, 'draft');
  assert.equal(plan.version.slots[0]!.title, 'Test food · valued A', 'a slot takes the food’s name');
  assert.deepEqual(plan.version.targets, { protein_g: 60 });
  const day1 = plan.version.totals.days.find((d) => d.day === 1)!;
  assert.deepEqual([day1.kcal, day1.protein_g, day1.fibre_g, day1.complete], [150, 6, 4, true], 'sums of the entered values');
  const day2 = plan.version.totals.days.find((d) => d.day === 2)!;
  assert.deepEqual([day2.kcal, day2.complete, day2.slotsMissingValues], [null, false, 1], 'a food without values leaves the day incomplete');
  assert.equal(plan.version.totals.days.find((d) => d.day === 3)!.complete, false, 'a slot without a food is not counted');
  assert.equal(plan.version.totals.complete, false);
  assert.equal(auditRow('meal_plan.create', plan.id)!.actor_id, userId(h.ctx, DEMO.coach));

  // the member sees nothing until it is published
  assert.notEqual(((await member.get('/api/me/meal-plan')).json as { plan: { id: string } | null }).plan?.id, plan.id);
  const v1 = await asha.post(`/api/coach/meal-plans/${plan.id}/publish`);
  assert.equal(v1.status, 200, JSON.stringify(v1.json));
  assert.equal((v1.json as { status: string; currentVersion: number }).currentVersion, 1);
  assert.ok(auditRow('meal_plan.publish', plan.id));
  const notice = h.db.get<{ title: string; category: string }>("SELECT title, category FROM notifications WHERE user_id = ? AND category = 'nutrition' ORDER BY created_at DESC LIMIT 1", [memberId])!;
  assert.equal(notice.title, 'Your meal plan is ready');
  assert.equal((await asha.post(`/api/coach/meal-plans/${plan.id}/publish`)).json.error?.code, 'INVALID_STATE', 'nothing to publish');

  // editing a published plan opens version 2; the member keeps seeing version 1 until it is published
  const edited = await asha.patch(`/api/coach/meal-plans/${plan.id}`, { summary: 'v2', slots: [{ day: 1, slot: 'breakfast', foodId: valued2.id }] });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal((edited.json as { version: { version: number; status: string } }).version.version, 2);
  assert.equal((edited.json as { version: { status: string } }).version.status, 'draft');
  const seen = ((await member.get('/api/me/meal-plan')).json as { plan: { id: string; version: { version: number; summary: string; slots: unknown[] } } }).plan;
  assert.equal(seen.id, plan.id);
  assert.equal(seen.version.version, 1);
  assert.equal(seen.version.slots.length, 4, 'the published version is frozen');
  await asha.post(`/api/coach/meal-plans/${plan.id}/publish`);
  const after2 = ((await member.get('/api/me/meal-plan')).json as { plan: { version: { version: number; summary: string; slots: unknown[] }; versions: Array<{ version: number; status: string }> } }).plan;
  assert.equal(after2.version.version, 2);
  assert.equal(after2.version.slots.length, 1);
  assert.deepEqual(after2.versions.map((v) => [v.version, v.status]), [[2, 'published'], [1, 'published']], 'the history stays');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM meal_plan_slots s JOIN meal_plan_versions v ON v.id = s.plan_version_id WHERE v.plan_id = ? AND v.version = 1", [plan.id])!.n, 4, 'version 1 is untouched');
  assert.equal(h.db.get<{ title: string }>("SELECT title FROM notifications WHERE user_id = ? AND category = 'nutrition' ORDER BY created_at DESC, rowid DESC LIMIT 1", [memberId])!.title, 'Your meal plan was updated');

  assert.equal((await asha.post(`/api/coach/meal-plans/${plan.id}/archive`, {})).status, 400, 'archiving needs a reason');
  const archived = await asha.post(`/api/coach/meal-plans/${plan.id}/archive`, { reason: 'test: replaced' });
  assert.equal((archived.json as { status: string }).status, 'archived');
  assert.equal(auditRow('meal_plan.archive', plan.id)!.reason, 'test: replaced');
  assert.equal((await asha.patch(`/api/coach/meal-plans/${plan.id}`, { title: 'Revived' })).json.error?.code, 'INVALID_STATE');
  assert.notEqual(((await member.get('/api/me/meal-plan')).json as { plan: { id: string } | null }).plan?.id, plan.id, 'an archived plan is no longer served');
});

test('meal photos: private files, checked by content; the member and the consenting coach only; removed with the log', async () => {
  const m = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const anon = client(h.app);
  const d = (await m.get('/api/me/nutrition')).json as { today: string };
  const log = (await m.post('/api/me/meal-logs', { date: d.today, slot: 'other', outcome: 'extra', description: 'Demo test · photo' })).json as { id: string };

  assert.equal((await m.post(`/api/me/meal-logs/${log.id}/photo`, { dataBase64: SVG.toString('base64') })).json.error?.code, 'FILE_TYPE', 'type by content, not by name');
  const up = await m.post(`/api/me/meal-logs/${log.id}/photo`, { filename: 'lunch.png', dataBase64: PNG_1x1.toString('base64') });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  const fileId = (up.json as { photoFileId: string }).photoFileId;
  assert.match(fileId, /^fil_/);
  const meta = h.db.get<{ kind: string; ref_type: string; ref_id: string; storage_path: string }>('SELECT kind, ref_type, ref_id, storage_path FROM file_metadata WHERE id = ?', [fileId])!;
  assert.deepEqual([meta.kind, meta.ref_type, meta.ref_id], ['meal_photo', 'meal_log', log.id]);
  assert.ok(fs.existsSync(path.join(privateDir, meta.storage_path)), 'stored under the private files directory');
  assert.ok(auditRow('meal_log.photo', log.id));

  const t = await m.post(`/api/files/${fileId}/token`);
  assert.equal(t.status, 200);
  const dl = await anon.get(t.json.url as string);
  assert.equal(dl.status, 200, 'the short-lived token opens it');
  assert.equal(dl.headers['content-type'], 'image/png');
  assert.equal((await asha.post(`/api/files/${fileId}/token`)).status, 200, 'the assigned coach, while the member shares');
  assert.equal((await rahul.post(`/api/files/${fileId}/token`)).status, 404, 'another coach');
  assert.equal((await admin.post(`/api/files/${fileId}/token`)).status, 404, 'administrators are not admitted to meal photos');
  assert.equal((await client(h.app).post(`/api/files/${fileId}/token`)).status, 401);

  // consent withdrawn: the coach is refused, even with a token issued before
  const memberId = userId(h.ctx, DEMO.member);
  const coachToken = (await asha.post(`/api/files/${fileId}/token`)).json.url as string;
  h.db.run("INSERT INTO member_consents (id, user_id, kind, granted, version, at) VALUES ('cns_test_nutrition_off', ?, 'coach_sharing', 0, 'test', ?)", [memberId, new Date(Date.now() + 1000).toISOString()]);
  try {
    assert.equal((await asha.post(`/api/files/${fileId}/token`)).status, 404);
    assert.equal((await anon.get(coachToken)).status, 404, 'checked again when the token is redeemed');
    const view = (await asha.get(`/api/coach/clients/${memberId}/nutrition`)).json as { healthShared: boolean; logs: unknown[] };
    assert.equal(view.healthShared, false);
    assert.deepEqual(view.logs, []);
  } finally { h.db.run("DELETE FROM member_consents WHERE id = 'cns_test_nutrition_off'"); }

  // removing the photo, then deleting a log with a photo, take the bytes off disk
  assert.equal((await m.del(`/api/me/meal-logs/${log.id}/photo`)).status, 200);
  assert.ok(h.db.get<{ deleted_at: string | null }>('SELECT deleted_at FROM file_metadata WHERE id = ?', [fileId])!.deleted_at);
  assert.ok(!fs.existsSync(path.join(privateDir, meta.storage_path)));
  const again = (await m.post(`/api/me/meal-logs/${log.id}/photo`, { dataBase64: PNG_1x1.toString('base64') })).json as { photoFileId: string };
  const againPath = h.db.get<{ storage_path: string }>('SELECT storage_path FROM file_metadata WHERE id = ?', [again.photoFileId])!.storage_path;
  assert.equal((await m.del(`/api/me/meal-logs/${log.id}`)).status, 200);
  assert.ok(!fs.existsSync(path.join(privateDir, againPath)), 'deleting the log removes its photo');
  assert.equal((await m.post(`/api/files/${again.photoFileId}/token`)).status, 404);
});

test('coach feedback on a logged meal: a client-visible note, sent as sensitive, read by the member, audited', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const m = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const memberId = userId(h.ctx, DEMO.member);
  const log = h.db.get<{ id: string }>("SELECT id FROM meal_logs WHERE member_id = ? AND deleted_at IS NULL AND outcome = 'as_planned' ORDER BY created_at LIMIT 1", [memberId])!;
  assert.equal((await asha.post(`/api/coach/meal-logs/${log.id}/feedback`, { body: '' })).status, 400);
  assert.equal((await asha.post('/api/coach/meal-logs/mlg_missing/feedback', { body: 'Hello there' })).status, 404);
  const r = await asha.post(`/api/coach/meal-logs/${log.id}/feedback`, { body: 'Test feedback: nicely done.' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assertCoachSafe(r.json, DEMO.member);
  const note = h.db.get<{ ref_type: string; ref_id: string; visibility: string; coach_id: string }>('SELECT ref_type, ref_id, visibility, coach_id FROM coach_notes WHERE id = ?', [(r.json as { id: string }).id])!;
  assert.deepEqual([note.ref_type, note.ref_id, note.visibility, note.coach_id], ['meal_log', log.id, 'client', userId(h.ctx, DEMO.coach)]);
  assert.equal(auditRow('meal_log.feedback', log.id)!.actor_id, userId(h.ctx, DEMO.coach));
  const notif = h.db.get<{ id: string; category: string }>("SELECT id, category FROM notifications WHERE user_id = ? AND title = 'Feedback on a meal you logged' ORDER BY created_at DESC LIMIT 1", [memberId])!;
  assert.equal(notif.category, 'nutrition');
  const email = h.db.get<{ body: string }>("SELECT body FROM outbox_messages WHERE notification_id = ? AND channel = 'email'", [notif.id]);
  if (email) assert.ok(!email.body.includes('nicely done'), 'the feedback itself stays out of email');
  const logs = (await m.get('/api/me/meal-logs')).json as { items: Array<{ id: string; feedback: Array<{ body: string; coachName: string }> }> };
  const mine = logs.items.find((l) => l.id === log.id)!;
  assert.ok(mine.feedback.some((f) => f.body === 'Test feedback: nicely done.' && f.coachName === 'Asha Menon'));
});

test('with the flag off every nutrition route answers FEATURE_DISABLED, except deleting my own data; only the member still opens their meal photo', async () => {
  const m = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const anon = client(h.app);
  const d = (await m.get('/api/me/nutrition')).json as { today: string };
  const log = (await m.post('/api/me/meal-logs', { date: d.today, slot: 'other', outcome: 'extra', description: 'Demo test · before the switch' })).json as { id: string };
  const photo = (await m.post(`/api/me/meal-logs/${log.id}/photo`, { filename: 'before.png', dataBase64: PNG_1x1.toString('base64') })).json as { photoFileId: string };
  assert.match(photo.photoFileId, /^fil_/);
  assert.equal((await asha.post(`/api/files/${photo.photoFileId}/token`)).status, 200, 'the assigned coach, while the member shares and the flag is on');
  const coachUrl = (await asha.post(`/api/files/${photo.photoFileId}/token`)).json.url as string;
  h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'nutrition'");
  try {
    for (const r of [await m.get('/api/me/nutrition'), await m.get('/api/me/meal-logs'), await m.post('/api/me/meal-logs', { date: d.today, slot: 'other', outcome: 'extra', description: 'x y' }), await asha.get(`/api/coach/clients/${userId(h.ctx, DEMO.member)}/nutrition`), await asha.get('/api/coach/nutrition-library'), await admin.get('/api/admin/foods')]) {
      assert.equal(r.status, 403);
      assert.equal(r.json.error?.code, 'FEATURE_DISABLED');
    }
    assert.ok(!((await m.get('/api/public/config')).json.features as string[]).includes('nutrition'));
    // meal photos open through the shared file link, which reads the switch for coaches: the member keeps their own
    const own = await m.post(`/api/files/${photo.photoFileId}/token`);
    assert.equal(own.status, 200, 'the member still opens their own meal photo');
    assert.equal((await anon.get(own.json.url as string)).status, 200);
    assert.equal((await asha.post(`/api/files/${photo.photoFileId}/token`)).status, 404, 'the assigned coach does not while the flag is off');
    assert.equal((await anon.get(coachUrl)).status, 404, 'nor with a link issued before the switch');
    assert.equal((await m.del(`/api/me/meal-logs/${log.id}`)).status, 200, 'a member can still delete their own log');
  } finally { h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'nutrition'"); }
});

test('a new coach takes over the member’s open meal plans when the assignment changes (outbox, audited)', async () => {
  const memberId = priya();
  const rahulId = userId(h.ctx, DEMO.coach2);
  const draft = h.db.get<{ id: string; coach_id: string }>("SELECT id, coach_id FROM meal_plans WHERE member_id = ? AND status = 'draft'", [memberId])!;
  assert.notEqual(draft.coach_id, rahulId);
  emit(h.ctx, 'CoachAssigned', { type: 'coach_assignment', id: 'asg_test_nutrition' }, { memberId, coachId: rahulId, method: 'manual' });
  await processPending(h.ctx);
  assert.equal(h.db.get<{ coach_id: string }>('SELECT coach_id FROM meal_plans WHERE id = ?', [draft.id])!.coach_id, rahulId);
  const row = auditRow('meal_plan.handover', draft.id)!;
  assert.equal(row.actor_role, 'system');
  assert.equal(h.db.get<{ coach_id: string }>("SELECT coach_id FROM meal_plans WHERE member_id = ? AND status = 'archived' LIMIT 1", [memberId])?.coach_id ?? userId(h.ctx, DEMO.coach), userId(h.ctx, DEMO.coach), 'archived plans keep their author');
  // access still follows the assignment itself: Rahul is not Priya's coach, so the plan stays closed to him
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  assert.equal((await rahul.get(`/api/coach/meal-plans/${draft.id}`)).json.error?.code, 'NO_ACCESS');
});

type EditorSlot = { day: number; slot: string; timeHint: string | null; title: string; portionNote: string; food: { id: string } | null; recipe: { id: string } | null };
/** A slot as the meal plan editor sends it back: every slot, with its food or recipe. */
const editorInput = (s: EditorSlot) => ({ day: s.day, slot: s.slot, timeHint: s.timeHint, title: s.title, portionNote: s.portionNote || undefined, ...(s.food ? { foodId: s.food.id } : s.recipe ? { recipeId: s.recipe.id } : {}) });

test('after a real reassignment the outbox hands the plan to the new coach, who edits it with the previous coach’s draft food; new private items stay refused', async () => {
  const owner = as(DEMO.owner);
  const ashaId = userId(h.ctx, DEMO.coach), rahulId = userId(h.ctx, DEMO.coach2);
  // a member of its own, so nothing an earlier test did to the demo members' plans (the test above moves Priya's draft
  // plan to Rahul) decides the outcome here
  const now = new Date().toISOString();
  const memberId = 'usr_test_nutrition_handover';
  h.db.insert('users', { id: memberId, email: 'handover.nutrition@demo.bioptime.test', role: 'member', state: 'active', name: 'Test member · nutrition handover', created_at: now, updated_at: now });
  assign(owner, { memberId, programmeId: null, coachId: ashaId, method: 'override', reason: 'test: a fresh member for the handover' });
  await processPending(h.ctx);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);

  // Asha writes a draft food of her own and a plan that uses it
  const food = await asha.post('/api/coach/foods', { name: 'Test food · Asha handover draft' });
  assert.equal(food.status, 201, JSON.stringify(food.json));
  const draftFood = food.json as { id: string };
  assert.equal(h.db.get<{ status: string; created_by: string }>('SELECT status, created_by FROM foods WHERE id = ?', [draftFood.id])!.status, 'draft', 'a coach’s own food stays a draft');
  const created = await asha.post('/api/coach/meal-plans', { memberId, title: 'Test plan · handover', slots: [{ day: 1, slot: 'breakfast', foodId: draftFood.id }] });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const plan = created.json as { id: string };
  const coachOf = () => h.db.get<{ coach_id: string }>('SELECT coach_id FROM meal_plans WHERE id = ?', [plan.id])!.coach_id;
  assert.equal(coachOf(), ashaId);
  const privateDraft = (await asha.post('/api/coach/foods', { name: 'Test food · Asha private draft' })).json as { id: string };

  // the member is reassigned to Rahul: the assignment writes CoachAssigned to the outbox, and processing it hands over
  const handoversBefore = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'meal_plan.handover' AND target_id = ?", [plan.id])!.n;
  assert.equal(handoversBefore, 0);
  assign(owner, { memberId, programmeId: null, coachId: rahulId, method: 'override', reason: 'test: handover of a plan with a coach draft food' });
  const event = h.db.get<{ id: string; processed_at: string | null }>("SELECT id, processed_at FROM domain_events WHERE type = 'CoachAssigned' AND json_extract(payload, '$.memberId') = ? AND json_extract(payload, '$.coachId') = ?", [memberId, rahulId]);
  assert.ok(event && !event.processed_at, 'CoachAssigned waits in the outbox');
  assert.equal(coachOf(), ashaId, 'nothing is handed over before the outbox runs');
  await processPending(h.ctx);
  assert.ok(h.db.get<{ processed_at: string | null }>('SELECT processed_at FROM domain_events WHERE id = ?', [event.id])!.processed_at, 'the outbox processed it');
  assert.equal(coachOf(), rahulId, 'the plan now belongs to Rahul');
  const handover = auditRow('meal_plan.handover', plan.id)!;
  assert.equal(handover.actor_role, 'system');
  assert.deepEqual(JSON.parse(handover.data), { from: ashaId, to: rahulId });
  assert.equal((await asha.get(`/api/coach/meal-plans/${plan.id}`)).json.error?.code, 'NO_ACCESS', 'the previous coach no longer reaches it');
  const seen = (await rahul.get(`/api/coach/meal-plans/${plan.id}`)).json as { version: { slots: EditorSlot[] } };
  assert.ok(seen.version.slots.some((s) => s.food?.id === draftFood.id), 'the plan still holds Asha’s draft food');
  assert.ok(!((await rahul.get('/api/coach/nutrition-library')).json as { foods: Array<{ id: string }> }).foods.some((f) => f.id === draftFood.id), 'it is not in Rahul’s library');

  // the editor sends every slot back: the item already on the plan is accepted, also on another day
  const kept = await rahul.patch(`/api/coach/meal-plans/${plan.id}`, { summary: 'Test: edited by the new coach', slots: [...seen.version.slots.map(editorInput), { day: 6, slot: 'breakfast', foodId: draftFood.id }] });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.equal((kept.json as { version: { slots: EditorSlot[] } }).version.slots.filter((s) => s.food?.id === draftFood.id).length, 2);
  assertCoachSafe(kept.json, 'handover.nutrition@demo.bioptime.test');
  assert.equal(auditRow('meal_plan.update_draft', plan.id)!.actor_id, rahulId);
  // a private draft of the previous coach that is not on the plan stays out of reach
  assert.equal((await rahul.patch(`/api/coach/meal-plans/${plan.id}`, { slots: [...seen.version.slots.map(editorInput), { day: 4, slot: 'lunch', foodId: privateDraft.id }] })).json.error?.code, 'FOOD_UNAVAILABLE');
  assert.equal((await rahul.post('/api/coach/meal-plans', { memberId, title: 'Test plan · borrowing', slots: [{ day: 1, slot: 'lunch', foodId: draftFood.id }] })).json.error?.code, 'FOOD_UNAVAILABLE', 'a new plan cannot borrow it either');
  const published = await rahul.post(`/api/coach/meal-plans/${plan.id}/publish`);
  assert.equal(published.status, 200, JSON.stringify(published.json));
});

test('a planned meal is logged only against the current published version of a plan that is not archived; the publish notice carries no title', async () => {
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const vikram = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const memberId = userId(h.ctx, DEMO.member2);
  const today = n.localToday(h.ctx);
  const week = (label: string) => [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, slot: 'lunch', title: `Test lunch · ${label}` }));
  const created = await rahul.post('/api/coach/meal-plans', { memberId, title: 'Test plan · title typed by the coach', slots: week('v1') });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const planId = (created.json as { id: string }).id;
  assert.equal((await rahul.post(`/api/coach/meal-plans/${planId}/publish`)).status, 200);

  // the notice says a plan is ready, never what the coach called it: not in the app, not in email, SMS or push
  const notice = h.db.get<{ id: string; title: string; body: string }>("SELECT id, title, body FROM notifications WHERE user_id = ? AND category = 'nutrition' ORDER BY created_at DESC, rowid DESC LIMIT 1", [memberId])!;
  assert.equal(notice.title, 'Your meal plan is ready');
  assert.ok(!notice.body.includes('title typed by the coach'), 'no plan title in the notification');
  const outbox = h.db.all<{ channel: string; subject: string | null; body: string }>('SELECT channel, subject, body FROM outbox_messages WHERE notification_id = ?', [notice.id]);
  assert.ok(outbox.some((m) => m.channel === 'email') && outbox.some((m) => m.channel === 'push'), 'email and push were written to the outbox');
  for (const m of outbox) {
    assert.ok(!`${m.subject ?? ''} ${m.body}`.includes('title typed by the coach'), `no plan title by ${m.channel}`);
    if (m.channel === 'email') assert.equal(m.body, 'Your meal plan is ready. Open the Bioptime app for the detail.', 'sent as sensitive');
    if (m.channel === 'push') assert.equal(m.body, 'Open the app for the detail.', 'sent as sensitive');
  }

  const v1 = ((await vikram.get('/api/me/nutrition')).json as { todaySlots: Array<{ id: string; title: string }> }).todaySlots[0]!;
  assert.equal(v1.title, 'Test lunch · v1');
  // the coach opens version 2 and renames it: while it is a draft, version 1 (and its title) is still the plan and its
  // meals can be logged
  const renamed = await rahul.patch(`/api/coach/meal-plans/${planId}`, { title: 'Test plan · revised working title', slots: week('v2') });
  assert.equal((renamed.json as { title: string }).title, 'Test plan · revised working title', 'the coach sees the draft’s title');
  assert.equal(((await vikram.get('/api/me/meal-plan')).json as { plan: { title: string } }).plan.title, 'Test plan · title typed by the coach', 'the member keeps the published title until the draft is published');
  const yesterday = shiftDate(today, -1);
  const v1Yesterday = h.db.get<{ id: string }>('SELECT s.id FROM meal_plan_slots s JOIN meal_plan_versions v ON v.id = s.plan_version_id WHERE v.plan_id = ? AND v.version = 1 AND s.day = ?', [planId, n.planDayOf(yesterday)])!;
  assert.equal((await vikram.post('/api/me/meal-logs', { date: yesterday, slotId: v1Yesterday.id, outcome: 'as_planned' })).status, 201, 'the version in force while the next one is a draft');
  await rahul.post(`/api/coach/meal-plans/${planId}/publish`);
  assert.equal(((await vikram.get('/api/me/meal-plan')).json as { plan: { title: string } }).plan.title, 'Test plan · revised working title', 'published with its version');
  const revisedNotice = h.db.get<{ title: string; body: string }>("SELECT title, body FROM notifications WHERE user_id = ? AND category = 'nutrition' ORDER BY created_at DESC, rowid DESC LIMIT 1", [memberId])!;
  assert.equal(revisedNotice.title, 'Your meal plan was updated');
  assert.ok(!revisedNotice.body.includes('revised working title'));
  const stale = await vikram.post('/api/me/meal-logs', { date: today, slotId: v1.id, outcome: 'as_planned' });
  assert.equal(stale.json.error?.code, 'SLOT_UNKNOWN', 'a meal from the version the coach replaced');
  const v2 = ((await vikram.get('/api/me/nutrition')).json as { todaySlots: Array<{ id: string; title: string }> }).todaySlots[0]!;
  assert.equal(v2.title, 'Test lunch · v2');
  assert.equal((await vikram.post('/api/me/meal-logs', { date: today, slotId: v2.id, outcome: 'as_planned' })).status, 201);

  // archived: none of its meals can be logged any more
  await rahul.post(`/api/coach/meal-plans/${planId}/archive`, { reason: 'test: archived' });
  const v2Yesterday = h.db.get<{ id: string }>('SELECT s.id FROM meal_plan_slots s JOIN meal_plan_versions v ON v.id = s.plan_version_id WHERE v.plan_id = ? AND v.version = 2 AND s.day = ?', [planId, n.planDayOf(yesterday)])!;
  assert.equal((await vikram.post('/api/me/meal-logs', { date: yesterday, slotId: v2Yesterday.id, outcome: 'swapped', description: 'Test · rice' })).json.error?.code, 'SLOT_UNKNOWN');
});

test('changing a meal log follows the rules of logging one', async () => {
  const m = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const d = (await m.get('/api/me/nutrition')).json as { today: string; todaySlots: Array<{ id: string; slot: string; title: string }> };
  const breakfast = d.todaySlots.find((s) => s.slot === 'breakfast')!;
  const planned = (await m.post('/api/me/meal-logs', { date: d.today, slotId: breakfast.id, outcome: 'as_planned' })).json as { id: string; description: string };
  assert.equal(planned.description, breakfast.title);

  assert.equal((await m.patch(`/api/me/meal-logs/${planned.id}`, { outcome: 'extra' })).json.error?.code, 'OUTCOME_INVALID', 'a planned meal never becomes an extra one');
  const bare = await m.patch(`/api/me/meal-logs/${planned.id}`, { outcome: 'swapped' });
  assert.equal(bare.status, 400, 'a swap says what was eaten instead, as when it is logged');
  assert.equal(bare.json.error?.code, 'VALIDATION_FAILED');
  assert.equal((await m.patch(`/api/me/meal-logs/${planned.id}`, { outcome: 'swapped', description: 'x' })).status, 400);
  assert.equal(h.db.get<{ outcome: string }>('SELECT outcome FROM meal_logs WHERE id = ?', [planned.id])!.outcome, 'as_planned', 'nothing changed');
  const swapped = await m.patch(`/api/me/meal-logs/${planned.id}`, { outcome: 'swapped', description: 'Test · upma instead' });
  assert.equal(swapped.status, 200, JSON.stringify(swapped.json));
  assert.equal((await m.patch(`/api/me/meal-logs/${planned.id}`, { note: 'Test note' })).status, 200, 'other changes to a swap need nothing more');
  assert.equal((await m.patch(`/api/me/meal-logs/${planned.id}`, { outcome: 'skipped' })).status, 200);
  assert.equal((await m.patch(`/api/me/meal-logs/${planned.id}`, { outcome: 'swapped' })).status, 400, 'swapped again: say what was eaten');
  assert.equal((await m.patch(`/api/me/meal-logs/${planned.id}`, { description: ' ' })).status, 400);

  // an entry without a planned meal takes any outcome when logged, so a change may too (adherence counts it for an
  // open planned meal of the same kind that day, as it does when it is logged that way)
  assert.equal((await m.post('/api/me/meal-logs', { date: d.today, slot: 'evening', outcome: 'as_planned', description: 'Test · evening snack as planned' })).status, 201);
  const extra = (await m.post('/api/me/meal-logs', { date: d.today, slot: 'evening', outcome: 'extra', description: 'Test · fruit' })).json as { id: string };
  assert.equal((await m.patch(`/api/me/meal-logs/${extra.id}`, { outcome: 'as_planned' })).status, 200);
  assert.equal((await m.patch(`/api/me/meal-logs/${extra.id}`, { outcome: 'extra', description: 'T' })).status, 400, 'a description stays at least two characters');
  for (const id of [planned.id, extra.id]) assert.equal((await m.del(`/api/me/meal-logs/${id}`)).status, 200);
});

test('data export: the member’s nutrition as their own screens show it; no drafts, unpublished plans, private notes, ids or file contents', async () => {
  const memberId = userId(h.ctx, DEMO.member);
  const m = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  // a draft version on her published plan, and a plan never published
  const live = h.db.get<{ id: string }>("SELECT id FROM meal_plans WHERE member_id = ? AND status = 'published' ORDER BY created_at LIMIT 1", [memberId])!;
  assert.equal((await asha.patch(`/api/coach/meal-plans/${live.id}`, { title: 'Draft title · export probe', summary: 'Draft summary · export probe' })).status, 200);
  assert.equal(((await m.get('/api/me/meal-plan')).json as { plan: { title: string } }).plan.title, 'Regular meals', 'her screen keeps the published title');
  assert.equal((await asha.post('/api/coach/meal-plans', { memberId, title: 'Test plan · never published, export probe', slots: [{ day: 1, slot: 'lunch', title: 'Unpublished lunch · export probe' }] })).status, 201);
  // a log with a photo, a deleted log, and the coach's private note on a log
  const d = (await m.get('/api/me/nutrition')).json as { today: string };
  const withPhoto = (await m.post('/api/me/meal-logs', { date: d.today, slot: 'other', outcome: 'extra', description: 'Test · export photo entry', note: 'My own note · export' })).json as { id: string };
  assert.equal((await m.post(`/api/me/meal-logs/${withPhoto.id}/photo`, { filename: 'export-probe.png', dataBase64: PNG_1x1.toString('base64') })).status, 200);
  const gone = (await m.post('/api/me/meal-logs', { date: d.today, slot: 'other', outcome: 'extra', description: 'Test · deleted entry, export probe' })).json as { id: string };
  await m.del(`/api/me/meal-logs/${gone.id}`);
  h.db.insert('coach_notes', { id: 'cnt_export_probe_private', coach_id: userId(h.ctx, DEMO.coach), member_id: memberId, kind: 'note', visibility: 'private', author_role: 'coach', body: 'Private coach note · export probe', ref_type: 'meal_log', ref_id: withPhoto.id, created_at: new Date().toISOString() });
  try {
    const archive = buildArchive(h.ctx, memberId, 'drq_test_nutrition_export') as { moduleSections?: Record<string, Record<string, { label: string; records: unknown }>>; notIncluded: Array<{ what: string }> };
    const sections = archive.moduleSections?.nutrition;
    assert.ok(sections, 'moduleSections.nutrition is present');
    assert.deepEqual(Object.keys(sections).sort(), ['mealLogs', 'mealPlans', 'profile', 'savedDishes']);
    assert.ok(!archive.notIncluded.some((x) => /meal plans|meal logs|saved dishes/i.test(x.what)), 'nutrition leaves the notIncluded list');

    const profile = sections.profile!.records as { dietPattern: string; restrictions: Array<{ label: string }>; lastChangedBy: string };
    assert.equal(profile.dietPattern, 'Vegetarian');
    assert.ok(profile.restrictions.length > 0);
    assert.ok(['you', 'your coach'].includes(profile.lastChangedBy));

    const plans = sections.mealPlans!.records as Array<{ title: string; coach: string; status: string; versions: Array<{ version: number; inForce: boolean; summary: string; meals: Array<{ day: string; meal: string; title: string }>; totalsPerDay?: { days: unknown[] } }> }>;
    const published = h.db.all<{ title: string }>("SELECT DISTINCT p.title FROM meal_plans p JOIN meal_plan_versions v ON v.plan_id = p.id WHERE p.member_id = ? AND v.status = 'published'", [memberId]).map((r) => r.title).sort();
    assert.deepEqual(plans.map((p) => p.title).sort(), published, 'every plan published to her, and only those');
    const regular = plans.find((p) => p.title === 'Regular meals')!;
    assert.equal(regular.coach, 'Asha Menon');
    assert.deepEqual(regular.versions.map((v) => v.version), [1], 'the open draft version is not included');
    assert.ok(regular.versions[0]!.inForce && regular.versions[0]!.totalsPerDay, 'the version in force with its totals of the entered values');
    assert.ok(regular.versions[0]!.meals.some((x) => x.day === 'Monday' && x.meal === 'Breakfast'));

    const logs = sections.mealLogs!.records as Array<{ description: string; note: string | null; plannedMeal: boolean; photo: { name: string; type: string } | null; coachFeedback: Array<{ coach: string; body: string }> }>;
    assert.equal(logs.length, h.db.get<{ n: number }>('SELECT COUNT(*) n FROM meal_logs WHERE member_id = ? AND deleted_at IS NULL', [memberId])!.n, 'every entry she kept');
    const photoEntry = logs.find((l) => l.description === 'Test · export photo entry')!;
    assert.deepEqual(photoEntry.photo, { name: 'export-probe.png', type: 'image/png' }, 'the photo by name and type only');
    assert.equal(photoEntry.note, 'My own note · export');
    assert.deepEqual(photoEntry.coachFeedback, [], 'the coach’s private note is not feedback');
    assert.ok(logs.some((l) => l.coachFeedback.some((f) => f.coach === 'Asha Menon' && f.body === 'A good swap. Keep the dal with it.')), 'feedback her coach wrote for her');

    // withheld: drafts, unpublished plans, deleted entries, private notes, ids, contact details, file storage and bytes
    const text = JSON.stringify(sections);
    for (const s of ['Draft title · export probe', 'Draft summary · export probe', 'never published, export probe', 'Unpublished lunch · export probe', 'Test plan · recipe totals', 'deleted entry, export probe', 'Private coach note · export probe', PNG_1x1.toString('base64'), 'asha.menon@', 'ananya.rao@']) assert.ok(!text.includes(s), `no ${s}`);
    for (const k of ['coachId', 'coach_id', 'memberId', 'member_id', 'created_by', 'createdBy', 'slot_id', 'slotId', 'photo_file_id', 'photoFileId', 'storage_path', 'storagePath', 'sourceRef', 'id']) assert.ok(!text.includes(`"${k}"`), `no ${k}`);
    for (const prefix of ['mlg_', 'mpl_', 'mpv_', 'mps_', 'fod_', 'rcp_', 'cnt_', 'fil_', 'usr_']) assert.ok(!text.includes(prefix), `no ${prefix} id`);
    assert.deepEqual(findRestrictedFields(sections, restrictedKeys()), [], 'no contact or account fields');
  } finally {
    h.db.run("DELETE FROM coach_notes WHERE id = 'cnt_export_probe_private'");
  }
});
