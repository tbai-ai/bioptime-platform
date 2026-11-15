/* Store data: the catalogue (GET /packages), what the member already has (GET /me), courses (GET /me/courses), bespoke
   requests (GET /me/custom-plans) and the referral link (GET /me/referrals), with the few helpers the Store, the package
   sheet and the checkout share. Nothing here invents a value: a field the API does not send is simply not shown (no
   ratings, no student counts, no struck price without compareAtPriceInr). */
import { fx, withAlpha, type IconName } from '@/fx';

export type Service = { name: string; detail?: string };
export type PackageVersion = {
  id: string; version: number; durationMonths: number | null; durationLabel: string | null; consultations: number | null;
  bloodworkEntitlements: number | null; entitlementUnit?: string | null; priceInr: number | null; currency?: string; coaching?: string | null;
  level: string | null; includes: string[] | null; forSale: boolean; eligibility?: 'public' | 'invite_only' | 'existing_members' | string | null;
  startPolicy?: 'on_payment' | 'on_first_consultation' | string | null; services?: Service[] | null;
  imageUrl?: string | null; compareAtPriceInr?: number | null; accent?: string | null;
};
export type Package = {
  id: string; slug: string; name: string; kind: 'package' | 'programme' | 'bespoke'; description: string; sort?: number;
  promoLabel: string | null; visible?: boolean; archived?: boolean; active?: boolean; version: PackageVersion | null;
};
export type Catalogue = { items: Package[]; currency?: string; pricesNote?: string; demo?: boolean };
export type Programme = { id: string; status: string; packageName: string; packageSlug: string; durationLabel: string | null; endAt: string | null; customPlanId: string | null };
/** One package the member holds (GET /me programmes: every active or paused one, each with its own dates). */
export type HeldProgramme = { id: string; status: string; packageName: string; packageSlug: string; endAt: string | null };
export type Me = { member?: { name?: string }; programme?: Programme | null; programmes?: HeldProgramme[] };

export type Progress = { completed: number; total: number; pct: number | null };
export type Enrollment = { status: string; source: string; enrolledAt: string; completedAt: string | null; assignedByName: string | null; assignedNote: string | null; progress: Progress };
export type Cover = { url?: string | null; width?: number | null; height?: number | null; alt?: string | null } | null;
export type CourseCard = {
  id: string; title: string; summary: string; lessons: number; minutes: number | null; access: string | null; locked?: boolean;
  cover?: Cover; enrollment: Enrollment | null; nextLessonId: string | null;
};
export type Courses = { enrolled: CourseCard[]; available: CourseCard[] };
export type CustomPlan = { id: string; reference: string; status: string; expires_at?: string | null };
export type Referrals = { code: string; link: string; joined: Array<{ id: string; firstName: string; joinedAt: string }> };

/** What may be bought here: the coached packages (programme-kind items stay hidden in the app, owner question Q3). */
export function forSalePackages(c: Catalogue | null): Package[] {
  return (c?.items ?? []).filter((p) => p.kind === 'package' && p.visible !== false && !p.archived && !!p.version);
}

/** The catalogue's bespoke entry, when it lists one. */
export function bespokeEntry(c: Catalogue | null): Package | null {
  return (c?.items ?? []).find((p) => p.kind === 'bespoke' && p.visible !== false && !p.archived) ?? null;
}

