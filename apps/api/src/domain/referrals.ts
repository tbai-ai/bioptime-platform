/* Referrals (module 'referrals', migration 0034_referrals.sql): each member's personal code and link, the members who
   joined with one, and their status.

   - The code is made the first time the member opens Refer a friend (GET /me/referrals): eight characters from an
     alphabet without look-alikes, matched without regard to case. The link is PUBLIC_ORIGIN + /register?ref=CODE (an
     https origin in production, which the configuration requires).
   - A referral is recorded only at registration (POST /auth/register with referralCode, from the website or the app):
     the client sends the code and nothing else. Who referred whom comes from the code; the status starts at signed_up.
     Refused, without failing the registration: the module switched off, an unknown code, a code of an account that is
     not an active member, a self-referral (the code's own account, or an account with the same phone number), and a
     member who has already been referred.
   - signed_up -> paying_member when the referred member's first order is paid (OrderPaid, which the payment webhook
     emits only after a signature-verified capture). A later refund does not undo it: it records that they became a
     paying member.
   - What people see: the member sees their code, link and who joined with it, by first name and the date they joined,
     never whether that person paid; administrators holding members.manage see every referral with its status.
   - Rewards are an owner decision: nothing about a reward is stored or promised; the screens say "Rewards are set by
     the Bioptime team".
   - Every change is audited (referral.code_created, referral.recorded, referral.refused, referral.converted). */
import { randomInt } from 'node:crypto';
import type { Ctx } from '../context.js';
import { randomId } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { audit } from './audit.js';
import { isEnabled } from './features.js';

import { REFERRAL_FEATURE } from './referralConstants.js';
export { REFERRAL_FEATURE };
export const REFERRAL_STATUSES = ['signed_up', 'paying_member'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = { signed_up: 'Signed up', paying_member: 'Became a paying member' };

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_LENGTH = 8;
/** What a referral code may look like when it arrives from a client (case does not matter). */
export const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9]{4,16}$/;
const CLOSED_STATES = new Set(['invited', 'suspended', 'deactivated', 'deletion_requested', 'closed']);

type CodeRow = { member_id: string; code: string; created_at: string };
type ReferralRow = { id: string; referrer_id: string; referred_id: string; code: string; status: ReferralStatus; signed_up_at: string; became_paying_at: string | null; first_order_id: string | null; created_at: string; updated_at: string };

/** "Priya" from "Priya Nair": what a referrer sees of the person who joined. */
export function firstName(name: string | null | undefined): string {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
  return first || 'A friend';
}

export function normaliseCode(raw: string): string { return String(raw ?? '').trim().toUpperCase(); }

/** The link a member shares: the public origin's register page with their code. */
export function referralLink(ctx: Ctx, code: string): string {
  let origin: string;
  try { origin = new URL(ctx.config.PUBLIC_ORIGIN).origin; } catch { origin = ctx.config.PUBLIC_ORIGIN.replace(/\/+$/, ''); }
  return `${origin}/register?ref=${encodeURIComponent(code)}`;
}

function newCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return s;
}

function codeOf(ctx: Ctx, memberId: string): CodeRow | undefined {
  return ctx.db.get<CodeRow>('SELECT * FROM referral_codes WHERE member_id = ?', [memberId]);
}

/** The member's code, made (and audited) the first time it is asked for. Members only. */
export function ensureCode(ctx: Ctx, memberId: string): CodeRow {
  const existing = codeOf(ctx, memberId);
  if (existing) return existing;
  const member = ctx.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', [memberId]);
  if (!member || member.role !== 'member') throw errors.forbidden('Referral codes are for members');
  return ctx.db.tx(() => {
    const again = codeOf(ctx, memberId);
    if (again) return again;
    for (let tries = 0; tries < 8; tries++) {
      const code = newCode();
      if (ctx.db.get('SELECT 1 FROM referral_codes WHERE code = ?', [code])) continue;
      const now = ctx.now();
      ctx.db.insert('referral_codes', { member_id: memberId, code, created_at: now });
      audit(ctx, 'referral.code_created', { type: 'user', id: memberId }, null, { code });
      return { member_id: memberId, code, created_at: now };
    }
    throw errors.internal('A referral code could not be made. Try again.');
  });
}

/** GET /me/referrals: the member's code and link, and who joined with it (first name and date only). */
export function forMember(ctx: Ctx, memberId: string) {
  const c = ensureCode(ctx, memberId);
  const joined = ctx.db.all<{ id: string; name: string; signed_up_at: string }>(
    'SELECT r.id, u.name, r.signed_up_at FROM referrals r JOIN users u ON u.id = r.referred_id WHERE r.referrer_id = ? ORDER BY r.signed_up_at DESC', [memberId]);
  return {
    code: c.code,
    link: referralLink(ctx, c.code),
    joined: joined.map((r) => ({ id: r.id, firstName: firstName(r.name), joinedAt: r.signed_up_at })),
  };
}

