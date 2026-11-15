/* Website content an administrator may change without a deploy: text, links, visibility and a few lists, each with
   a built-in default (today's copy), a draft and a published value. The public website reads only published values;
   previews read drafts with an administrator's session. Rich text is reduced to a small safe tag set on the way in. */
import type { Ctx } from '../context.js';
import { j } from '../db/db.js';
import { errors } from '../lib/errors.js';
import { audit } from './audit.js';
import { getAsset } from './assets.js';

export type ContentType = 'text' | 'richtext' | 'url' | 'boolean' | 'faq' | 'image';
export type ContentDef = { key: string; type: ContentType; label: string; section: string; page: string; default: unknown; max?: number };

const T = (key: string, section: string, page: string, label: string, def: string, max = 300): ContentDef => ({ key, type: 'text', section, page, label, default: def, max });
const U = (key: string, section: string, page: string, label: string, def: string): ContentDef => ({ key, type: 'url', section, page, label, default: def });

/** Every editable block, with the copy the site ships today as its default. Keys are stable: the website references them. */
export const CONTENT: ContentDef[] = [
  { key: 'site.announcement.visible', type: 'boolean', section: 'Announcement bar', page: 'Every page', label: 'Show the announcement bar', default: false },
  T('site.announcement.text', 'Announcement bar', 'Every page', 'Announcement text', '', 160),
  U('site.announcement.href', 'Announcement bar', 'Every page', 'Announcement link (optional)', ''),
  T('nav.about', 'Navigation', 'Every page', 'Menu: About', 'About us', 30),
  T('nav.programmes', 'Navigation', 'Every page', 'Menu: Programmes', 'Programmes', 30),
  T('nav.packages', 'Navigation', 'Every page', 'Menu: Packages', 'Packages', 30),
  T('nav.how_it_works', 'Navigation', 'Every page', 'Menu: How it works', 'How it works', 30),
  T('nav.bloodwork', 'Navigation', 'Every page', 'Menu: Bloodwork', 'Bloodwork', 30),
  T('nav.blog', 'Navigation', 'Every page', 'Menu: Blog', 'Blog', 30),
  T('nav.contact', 'Navigation', 'Every page', 'Menu: Contact', 'Contact us', 30),
  T('nav.signin', 'Navigation', 'Every page', 'Menu: Sign in', 'Sign in', 30),
  T('nav.download', 'Navigation', 'Every page', 'Button: Download the app', 'Download the app', 40),
  T('home.hero.badge', 'Hero', 'Home', 'Badge above the headline', 'Your wellness, our passion.', 60),
  T('home.hero.line1', 'Hero', 'Home', 'Headline line 1', 'Train smarter.', 40),
  T('home.hero.line2', 'Hero', 'Home', 'Headline line 2', 'Recover faster.', 40),
  T('home.hero.line3', 'Hero', 'Home', 'Headline line 3 (accent)', 'Live well, longer.', 40),
  T('home.hero.lead', 'Hero', 'Home', 'Supporting text', 'Bioptime brings your training, nutrition, sleep and blood tests together in one app, with coaching that sees the whole picture. Small, informed steps, every day.', 400),
  T('home.hero.cta_primary_label', 'Hero', 'Home', 'Primary button label', 'Download the app', 40),
  U('home.hero.cta_primary_href', 'Hero', 'Home', 'Primary button link', 'download.html'),
  T('home.hero.cta_secondary_label', 'Hero', 'Home', 'Secondary button label', 'Explore programmes', 40),
  U('home.hero.cta_secondary_href', 'Hero', 'Home', 'Secondary button link', 'programmes.html'),
  T('packages.intro.title', 'Packages page', 'Packages', 'Headline', 'One package. A coach, your blood tests and your consultations.', 120),
  T('packages.intro.lead', 'Packages page', 'Packages', 'Lead paragraph', 'Every package pairs you with a Bioptime coach for a set number of months and includes blood tests collected at home and one-to-one consultations. Pick the length that fits, or ask for a bespoke plan built around you.', 500),
  T('packages.note', 'Packages page', 'Packages', 'Note under the packages', 'Package prices in rupees include GST where shown. Once your payment is confirmed, Bioptime matches you with a coach by expertise, language and availability; you can ask for a change at any time.', 300),
  T('howitworks.intro.title', 'How it works', 'How it works', 'Headline', 'Eight steps from “I should” to “I did”.', 120),
  T('howitworks.intro.lead', 'How it works', 'How it works', 'Lead paragraph', 'Bioptime is a coach, a plan, blood tests at home and consultations, in one place. This is the order things happen in, and what you can expect at each step.', 500),
  T('bloodwork.intro.title', 'Bloodwork page', 'Bloodwork', 'Headline', 'Blood tests at home, results you can actually read.', 120),
  T('bloodwork.intro.lead', 'Bloodwork page', 'Bloodwork', 'Lead paragraph', 'Every package includes blood tests. A phlebotomist from our partner laboratory collects the sample at your address, the laboratory prepares the report, and it is reviewed with plain-language notes before you see it: by your coach while health sharing is on and your coach is available, otherwise by the Bioptime team.', 500),
  T('bespoke.intro.title', 'Bespoke page', 'Bespoke', 'Headline', 'A plan scoped with you, priced per proposal.', 120),
  T('bespoke.intro.lead', 'Bespoke page', 'Bespoke', 'Lead paragraph', 'When Starter, Core or Advanced is not the right shape, tell us what you are after. We review it, scope the length, tests and consultations with the right coach, and send a written proposal. Nothing is charged until you accept it.', 500),
  T('contact.intro.title', 'Contact page', 'Contact', 'Headline', 'We’d love to hear from you.', 120),
  T('contact.intro.lead', 'Contact page', 'Contact', 'Lead paragraph', 'A question about the app, a programme or a lab booking? Something we could do better? Send a note and a real person will reply by email.', 400),
  T('site.footer.note', 'Footer', 'Every page', 'Health disclaimer', 'Bioptime offers general wellbeing guidance and coaching. It isn’t medical advice and doesn’t diagnose, treat or prevent disease. If you’re unwell, talk to a doctor.', 400),
  { key: 'faq.items', type: 'faq', section: 'Questions and answers', page: 'Home', label: 'FAQ entries (empty = the built-in questions)', default: [] },
  ...(['chapters', 'method', 'technology', 'biometrics', 'diagnostics', 'longevity', 'training', 'workouts', 'nutrition', 'programs', 'showcase', 'faq', 'blog', 'finalCta'] as const).map((id) => ({ key: `home.section.${id}.visible`, type: 'boolean' as const, section: 'Section visibility', page: 'Home', label: `Show the ${id === 'finalCta' ? 'final call to action' : id} section`, default: true })),
  ...(['ignite', 'evolve', 'reset'] as const).map((id) => ({ key: `home.programs.${id}.image`, type: 'image' as const, section: 'Images', page: 'Home', label: `${id[0]!.toUpperCase()}${id.slice(1)} programme card image (empty = the built-in image)`, default: null })),
  { key: 'home.section.coaching.visible', type: 'boolean', section: 'Section visibility', page: 'Home', label: 'Show the coaching section', default: true },
  { key: 'home.section.packages.visible', type: 'boolean', section: 'Section visibility', page: 'Home', label: 'Show the packages section', default: true },
  T('home.coaching.title', 'Coaching section', 'Home', 'Headline', 'A coach who sees the whole picture.', 120),
  T('home.coaching.lead', 'Coaching section', 'Home', 'Lead paragraph', 'Every package comes with a Bioptime coach: one person who reads your goals, writes your plan, reviews your blood test reports while you share them, and talks to you, in the app and in consultations.', 400),
  T('home.coaching.cta_label', 'Coaching section', 'Home', 'Button label', 'How coaching works', 40),
  U('home.coaching.cta_href', 'Coaching section', 'Home', 'Button link', 'coaching.html'),
  T('home.packages.title', 'Packages section', 'Home', 'Headline', 'One package. A coach, your blood tests and your consultations.', 120),
  T('home.packages.lead', 'Packages section', 'Home', 'Lead paragraph', 'Pick the length that fits. The price and what each package includes are confirmed at checkout; a bespoke plan is scoped with you.', 400),
  T('nav.coaching', 'Navigation', 'Every page', 'Menu: Coaching', 'Coaching', 30),
  { key: 'coaching.hero.image', type: 'image', section: 'Images', page: 'Coaching', label: 'Coaching page image (empty = none)', default: null },
  T('seo.home.title', 'Search engines', 'Home', 'Home page title', '', 70),
  T('seo.home.description', 'Search engines', 'Home', 'Home page description', '', 160),
  T('seo.packages.title', 'Search engines', 'Packages', 'Packages page title', '', 70),
  T('seo.packages.description', 'Search engines', 'Packages', 'Packages page description', '', 160),
];
const BY_KEY = new Map(CONTENT.map((c) => [c.key, c]));
export const CONTENT_KEYS = CONTENT.map((c) => c.key);

