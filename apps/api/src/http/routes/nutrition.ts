/* M5 Nutrition routes, registered through the module descriptor (api/modules/nutrition.ts). Every route goes through
   def() with its role, `feature: 'nutrition'` (two member clean-up routes stay reachable while the module is off) and,
   for the library administration, the library.manage permission.

   Member: their own profile, plan and logs, and the published library: search, saved dishes, and a dish logged with
   its portion (values only as entered with their source). Coach: assigned clients only; the plan always (the coach writes it), the
   profile, logs and meal photos only while the member shares health records with the coach (requireHealthAccess);
   every coach payload passes the field policy guard. Admin: the team's food and recipe library (library.manage). */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  favouriteSchema, foodInputSchema, libraryStatusSchema, mealFeedbackSchema, mealLogInputSchema, mealLogPatchSchema, mealPhotoSchema,
  mealPlanCreateSchema, mealPlanPatchSchema, MEAL_PHOTO_MAX_BYTES, memberLibraryQuerySchema, nutritionProfileSchema, recipeInputSchema,
  LIBRARY_STATUSES,
} from '@bioptime/domain/modules/nutrition';
import type { Ctx } from '../../context.js';
import { parse } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import { coachHasMember, requireHealthAccess } from '../../auth/permissions.js';
import { coachSafe as policyCoachSafe } from '../../auth/fieldPolicy.js';
import { audit } from '../../domain/audit.js';
import * as n from '../../domain/nutrition.js';

const FEATURE = 'nutrition';
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const libraryQuery = z.object({ status: z.enum(LIBRARY_STATUSES).optional(), q: z.string().trim().max(80).optional() });
const archiveBody = z.object({ reason: z.string().trim().min(3).max(300) });
const copyPlanBody = z.object({ memberId: z.string().min(1).max(64), title: z.string().trim().min(2).max(160).optional(), summary: z.string().max(2000).optional() });
const coachPlansQuery = z.object({ status: z.enum(['draft', 'published', 'archived']).optional(), memberId: z.string().max(64).optional(), q: z.string().trim().max(80).optional() });
const adminFoodCreate = foodInputSchema.extend({ status: z.enum(['draft', 'published']).optional(), reason: z.string().trim().max(300).optional() });
const adminFoodPatch = foodInputSchema.partial().extend({ reason: z.string().trim().min(3).max(500) });
const adminRecipeCreate = recipeInputSchema.extend({ status: z.enum(['draft', 'published']).optional(), reason: z.string().trim().max(300).optional() });
const adminRecipePatch = recipeInputSchema.partial().extend({ reason: z.string().trim().min(3).max(500) });

/** Every coach response passes the field policy's safety net (coachSafe in auth/fieldPolicy.ts): it looks at the
 *  payload as built, reports any restricted key a presenter produced (paths only, never values) and sends the payload
 *  without it. */
function coachSafe<T>(ctx: Ctx, payload: T): T {
  return policyCoachSafe(ctx, payload, 'nutrition coach route');
}

const me = (req: FastifyRequest) => req.ctx.actor!.id;

/** A client of the calling coach (currently assigned), or 403. */
function assignedClient(req: FastifyRequest, memberId: string): string {
  if (!coachHasMember(req.ctx, me(req), memberId)) throw errors.forbidden('Not your client', 'NO_ACCESS');
  return memberId;
}

/** A meal plan of one of the calling coach's assigned clients, or 404/403. */
function coachPlan(req: FastifyRequest): string {
  const id = param(req, 'id');
  const p = req.ctx.db.get<{ member_id: string }>('SELECT member_id FROM meal_plans WHERE id = ?', [id]);
  if (!p) throw errors.notFound('Meal plan');
  if (!coachHasMember(req.ctx, me(req), p.member_id)) throw errors.forbidden('This member is not assigned to you', 'NO_ACCESS');
  return id;
}

