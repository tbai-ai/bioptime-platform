/* Promotional codes: a percentage or a fixed amount off a package at checkout. Validated and applied on the server; the
   discount is recorded on the order and the use is counted only when the payment is verified. */
import type { Ctx } from '../context.js';
import { randomId } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { audit } from './audit.js';

export type CouponRow = { id: string; code: string; kind: 'percent' | 'amount'; value: number; max_uses: number | null; used: number; valid_from: string | null; valid_to: string | null; active: number; note: string | null; created_by: string | null; created_at: string; updated_at: string };

export function present(c: CouponRow) {
  return { id: c.id, code: c.code, kind: c.kind, value: c.kind === 'amount' ? c.value / 100 : c.value, maxUses: c.max_uses, used: c.used, validFrom: c.valid_from, validTo: c.valid_to, active: !!c.active, note: c.note, createdAt: c.created_at };
}

export function listCoupons(ctx: Ctx) { return ctx.db.all<CouponRow>('SELECT * FROM coupons ORDER BY created_at DESC').map(present); }

export function createCoupon(ctx: Ctx, input: { code: string; kind: 'percent' | 'amount'; value: number; maxUses?: number | null; validFrom?: string | null; validTo?: string | null; note?: string }, reason?: string) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,24}$/.test(code)) throw errors.badRequest('Codes use 3 to 24 letters, digits or dashes', 'COUPON_CODE');
  if (input.kind === 'percent' && (input.value < 1 || input.value > 100)) throw errors.badRequest('A percentage is between 1 and 100', 'COUPON_VALUE');
  if (input.kind === 'amount' && input.value <= 0) throw errors.badRequest('An amount must be positive', 'COUPON_VALUE');
  if (ctx.db.get('SELECT 1 FROM coupons WHERE code = ?', [code])) throw errors.conflict('That code exists already', 'COUPON_EXISTS');
  const now = ctx.now();
  const id = randomId('cpn');
  ctx.db.insert('coupons', { id, code, kind: input.kind, value: input.kind === 'amount' ? Math.round(input.value * 100) : Math.round(input.value), max_uses: input.maxUses ?? null, used: 0, valid_from: input.validFrom ?? null, valid_to: input.validTo ?? null, active: 1, note: input.note ?? null, created_by: ctx.actor?.id ?? null, created_at: now, updated_at: now });
  audit(ctx, 'coupon.create', { type: 'coupon', id }, reason ?? null, { code, kind: input.kind, value: input.value });
  return present(ctx.db.get<CouponRow>('SELECT * FROM coupons WHERE id = ?', [id])!);
}

export function updateCoupon(ctx: Ctx, id: string, patch: { active?: boolean; maxUses?: number | null; validTo?: string | null; note?: string }, reason: string) {
  const c = ctx.db.get<CouponRow>('SELECT * FROM coupons WHERE id = ?', [id]);
  if (!c) throw errors.notFound('Coupon');
  ctx.db.update('coupons', id, { active: patch.active === undefined ? undefined : patch.active ? 1 : 0, max_uses: patch.maxUses === undefined ? undefined : patch.maxUses, valid_to: patch.validTo === undefined ? undefined : patch.validTo, note: patch.note, updated_at: ctx.now() });
  audit(ctx, 'coupon.update', { type: 'coupon', id }, reason, patch);
  return present(ctx.db.get<CouponRow>('SELECT * FROM coupons WHERE id = ?', [id])!);
}

/** The discount a code gives on a total, or a clear reason why not. */
export function applyCoupon(ctx: Ctx, code: string, totalPaise: number): { coupon: CouponRow; discountPaise: number } {
  const c = ctx.db.get<CouponRow>('SELECT * FROM coupons WHERE code = ?', [code.trim().toUpperCase()]);
  const now = ctx.now();
  if (!c || !c.active) throw errors.badRequest('That code is not valid', 'COUPON_INVALID');
  if (c.valid_from && c.valid_from > now) throw errors.badRequest('That code is not active yet', 'COUPON_NOT_YET');
  if (c.valid_to && c.valid_to < now) throw errors.badRequest('That code has expired', 'COUPON_EXPIRED');
  if (c.max_uses !== null) {
    // orders waiting for payment hold a use too, so N checkouts cannot all redeem a one-use code before any capture
    const inFlight = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE coupon_id = ? AND status = 'pending_payment'", [c.id])?.n ?? 0;
    if (c.used + inFlight >= c.max_uses) throw errors.badRequest('That code has been used up', 'COUPON_EXHAUSTED');
  }
  const raw = c.kind === 'percent' ? Math.round((totalPaise * c.value) / 100) : c.value;
  const discount = Math.min(raw, totalPaise - 100); // never below ₹1, whatever the kind
  return { coupon: c, discountPaise: Math.max(0, discount) };
}

/** Counted once the payment is verified (called from the webhook path). */
export function recordUse(ctx: Ctx, couponId: string): void {
  ctx.db.run('UPDATE coupons SET used = used + 1, updated_at = ? WHERE id = ?', [ctx.now(), couponId]);
}