/* ---------- validation and sanitising ---------- */
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'a', 'h3']);
function safeHref(href: string): string | null {
  const h = href.trim();
  if (!h) return null;
  if (/[\s\\\u0000-\u001f"'<>]/.test(h)) return null; // the URL parser folds backslashes and strips tabs; quotes and angle brackets never belong in a link
  if (/^(https?:)?\/\//i.test(h)) return /^https:\/\//i.test(h) ? h : null; // only https for absolute links
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // no other schemes (javascript:, data:, mailto: stays out of CMS links)
  if (h.startsWith('/') || h.startsWith('#') || /^[\w./-]+(\?[\w=&%.-]*)?(#[\w-]*)?$/.test(h)) return h;
  return null;
}
/** Keep only a small set of formatting tags and safe links; everything else becomes text. */
export function sanitizeRichText(input: string): string {
  const escape = (s: string) => s.replace(/&(?!(amp|lt|gt|quot|#39);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '';
  const re = /<\/?([a-zA-Z0-9]+)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const open: string[] = [];
  while ((m = re.exec(input))) {
    out += escape(input.slice(last, m.index));
    last = re.lastIndex;
    const closing = m[0].startsWith('</');
    const tag = m[1]!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue; // dropped tag; its text content stays
    if (tag === 'br') { out += '<br>'; continue; }
    if (closing) { if (open.lastIndexOf(tag) >= 0) { out += `</${tag}>`; open.splice(open.lastIndexOf(tag), 1); } continue; }
    if (tag === 'a') {
      const hm = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[2] ?? '');
      const href = hm ? safeHref(hm[2] ?? hm[3] ?? '') : null;
      if (!href) continue; // a link without a safe target is dropped (its text stays)
      out += `<a href="${href.replace(/"/g, '&quot;')}"${/^https:/.test(href) ? ' rel="noopener" target="_blank"' : ''}>`;
    } else out += `<${tag}>`;
    open.push(tag);
  }
  out += escape(input.slice(last));
  for (const tag of open.reverse()) out += `</${tag}>`;
  return out.trim();
}

/** Plain text: control characters and complete tags removed; a lone < is harmless under textContent and stays. */
function plainText(value: string): string { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->/g, '').trim(); }

const ALT_REQUIRED = (def: ContentDef) => `${def.label.replace(/\s*\(empty[^)]*\)\s*$/, '')}: describe the image in the alternative text (what it shows, for people who cannot see it) before saving or publishing.`;

export function validateValue(ctx: Ctx, def: ContentDef, value: unknown): unknown {
  switch (def.type) {
    case 'text': {
      if (typeof value !== 'string') throw errors.badRequest(`${def.label} must be text`, 'CONTENT_TYPE');
      const v = plainText(value);
      if (v.length > (def.max ?? 300)) throw errors.badRequest(`${def.label} is limited to ${def.max ?? 300} characters`, 'CONTENT_TOO_LONG');
      return v;
    }
    case 'richtext': {
      if (typeof value !== 'string') throw errors.badRequest(`${def.label} must be text`, 'CONTENT_TYPE');
      if (value.length > (def.max ?? 4000)) throw errors.badRequest(`${def.label} is limited to ${def.max ?? 4000} characters`, 'CONTENT_TOO_LONG');
      return sanitizeRichText(value);
    }
    case 'url': {
      if (typeof value !== 'string') throw errors.badRequest(`${def.label} must be a link`, 'CONTENT_TYPE');
      if (!value.trim()) return '';
      const h = safeHref(value);
      if (!h) throw errors.badRequest(`${def.label}: use a page of this site (like packages.html) or an https:// address`, 'CONTENT_URL');
      return h;
    }
    case 'boolean': { if (typeof value !== 'boolean') throw errors.badRequest(`${def.label} is on or off`, 'CONTENT_TYPE'); return value; }
    case 'image': {
      if (value === null || value === '' || value === undefined) return null;
      const v = value as { assetId?: unknown; alt?: unknown };
      if (typeof v !== 'object' || typeof v.assetId !== 'string') throw errors.badRequest(`${def.label} must name an uploaded image`, 'CONTENT_TYPE');
      const asset = getAsset(ctx, v.assetId);
      if (!asset) throw errors.badRequest('That image is not in the library', 'CONTENT_ASSET');
      const alt = typeof v.alt === 'string' ? plainText(v.alt).slice(0, 200) : asset.alt;
      // every image the site shows is described for people who cannot see it (staff-14)
      if (!alt.trim()) throw errors.badRequest(ALT_REQUIRED(def), 'CONTENT_ALT_REQUIRED');
      return { assetId: asset.id, alt, url: `/api/public/assets/${asset.id}`, width: asset.width, height: asset.height }; // dimensions let the page reserve the box before the image loads
    }
    case 'faq': {
      if (!Array.isArray(value) || value.length > 50) throw errors.badRequest('FAQ entries must be a list of up to 50 items', 'CONTENT_TYPE');
      return value.map((it, i) => {
        const q = typeof (it as { q?: unknown })?.q === 'string' ? plainText((it as { q: string }).q) : '';
        const a = typeof (it as { a?: unknown })?.a === 'string' ? (it as { a: string }).a : '';
        if (q.length < 3 || q.length > 200) throw errors.badRequest(`FAQ item ${i + 1}: the question needs 3 to 200 characters`, 'CONTENT_TYPE');
        if (a.length < 3 || a.length > 4000) throw errors.badRequest(`FAQ item ${i + 1}: the answer needs 3 to 4000 characters`, 'CONTENT_TYPE');
        return { q, a: sanitizeRichText(a) };
      });
    }
  }
}

/* ---------- reads ---------- */
type Row = { key: string; draft: string | null; published: string | null; draft_updated_at: string | null; draft_updated_by: string | null; published_at: string | null; published_by: string | null };

/** What the public website shows: published values, falling back to the built-in defaults. */
export function publishedContent(ctx: Ctx): { values: Record<string, unknown>; version: string | null } {
  const rows = ctx.db.all<Row>('SELECT * FROM content_blocks');
  const by = new Map(rows.map((r) => [r.key, r]));
  const values: Record<string, unknown> = {};
  let version: string | null = null;
  for (const def of CONTENT) {
    const r = by.get(def.key);
    values[def.key] = r?.published !== null && r?.published !== undefined ? j.out(r.published, def.default) : def.default;
    if (r?.published_at && (!version || r.published_at > version)) version = r.published_at;
  }
  return { values, version };
}

/** What an administrator previews: drafts where they exist, otherwise the published or default value. */
export function previewContent(ctx: Ctx): Record<string, unknown> {
  const rows = ctx.db.all<Row>('SELECT * FROM content_blocks');
  const by = new Map(rows.map((r) => [r.key, r]));
  const values: Record<string, unknown> = {};
  for (const def of CONTENT) {
    const r = by.get(def.key);
    values[def.key] = r?.draft !== null && r?.draft !== undefined ? j.out(r.draft, def.default) : r?.published !== null && r?.published !== undefined ? j.out(r.published, def.default) : def.default;
  }
  return values;
}

export function listContent(ctx: Ctx) {
  const rows = ctx.db.all<Row & { draft_by_name?: string; published_by_name?: string }>('SELECT c.*, d.name AS draft_by_name, p.name AS published_by_name FROM content_blocks c LEFT JOIN users d ON d.id = c.draft_updated_by LEFT JOIN users p ON p.id = c.published_by');
  const by = new Map(rows.map((r) => [r.key, r]));
  return CONTENT.map((def) => {
    const r = by.get(def.key);
    return {
      key: def.key, type: def.type, label: def.label, section: def.section, page: def.page, max: def.max ?? null, default: def.default,
      published: r?.published !== null && r?.published !== undefined ? j.out(r.published, def.default) : null, publishedAt: r?.published_at ?? null, publishedBy: r?.published_by_name ?? null,
      draft: r?.draft !== null && r?.draft !== undefined ? j.out(r.draft, def.default) : null, draftUpdatedAt: r?.draft_updated_at ?? null, draftBy: r?.draft_by_name ?? null,
    };
  });
}

/* ---------- writes ---------- */
export function saveDraft(ctx: Ctx, key: string, value: unknown, reason?: string) {
  const def = BY_KEY.get(key);
  if (!def) throw errors.notFound('Content block');
  const v = validateValue(ctx, def, value);
  const now = ctx.now();
  ctx.db.run('INSERT INTO content_blocks (key, draft, draft_updated_at, draft_updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET draft = excluded.draft, draft_updated_at = excluded.draft_updated_at, draft_updated_by = excluded.draft_updated_by', [key, j.in(v), now, ctx.actor?.id ?? null]);
  audit(ctx, 'content.draft', { type: 'content', id: key }, reason ?? null, { chars: typeof v === 'string' ? v.length : undefined });
  return listContent(ctx).find((c) => c.key === key)!;
}

export function discardDraft(ctx: Ctx, key: string) {
  if (!BY_KEY.has(key)) throw errors.notFound('Content block');
  ctx.db.run('UPDATE content_blocks SET draft = NULL, draft_updated_at = NULL, draft_updated_by = NULL WHERE key = ?', [key]);
  audit(ctx, 'content.discard_draft', { type: 'content', id: key });
}

/** Publish the drafts of the given keys (or every pending draft). The old published value stays in the audit record. */
export function publish(ctx: Ctx, keys: string[] | 'all', reason?: string): string[] {
  const now = ctx.now();
  const pending = ctx.db.all<Row>('SELECT * FROM content_blocks WHERE draft IS NOT NULL');
  const chosen = pending.filter((r) => keys === 'all' || keys.includes(r.key));
  if (!chosen.length) throw errors.state('Nothing to publish: no drafts are waiting', { code: 'NO_DRAFTS' });
  // a draft image saved before alternative text was required is not published without it (staff-14)
  for (const r of chosen) {
    const def = BY_KEY.get(r.key);
    if (def?.type !== 'image') continue;
    const v = j.out<{ alt?: unknown } | null>(r.draft!, null);
    if (v && !(typeof v.alt === 'string' && v.alt.trim())) throw errors.badRequest(ALT_REQUIRED(def), 'CONTENT_ALT_REQUIRED');
  }
  ctx.db.tx(() => {
    for (const r of chosen) {
      ctx.db.run('UPDATE content_blocks SET published = draft, published_at = ?, published_by = ?, draft = NULL, draft_updated_at = NULL, draft_updated_by = NULL WHERE key = ?', [now, ctx.actor?.id ?? null, r.key]);
      audit(ctx, 'content.publish', { type: 'content', id: r.key }, reason ?? null, { previous: r.published ? j.out(r.published, null) : null, published: j.out(r.draft!, null) });
    }
  });
  return chosen.map((r) => r.key);
}

/** Return a block to its built-in default (unpublish). */
export function resetToDefault(ctx: Ctx, key: string, reason?: string) {
  if (!BY_KEY.has(key)) throw errors.notFound('Content block');
  const r = ctx.db.get<Row>('SELECT * FROM content_blocks WHERE key = ?', [key]);
  ctx.db.run('DELETE FROM content_blocks WHERE key = ?', [key]);
  audit(ctx, 'content.reset', { type: 'content', id: key }, reason ?? null, { previous: r?.published ? j.out(r.published, null) : null });
}
