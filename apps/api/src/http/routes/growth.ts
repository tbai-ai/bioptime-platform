/* Growth routes: registered by the module descriptor (api/modules/growth.ts) inside /api, each through def() with the
   feature flag 'growth'. Public forms (discovery call, corporate enquiry, newsletter) are rate-limited, carry a honeypot
   field and answer the same way whatever happened (202 { received: true }); none creates an account. The team's routes
   need growth.manage; phone numbers reach only administrators who also hold members.view_restricted. A coach sees the
   discovery calls assigned to them without the email address or the phone number (the field policy's safety net runs
   over the payload). Unsubscribing stays possible while the module is switched off (listed as ungated). */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { emailSchema, isoDateTimeSchema, phoneSchema } from '@bioptime/domain';
import type { Ctx } from '../../context.js';
import { parse } from '../../lib/validate.js';
import { def, param, query } from '../route.js';
import { hasPermission } from '../../auth/permissions.js';
import { adminRestrictedKeys, coachSafe, stripRestricted } from '../../auth/fieldPolicy.js';
import * as g from '../../domain/growth.js';

const FEATURE = 'growth';
const TAG = 'growth';
const PUBLIC_LIMIT = { max: 5, timeWindow: '10 minutes' };
const LINK_LIMIT = { max: 20, timeWindow: '10 minutes' };
const WRITE_LIMIT = { max: 60, timeWindow: '10 minutes' };

/* The routes reachable while the module is off (GROWTH_UNGATED) live in domain/growthConstants.ts, a file that imports
   nothing, because the module registry reads them while it loads: a person can always leave the newsletter. */

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
/** A phone number as people type it (spaces, dashes, brackets) is reduced to digits and a leading +; empty means none. */
const optionalPhone = z.preprocess((v) => (typeof v === 'string' ? (v.replace(/[\s().-]/g, '') || undefined) : v), phoneSchema.optional());
const honeypot = z.string().max(500).optional();

function payloads() {
  const discovery = z.object({
    name: text(2, 120), email: emailSchema, phone: optionalPhone, goals: text(5, 1000),
    slotIds: z.array(z.string().min(1).max(64)).max(3, 'Choose up to three times').default([]),
    windows: z.string().trim().max(300).optional(),
    interests: z.array(z.string().regex(/^[a-z0-9-]{1,64}$/)).max(3).default([]),
    source: z.enum(g.DISCOVERY_SOURCES).default('website'),
    consent: z.literal(true, { errorMap: () => ({ message: 'Please agree that we may contact you about this request' }) }),
    consentVersion: z.literal(g.CONTACT_CONSENT_VERSION, { errorMap: () => ({ message: 'This form has changed since the page was opened. Reload the page and try again.' }) }),
    website: honeypot,
  });
  const corporate = z.object({
    company: text(2, 160), name: text(2, 120), email: emailSchema, phone: optionalPhone,
    teamSize: z.enum(g.TEAM_SIZES, { errorMap: () => ({ message: 'Choose the size of your team' }) }),
    interests: z.array(z.enum(g.CORPORATE_INTERESTS)).min(1, 'Choose at least one thing you would like to know about').max(g.CORPORATE_INTERESTS.length),
    message: z.string().trim().max(2000).optional(),
    consent: z.literal(true, { errorMap: () => ({ message: 'Please agree that we may contact you about this enquiry' }) }),
    consentVersion: z.literal(g.CONTACT_CONSENT_VERSION, { errorMap: () => ({ message: 'This form has changed since the page was opened. Reload the page and try again.' }) }),
    website: honeypot,
  });
  const newsletter = z.object({
    email: emailSchema,
    consent: z.literal(true, { errorMap: () => ({ message: 'Please tick the box to agree to the newsletter' }) }),
    consentVersion: z.literal(g.NEWSLETTER_CONSENT_VERSION, { errorMap: () => ({ message: 'This form has changed since the page was opened. Reload the page and try again.' }) }),
    source: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
    website: honeypot,
  });
  const confirmBody = z.object({ token: z.string().min(16).max(200) });
  const unsubscribeBody = z.object({ id: z.string().min(4).max(64), token: z.string().min(16).max(200) });
  const callQuery = z.object({ status: z.enum([...g.DISCOVERY_STATUSES, 'open', 'all']).optional(), assigned: z.string().max(64).optional() });
  const callPatch = z.object({ status: z.enum(g.DISCOVERY_STATUSES).optional(), assignedTo: z.string().min(1).max(64).nullable().optional(), bookedAt: isoDateTimeSchema.nullable().optional(), note: z.string().trim().max(2000).optional() });
  const corpQuery = z.object({ status: z.enum([...g.CORPORATE_STATUSES, 'open', 'all']).optional() });
  const corpPatch = z.object({ status: z.enum(g.CORPORATE_STATUSES).optional(), assignedTo: z.string().min(1).max(64).nullable().optional(), note: z.string().trim().max(2000).optional() });
  const noteBody = z.object({ body: text(2, 2000) });
  const slotBody = z.object({ startAt: isoDateTimeSchema, endAt: isoDateTimeSchema });
  const reasonOptional = z.object({ reason: z.string().trim().max(300).optional() });
  const reasonBody = z.object({ reason: text(3, 300) });
  const subQuery = z.object({ status: z.enum([...g.NEWSLETTER_STATUSES, 'all']).optional(), q: z.string().trim().max(120).optional() });
  const exportQuery = z.object({ status: z.enum([...g.NEWSLETTER_STATUSES, 'all']).optional() });
  return { discovery, corporate, newsletter, confirmBody, unsubscribeBody, callQuery, callPatch, corpQuery, corpPatch, noteBody, slotBody, reasonOptional, reasonBody, subQuery, exportQuery };
}

