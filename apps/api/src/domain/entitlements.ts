/* The entitlement ledger. Quantities only move through transactions with idempotency keys, inside the caller's
   transaction, so a booking can never spend the same entitlement twice. */
import type { Ctx } from '../context.js';
import type { ServiceType } from '@bioptime/domain';
import { ids } from '../lib/ids.js';
import { audit } from './audit.js';
import { errors } from '../lib/errors.js';

export type EntitlementRow = { id: string; member_id: string; order_id: string | null; programme_id: string | null; service_type: ServiceType; unit: string; quantity: number; used_qty: number; reserved_qty: number; status: string; expires_at: string | null };

export function grant(ctx: Ctx, input: { memberId: string; orderId: string | null; programmeId: string | null; packageVersionId: string | null; serviceType: ServiceType; unit: string; quantity: number; expiresAt: string | null; idempotencyKey: string }): string | null {
  if (input.quantity <= 0) return null;
  const dup = ctx.db.get<{ entitlement_id: string }>('SELECT entitlement_id FROM entitlement_transactions WHERE idempotency_key = ?', [input.idempotencyKey]);
  if (dup) return dup.entitlement_id;
  const id = ids.entitlement();
  const now = ctx.now();
  ctx.db.insert('entitlements', { id, member_id: input.memberId, order_id: input.orderId, programme_id: input.programmeId, package_version_id: input.packageVersionId, service_type: input.serviceType, unit: input.unit, quantity: input.quantity, used_qty: 0, reserved_qty: 0, status: 'available', expires_at: input.expiresAt, created_at: now, updated_at: now });
  ctx.db.insert('entitlement_transactions', { id: ids.entitlementTx(), entitlement_id: id, kind: 'grant', quantity: input.quantity, ref_type: 'order', ref_id: input.orderId, idempotency_key: input.idempotencyKey, created_by: ctx.actor?.id ?? 'system', created_at: now });
  return id;
}

export function available(ctx: Ctx, memberId: string, serviceType: ServiceType): EntitlementRow[] {
  return ctx.db.all<EntitlementRow>("SELECT * FROM entitlements WHERE member_id = ? AND service_type = ? AND status = 'available' AND (expires_at IS NULL OR expires_at > ?) AND quantity - used_qty - reserved_qty > 0 ORDER BY expires_at IS NULL, expires_at, created_at", [memberId, serviceType, ctx.now()]);
}

export function balance(ctx: Ctx, memberId: string, serviceType: ServiceType) {
  const rows = ctx.db.all<EntitlementRow>("SELECT * FROM entitlements WHERE member_id = ? AND service_type = ? AND status IN ('available','exhausted') AND (expires_at IS NULL OR expires_at > ?)", [memberId, serviceType, ctx.now()]);
  const total = rows.reduce((s, r) => s + r.quantity, 0), used = rows.reduce((s, r) => s + r.used_qty, 0), reserved = rows.reduce((s, r) => s + r.reserved_qty, 0);
  // expiresAt is when the first units still left expire (a used-up grant's date no longer says anything about what is
  // left; release round, 5 Nov 2026)
  const byExpiry = unitsByExpiry(rows);
  return { total, used, reserved, remaining: total - used - reserved, unit: rows[0]?.unit ?? ctx.config.ENTITLEMENT_UNIT, expiresAt: byExpiry.find((b) => b.expiresAt)?.expiresAt ?? (byExpiry.length ? null : rows.map((r) => r.expires_at).filter(Boolean).sort()[0] ?? null) };
}

/** How many units remain until each expiry date, earliest first, open-ended last: two packages held side by side each
 *  keep their own end (GET /me entitlements.*.byExpiry; release round, 5 Nov 2026). */
function unitsByExpiry(rows: EntitlementRow[]): Array<{ remaining: number; expiresAt: string | null }> {
  const until = new Map<string | null, number>();
  for (const r of rows) { const left = r.quantity - r.used_qty - r.reserved_qty; if (left > 0) until.set(r.expires_at, (until.get(r.expires_at) ?? 0) + left); }
  return [...until].map(([expiresAt, remaining]) => ({ remaining, expiresAt })).sort((a, b) => (a.expiresAt ?? '\uffff').localeCompare(b.expiresAt ?? '\uffff'));
}