export function nutritionRoutes(app: FastifyInstance): void {
  /* ---------- member ---------- */
  def(app, { method: 'GET', path: '/me/nutrition', summary: 'My nutrition: profile, published meal plan, today’s planned meals and logs with today’s totals (entered, sourced values only; meals without values counted as missing), last week’s adherence', tag: 'nutrition', auth: 'member', feature: FEATURE }, async (req) => n.memberNutrition(req.ctx, me(req)));
  def(app, { method: 'PUT', path: '/me/nutrition/profile', summary: 'Set my diet pattern, restrictions, dislikes, cuisines and meals per day (labels are my own words)', tag: 'nutrition', auth: 'member', feature: FEATURE, body: nutritionProfileSchema }, async (req) => n.setProfile(req.ctx, me(req), parse(nutritionProfileSchema, req.body)));
  def(app, { method: 'GET', path: '/me/meal-plan', summary: 'My published meal plan with its slots and totals of the entered values', tag: 'nutrition', auth: 'member', feature: FEATURE }, async (req) => ({ plan: n.memberMealPlan(req.ctx, me(req)) }));
  def(app, { method: 'GET', path: '/me/meal-logs', summary: 'My meal logs between two local dates (default the last 14 days, at most 92), with my coach’s feedback', tag: 'nutrition', auth: 'member', feature: FEATURE, query: rangeQuery }, async (req) => {
    const q = parse(rangeQuery, query(req));
    const range = n.logRange(req.ctx, q.from, q.to);
    return { ...range, items: n.listLogs(req.ctx, me(req), range), adherence: n.adherence(req.ctx, me(req), range) };
  });
  def(app, { method: 'POST', path: '/me/meal-logs', summary: 'Log a meal: a planned meal (as planned, swapped or skipped) or an extra one; a dish from the library (foodId or recipeId, published) is an extra meal or a swap, with its portion (0.5, 1, 1.5 or 2 servings)', tag: 'nutrition', auth: 'member', feature: FEATURE, body: mealLogInputSchema, rateLimit: { max: 120, timeWindow: '10 minutes' } }, async (req, reply) => { const i = parse(mealLogInputSchema, req.body); reply.code(201); return n.logMeal(req.ctx, me(req), i, 'member'); });
  def(app, { method: 'PATCH', path: '/me/meal-logs/:id', summary: 'Change one of my meal logs', tag: 'nutrition', auth: 'member', feature: FEATURE, body: mealLogPatchSchema }, async (req) => n.updateLog(req.ctx, me(req), param(req, 'id'), parse(mealLogPatchSchema, req.body)));
  // deleting my own data stays possible while the module is switched off
  def(app, { method: 'DELETE', path: '/me/meal-logs/:id', summary: 'Delete one of my meal logs (its photo is removed from storage)', tag: 'nutrition', auth: 'member' }, async (req) => n.deleteLog(req.ctx, me(req), param(req, 'id')));
  def(app, { method: 'GET', path: '/me/foods', summary: 'The published foods: by words in the name or a tag (q), one tag (tag), a page at a time (cursor); values per serving only as entered with their source', tag: 'nutrition', auth: 'member', feature: FEATURE, query: memberLibraryQuerySchema }, async (req) => n.memberFoods(req.ctx, me(req), parse(memberLibraryQuerySchema, query(req))));
  def(app, { method: 'GET', path: '/me/recipes', summary: 'The published recipes: by words in the title or a tag (q), one tag (tag), a page at a time (cursor); values per serving only from their ingredients’ sourced values', tag: 'nutrition', auth: 'member', feature: FEATURE, query: memberLibraryQuerySchema }, async (req) => n.memberRecipes(req.ctx, me(req), parse(memberLibraryQuerySchema, query(req))));
  def(app, { method: 'GET', path: '/me/nutrition/favourites', summary: 'My saved foods and recipes that are still in the library, the latest saved first', tag: 'nutrition', auth: 'member', feature: FEATURE }, async (req) => n.memberFavourites(req.ctx, me(req)));
  def(app, { method: 'PUT', path: '/me/nutrition/favourites', summary: 'Save or unsave a published food or recipe (saving twice changes nothing)', tag: 'nutrition', auth: 'member', feature: FEATURE, body: favouriteSchema, rateLimit: { max: 120, timeWindow: '10 minutes' } }, async (req) => n.setFavourite(req.ctx, me(req), parse(favouriteSchema, req.body)));
  def(app, { method: 'POST', path: '/me/meal-logs/:id/photo', summary: 'Add a photo to a meal log (PNG, JPEG or WebP, 4 MB, checked by content; stored privately; nothing is estimated from it)', tag: 'nutrition', auth: 'member', feature: FEATURE, body: mealPhotoSchema, bodyLimit: Math.ceil(MEAL_PHOTO_MAX_BYTES * 1.5), rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req) => n.attachPhoto(req.ctx, me(req), param(req, 'id'), parse(mealPhotoSchema, req.body)));
  def(app, { method: 'DELETE', path: '/me/meal-logs/:id/photo', summary: 'Remove the photo of one of my meal logs', tag: 'nutrition', auth: 'member' }, async (req) => n.removePhoto(req.ctx, me(req), param(req, 'id')));

  /* ---------- coach (assigned clients only) ---------- */
  def(app, { method: 'GET', path: '/coach/clients/:id/nutrition', summary: 'A client’s meal plans; profile, logs and adherence only while they share health records with me', tag: 'nutrition', auth: 'coach', feature: FEATURE }, async (req) => {
    const memberId = assignedClient(req, param(req, 'id'));
    const shared = n.sharesWithCoach(req.ctx, memberId);
    if (shared) audit(req.ctx, 'health.viewed', { type: 'user', id: memberId }, null, { by: 'coach', what: 'nutrition' });
    return coachSafe(req.ctx, n.coachClientNutrition(req.ctx, memberId, shared));
  });
  def(app, { method: 'PUT', path: '/coach/clients/:id/nutrition/profile', summary: 'Record a client’s diet pattern and restrictions as they told me (requires their health-sharing consent)', tag: 'nutrition', auth: 'coach', feature: FEATURE, body: nutritionProfileSchema }, async (req) => {
    const memberId = assignedClient(req, param(req, 'id'));
    requireHealthAccess(req.ctx, memberId);
    return coachSafe(req.ctx, n.setProfile(req.ctx, memberId, parse(nutritionProfileSchema, req.body)));
  });
  def(app, { method: 'POST', path: '/coach/meal-plans', summary: 'Create a draft meal plan for a client', tag: 'nutrition', auth: 'coach', feature: FEATURE, body: mealPlanCreateSchema, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(mealPlanCreateSchema, req.body);
    assignedClient(req, i.memberId);
    const programme = req.ctx.db.get<{ id: string }>("SELECT id FROM programmes WHERE member_id = ? AND status = 'active' ORDER BY start_at DESC LIMIT 1", [i.memberId]);
    reply.code(201);
    return coachSafe(req.ctx, n.createMealPlan(req.ctx, { coachId: me(req), memberId: i.memberId, programmeId: programme?.id ?? null, title: i.title, summary: i.summary, targets: i.targets, slots: i.slots }));
  });
  def(app, { method: 'GET', path: '/coach/meal-plans', summary: 'The meal plans of all my assigned clients, summarised (title, status, open draft, meals and days, dates; no slots, no preferences or logs), with counts by status; filters status, memberId, q (title or client name)', tag: 'nutrition', auth: 'coach', feature: FEATURE, query: coachPlansQuery }, async (req) => {
    const q = parse(coachPlansQuery, query(req));
    if (q.memberId) assignedClient(req, q.memberId);
    return coachSafe(req.ctx, n.coachMealPlans(req.ctx, me(req), { status: q.status, memberId: q.memberId, q: q.q || undefined }));
  });
  def(app, { method: 'POST', path: '/coach/meal-plans/:id/copy', summary: 'Assign one of my meal plans to another of my clients: a new draft for that client with the same meals and targets (my library only; nothing reaches the client until I publish)', tag: 'nutrition', auth: 'coach', feature: FEATURE, body: copyPlanBody, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => {
    const source = coachPlan(req);
    const i = parse(copyPlanBody, req.body);
    assignedClient(req, i.memberId);
    reply.code(201);
    return coachSafe(req.ctx, n.copyMealPlan(req.ctx, { coachId: me(req), sourcePlanId: source, memberId: i.memberId, title: i.title, summary: i.summary }));
  });
  def(app, { method: 'GET', path: '/coach/meal-plans/:id', summary: 'A meal plan with its draft, versions, slots and totals', tag: 'nutrition', auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, n.presentMealPlan(req.ctx, coachPlan(req), { includeDraft: true })));
  def(app, { method: 'PATCH', path: '/coach/meal-plans/:id', summary: 'Edit the draft (a published plan opens its next version)', tag: 'nutrition', auth: 'coach', feature: FEATURE, body: mealPlanPatchSchema }, async (req) => coachSafe(req.ctx, n.updateMealPlanDraft(req.ctx, coachPlan(req), parse(mealPlanPatchSchema, req.body))));
  def(app, { method: 'POST', path: '/coach/meal-plans/:id/publish', summary: 'Publish the draft: it becomes the version the member sees, and they are told', tag: 'nutrition', auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, n.publishMealPlan(req.ctx, coachPlan(req))));
  def(app, { method: 'POST', path: '/coach/meal-plans/:id/archive', summary: 'Archive a meal plan (reason required, audited)', tag: 'nutrition', auth: 'coach', feature: FEATURE, body: archiveBody }, async (req) => { const id = coachPlan(req); return coachSafe(req.ctx, n.archiveMealPlan(req.ctx, id, parse(archiveBody, req.body).reason)); });
  def(app, { method: 'GET', path: '/coach/nutrition-library', summary: 'Published foods and recipes plus my own drafts', tag: 'nutrition', auth: 'coach', feature: FEATURE, query: libraryQuery }, async (req) => {
    const q = parse(libraryQuery, query(req));
    const scope = { kind: 'coach' as const, coachId: me(req) };
    return coachSafe(req.ctx, { foods: n.listFoods(req.ctx, scope, q), recipes: n.listRecipes(req.ctx, scope, q), licensedDataset: { configured: false, missing: n.LICENSED_DATASET_MISSING } });
  });
  def(app, { method: 'POST', path: '/coach/foods', summary: 'Add a food as my draft (usable in my plans; nutrient values need their source)', tag: 'nutrition', auth: 'coach', feature: FEATURE, body: foodInputSchema, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => { const i = parse(foodInputSchema, req.body); reply.code(201); return coachSafe(req.ctx, n.createFood(req.ctx, i, { source: 'coach', status: 'draft' })); });
  def(app, { method: 'POST', path: '/coach/recipes', summary: 'Add a recipe as my draft (usable in my plans)', tag: 'nutrition', auth: 'coach', feature: FEATURE, body: recipeInputSchema, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => { const i = parse(recipeInputSchema, req.body); reply.code(201); return coachSafe(req.ctx, n.createRecipe(req.ctx, { kind: 'coach', coachId: me(req) }, i, { source: 'coach', status: 'draft' })); });
  def(app, { method: 'POST', path: '/coach/meal-logs/:id/feedback', summary: 'Feedback on a client’s logged meal (a client-visible note; requires their health-sharing consent)', tag: 'nutrition', auth: 'coach', feature: FEATURE, body: mealFeedbackSchema, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req, reply) => { const i = parse(mealFeedbackSchema, req.body); reply.code(201); return coachSafe(req.ctx, n.feedbackOnLog(req.ctx, me(req), param(req, 'id'), i.body)); });

  /* ---------- admin: the team library (library.manage) ---------- */
  const pending = () => ({ licensedDataset: { configured: false, missing: n.LICENSED_DATASET_MISSING }, estimates: { configured: false, missing: n.ESTIMATE_MISSING } });
  def(app, { method: 'GET', path: '/admin/foods', summary: 'Every food in the library, drafts and archived included', tag: 'nutrition', auth: 'admin', permission: 'library.manage', feature: FEATURE, query: libraryQuery }, async (req) => ({ items: n.listFoods(req.ctx, { kind: 'team' }, parse(libraryQuery, query(req))), ...pending() }));
  def(app, { method: 'POST', path: '/admin/foods', summary: 'Add a team food (nutrient values need their source; leave them empty otherwise)', tag: 'nutrition', auth: 'admin', permission: 'library.manage', feature: FEATURE, body: adminFoodCreate }, async (req, reply) => { const { reason, status, ...i } = parse(adminFoodCreate, req.body); reply.code(201); return n.createFood(req.ctx, i, { source: 'team', status }, reason); });
  def(app, { method: 'PATCH', path: '/admin/foods/:id', summary: 'Correct a food (reason required, audited)', tag: 'nutrition', auth: 'admin', permission: 'library.manage', feature: FEATURE, body: adminFoodPatch }, async (req) => { const { reason, ...i } = parse(adminFoodPatch, req.body); return n.updateFood(req.ctx, param(req, 'id'), i, reason); });
  def(app, { method: 'POST', path: '/admin/foods/:id/status', summary: 'Publish, return to draft or archive a food (reason required, audited)', tag: 'nutrition', auth: 'admin', permission: 'library.manage', feature: FEATURE, body: libraryStatusSchema }, async (req) => { const i = parse(libraryStatusSchema, req.body); return n.setFoodStatus(req.ctx, param(req, 'id'), i.status, i.reason); });
  def(app, { method: 'GET', path: '/admin/recipes', summary: 'Every recipe in the library with its ingredients', tag: 'nutrition', auth: 'admin', permission: 'library.manage', feature: FEATURE, query: libraryQuery }, async (req) => ({ items: n.listRecipes(req.ctx, { kind: 'team' }, parse(libraryQuery, query(req))), ...pending() }));
  def(app, { method: 'POST', path: '/admin/recipes', summary: 'Add a team recipe (the method is sanitised)', tag: 'nutrition', auth: 'admin', permission: 'library.manage', feature: FEATURE, body: adminRecipeCreate }, async (req, reply) => { const { reason, status, ...i } = parse(adminRecipeCreate, req.body); reply.code(201); return n.createRecipe(req.ctx, { kind: 'team' }, i, { source: 'team', status }, reason); });
  def(app, { method: 'PATCH', path: '/admin/recipes/:id', summary: 'Correct a recipe (reason required, audited)', tag: 'nutrition', auth: 'admin', permission: 'library.manage', feature: FEATURE, body: adminRecipePatch }, async (req) => { const { reason, ...i } = parse(adminRecipePatch, req.body); return n.updateRecipe(req.ctx, param(req, 'id'), i, reason); });
  def(app, { method: 'POST', path: '/admin/recipes/:id/status', summary: 'Publish, return to draft or archive a recipe (reason required, audited)', tag: 'nutrition', auth: 'admin', permission: 'library.manage', feature: FEATURE, body: libraryStatusSchema }, async (req) => { const i = parse(libraryStatusSchema, req.body); return n.setRecipeStatus(req.ctx, param(req, 'id'), i.status, i.reason); });
}
