/* M11 Coach AI drafting (feature flag 'ai', migration 0019_ai.sql, CAPABILITY_MAP.md 4.11).
   Adapter: api/adapters/ai.ts (AI_PROVIDER=none: every request is refused with AI_NOT_CONFIGURED, naming what is
   missing). Domain: api/domain/ai.ts. Routes: api/http/routes/ai.ts, each through def() with feature 'ai', except the
   member's own consent (GET and POST /me/ai/consent), which stays reachable while the module is off so a member can
   always see and withdraw it.
   The member assistant (owner decision D2, 30 October 2026; api/domain/assistant.ts, api/http/routes/assistant.ts,
   0044_member_assistant.sql) is registered here too, behind its own switch, which is off: GET /me/assistant and the
   member's assistant consent answer while the module is off (seeing or withdrawing a consent, as for Coach AI); the
   conversation routes and the administrator's switch (PUT /admin/assistant) need the module on.
   Jobs:
   - ai.draft_retention: deletes drafts older than ai_draft_retention_days (an owner decision; nothing is deleted, and
     no draft can be made, while it is undecided). Runs while the module is off: retention is a privacy duty.
   Events: CoachAssigned discards the previous coach's open drafts about the client.
   Demo: the first demo member's ai_processing consent under the demo draft wording; no draft is seeded (no provider
   is configured, so there is no AI text to show, and none is made up).
   Everything is referenced lazily, so the registry → module → domain → registry import cycle never reads a binding
   before it exists. */
import type { Ctx } from '../context.js';
import type { ApiModule } from './types.js';
import { aiRoutes } from '../http/routes/ai.js';
import { assistantRoutes } from '../http/routes/assistant.js';
import * as domain from '../domain/ai.js';

export const ai: ApiModule = {
  key: 'ai',
  feature: 'ai',
  routes: (app) => { aiRoutes(app); assistantRoutes(app); },
  ungated: ['GET /me/ai/consent', 'POST /me/ai/consent', 'GET /me/assistant', 'POST /me/assistant/consent'],
  jobs: [
    { name: 'draft_retention', everyMs: 6 * 60 * 60_000, runWhenDisabled: true, run: (ctx: Ctx) => domain.applyRetention(ctx), idle: (r: unknown) => !(r as { deleted?: number } | undefined)?.deleted },
  ],
  events: {
    CoachAssigned: [(ctx, _event, payload) => { domain.onCoachAssigned(ctx, payload); }],
  },
  seedDemo: (demo) => { domain.seedDemo(demo); },
};