/** The balance with its remaining units by expiry date (the member's overview). */
export function balanceByExpiry(ctx: Ctx, memberId: string, serviceType: ServiceType) {
  const rows = ctx.db.all<EntitlementRow>("SELECT * FROM entitlements WHERE member_id = ? AND service_type = ? AND status IN ('available','exhausted') AND (expires_at IS NULL OR expires_at > ?)", [memberId, serviceType, ctx.now()]);
  return { ...balance(ctx, memberId, serviceType), byExpiry: unitsByExpiry(rows) };
}

/** Reserve one unit for a booking or appointment. Returns the transaction id; the same key returns the same transaction. */
export function reserve(ctx: Ctx, memberId: string, serviceType: ServiceType, ref: { type: string; id: string }, idempotencyKey: string): { txId: string; entitlementId: string } {
  const dup = ctx.db.get<{ id: string; entitlement_id: string }>('SELECT id, entitlement_id FROM entitlement_transactions WHERE idempotency_key = ?', [idempotencyKey]);
  if (dup) return { txId: dup.id, entitlementId: dup.entitlement_id };
  const candidates = available(ctx, memberId, serviceType);
  const e = candidates[0];
  if (!e) throw errors.state(`No ${serviceType === 'bloodwork' ? 'blood test' : 'consultation'} entitlement is left on your package`, { code: 'NO_ENTITLEMENT' });
  const txId = ids.entitlementTx();
  const now = ctx.now();
  const changed = ctx.db.run('UPDATE entitlements SET reserved_qty = reserved_qty + 1, updated_at = ? WHERE id = ? AND quantity - used_qty - reserved_qty > 0', [now, e.id]).changes;
  if (!changed) throw errors.state('That entitlement was just used', { code: 'NO_ENTITLEMENT' });
  ctx.db.insert('entitlement_transactions', { id: txId, entitlement_id: e.id, kind: 'reserve', quantity: 1, ref_type: ref.type, ref_id: ref.id, idempotency_key: idempotencyKey, created_by: ctx.actor?.id ?? 'system', created_at: now });
  return { txId, entitlementId: e.id };
}

/** Turn a reservation into a consumption (the collection happened, the consultation was completed). */
export function consume(ctx: Ctx, reserveTxId: string, note?: string): void {
  const r = ctx.db.get<{ id: string; entitlement_id: string; kind: string; ref_type: string; ref_id: string }>('SELECT * FROM entitlement_transactions WHERE id = ?', [reserveTxId]);
  if (!r || r.kind !== 'reserve') throw errors.state('No reservation to consume');
  if (ctx.db.get('SELECT 1 FROM entitlement_transactions WHERE idempotency_key = ?', [`consume:${reserveTxId}`])) return;
  // a reservation that was given back cannot be spent later, and a cancelled or expired entitlement cannot be spent at all
  if (ctx.db.get('SELECT 1 FROM entitlement_transactions WHERE idempotency_key = ?', [`release:${reserveTxId}`])) throw errors.state('That reservation was already released', { code: 'RESERVATION_RELEASED' });
  const ent = ctx.db.get<{ status: string }>('SELECT status FROM entitlements WHERE id = ?', [r.entitlement_id]);
  if (!ent || ent.status === 'cancelled' || ent.status === 'expired') throw errors.state(`This entitlement is ${ent?.status ?? 'missing'} and cannot be used`, { code: 'ENTITLEMENT_UNAVAILABLE' });
  const now = ctx.now();
  const changed = ctx.db.run('UPDATE entitlements SET reserved_qty = reserved_qty - 1, used_qty = used_qty + 1, updated_at = ? WHERE id = ? AND reserved_qty > 0', [now, r.entitlement_id]).changes;
  if (changed !== 1) throw errors.state('No held unit to consume on this entitlement', { code: 'NOTHING_RESERVED' });
  ctx.db.insert('entitlement_transactions', { id: ids.entitlementTx(), entitlement_id: r.entitlement_id, kind: 'consume', quantity: 1, ref_type: r.ref_type, ref_id: r.ref_id, idempotency_key: `consume:${reserveTxId}`, note: note ?? null, created_by: ctx.actor?.id ?? 'system', created_at: now });
  refreshStatus(ctx, r.entitlement_id);
}