export type CardColour = { c: string; dim: string };
/** A card's colour: the API's `accent` when it sends one, else red, gold and blue by display order. */
export function colourFor(p: Package, index: number): CardColour {
  const a = p.version?.accent;
  if (a && /^#[0-9a-fA-F]{6}$/.test(a)) return { c: a, dim: withAlpha(a, 0.12) };
  const m = fx.map.programme[index % fx.map.programme.length];
  return { c: m.c, dim: m.dim };
}

/** WCAG 2 relative luminance of a #RRGGBB colour; null for any other form. */
function luminance(colour: string): number | null {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(colour);
  if (!m) return null;
  const ch = (h: string) => { const c = parseInt(h, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(m[1]) + 0.7152 * ch(m[2]) + 0.0722 * ch(m[3]);
}

/** The WCAG contrast ratio of two #RRGGBB colours (1 … 21); null when either is in another form. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a), lb = luminance(b);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG AA for the Buy label (16 pt Montserrat: not large text). */
const LABEL_CONTRAST = 4.5;

export type BuyColours = { fill: string; ink: string };
/** The Buy button in a card's colour, with a label that reads (at least 4.5:1 against its fill):
 *  - Bioptime red takes its own pressed shade (#D42C1E: white 5.03:1; white on the brand red is 4.09:1);
 *  - a light colour (the gold #C9A96E, the light blue #64B5F6, or a light API accent) keeps its fill with a black label
 *    (9.4:1 on the gold, 9.5:1 on the blue; white was 2.24:1 and 2.21:1);
 *  - any other colour keeps white when white reaches 4.5:1. */
export function buyColours(c: string): BuyColours {
  const fill = c === fx.red.brand ? fx.red.pressed : c;
  const white = contrastRatio(fx.ink.white, fill);
  return { fill, ink: white == null || white >= LABEL_CONTRAST ? fx.ink.white : fx.bg.deep };
}

/** The level pill's icon (the earlier app's flame / bolt / refresh), for whatever level text the API sends. */
export function levelIcon(level: string): IconName {
  const l = level.toLowerCase();
  if (l.includes('begin') || l.includes('start')) return 'flame';
  if (l.includes('inter')) return 'zap';
  if (l.includes('adv') || l.includes('elite')) return 'trophy';
  if (l.includes('all')) return 'refresh-cw';
  return 'sparkle';
}

/** The tagline under a name: the description's first sentence. */
export function tagline(description: string | null | undefined): string {
  const d = (description ?? '').trim();
  if (!d) return '';
  const m = d.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : d).replace(/[.]$/, '');
}

/** Rupees as digits with Indian grouping (the price itself is drawn in mono after a ₹). */
export function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

/** A price read aloud: "22,999 rupees". */
export function spokenPrice(n: number | null | undefined): string {
  return n == null ? 'Price on request' : `${Math.round(n).toLocaleString('en-IN')} rupees`;
}

/** A compare-at price worth striking: only when the API sends one above today's price. */
export function compareAt(v: PackageVersion | null): number | null {
  const c = v?.compareAtPriceInr;
  return v && c != null && v.priceInr != null && c > v.priceInr ? c : null;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The meta line under a card's tagline: duration, consultations, blood tests (only what the version says). */
export function metaFor(v: PackageVersion | null): Array<{ icon: IconName; text: string }> {
  if (!v) return [];
  const out: Array<{ icon: IconName; text: string }> = [];
  if (v.durationLabel) out.push({ icon: 'clock', text: v.durationLabel });
  if (v.consultations) out.push({ icon: 'video', text: plural(v.consultations, 'consultation', 'consultations') });
  if (v.bloodworkEntitlements) out.push({ icon: 'test-tube', text: plural(v.bloodworkEntitlements, 'blood test', 'blood tests') });
  return out;
}

export const START_POLICY: Record<string, string> = {
  on_payment: 'Starts when the payment is confirmed',
  on_first_consultation: 'Starts at your first consultation',
};
export const ELIGIBILITY: Record<string, string> = {
  public: 'Open to everyone',
  invite_only: 'By invitation',
  existing_members: 'For existing members',
};

/** A package the member holds now: GET /me's current programme, or any other package still running that GET /me lists
 *  under `programmes` (a second package bought while one is active: both are held, so neither offers Buy). */
export function isEnrolled(me: Me | null | undefined, p: Package): boolean {
  if (!!me?.programme && me.programme.packageSlug === p.slug) return true;
  return (me?.programmes ?? []).some((g) => g.packageSlug === p.slug && (g.status === 'active' || g.status === 'paused'));
}

export const ACCESS: Record<string, string> = { all_members: 'Open to every member', package: 'Comes with your package', coach_assigned: 'From your coach' };
export const progressText = (p: Progress) => (p.total ? `${p.completed} of ${p.total} lessons` : 'No lessons yet');
export const courseStatus = (s: string) => (s === 'active' ? 'In progress' : s === 'completed' ? 'Completed' : 'Left');
