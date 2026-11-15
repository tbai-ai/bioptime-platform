/* Growth (feature flag 'growth'): discovery calls for prospects, the package finder, the newsletter, health calculators,
   corporate enquiries and the public webinars page. Migration 0033_growth.sql.

   - routes: api/http/routes/growth.ts, each through def() with feature 'growth' (the team's routes also need
     growth.manage). Leaving the newsletter (POST /public/newsletter/unsubscribe) is ungated: it works while the module
     is off.
   - What lives elsewhere: the package finder reads the public catalogue (GET /packages) and stores nothing unless the
     visitor asks for a call; the health calculators run entirely in the visitor's browser; the webinars page lists and
     registers through the sessions module's public routes (GET /public/webinars, POST /public/webinars/:id/register),
     which need the sessions flag and its public_webinars switch.
   - jobs: privacy_retention (daily, and also while the module is off, because retention is a privacy duty) deletes
     newsletter sign-ups never confirmed 30 days after their link expired, addresses that left the newsletter 30 days
     after they unsubscribed, and discovery calls and corporate enquiries 180 days after they were closed (or after a
     year with no change), each with its notes and the emails recorded about it (domain/growth.ts applyRetention).
   - seedDemo: a few offered call times, two discovery call requests, one corporate enquiry and newsletter sign-ups in each
     state, all from fictional people on the reserved .test domain. Nothing is labelled in the visible text (the owner's
     decision of 24 October 2026); every address is fictional and receives nothing.
   - exportSections: none. The people here have no account, so there is no member archive to add them to.
   Email: confirmations and links are recorded in the outbox (EMAIL_PROVIDER is the outbox until a provider is chosen). */
import type { ApiModule, DemoSeedContext } from './types.js';
import type { Ctx } from '../context.js';
import { growthRoutes } from '../http/routes/growth.js';
import { GROWTH_UNGATED } from '../domain/growthConstants.js';
import * as g from '../domain/growth.js';
import { audit } from '../domain/audit.js';
import { zonedToIso, addDays, addMinutes } from '../lib/time.js';

export const growth: ApiModule = {
  key: 'growth',
  feature: 'growth',
  routes: (app) => growthRoutes(app),
  ungated: GROWTH_UNGATED,
  jobs: [
    {
      name: 'privacy_retention', everyMs: 24 * 3_600_000, runWhenDisabled: true, run: (ctx) => g.applyRetention(ctx),
      idle: (r) => { const x = r as g.RetentionResult | undefined; return !x || !(x.discoveryCalls || x.corporateEnquiries || x.pendingSignups || x.unsubscribed); },
    },
  ],
  seedDemo: (demo) => seedGrowth(demo),
};

/** Rows for the running product in demo mode: fictional prospects on the reserved .test domain, written through the
 *  same services the website uses (so the outbox shows the confirmation emails), then progressed by the team. */
function seedGrowth(demo: DemoSeedContext): void {
  const { owner, system, coachIds } = demo;
  if (!owner.config.isDemo) return;
  const now = owner.now();
  const day = (n: number) => addDays(now, n).slice(0, 10);
  // offered call times over the coming week, in the evening and on Saturday morning (India time)
  const slotIds: string[] = [];
  for (const [d, minute] of [[1, 18 * 60], [2, 12 * 60 + 30], [3, 18 * 60 + 30], [5, 10 * 60], [6, 17 * 60]] as Array<[number, number]>) {
    const startAt = zonedToIso(day(d), minute);
    slotIds.push(g.createSlot(owner, { startAt, endAt: addMinutes(startAt, 20) }).id);
  }

  const visitor: Ctx = { ...system, actor: null };
  g.requestDiscoveryCall(visitor, { name: 'Neha Kapoor', email: 'neha.kapoor@example.test', goals: 'I sit at a desk all day and want to get stronger and sleep better. Not sure which package fits.', slotIds: [slotIds[0]!, slotIds[2]!], windows: undefined, interests: [], source: 'website', consentVersion: g.CONTACT_CONSENT_VERSION });
  g.requestDiscoveryCall(visitor, { name: 'Arjun Pillai', email: 'arjun.pillai@example.test', phone: '+919700000123', goals: 'Training for a first half marathon; I would like blood tests before I start.', slotIds: [], windows: 'Weekday evenings after 7pm', interests: ['core'], source: 'package_finder', consentVersion: g.CONTACT_CONSENT_VERSION });
  const arjun = owner.db.get<{ id: string }>("SELECT id FROM growth_discovery_calls WHERE email = 'arjun.pillai@example.test'");
  if (arjun) {
    g.updateDiscoveryCall(owner, arjun.id, { status: 'contacted', assignedTo: coachIds[0] ?? null, note: 'Replied by email with two evening options; waiting to hear back.' });
  }

  g.createCorporateEnquiry(visitor, { company: 'Northwind Studio', name: 'Kavya Rao', email: 'kavya.rao@example.test', teamSize: '11-50', interests: ['coaching', 'live_sessions'], message: 'We are a design studio of about thirty people and are looking at wellbeing support for next year.', consentVersion: g.CONTACT_CONSENT_VERSION });

  // newsletter: one confirmed, one waiting for confirmation, one who left
  for (const email of ['rohan.mehta@example.test', 'isha.nair@example.test', 'farah.khan@example.test']) g.subscribe(visitor, { email, consentVersion: g.NEWSLETTER_CONSENT_VERSION, source: 'footer' });
  const confirmed = owner.db.get<{ id: string }>("SELECT id FROM growth_newsletter_subscribers WHERE email = 'rohan.mehta@example.test'");
  if (confirmed) {
    // the confirmation link went to an address that receives nothing, so the seed marks this one confirmed itself
    owner.db.update('growth_newsletter_subscribers', confirmed.id, { status: 'confirmed', confirmed_at: now, confirm_token_hash: null, confirm_expires_at: null, updated_at: now });
    audit(system, 'growth.newsletter.confirm', { type: 'newsletter_subscriber', id: confirmed.id }, null, { consentVersion: g.NEWSLETTER_CONSENT_VERSION, seeded: true });
  }
  const left = owner.db.get<{ id: string }>("SELECT id FROM growth_newsletter_subscribers WHERE email = 'farah.khan@example.test'");
  if (left) g.unsubscribe(visitor, { id: left.id, token: g.unsubscribeToken(owner, left.id) });
}