export type RecordOutcome = { recorded: true; referralId: string } | { recorded: false; reason: 'module_off' | 'invalid' | 'unknown_code' | 'self' | 'duplicate' | 'referrer_inactive' };

/** At registration: records that the new member joined with this code, when every rule allows it. Never throws: a
 *  wrong code must not stop anyone creating an account. The code is the only thing taken from the client. */
export function recordAtSignUp(ctx: Ctx, referredId: string, rawCode: string | undefined | null): RecordOutcome {
  if (!rawCode) return { recorded: false, reason: 'invalid' };
  if (!isEnabled(ctx, REFERRAL_FEATURE)) return { recorded: false, reason: 'module_off' };
  if (!REFERRAL_CODE_PATTERN.test(String(rawCode).trim())) return { recorded: false, reason: 'invalid' };
  const code = normaliseCode(rawCode);
  try {
    return ctx.db.tx((): RecordOutcome => {
      const owner = ctx.db.get<{ member_id: string; role: string; state: string; phone: string | null }>('SELECT c.member_id, u.role, u.state, u.phone FROM referral_codes c JOIN users u ON u.id = c.member_id WHERE c.code = ?', [code]);
      const referred = ctx.db.get<{ id: string; role: string; phone: string | null }>('SELECT id, role, phone FROM users WHERE id = ?', [referredId]);
      if (!owner || !referred || referred.role !== 'member') return { recorded: false, reason: 'unknown_code' };
      const refuse = (reason: 'self' | 'duplicate' | 'referrer_inactive'): RecordOutcome => {
        audit(ctx, 'referral.refused', { type: 'user', id: referredId }, null, { reason, code });
        return { recorded: false, reason };
      };
      if (owner.member_id === referredId) return refuse('self');
      const digits = (p: string | null) => (p ?? '').replace(/\D/g, '').slice(-10);
      if (owner.phone && referred.phone && digits(owner.phone).length >= 8 && digits(owner.phone) === digits(referred.phone)) return refuse('self');
      if (owner.role !== 'member' || CLOSED_STATES.has(owner.state)) return refuse('referrer_inactive');
      if (ctx.db.get('SELECT 1 FROM referrals WHERE referred_id = ?', [referredId])) return refuse('duplicate');
      const id = randomId('rfl');
      const now = ctx.now();
      ctx.db.insert('referrals', { id, referrer_id: owner.member_id, referred_id: referredId, code, status: 'signed_up', signed_up_at: now, became_paying_at: null, first_order_id: null, created_at: now, updated_at: now });
      audit(ctx, 'referral.recorded', { type: 'referral', id }, null, { referrerId: owner.member_id, referredId, code });
      return { recorded: true, referralId: id };
    });
  } catch {
    // a constraint (a second registration racing this one) or anything else: the account stands, the referral does not
    return { recorded: false, reason: 'duplicate' };
  }
}

/** OrderPaid: the referred member's first paid order makes them a paying member. Later orders change nothing. */
export function onOrderPaid(ctx: Ctx, orderId: string, payload: Record<string, unknown>): void {
  const order = ctx.db.get<{ id: string; member_id: string; status: string; paid_at: string | null }>('SELECT id, member_id, status, paid_at FROM orders WHERE id = ?', [orderId]);
  const memberId = order?.member_id ?? (typeof payload.memberId === 'string' ? payload.memberId : null);
  if (!order || !memberId || !order.paid_at) return;
  const r = ctx.db.get<ReferralRow>("SELECT * FROM referrals WHERE referred_id = ? AND status = 'signed_up'", [memberId]);
  if (!r) return;
  const now = ctx.now();
  const changed = ctx.db.run("UPDATE referrals SET status = 'paying_member', became_paying_at = ?, first_order_id = ?, updated_at = ? WHERE id = ? AND status = 'signed_up'", [order.paid_at, order.id, now, r.id]).changes;
  if (changed) audit({ ...ctx, actor: null }, 'referral.converted', { type: 'referral', id: r.id }, null, { orderId: order.id, referrerId: r.referrer_id, referredId: memberId });
}

