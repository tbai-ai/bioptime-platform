import type { FastifyInstance } from 'fastify';
import { enquirySchema, customPlanRequestSchema, emailSchema, phoneSchema } from '@bioptime/domain';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def, param } from '../route.js';
import * as assets from '../../domain/assets.js';
import fs from 'node:fs';
import { listPackages, getPackage } from '../../domain/packages.js';
import { listTests } from '../../domain/bloodwork.js';
import * as enquiries from '../../domain/enquiries.js';
import * as customPlans from '../../domain/customPlans.js';
import { allSettings } from '../../domain/settings.js';
import * as content from '../../domain/content.js';
import * as theme from '../../domain/theme.js';
import { enabledFeatures } from '../../domain/features.js';
import { publicSignInConfig } from '../../auth/social.js';

export function publicRoutes(app: FastifyInstance): void {
  def(app, { method: 'GET', path: '/packages', summary: 'The catalogue: packages and programmes with their current version', tag: 'public', auth: 'none' }, async (req) => ({ items: listPackages(req.ctx), currency: 'INR', pricesNote: 'Prices include GST where shown; "null" means pricing on request.', demo: app.config.isDemo }));
  def(app, { method: 'GET', path: '/packages/:slug', summary: 'One package by slug or id', tag: 'public', auth: 'none' }, async (req) => { const p = getPackage(req.ctx, param(req, 'slug')).presented; if (p.archived) throw errors.notFound('Package'); return p; });
  def(app, { method: 'GET', path: '/bloodwork/tests', summary: 'The priced test catalogue', tag: 'public', auth: 'none' }, async (req) => ({ items: listTests(req.ctx), vendor: app.services.vendor.mode, demo: app.config.isDemo }));
  def(app, { method: 'POST', path: '/enquiries', summary: 'Send an enquiry from the website', tag: 'public', auth: 'none', body: enquirySchema, rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req, reply) => {
    const input = parse(enquirySchema, req.body);
    if (input.website) { reply.code(202); return { received: true }; } // honeypot: swallow silently
    reply.code(201);
    return enquiries.create(req.ctx, input);
  });
  const bespokeSchema = customPlanRequestSchema.extend({ name: z.string().min(2).max(120), email: emailSchema, phone: phoneSchema.optional() });
  def(app, { method: 'POST', path: '/custom-plans/requests', summary: 'Request a bespoke programme (website or app)', tag: 'public', auth: 'none', body: bespokeSchema, rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req, reply) => {
    const input = parse(bespokeSchema, req.body);
    reply.code(201);
    const isMember = req.ctx.actor?.role === 'member';
    const r = customPlans.createRequest(req.ctx, { memberId: isMember ? req.ctx.actor!.id : null, contactName: input.name, contactEmail: input.email, contactPhone: input.phone, goals: input.goals, duration: input.duration, budgetInr: input.budgetInr, notes: input.notes });
    // a visitor gets the reference to quote, nothing else: no account, name or internal id comes back to an anonymous form
    return isMember ? customPlans.memberView(req.ctx, r.id as string) : { id: r.id, reference: r.reference, received: true };
  });
  // The website's contact form (contact.html posts to /api/contact, the same contract as the Cloudflare Worker in
  // drive/worker/index.js): JSON from the page script, or a plain form post without JavaScript (303 back to the page).
  const TOPIC_PURPOSE: Record<string, 'general' | 'bespoke' | 'partnership' | 'support'> = {
    'General question': 'general', 'The app': 'support', 'Programmes and coaching': 'general', 'Blood tests and bookings': 'support', 'Privacy and my data': 'support', 'Press and partnerships': 'partnership',
  };
  def(app, { method: 'POST', path: '/contact', summary: 'The website contact form (JSON or form post); recorded as an enquiry', tag: 'public', auth: 'none', rateLimit: { max: 10, timeWindow: '10 minutes' } }, async (req, reply) => {
    const data = (req.body ?? {}) as Record<string, unknown>;
    const isForm = (req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded');
    const back = (hash: string) => reply.redirect(`/contact#${hash}`, 303);
    if (String(data.company_website ?? '').trim()) return isForm ? back('sent') : { ok: true }; // honeypot: answer as if sent, record nothing
    const name = String(data.name ?? '').trim(), email = String(data.email ?? '').trim(), message = String(data.message ?? '').trim();
    const rawTopic = String(data.topic ?? '').trim();
    const topic = Object.prototype.hasOwnProperty.call(TOPIC_PURPOSE, rawTopic) ? rawTopic : 'General question'; // only the known labels are stored
    const errs: Record<string, string> = {};
    if (name.length < 2 || name.length > 80) errs.name = 'Please tell us your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) errs.email = 'Please enter an email address we can reply to.';
    if (message.length < 10 || message.length > 3000) errs.message = 'Please write between 10 and 3,000 characters.';
    const started = Number(data.startedAt ?? 0);
    if (started && Date.now() - started < 3000) errs.message = 'That was quick. Please take a moment and try again.';
    if (Object.keys(errs).length) { if (isForm) return back('error'); reply.code(400); return { ok: false, errors: errs }; }
    enquiries.create(req.ctx, { name, email, purpose: TOPIC_PURPOSE[topic] ?? 'general', message: `[${topic}] ${message}` });
    return isForm ? back('sent') : { ok: true, recorded: true, demo: app.config.isDemo };
  });
  def(app, { method: 'GET', path: '/public/config', summary: 'Public configuration the clients need (mode, support address, policy versions, the feature flags that are on for the caller)', tag: 'public', auth: 'none' }, async (req) => {
    const s = allSettings(req.ctx);
    // features: the flags that are on for this caller (a signed-out visitor sees only flags without an audience); the
    // portal and the app hide a module's entries while its flag is missing here. A switch that cannot run on this
    // server is left out too (phone_sign_in in production without an SMS provider), so no client offers a link that
    // would only answer 503
    // no sign-in hint: the owner removed every demo label from the screens (24 October 2026), and a password never
    // belongs in a public response
    // signIn: which member sign-in buttons to show (Google, Apple; the demo stand-in in demo mode only) and the public
    // identifiers each flow needs: OAuth client IDs and the Apple Services ID are audiences, never secrets (api/auth/social.ts)
    // openPreview: true only while the open preview is effective (demo mode with OPEN_PREVIEW=1), absent otherwise: the
    // portal, the website and the app then open each workspace through POST /auth/open-preview (api/auth/openPreview.ts)
    return { available: true, mode: app.config.BIOPTIME_MODE, demo: app.config.isDemo, emailProvider: app.config.EMAIL_PROVIDER, emailDelivered: app.config.EMAIL_PROVIDER !== 'outbox', supportEmail: s.support_email, termsVersion: '2026-10-17', privacyVersion: '2026-10-17', labVendor: app.services.vendor.mode, payments: app.services.payments.name, entitlementUnit: s.entitlement_unit, features: enabledFeatures(req.ctx), signIn: await publicSignInConfig(app.config, app.services.identity), ...(app.config.openPreview ? { openPreview: true as const } : {}) };
  });
  // published website content and theme: what the public site reads at runtime (drafts only with an administrator session)
  def(app, { method: 'GET', path: '/public/content', summary: 'Published website content blocks (key → value) and the publish version', tag: 'public', auth: 'none' }, async (req, reply) => { reply.header('cache-control', 'no-cache'); return content.publishedContent(req.ctx); });
  def(app, { method: 'GET', path: '/public/content/preview', summary: 'Draft-or-published content for the administrator preview (content.manage)', tag: 'public', auth: 'admin', permission: 'content.manage' }, async (req) => ({ values: content.previewContent(req.ctx), preview: true }));
  def(app, { method: 'GET', path: '/public/assets/:id', summary: 'An uploaded image by id (immutable: a new upload is a new id)', tag: 'public', auth: 'none' }, async (req, reply) => {
    const a = assets.getAsset(req.ctx, param(req, 'id'));
    if (!a) throw errors.notFound('Image');
    const file = assets.filePath(req.ctx, a);
    if (!fs.existsSync(file)) throw errors.notFound('Image');
    reply.type(a.mime); reply.header('cache-control', 'public, max-age=31536000, immutable'); reply.header('x-content-type-options', 'nosniff'); reply.header('content-disposition', `inline; filename="${a.filename.replace(/"/g, '')}"`);
    return fs.createReadStream(file); // returned, not reply.send(): Fastify sends it once and handles a client that leaves early
  });
  def(app, { method: 'GET', path: '/public/theme.css', summary: 'The published theme as CSS custom properties over the brand tokens', tag: 'public', auth: 'none' }, async (req, reply) => { reply.type('text/css; charset=utf-8'); reply.header('cache-control', 'no-cache'); return theme.publishedThemeCss(req.ctx); });
  def(app, { method: 'GET', path: '/public/status', summary: 'Liveness for monitors', tag: 'public', auth: 'none' }, async () => { if (!app.db) throw errors.internal(); return { ok: true }; });
}
