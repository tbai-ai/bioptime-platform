/* The help centre (M4): articles for members, coaches or both, written and published by administrators holding
   content.manage, read in the portal and the app. Bodies are rich text kept to the CMS allowlist (sanitizeRichText);
   the app receives a plain-text copy as well. Bioptime supplies the words: no clinical guidance, service levels or legal
   text is written here.

   Also here: the coach onboarding checklist, computed from the coach's records (no table), with the coach training
   courses of the Learning module (M10) counted while that module is on for coaches and has published coach courses. */
import type { Ctx } from '../context.js';
// first, so that the constants exist before the support route file reads them (see helpConstants.ts)
export { HELP_AUDIENCES, SLUG_RE, type HelpAudience } from './helpConstants.js';
import { HELP_AUDIENCES, SLUG_RE, type HelpAudience } from './helpConstants.js';
import { randomId } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { j } from '../db/db.js';
import { audit } from './audit.js';
import { sanitizeRichText } from './content.js';
import { requireActor, requirePermission, requireRole } from '../auth/permissions.js';
import { isEnabledFor } from './features.js';
import { coachTrainingSummary } from './learning.js';


type ArticleRow = {
  id: string; slug: string; title: string; body: string; audience: HelpAudience; category: string; status: 'draft' | 'published'; sort: number;
  created_by: string | null; created_at: string; updated_by: string | null; updated_at: string; published_at: string | null;
};