/** GET /admin/referrals (members.manage): every referral with its status, newest first, and the counts. */
export function adminList(ctx: Ctx, filter: { status?: ReferralStatus | 'all'; q?: string }) {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.status && filter.status !== 'all') { where.push('r.status = ?'); params.push(filter.status); }
  if (filter.q) {
    const like = `%${filter.q.toLowerCase()}%`;
    where.push('(LOWER(a.name) LIKE ? OR LOWER(b.name) LIKE ? OR LOWER(pa.member_code) LIKE ? OR LOWER(pb.member_code) LIKE ? OR LOWER(r.code) LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const rows = ctx.db.all<ReferralRow & { referrer_name: string; referrer_code: string | null; referred_name: string; referred_code: string | null }>(
    `SELECT r.*, a.name AS referrer_name, pa.member_code AS referrer_code, b.name AS referred_name, pb.member_code AS referred_code
       FROM referrals r JOIN users a ON a.id = r.referrer_id JOIN users b ON b.id = r.referred_id
       LEFT JOIN member_profiles pa ON pa.user_id = a.id LEFT JOIN member_profiles pb ON pb.user_id = b.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.signed_up_at DESC LIMIT 500`, params);
  const counts = Object.fromEntries(REFERRAL_STATUSES.map((s) => [s, 0])) as Record<ReferralStatus, number>;
  for (const c of ctx.db.all<{ status: ReferralStatus; n: number }>('SELECT status, COUNT(*) n FROM referrals GROUP BY status')) counts[c.status] = c.n;
  const members = ctx.db.get<{ n: number }>('SELECT COUNT(DISTINCT referrer_id) n FROM referrals')?.n ?? 0;
  return {
    items: rows.map((r) => ({
      id: r.id, code: r.code, status: r.status, statusLabel: REFERRAL_STATUS_LABELS[r.status], signedUpAt: r.signed_up_at, becamePayingAt: r.became_paying_at,
      referrer: { id: r.referrer_id, name: r.referrer_name, memberCode: r.referrer_code },
      referred: { id: r.referred_id, name: r.referred_name, memberCode: r.referred_code },
    })),
    counts: { ...counts, total: counts.signed_up + counts.paying_member, referringMembers: members },
  };
}

/** The member's data export: their code and link, who joined with it (first names and dates, as their page shows), and
 *  who referred them, if anyone (first name and date). Nothing about rewards exists to export. */
export function exportForMember(ctx: Ctx, memberId: string) {
  const c = codeOf(ctx, memberId);
  const joined = ctx.db.all<{ name: string; signed_up_at: string }>('SELECT u.name, r.signed_up_at FROM referrals r JOIN users u ON u.id = r.referred_id WHERE r.referrer_id = ? ORDER BY r.signed_up_at', [memberId]);
  const by = ctx.db.get<{ name: string; signed_up_at: string; code: string }>('SELECT u.name, r.signed_up_at, r.code FROM referrals r JOIN users u ON u.id = r.referrer_id WHERE r.referred_id = ?', [memberId]);
  return {
    code: c?.code ?? null,
    link: c ? referralLink(ctx, c.code) : null,
    codeCreatedAt: c?.created_at ?? null,
    joinedWithYourCode: joined.map((r) => ({ firstName: firstName(r.name), joinedAt: r.signed_up_at })),
    youJoinedWith: by ? { firstName: firstName(by.name), code: by.code, joinedAt: by.signed_up_at } : null,
  };
}

/** The demo seed's referrals (demo mode only): codes for two members, three people who joined with them, one of whom
 *  has paid. Written directly from the seeded people's own records (their registration time, their first paid order). */
export function seedDemoReferrals(owner: Ctx, memberIds: string[]): number {
  if (!owner.config.isDemo || memberIds.length < 12) return 0;
  const pairs: Array<[number, number]> = [[0, 8], [0, 11], [1, 7]]; // Ananya → Priya and Ishaan; Vikram → Rohan
  let n = 0;
  for (const [a, b] of pairs) {
    const referrerId = memberIds[a]!, referredId = memberIds[b]!;
    if (owner.db.get('SELECT 1 FROM referrals WHERE referred_id = ?', [referredId])) continue;
    const code = ensureCode(owner, referrerId).code;
    const joined = owner.db.get<{ created_at: string }>('SELECT created_at FROM users WHERE id = ?', [referredId])?.created_at ?? owner.now();
    const paid = owner.db.get<{ id: string; paid_at: string }>("SELECT id, paid_at FROM orders WHERE member_id = ? AND paid_at IS NOT NULL ORDER BY paid_at LIMIT 1", [referredId]);
    const id = randomId('rfl');
    owner.db.insert('referrals', { id, referrer_id: referrerId, referred_id: referredId, code, status: paid ? 'paying_member' : 'signed_up', signed_up_at: joined, became_paying_at: paid?.paid_at ?? null, first_order_id: paid?.id ?? null, created_at: joined, updated_at: owner.now() });
    audit(owner, 'referral.recorded', { type: 'referral', id }, 'initial data: a member who joined with a referral code', { referrerId, referredId, code, status: paid ? 'paying_member' : 'signed_up' });
    n++;
  }
  return n;
}
