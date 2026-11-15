/* The request context every service receives: the database, the configuration, who is acting, and the clock. */
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import type { Role } from '@bioptime/domain';

/** mfaEnrolled: set from the session (api/auth/sessions.ts resolveSession). false on an administrator's or owner's session
 *  means the account has no authenticator enrolled, and requireActor refuses it (MFA_ENROLMENT_REQUIRED). Every HTTP actor
 *  comes from resolveSession; requireActor fails closed for an administrator's or owner's actor that carries a sessionId
 *  without mfaEnrolled: true. Actors built in code with no session (the seed, jobs, tests) leave both unset. */
export type Actor = { id: string; role: Role; email: string; name: string; sessionId?: string; mfaEnrolled?: boolean } | null;

export type Ctx = {
  db: Db;
  config: Config;
  actor: Actor;
  ip?: string;
  now: () => string;
};

export function systemCtx(db: Db, config: Config): Ctx {
  return { db, config, actor: null, now: () => new Date().toISOString() };
}

export function isPrivileged(actor: Actor): boolean { return !!actor && (actor.role === 'admin' || actor.role === 'owner'); }
export function isCoach(actor: Actor): boolean { return !!actor && actor.role === 'coach'; }
export function isMember(actor: Actor): boolean { return !!actor && actor.role === 'member'; }
