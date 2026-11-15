/* M11 Coach AI drafting: the routes. Every one goes through def() with its role and, except the member's own consent,
   `feature: 'ai'` (403 FEATURE_DISABLED while the flag is off). Records are checked again in api/domain/ai.ts: a coach
   reaches only their own drafts about clients assigned to them, and every coach payload passes the field policy guard.

   - Coach (rate-limited per address here, and per coach in the domain): POST /coach/ai/drafts, GET /coach/ai/drafts,
     GET /coach/ai/drafts/:id, POST /coach/ai/drafts/:id/accept, POST /coach/ai/drafts/:id/discard, and
     GET /coach/ai/status (what is missing, the purposes, and one client's consents and starting records).
   - Administrator holding ai.manage: GET /admin/ai/usage (counts only).
   - Member: GET and POST /me/ai/consent, reachable while the module is off so a member can always see and withdraw the
     consent (granting needs the module on).
   The coach's instructions travel only in the request body: request logs record the method and path, never a body. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isoDateSchema } from '@bioptime/domain';
import type { Ctx } from '../../context.js';
import { parse } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param, query } from '../route.js';
import { coachSafe } from '../../auth/fieldPolicy.js';
import { requireFeature } from '../../domain/features.js';
import { addDays } from '../../lib/time.js';
import * as ai from '../../domain/ai.js';
// read while this file loads, so they come from files with no part in the registry import cycle (api/domain/aiConstants.ts
// explains it); api/domain/ai.ts itself is read only inside the handlers
import { AI_PURPOSES } from '../../adapters/ai.js';
import { DRAFT_STATUSES, FINAL_TEXT_MAX, INSTRUCTIONS_MAX, MODULE_FLAG } from '../../domain/aiConstants.js';

const F = MODULE_FLAG;
const TAG = 'coach-ai';
const id40 = z.string().trim().min(1).max(40);

const draftCreate = z.object({
  purpose: z.enum(AI_PURPOSES),
  memberId: id40.optional(),
  checkinId: id40.optional(),
  planId: id40.optional(),
  instructions: z.string().max(INSTRUCTIONS_MAX, `At most ${INSTRUCTIONS_MAX} characters`).optional(),
}).strict();
const draftAccept = z.object({ finalText: z.string().trim().min(1, 'Write the text you will use').max(FINAL_TEXT_MAX, `At most ${FINAL_TEXT_MAX} characters`) }).strict();
const draftDiscard = z.object({ reason: z.string().trim().max(500).optional() }).strict();
const draftList = z.object({ memberId: id40.optional(), status: z.enum(DRAFT_STATUSES).optional() });
const statusQuery = z.object({ memberId: id40.optional() });
const usageQuery = z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() });
const consentBody = z.object({ granted: z.boolean(), version: z.string().max(40).optional() }).strict();

export function aiRoutes(app: FastifyInstance): void {
  const me = (req: FastifyRequest) => req.ctx.actor!.id;
  /** The field policy's safety net over the whole coach payload (no phone, email, address, PIN or date of birth): coachSafe
   *  looks at the payload as built, reports any restricted key a presenter produced (paths only) and sends it without. */
  const guard = <T,>(ctx: Ctx, payload: T): T => coachSafe(ctx, payload, 'ai coach route');

  /* ---------- coach ---------- */

  def(app, { method: 'GET', path: '/coach/ai/status', summary: 'Coach AI for me: whether it is configured and exactly what is missing, the purposes, and for one assigned client their consents and the records a draft could start from', tag: TAG, auth: 'coach', feature: F, query: statusQuery }, async (req) => {
    const q = parse(statusQuery, query(req));
    return guard(req.ctx, ai.coachStatus(req.ctx, me(req), q.memberId));
  });

  def(app, { method: 'POST', path: '/coach/ai/drafts', summary: 'Ask for a draft (refused with AI_NOT_CONFIGURED, naming what is missing, while no provider is configured; never sent to the client)', tag: TAG, auth: 'coach', feature: F, body: draftCreate, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(draftCreate, req.body);
    const draft = await ai.requestDraft(req.ctx, me(req), i);
    reply.code(201);
    return guard(req.ctx, draft);
  });

  def(app, { method: 'GET', path: '/coach/ai/drafts', summary: 'My drafts, newest first (?memberId for one assigned client, ?status)', tag: TAG, auth: 'coach', feature: F, query: draftList }, async (req) => {
    const q = parse(draftList, query(req));
    return guard(req.ctx, ai.listDrafts(req.ctx, me(req), q));
  });

  def(app, { method: 'GET', path: '/coach/ai/drafts/:id', summary: 'One of my drafts', tag: TAG, auth: 'coach', feature: F }, async (req) => guard(req.ctx, ai.getDraft(req.ctx, me(req), param(req, 'id'))));

  def(app, { method: 'POST', path: '/coach/ai/drafts/:id/accept', summary: 'Accept a ready draft with my final text (nothing is sent: I copy it into Messages or the plan editor)', tag: TAG, auth: 'coach', feature: F, body: draftAccept, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req) => {
    const i = parse(draftAccept, req.body);
    return guard(req.ctx, ai.acceptDraft(req.ctx, me(req), param(req, 'id'), i.finalText));
  });

  def(app, { method: 'POST', path: '/coach/ai/drafts/:id/discard', summary: 'Discard a draft (its text is cleared at once)', tag: TAG, auth: 'coach', feature: F, body: draftDiscard, rateLimit: { max: 60, timeWindow: '10 minutes' } }, async (req) => {
    const i = parse(draftDiscard, req.body ?? {});
    return guard(req.ctx, ai.discardDraft(req.ctx, me(req), param(req, 'id'), i.reason ?? null));
  });

  /* ---------- administrator ---------- */

  def(app, { method: 'GET', path: '/admin/ai/usage', summary: 'Coach AI usage: requests, refusals, acceptances and discards by purpose, coach and day (counts only, never draft text or client details)', tag: TAG, auth: 'admin', permission: 'ai.manage', feature: F, query: usageQuery }, async (req) => {
    const q = parse(usageQuery, query(req));
    const to = q.to ?? req.ctx.now().slice(0, 10);
    const from = q.from ?? addDays(`${to}T00:00:00.000Z`, -29).slice(0, 10);
    if (from > to) throw errors.validation([{ path: 'from', message: 'The start is after the end' }], 'from: the start is after the end');
    if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86_400_000) throw errors.validation([{ path: 'from', message: 'At most a year at a time' }], 'from: at most a year at a time');
    return ai.usage(req.ctx, { from, to });
  });

  /* ---------- member: the ai_processing consent (reachable while the module is off) ---------- */

  def(app, { method: 'GET', path: '/me/ai/consent', summary: 'My Coach AI consent, its wording, and whether Coach AI is in use (works while the module is off)', tag: TAG, auth: 'member' }, async (req) => ai.aiConsentState(req.ctx, me(req)));

  def(app, { method: 'POST', path: '/me/ai/consent', summary: 'Grant or withdraw my Coach AI consent (withdrawing works while the module is off and discards open drafts about me)', tag: TAG, auth: 'member', body: consentBody, rateLimit: { max: 20, timeWindow: '10 minutes' } }, async (req) => {
    const i = parse(consentBody, req.body);
    if (i.granted) requireFeature(req.ctx, F);
    return ai.setAiConsent(req.ctx, me(req), i.granted, i.version);
  });
}