/** The team's view: phone numbers only with members.view_restricted, as for members. */
const teamView = <T>(ctx: Ctx, payload: T): T => (hasPermission(ctx, 'members.view_restricted') ? payload : stripRestricted(payload, adminRestrictedKeys()));

const isForm = (req: FastifyRequest) => (req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded');

/** The footer's sign-up works without JavaScript: a plain form post comes back to the home page's newsletter block. */
function formBack(reply: FastifyReply, outcome: 'sent' | 'error') { return reply.redirect(`/?newsletter=${outcome}#newsletter`, 303); }

export function growthRoutes(app: FastifyInstance): void {
  const p = payloads();

  /* ---------- public ---------- */
  def(app, { method: 'GET', path: '/public/discovery-calls/slots', summary: 'Times the team offers for a short call (start and end only); choosing one books nothing', tag: TAG, auth: 'none', feature: FEATURE }, async (req, reply) => { reply.header('cache-control', 'no-cache'); return { items: g.publicSlots(req.ctx), timezone: 'Asia/Kolkata' }; });

  def(app, { method: 'POST', path: '/public/discovery-calls', summary: 'A visitor asks for a short call (no account is created); the confirmation goes to their email and promises no time (rate-limited; honeypot)', tag: TAG, auth: 'none', feature: FEATURE, rateLimit: PUBLIC_LIMIT, body: p.discovery }, async (req, reply) => {
    const input = parse(p.discovery, req.body);
    reply.code(202);
    if (input.website) return { received: true }; // honeypot: the same answer, nothing recorded or sent
    return g.requestDiscoveryCall(req.ctx, { name: input.name, email: input.email, phone: input.phone, goals: input.goals, slotIds: input.slotIds, windows: input.windows, interests: input.interests, source: input.source, consentVersion: input.consentVersion });
  });

  def(app, { method: 'POST', path: '/public/corporate-enquiries', summary: 'A company asks about Bioptime for its team; the confirmation goes to the contact’s email (rate-limited; honeypot)', tag: TAG, auth: 'none', feature: FEATURE, rateLimit: PUBLIC_LIMIT, body: p.corporate }, async (req, reply) => {
    const input = parse(p.corporate, req.body);
    reply.code(202);
    if (input.website) return { received: true };
    return g.createCorporateEnquiry(req.ctx, { company: input.company, name: input.name, email: input.email, phone: input.phone, teamSize: input.teamSize, interests: input.interests, message: input.message, consentVersion: input.consentVersion });
  });

  def(app, { method: 'POST', path: '/public/newsletter', summary: 'Newsletter sign-up (double opt-in: a confirmation link goes to the address); JSON or a plain form post (rate-limited; honeypot)', tag: TAG, auth: 'none', feature: FEATURE, rateLimit: PUBLIC_LIMIT, body: p.newsletter }, async (req, reply) => {
    const form = isForm(req);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const body = form ? { ...raw, consent: raw.consent === 'yes' || raw.consent === 'on' || raw.consent === 'true' } : raw;
    if (form) {
      const r = p.newsletter.safeParse(body);
      if (!r.success) return formBack(reply, 'error');
      if (!r.data.website) g.subscribe(req.ctx, { email: r.data.email, consentVersion: r.data.consentVersion, source: r.data.source });
      return formBack(reply, 'sent');
    }
    const input = parse(p.newsletter, body);
    reply.code(202);
    if (input.website) return { received: true };
    return g.subscribe(req.ctx, { email: input.email, consentVersion: input.consentVersion, source: input.source });
  });

  def(app, { method: 'POST', path: '/public/newsletter/confirm', summary: 'Confirm a newsletter sign-up with the token from the email (works once, expires after 72 hours)', tag: TAG, auth: 'none', feature: FEATURE, rateLimit: LINK_LIMIT, body: p.confirmBody }, async (req) => g.confirm(req.ctx, parse(p.confirmBody, req.body).token));

  // ungated (GROWTH_UNGATED in domain/growthConstants.ts): leaving the newsletter works whether or not the module is on
  def(app, { method: 'POST', path: '/public/newsletter/unsubscribe', summary: 'Leave the newsletter with the signed link from any newsletter email (works while the module is off)', tag: TAG, auth: 'none', rateLimit: LINK_LIMIT, body: p.unsubscribeBody }, async (req) => g.unsubscribe(req.ctx, parse(p.unsubscribeBody, req.body)));

  /* ---------- coach: the discovery calls assigned to them ---------- */
  def(app, { method: 'GET', path: '/coach/growth/discovery-calls', summary: 'Discovery calls assigned to me: name, goals, preferred times and status (never the email or phone number)', tag: TAG, auth: 'coach', feature: FEATURE }, async (req) => coachSafe(req.ctx, { items: g.callsForCoach(req.ctx, req.ctx.actor!.id) }, 'growth coach route'));

  /* ---------- the team (growth.manage) ---------- */
  const team = { auth: 'admin' as const, permission: 'growth.manage' as const, feature: FEATURE, tag: TAG };
  def(app, { ...team, method: 'GET', path: '/admin/growth/summary', summary: 'Counts for the Growth pages: new and open requests, subscribers, offered slots' }, async (req) => g.summary(req.ctx));
  def(app, { ...team, method: 'GET', path: '/admin/growth/assignees', summary: 'Who a request can be assigned to: team members holding growth.manage and active coaches (names and roles only)' }, async (req) => ({ items: g.assignees(req.ctx) }));

  def(app, { ...team, method: 'GET', path: '/admin/growth/discovery-calls', summary: 'Discovery call requests (status open|new|contacted|booked|closed|all; assigned me|none|<id>)', query: p.callQuery }, async (req) => teamView(req.ctx, g.listDiscoveryCalls(req.ctx, parse(p.callQuery, query(req)))));
  def(app, { ...team, method: 'GET', path: '/admin/growth/discovery-calls/:id', summary: 'One discovery call request with the team’s notes' }, async (req) => teamView(req.ctx, g.getDiscoveryCall(req.ctx, param(req, 'id'))));
  def(app, { ...team, method: 'PATCH', path: '/admin/growth/discovery-calls/:id', summary: 'Progress a request: status, who handles it, the agreed time, a note (audited)', rateLimit: WRITE_LIMIT, body: p.callPatch }, async (req) => teamView(req.ctx, g.updateDiscoveryCall(req.ctx, param(req, 'id'), parse(p.callPatch, req.body))));
  def(app, { ...team, method: 'POST', path: '/admin/growth/discovery-calls/:id/notes', summary: 'Add a team note to a request (never sent to the person or a coach)', rateLimit: WRITE_LIMIT, body: p.noteBody }, async (req, reply) => { const out = g.addNote(req.ctx, 'discovery_call', param(req, 'id'), parse(p.noteBody, req.body).body); reply.code(201); return { items: out }; });

  def(app, { ...team, method: 'GET', path: '/admin/growth/slots', summary: 'Offered call times: upcoming and the last 14 days, with how many open requests named each' }, async (req) => ({ items: g.adminSlots(req.ctx), timezone: 'Asia/Kolkata' }));
  def(app, { ...team, method: 'POST', path: '/admin/growth/slots', summary: 'Offer a call time (10 minutes to 3 hours, in the future, no overlap)', rateLimit: WRITE_LIMIT, body: p.slotBody }, async (req, reply) => { const out = g.createSlot(req.ctx, parse(p.slotBody, req.body)); reply.code(201); return out; });
  def(app, { ...team, method: 'POST', path: '/admin/growth/slots/:id/withdraw', summary: 'Stop offering a call time (requests that named it keep it)', rateLimit: WRITE_LIMIT, body: p.reasonOptional }, async (req) => g.withdrawSlot(req.ctx, param(req, 'id'), parse(p.reasonOptional, req.body ?? {}).reason));

  def(app, { ...team, method: 'GET', path: '/admin/growth/corporate', summary: 'Corporate enquiries (status open|new|contacted|in_discussion|closed|all)', query: p.corpQuery }, async (req) => teamView(req.ctx, g.listCorporate(req.ctx, parse(p.corpQuery, query(req)))));
  def(app, { ...team, method: 'GET', path: '/admin/growth/corporate/:id', summary: 'One corporate enquiry with the team’s notes' }, async (req) => teamView(req.ctx, g.getCorporate(req.ctx, param(req, 'id'))));
  def(app, { ...team, method: 'PATCH', path: '/admin/growth/corporate/:id', summary: 'Progress a corporate enquiry: status, who handles it, a note (audited)', rateLimit: WRITE_LIMIT, body: p.corpPatch }, async (req) => teamView(req.ctx, g.updateCorporate(req.ctx, param(req, 'id'), parse(p.corpPatch, req.body))));
  def(app, { ...team, method: 'POST', path: '/admin/growth/corporate/:id/notes', summary: 'Add a team note to a corporate enquiry', rateLimit: WRITE_LIMIT, body: p.noteBody }, async (req, reply) => { const out = g.addNote(req.ctx, 'corporate_enquiry', param(req, 'id'), parse(p.noteBody, req.body).body); reply.code(201); return { items: out }; });

  def(app, { ...team, method: 'GET', path: '/admin/growth/newsletter', summary: 'Newsletter subscribers (status pending|confirmed|unsubscribed|all; q searches the address)', query: p.subQuery }, async (req) => g.listSubscribers(req.ctx, parse(p.subQuery, query(req))));
  def(app, { ...team, method: 'GET', path: '/admin/growth/newsletter/export.csv', summary: 'Subscribers as CSV (confirmed by default); the export is audited', query: p.exportQuery }, async (req, reply) => {
    const status = parse(p.exportQuery, query(req)).status ?? 'confirmed';
    const out = g.exportSubscribersCsv(req.ctx, status);
    reply.type('text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="bioptime-newsletter-${status}-${req.ctx.now().slice(0, 10)}.csv"`);
    reply.header('cache-control', 'no-store');
    return out.csv;
  });
  def(app, { ...team, method: 'POST', path: '/admin/growth/newsletter/:id/unsubscribe', summary: 'Take someone off the newsletter (for example when they ask by email), with a reason', rateLimit: WRITE_LIMIT, body: p.reasonBody }, async (req) => g.adminUnsubscribe(req.ctx, param(req, 'id'), parse(p.reasonBody, req.body).reason));
}
