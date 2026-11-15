/* Route definition helper: one call registers the handler, its OpenAPI entry, its role guard, its feature flag and its
   rate limit, and marks the route as made by def() (modules may register routes no other way; api/http/app.ts). */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../context.js';
import { requireActor, requirePermission, requireRole, type Permission } from '../auth/permissions.js';
import { register, type RouteMeta } from './openapi.js';
import { errors } from '../lib/errors.js';
import { requireFeature } from '../domain/features.js';
import { enforceOpenPreview, openPreviewNote, openPreviewRestriction } from '../auth/openPreview.js';

declare module 'fastify' {
  interface FastifyRequest { ctx: Ctx; rawBody?: string }
}

export type Handler = (req: FastifyRequest, reply: FastifyReply) => unknown;

export function guard(ctx: Ctx, auth: RouteMeta['auth'], opts: { allowWithoutMfa?: boolean } = {}): void {
  // sign-out works for any session, even a privileged one that requireActor refuses for want of an enrolled authenticator
  if (opts.allowWithoutMfa && auth === 'any') { if (!ctx.actor) throw errors.unauthorised(); return; }
  switch (auth) {
    case 'none': case 'webhook': return;
    case 'any': requireActor(ctx); return;
    case 'member': requireRole(ctx, 'member'); return;
    case 'coach': requireRole(ctx, 'coach'); return;
    case 'admin': requireRole(ctx, 'admin', 'owner'); return;
    case 'owner': requireRole(ctx, 'owner'); return;
  }
}

/* def()'s own mark on every route it creates (in the route's config). buildApp registers each module inside its own
   scope with an onRoute hook that refuses, at start-up, any route without it: a module that called app.get() or
   app.route() directly would skip the role guard, the permission and the feature flag. The mark is a private object,
   so only def() can set it. */
const DEF_MARK: object = Object.freeze({ madeBy: 'def' });

/** True when a route (Fastify's onRoute options) was created by def(). */
export function madeByDef(route: { config?: unknown }): boolean {
  return !!route.config && typeof route.config === 'object' && (route.config as { bioptimeDef?: unknown }).bioptimeDef === DEF_MARK;
}

/** allowWithoutMfa: the route answers an administrator's or owner's session even before the account has an
 *  authenticator enrolled (only POST /auth/logout; every other route refuses it with MFA_ENROLMENT_REQUIRED). */
export function def(app: FastifyInstance, meta: RouteMeta & { rateLimit?: { max: number; timeWindow: string }; permission?: Permission; bodyLimit?: number; allowWithoutMfa?: boolean }, handler: Handler): void {
  // the open preview (demo only; api/auth/openPreview.ts): the routes it switches off answer 403 OPEN_PREVIEW_RESTRICTED,
  // checked after the role, the feature flag and the permission so a caller without them gets the usual answer. Off,
  // this is undefined and nothing changes (not even the API reference)
  const preview = openPreviewRestriction(app.config?.openPreview === true, meta.method, meta.path);
  register(preview ? { ...meta, responses: { ...meta.responses, '403': `${meta.responses?.['403'] ?? 'Not allowed for this role or record'}; ${openPreviewNote(preview)}` } } : meta);
  // /admin/members/:id… acts only on member accounts and /admin/coaches/:id… only on coach accounts, checked after the
  // permission so that the answer never tells a caller without it which role an id has
  const target = /^\/admin\/members\/:id(\/|$)/.test(meta.path) ? 'member' : /^\/admin\/coaches\/:id(\/|$)/.test(meta.path) ? 'coach' : null;
  app.route({
    method: meta.method,
    url: meta.path,
    config: { ...(meta.rateLimit ? { rateLimit: meta.rateLimit } : {}), bioptimeDef: DEF_MARK },
    ...(meta.bodyLimit ? { bodyLimit: meta.bodyLimit } : {}),
    handler: async (req, reply) => {
      guard(req.ctx, meta.auth, { allowWithoutMfa: meta.allowWithoutMfa });
      if (meta.feature) requireFeature(req.ctx, meta.feature); // a module's route answers FEATURE_DISABLED while its flag is off (or the caller is outside its audience)
      if (meta.permission) requirePermission(req.ctx, meta.permission); // granular check on top of the role
      if (target) {
        const id = (req.params as Record<string, string | undefined>).id;
        const u = id ? req.ctx.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', [id]) : undefined;
        if (!u || u.role !== target) throw errors.notFound(target === 'member' ? 'Member' : 'Coach');
      }
      if (preview) enforceOpenPreview(req, preview);
      const out = await handler(req, reply);
      if (out !== undefined) return out;
      // a handler that answered by itself (a redirect, a stream it passed to reply.send) leaves nothing to send: awaiting
      // the reply waits for the response to end, and a second send after a client closed the connection part-way would
      // write headers twice, an error that escaped every handler and stopped the process (app-1)
      if (reply.sent || reply.raw.headersSent || req.raw.destroyed) return undefined;
      return reply.send();
    },
  });
}

export function param(req: FastifyRequest, name: string): string {
  const v = (req.params as Record<string, string>)[name];
  if (!v) throw new Error(`missing param ${name}`);
  return v;
}

export function query(req: FastifyRequest): Record<string, unknown> { return (req.query ?? {}) as Record<string, unknown>; }