/** Rich text to plain text for the app: block ends become line breaks, list items get a bullet, entities are decoded. */
export function toPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/(p|li|h3|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function summaryOf(html: string): string {
  const t = toPlainText(html).replace(/\s+/g, ' ');
  return t.length > 180 ? `${t.slice(0, 177).trimEnd()}…` : t;
}

/** Which audiences a person reads: members the member and all articles, coaches the coach and all articles,
 *  administrators every audience (or the one they ask for). */
function audiencesFor(ctx: Ctx, requested?: HelpAudience): HelpAudience[] {
  const actor = requireActor(ctx);
  if (actor.role === 'member') return ['member', 'all'];
  if (actor.role === 'coach') return ['coach', 'all'];
  return requested && requested !== 'all' ? [requested, 'all'] : [...HELP_AUDIENCES];
}

function listItem(a: ArticleRow) {
  return { id: a.id, slug: a.slug, title: a.title, category: a.category, audience: a.audience, summary: summaryOf(a.body), updatedAt: a.updated_at, publishedAt: a.published_at };
}

/** Published articles for the caller's audience, grouped by the client (category, then sort). */
export function listPublished(ctx: Ctx, requested?: HelpAudience) {
  const audiences = audiencesFor(ctx, requested);
  const rows = ctx.db.all<ArticleRow>(`SELECT * FROM help_articles WHERE status = 'published' AND audience IN (${audiences.map(() => '?').join(', ')}) ORDER BY category, sort, title`, audiences);
  return rows.map(listItem);
}

/** One published article the caller may read; anything else is "not found". */
export function getPublished(ctx: Ctx, slug: string) {
  const audiences = audiencesFor(ctx);
  const a = SLUG_RE.test(slug) ? ctx.db.get<ArticleRow>("SELECT * FROM help_articles WHERE slug = ? AND status = 'published'", [slug]) : undefined;
  if (!a || !audiences.includes(a.audience)) throw errors.notFound('Help article');
  return { ...listItem(a), body: a.body, bodyText: toPlainText(a.body) };
}

/* ---------- administration (content.manage) ---------- */

function adminView(ctx: Ctx, a: ArticleRow) {
  const names = ctx.db.all<{ id: string; name: string }>('SELECT id, name FROM users WHERE id IN (?, ?)', [a.created_by ?? '', a.updated_by ?? '']);
  const name = (id: string | null) => (id ? names.find((n) => n.id === id)?.name ?? null : null);
  return { ...listItem(a), status: a.status, sort: a.sort, body: a.body, createdAt: a.created_at, createdBy: name(a.created_by), updatedBy: name(a.updated_by) };
}

function articleRow(ctx: Ctx, id: string): ArticleRow {
  const a = /^hlp_[a-z0-9]{6,40}$/.test(id) ? ctx.db.get<ArticleRow>('SELECT * FROM help_articles WHERE id = ?', [id]) : undefined;
  if (!a) throw errors.notFound('Help article');
  return a;
}

export function adminList(ctx: Ctx) {
  requirePermission(ctx, 'content.manage');
  return ctx.db.all<ArticleRow>('SELECT * FROM help_articles ORDER BY status DESC, category, sort, title').map((a) => adminView(ctx, a));
}

export function adminGet(ctx: Ctx, id: string) {
  requirePermission(ctx, 'content.manage');
  return adminView(ctx, articleRow(ctx, id));
}

function slugFrom(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[_\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'article';
}

function cleanBody(body: string): string {
  const out = sanitizeRichText(body);
  if (!toPlainText(out)) throw errors.badRequest('The article needs some text', 'BODY_EMPTY');
  return out;
}

export type ArticleInput = { slug?: string; title: string; body: string; audience: HelpAudience; category?: string; sort?: number };

/** A new article, saved as a draft. The slug is taken from the title unless given; it must be unused. */
export function createArticle(ctx: Ctx, input: ArticleInput) {
  const actor = requirePermission(ctx, 'content.manage');
  const slug = input.slug ?? slugFrom(input.title);
  if (!SLUG_RE.test(slug)) throw errors.badRequest('The address may use lower-case letters, digits and single hyphens', 'SLUG_INVALID');
  if (ctx.db.get('SELECT 1 FROM help_articles WHERE slug = ?', [slug])) throw errors.conflict('Another article already uses this address', 'SLUG_TAKEN', { slug });
  const id = randomId('hlp');
  const now = ctx.now();
  ctx.db.insert('help_articles', { id, slug, title: input.title, body: cleanBody(input.body), audience: input.audience, category: input.category?.trim() || 'general', status: 'draft', sort: input.sort ?? 0, created_by: actor.id, created_at: now, updated_by: actor.id, updated_at: now, published_at: null });
  audit(ctx, 'help_article.create', { type: 'help_article', id }, null, { slug, audience: input.audience });
  return adminView(ctx, articleRow(ctx, id));
}

/** Edit an article. A published article changes for readers at once, so the edit is audited with its reason. */
export function updateArticle(ctx: Ctx, id: string, patch: Partial<ArticleInput>, reason?: string) {
  const actor = requirePermission(ctx, 'content.manage');
  const a = articleRow(ctx, id);
  if (patch.slug !== undefined && patch.slug !== a.slug) {
    if (!SLUG_RE.test(patch.slug)) throw errors.badRequest('The address may use lower-case letters, digits and single hyphens', 'SLUG_INVALID');
    if (ctx.db.get('SELECT 1 FROM help_articles WHERE slug = ? AND id != ?', [patch.slug, id])) throw errors.conflict('Another article already uses this address', 'SLUG_TAKEN', { slug: patch.slug });
  }
  if (a.status === 'published' && (!reason || reason.trim().length < 3)) throw errors.badRequest('This article is published: say why it changes (recorded in the audit log)', 'REASON_REQUIRED');
  ctx.db.update('help_articles', id, {
    slug: patch.slug, title: patch.title, body: patch.body !== undefined ? cleanBody(patch.body) : undefined, audience: patch.audience,
    category: patch.category !== undefined ? patch.category.trim() || 'general' : undefined, sort: patch.sort, updated_by: actor.id, updated_at: ctx.now(),
  });
  audit(ctx, 'help_article.update', { type: 'help_article', id }, reason?.trim() || null, { fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined), status: a.status });
  return adminView(ctx, articleRow(ctx, id));
}

/** Publish or withdraw (back to draft). A reason is required and recorded. */
export function setPublished(ctx: Ctx, id: string, published: boolean, reason: string) {
  const actor = requirePermission(ctx, 'content.manage');
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  const a = articleRow(ctx, id);
  if ((a.status === 'published') === published) throw errors.state(published ? 'The article is already published' : 'The article is not published', { code: published ? 'ALREADY_PUBLISHED' : 'NOT_PUBLISHED' });
  const now = ctx.now();
  ctx.db.update('help_articles', id, { status: published ? 'published' : 'draft', published_at: published ? now : a.published_at, updated_by: actor.id, updated_at: now });
  audit(ctx, published ? 'help_article.publish' : 'help_article.unpublish', { type: 'help_article', id }, reason.trim(), { slug: a.slug, audience: a.audience });
  return adminView(ctx, articleRow(ctx, id));
}

/* ---------- coach onboarding (computed) ---------- */

type ChecklistItem = { key: string; label: string; detail: string; done: boolean; href: string | null; missing?: string[] };

/** Coach training from the Learning module (M10): counted only while Learning is on for this coach and at least one
 *  course with the audience 'coaches' is published; otherwise a note says why there is no training item. */
function coachTraining(ctx: Ctx, coachId: string): { available: true; total: number; completed: number } | { available: false; note: string } {
  const learningOn = isEnabledFor(ctx, 'learning') && !!ctx.db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'courses'");
  if (!learningOn) return { available: false, note: 'Training courses for coaches appear here when the Learning module is switched on.' };
  const t = coachTrainingSummary(ctx, coachId);
  if (!t.available) return { available: false, note: 'No training courses for coaches are published yet. They join this checklist once an administrator publishes one.' };
  return { available: true, total: t.total, completed: Math.min(t.completed, t.total) };
}

/** The coach's onboarding checklist: profile complete, working hours set, policies accepted, and coach training
 *  courses completed when the Learning module provides them (see coachTraining). */
export function coachOnboarding(ctx: Ctx, coachId: string) {
  const actor = requireRole(ctx, 'coach');
  if (actor.id !== coachId) throw errors.forbidden();
  const p = ctx.db.get<{ display_name: string; bio: string | null; expertise: string; languages: string; activated_at: string | null }>('SELECT display_name, bio, expertise, languages, activated_at FROM coach_profiles WHERE user_id = ?', [coachId]);
  if (!p) throw errors.notFound('Coach profile');
  const missing: string[] = [];
  if (!p.display_name?.trim()) missing.push('display name');
  if (!p.bio?.trim()) missing.push('bio');
  if (!j.out<string[]>(p.expertise, []).length) missing.push('expertise');
  if (!j.out<string[]>(p.languages, []).length) missing.push('languages');
  const hours = ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM availability_rules WHERE coach_id = ? AND active = 1', [coachId])?.n ?? 0;
  const latest = (kind: 'terms' | 'privacy') => ctx.db.get<{ granted: number; version: string; at: string }>('SELECT granted, version, at FROM member_consents WHERE user_id = ? AND kind = ? ORDER BY at DESC LIMIT 1', [coachId, kind]);
  const terms = latest('terms'), privacy = latest('privacy');
  const policiesOk = !!terms?.granted && !!privacy?.granted;
  const items: ChecklistItem[] = [
    { key: 'profile', label: 'Complete your profile', detail: missing.length ? `Members see your profile. Still missing: ${missing.join(', ')}.` : 'Display name, bio, expertise and languages are filled in.', done: !missing.length, href: '/profile', ...(missing.length ? { missing } : {}) },
    { key: 'hours', label: 'Set your working hours', detail: hours ? `${hours} weekly working-hour block${hours === 1 ? '' : 's'} set.` : 'Members book consultations only inside your working hours.', done: hours > 0, href: '/settings' },
    { key: 'policies', label: 'Accept the policies', detail: policiesOk ? `Terms version ${terms!.version} and privacy policy version ${privacy!.version} accepted.` : 'Accepted when you activate your account from the invitation. Ask an administrator if this stays open.', done: policiesOk, href: null },
  ];
  const training = coachTraining(ctx, coachId);
  if (training.available) {
    const plural = training.total === 1 ? '' : 's';
    items.push({ key: 'training', label: 'Complete your training', detail: training.completed >= training.total ? `All ${training.total} training course${plural} for coaches completed.` : `${training.completed} of ${training.total} training course${plural} for coaches completed.`, done: training.completed >= training.total, href: '/training' });
  }
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, complete: done === items.length, activatedAt: p.activated_at, training };
}