/** Give a reservation back (a cancelled booking, a cancelled appointment). */
export function release(ctx: Ctx, reserveTxId: string, note?: string): void {
  const r = ctx.db.get<{ id: string; entitlement_id: string; kind: string; ref_type: string; ref_id: string }>('SELECT * FROM entitlement_transactions WHERE id = ?', [reserveTxId]);
  if (!r || r.kind !== 'reserve') return;
  if (ctx.db.get('SELECT 1 FROM entitlement_transactions WHERE idempotency_key IN (?, ?)', [`release:${reserveTxId}`, `consume:${reserveTxId}`])) return;
  const now = ctx.now();
  ctx.db.run('UPDATE entitlements SET reserved_qty = reserved_qty - 1, updated_at = ? WHERE id = ? AND reserved_qty > 0', [now, r.entitlement_id]);
  ctx.db.insert('entitlement_transactions', { id: ids.entitlementTx(), entitlement_id: r.entitlement_id, kind: 'release', quantity: 1, ref_type: r.ref_type, ref_id: r.ref_id, idempotency_key: `release:${reserveTxId}`, note: note ?? null, created_by: ctx.actor?.id ?? 'system', created_at: now });
  refreshStatus(ctx, r.entitlement_id);
}

function refreshStatus(ctx: Ctx, entitlementId: string): void {
  const e = ctx.db.get<EntitlementRow>('SELECT * FROM entitlements WHERE id = ?', [entitlementId]);
  if (!e || e.status === 'expired' || e.status === 'cancelled') return;
  const status = e.quantity - e.used_qty - e.reserved_qty > 0 ? 'available' : 'exhausted';
  if (status !== e.status) ctx.db.update('entitlements', entitlementId, { status, updated_at: ctx.now() });
}

export function expireDue(ctx: Ctx): number {
  const now = ctx.now();
  const rows = ctx.db.all<EntitlementRow>("SELECT * FROM entitlements WHERE status IN ('available','exhausted') AND expires_at IS NOT NULL AND expires_at <= ?", [now]);
  for (const e of rows) {
    const remaining = e.quantity - e.used_qty - e.reserved_qty;
    ctx.db.update('entitlements', e.id, { status: 'expired', updated_at: now });
    ctx.db.insert('entitlement_transactions', { id: ids.entitlementTx(), entitlement_id: e.id, kind: 'expire', quantity: remaining, ref_type: 'job', ref_id: 'expire', idempotency_key: `expire:${e.id}`, created_by: 'system', created_at: now });
  }
  return rows.length;
}

export function cancelForOrder(ctx: Ctx, orderId: string, reason: string): void {
  const now = ctx.now();
  for (const e of ctx.db.all<EntitlementRow>('SELECT * FROM entitlements WHERE order_id = ? AND status IN (\'available\',\'exhausted\')', [orderId])) {
    ctx.db.update('entitlements', e.id, { status: 'cancelled', updated_at: now });
    ctx.db.insert('entitlement_transactions', { id: ids.entitlementTx(), entitlement_id: e.id, kind: 'cancel', quantity: e.quantity - e.used_qty, ref_type: 'order', ref_id: orderId, idempotency_key: `cancel:${e.id}`, note: reason, created_by: ctx.actor?.id ?? 'system', created_at: now });
  }
}

/** A manual adjustment by an administrator: +n grants a fresh entitlement (no expiry unless given), -n reduces the
    oldest available ones but never below what is already used or held. Every adjustment is a ledger row with the actor,
    the reason and an idempotency key, and an audit event. */
