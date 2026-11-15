/* Referrals (feature flag 'referrals'): member referral codes, the members who joined with one, and their status.
   Migration 0034_referrals.sql; the domain is api/domain/referrals.ts.

   - routes: api/http/routes/referrals.ts (GET /me/referrals for the member; GET /admin/referrals with members.manage),
     each through def() with feature 'referrals'. The referral itself is recorded by POST /auth/register
     (api/http/routes/auth.ts) from the code the new member arrived with, while this module is on.
   - events: OrderPaid moves the referred member from signed_up to paying_member on their first paid order.
   - exportSections: the member's code and link, who joined with it (first names and dates) and who referred them.
   - seedDemo (demo mode only): codes for two of the seeded members and three people who joined with them, one of whom
     has paid; in plain words (the owner's decision of 24 October 2026).
   - Rewards are an owner decision: nothing about a reward is stored, and the screens promise none.

   Phone sign-in rides on this module's demo seed only: 'phone_sign_in' is a switch of its own outside the module
   registry (signing in is identity, not a module; migration 0035_phone_sign_in.sql, api/auth/phoneSignIn.ts), and the
   demo seed switches every registered module on but not such switches. So this seedDemo also switches phone sign-in
   on in demo mode and confirms the seeded members' phone numbers (seedPhoneSignInDemo), the way the sessions module
   switches its public_webinars part on. The phone sign-in routes do not need the referrals flag. */
import type { ApiModule } from './types.js';
import { referralRoutes } from '../http/routes/referrals.js';
import * as domain from '../domain/referrals.js';
import { seedPhoneSignInDemo } from '../auth/phoneSignIn.js';

export const referrals: ApiModule = {
  key: 'referrals',
  feature: 'referrals',
  routes: (app) => referralRoutes(app),
  events: {
    OrderPaid: [(ctx, event, payload) => { domain.onOrderPaid(ctx, event.aggregate_id, payload); }],
  },
  seedDemo: (demo) => {
    if (!demo.owner.config.isDemo) return;
    domain.seedDemoReferrals(demo.owner, demo.memberIds);
    seedPhoneSignInDemo(demo.owner);
  },
  exportSections: [
    { key: 'referrals', label: 'Your referral code and link, who joined with it (first names and dates) and who referred you', build: (ctx, memberId) => domain.exportForMember(ctx, memberId) },
  ],
};
