/* Referral routes: registered by the module descriptor (api/modules/referrals.ts) inside /api, each through def() with
   the feature flag 'referrals'. The member sees their own code, link and who joined with it (first names only); the
   administrators holding members.manage see every referral with its status. A referral itself is recorded only by
   POST /auth/register (api/http/routes/auth.ts), from the code the new member arrived with. */
import type { FastifyInstance } from 'fastify';
import { REFERRAL_FEATURE } from '../../domain/referralConstants.js';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { def, query } from '../route.js';
import * as r from '../../domain/referrals.js';

const FEATURE = REFERRAL_FEATURE;
const TAG = 'referrals';

export function referralRoutes(app: FastifyInstance): void {
  def(app, { method: 'GET', path: '/me/referrals', summary: 'My referral code and link (made the first time) and who joined with it, by first name and date', tag: TAG, auth: 'member', feature: FEATURE }, async (req) => r.forMember(req.ctx, req.ctx.actor!.id));

  const listQuery = z.object({ status: z.enum([...r.REFERRAL_STATUSES, 'all']).optional(), q: z.string().trim().max(120).optional() });
  def(app, { method: 'GET', path: '/admin/referrals', summary: 'Every referral with its status (signed_up|paying_member|all; q searches names, member IDs and codes)', tag: TAG, auth: 'admin', permission: 'members.manage', feature: FEATURE, query: listQuery }, async (req) => r.adminList(req.ctx, parse(listQuery, query(req))));
}