export function adjust(ctx: Ctx, input: { memberId: string; serviceType: ServiceType; delta: number; reason: string; idempotencyKey: string; expiresAt?: string | null }) {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw errors.badRequest('The adjustment must be a whole number other than zero', 'ADJUST_DELTA');
  if (input.reason.trim().length < 3) throw errors.badRequest('A reason is required', 'REASON_REQUIRED');
  const who = ctx.db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', [input.memberId]);
  if (!who || who.role !== 'member') throw errors.notFound('Member');
  // one key space per member and service: a key replayed on another member is a new adjustment, never a silent no-op, and a caller cannot pre-claim the ledger's own keys
  const key = `adjust:${input.memberId}:${input.serviceType}:${input.idempotencyKey}`;
  const dup = ctx.db.get<{ entitlement_id: string }>('SELECT entitlement_id FROM entitlement_transactions WHERE idempotency_key = ?', [key]);
  if (dup) return balance(ctx, input.memberId, input.serviceType);
  const now = ctx.now();
  ctx.db.tx(() => {
    if (input.delta > 0) {
      const id = ids.entitlement();
      ctx.db.insert('entitlements', { id, member_id: input.memberId, order_id: null, programme_id: null, package_version_id: null, service_type: input.serviceType, unit: ctx.config.ENTITLEMENT_UNIT, quantity: input.delta, used_qty: 0, reserved_qty: 0, status: 'available', expires_at: input.expiresAt ?? null, created_at: now, updated_at: now });
      ctx.db.insert('entitlement_transactions', { id: ids.entitlementTx(), entitlement_id: id, kind: 'adjust', quantity: input.delta, ref_type: 'adjustment', ref_id: null, idempotency_key: key, note: input.reason, created_by: ctx.actor?.id ?? 'system', created_at: now });
    } else {
      let left = -input.delta;
      const rows = ctx.db.all<EntitlementRow>("SELECT * FROM entitlements WHERE member_id = ? AND service_type = ? AND status = 'available' ORDER BY created_at", [input.memberId, input.serviceType]);
      const free = rows.reduce((s, e) => s + (e.quantity - e.used_qty - e.reserved_qty), 0);
      if (free < left) throw errors.state(`Only ${free} unused unit${free === 1 ? '' : 's'} can be removed; used and held units stay`, { code: 'ADJUST_TOO_FAR', free });
      let first = true;
      for (const e of rows) {
        if (left <= 0) break;
        const take = Math.min(left, e.quantity - e.used_qty - e.reserved_qty);
        if (take <= 0) continue;
        const quantity = e.quantity - take;
        ctx.db.update('entitlements', e.id, { quantity, status: quantity - e.used_qty - e.reserved_qty <= 0 ? 'exhausted' : 'available', updated_at: now });
        ctx.db.insert('entitlement_transactions', { id: ids.entitlementTx(), entitlement_id: e.id, kind: 'adjust', quantity: -take, ref_type: 'adjustment', ref_id: null, idempotency_key: first ? key : null, note: input.reason, created_by: ctx.actor?.id ?? 'system', created_at: now });
        first = false; left -= take;
      }
    }
    audit(ctx, 'entitlement.adjust', { type: 'user', id: input.memberId }, input.reason, { serviceType: input.serviceType, delta: input.delta });
  });
  return balance(ctx, input.memberId, input.serviceType);
}

export function listForMember(ctx: Ctx, memberId: string) {
  return ctx.db.all<EntitlementRow & { package_name: string | null }>('SELECT e.*, p.name AS package_name FROM entitlements e LEFT JOIN package_versions v ON v.id = e.package_version_id LEFT JOIN packages p ON p.id = v.package_id WHERE e.member_id = ? ORDER BY e.created_at DESC', [memberId])
    .map((e) => ({ id: e.id, serviceType: e.service_type, unit: e.unit, quantity: e.quantity, used: e.used_qty, reserved: e.reserved_qty, remaining: e.quantity - e.used_qty - e.reserved_qty, status: e.status, expiresAt: e.expires_at, orderId: e.order_id, programmeId: e.programme_id, packageName: e.package_name }));
}

export function transactionsFor(ctx: Ctx, entitlementId: string) {
  return ctx.db.all('SELECT * FROM entitlement_transactions WHERE entitlement_id = ? ORDER BY created_at', [entitlementId]);
}
