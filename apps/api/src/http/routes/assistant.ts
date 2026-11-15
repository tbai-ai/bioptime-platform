/* The member assistant's routes (api/domain/assistant.ts), registered by the ai module (api/modules/ai.ts). The
   assistant is off: the switch starts off and there is no provider, no key and no cost.

   - Member: GET /me/assistant (offered or not, on or not, why, what is missing, the consent and its wording) and
     POST /me/assistant/consent answer while the 'ai' module is off (listed as ungated), so the app can always ask and a
     member can always withdraw (granting needs the assistant offered); GET and POST /me/assistant/messages declare
     `feature: 'ai'`, and the domain refuses them while the assistant is not on for the member.
   - Administrator holding settings.manage: PUT /admin/assistant turns the switch (reason required, audited), with
     `feature: 'ai'` like the module's other administration: while the module is off the assistant is off whatever the
     switch says, and the module page's statement (only consent and clean-up routes answer while a module is off)
     stays true.
   The message text travels only in the request body: request logs record the method and path, never a body. Nothing
   here reads api/domain/assistant.ts while this file loads (api/domain/aiConstants.ts explains the import cycle). */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { def } from '../route.js';
import { MODULE_FLAG } from '../../domain/aiConstants.js';
import * as assistant from '../../domain/assistant.js';

const TAG = 'assistant';
/** The longest message a member may send the assistant. */
const MESSAGE_MAX = 2000;
const messageBody = z.object({ body: z.string().trim().min(1, 'Write a message').max(MESSAGE_MAX, `At most ${MESSAGE_MAX} characters`) }).strict();
const consentBody = z.object({ granted: z.boolean(), version: z.string().max(60).optional() }).strict();
const switchBody = z.object({ enabled: z.boolean(), reason: z.string().trim().min(3).max(300) }).strict();

export function assistantRoutes(app: FastifyInstance): void {
  const me = (req: FastifyRequest) => req.ctx.actor!.id;

  def(app, { method: 'GET', path: '/me/assistant', summary: 'The member assistant for me: whether it is offered and on, why not, what is missing, and its consent with the wording (works while the module is off; off by default)', tag: TAG, auth: 'member' }, async (req) => assistant.assistantStatus(req.ctx, me(req)));

  def(app, { method: 'POST', path: '/me/assistant/consent', summary: 'Grant or withdraw my assistant consent (granting needs the assistant offered; withdrawing always works and deletes my conversation with it)', tag: TAG, auth: 'member', body: consentBody, rateLimit: { max: 20, timeWindow: '10 minutes' } }, async (req) => {
    const i = parse(consentBody, req.body);
    return assistant.setAssistantConsent(req.ctx, me(req), i.granted, i.version);
  });

  def(app, { method: 'GET', path: '/me/assistant/messages', summary: 'My conversation with the assistant while it is on for me (empty otherwise)', tag: TAG, auth: 'member', feature: MODULE_FLAG }, async (req) => assistant.listMessages(req.ctx, me(req)));

  def(app, { method: 'POST', path: '/me/assistant/messages', summary: 'Write to the assistant (409 ASSISTANT_OFF while it is switched off; 409 AI_NOT_CONFIGURED, naming what is missing, without a provider; never answered without one)', tag: TAG, auth: 'member', feature: MODULE_FLAG, body: messageBody, rateLimit: { max: 20, timeWindow: '10 minutes' } }, async (req, reply) => {
    const i = parse(messageBody, req.body);
    const out = await assistant.sendMessage(req.ctx, me(req), i.body);
    reply.code(201);
    return out;
  });

  def(app, { method: 'PUT', path: '/admin/assistant', summary: 'Turn the member assistant on or off (reason required, audited); says what else it lacks before members are offered it', tag: TAG, auth: 'admin', permission: 'settings.manage', feature: MODULE_FLAG, body: switchBody, rateLimit: { max: 30, timeWindow: '10 minutes' } }, async (req) => {
    const i = parse(switchBody, req.body);
    return assistant.setSwitch(req.ctx, i.enabled, i.reason);
  });
}
