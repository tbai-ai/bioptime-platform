/* Orders and payments: checkout → signed webhook → verified payment → transactional activation (programme, entitlements,
   assignment request). A client-side success is never proof; the webhook is, and it is idempotent on its event id. */
import { ORDER_TRANSITIONS, type OrderState } from '@bioptime/domain';
import type { Ctx } from '../context.js';
import type { PaymentProvider } from '../adapters/payments.js';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { addMonths, addDays, istDayLabel } from '../lib/time.js';
import { j } from '../db/db.js';
import { nextReference } from '../db/seq.js';
import { audit, emit } from './audit.js';
import { notify, notifyPrivileged } from './notifications.js';
import { openTask } from './support.js';
import { getPackage, type PackageVersionRow } from './packages.js';
import * as entitlements from './entitlements.js';
import * as coupons from './coupons.js';
import { getSetting } from './settings.js';

export type OrderRow = { coupon_id?: string | null; discount_paise?: number; id: string; reference: string; member_id: string; package_version_id: string | null; custom_plan_id: string | null; status: OrderState; amount_paise: number; gst_paise: number; total_paise: number; currency: string; idempotency_key: string | null; failure_reason: string | null; metadata: string; paid_at: string | null; activated_at: string | null; cancelled_at: string | null; created_at: string; updated_at: string };

/** The GST rate in basis points, from the setting gst_rate_bp (default 1800, the 18% this file applied as a constant
 *  before M3). GST is the portion included in the catalogue price; the rate itself stays an owner decision. */
export const DEFAULT_GST_RATE_BP = 1800;
export function gstRateBp(ctx: Ctx): number {
  const v = getSetting<unknown>(ctx, 'gst_rate_bp');
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10000 ? v : DEFAULT_GST_RATE_BP;
}
/** The GST included in a GST-inclusive total at a rate in basis points (the computation orders have always used). */
export function gstIncluded(totalPaise: number, rateBp: number): number {
  return Math.round(totalPaise - totalPaise / (1 + rateBp / 10000));
}

export function getOrder(ctx: Ctx, id: string): OrderRow {
  const o = ctx.db.get<OrderRow>('SELECT * FROM orders WHERE id = ? OR reference = ?', [id, id]);
  if (!o) throw errors.notFound('Order');
  return o;
}

export function presentOrder(ctx: Ctx, o: OrderRow) {
  const v = o.package_version_id ? ctx.db.get<PackageVersionRow & { package_name: string; package_slug: string }>('SELECT v.*, p.name AS package_name, p.slug AS package_slug FROM package_versions v JOIN packages p ON p.id = v.package_id WHERE v.id = ?', [o.package_version_id]) : undefined;
  const payment = ctx.db.get<{ id: string; provider: string; status: string; checkout_id: string | null; provider_ref: string | null; signature_verified: number; updated_at: string }>('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', [o.id]);
  const refund = ctx.db.get<{ id: string; status: string; amount_paise: number; reason: string; created_at: string }>('SELECT * FROM refunds WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', [o.id]);
  const member = ctx.db.get<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = ?', [o.member_id]);
  return {
    id: o.id, reference: o.reference, memberId: o.member_id, memberName: member?.name ?? null, memberEmail: member?.email ?? null,
    packageName: v?.package_name ?? (o.custom_plan_id ? 'Bespoke plan' : null), packageSlug: v?.package_slug ?? null, packageVersionId: o.package_version_id, customPlanId: o.custom_plan_id,
    status: o.status, amountInr: o.amount_paise / 100, gstInr: o.gst_paise / 100, totalInr: o.total_paise / 100, discountInr: (o.discount_paise ?? 0) / 100, couponCode: o.coupon_id ? (ctx.db.get<{ code: string }>('SELECT code FROM coupons WHERE id = ?', [o.coupon_id])?.code ?? null) : null, currency: o.currency,
    payment: payment ? { id: payment.id, provider: payment.provider, status: payment.status, checkoutId: payment.checkout_id, providerRef: payment.provider_ref, signatureVerified: !!payment.signature_verified, updatedAt: payment.updated_at, simulated: payment.provider === 'simulator' } : null,
    refund: refund ? { id: refund.id, status: refund.status, amountInr: refund.amount_paise / 100, reason: refund.reason, createdAt: refund.created_at } : null,
    failureReason: o.failure_reason, metadata: j.out(o.metadata, {}), paidAt: o.paid_at, activatedAt: o.activated_at, cancelledAt: o.cancelled_at, createdAt: o.created_at, updatedAt: o.updated_at,
  };
}

function moveOrder(ctx: Ctx, o: OrderRow, to: OrderState, extra: Record<string, string | null> = {}): void {
  if (!ORDER_TRANSITIONS[o.status].includes(to)) throw errors.state(`An order that is ${o.status} cannot become ${to}`, { from: o.status, to });
  ctx.db.update('orders', o.id, { status: to, updated_at: ctx.now(), ...extra });
}

/* ---------- checkout ---------- */
export function createCheckout(ctx: Ctx, provider: PaymentProvider, input: { memberId: string; packageId: string; idempotencyKey?: string; couponCode?: string }) {
  const member = ctx.db.get<{ id: string; state: string; email_verified_at: string | null }>('SELECT id, state, email_verified_at FROM users WHERE id = ? AND role = \'member\'', [input.memberId]);
  if (!member) throw errors.notFound('Member');
  if (['suspended', 'deactivated', 'closed', 'deletion_requested'].includes(member.state)) throw errors.forbidden('This account cannot make purchases', 'ACCOUNT_STATE');
  if (input.idempotencyKey) {
    const existing = ctx.db.get<OrderRow>('SELECT * FROM orders WHERE idempotency_key = ? AND member_id = ?', [`${input.memberId}:${input.idempotencyKey}`, input.memberId]);
    if (existing) return presentCheckout(ctx, existing);
  }
  const { row: pkg, version } = getPackage(ctx, input.packageId);
  if (!version || !pkg.active || pkg.archived_at) throw errors.state('This package is not available', { code: 'NOT_FOR_SALE' });
  if (!version.for_sale || version.price_paise === null || version.price_paise < 100) throw errors.state('This package has no price yet. Pricing is on request: send an enquiry and we will confirm.', { code: 'PRICE_NOT_SET' });
  if (pkg.kind === 'bespoke') throw errors.state('Bespoke plans are priced per proposal. Request one from the Bespoke page.', { code: 'BESPOKE_ONLY' });
  const now = ctx.now();
  const listPrice = version.price_paise;
  const promo = input.couponCode ? coupons.applyCoupon(ctx, input.couponCode, listPrice) : null; // validated on the server, never trusted from the client
  const total = listPrice - (promo?.discountPaise ?? 0);
  const rateBp = gstRateBp(ctx);
  const gst = gstIncluded(total, rateBp);
  return ctx.db.tx(() => {
    const id = ids.order();
    const reference = nextReference(ctx.db, 'PAY');
    ctx.db.insert('orders', { id, reference, member_id: input.memberId, package_version_id: version.id, status: 'pending_payment', amount_paise: total - gst, gst_paise: gst, total_paise: total, currency: 'INR', coupon_id: promo?.coupon.id ?? null, discount_paise: promo?.discountPaise ?? 0, idempotency_key: input.idempotencyKey ? `${input.memberId}:${input.idempotencyKey}` : null, metadata: j.in({ packageName: pkg.name, packageSlug: pkg.slug, gstRateBp: rateBp }), created_at: now, updated_at: now });
    const checkout = provider.createCheckout({ id, reference, totalPaise: total, currency: 'INR' }, ctx.config.PUBLIC_ORIGIN);
    ctx.db.insert('payments', { id: ids.payment(), order_id: id, provider: provider.name, provider_ref: checkout.providerRef, checkout_id: checkout.checkoutId, status: 'created', amount_paise: total, currency: 'INR', signature_verified: 0, raw: j.in({ checkout }), created_at: now, updated_at: now });
    audit(ctx, 'order.create', { type: 'order', id }, null, { reference, packageSlug: pkg.slug, totalPaise: total, listPaise: listPrice, coupon: promo?.coupon.code ?? null });
    emit(ctx, 'OrderCreated', { type: 'order', id }, { reference, memberId: input.memberId });
    return presentCheckout(ctx, getOrder(ctx, id));
  });
}

function presentCheckout(ctx: Ctx, o: OrderRow) {
  const presented = presentOrder(ctx, o);
  const payment = ctx.db.get<{ checkout_id: string; raw: string; provider: string }>('SELECT checkout_id, raw, provider FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', [o.id]);
  const raw = j.out<{ checkout?: { url?: string; expiresAt?: string } }>(payment?.raw, {});
  return { order: presented, checkout: payment ? { checkoutId: payment.checkout_id, url: raw.checkout?.url ?? null, expiresAt: raw.checkout?.expiresAt ?? null, provider: payment.provider, simulated: payment.provider === 'simulator' } : null };
}

/* ---------- the webhook: the only path to "paid" ---------- */
export function handlePaymentWebhook(ctx: Ctx, provider: PaymentProvider, rawBody: string, signature: string | undefined): { outcome: string; orderId?: string } {
  const event = provider.verifyWebhook(rawBody, signature);
  if (!event) { audit(ctx, 'payment.webhook_rejected', null, 'signature did not verify'); throw errors.unauthorised('Webhook signature did not verify', 'BAD_SIGNATURE'); }
  return ctx.db.tx(() => {
    const dup = ctx.db.get('SELECT 1 FROM vendor_events WHERE dedupe_key = ?', [`payments:${event.eventId}`]);
    if (dup) return { outcome: 'duplicate_ignored' };
    ctx.db.insert('vendor_events', { id: ids.vendorEvent(), vendor: 'payments', kind: event.status, vendor_order_id: event.providerRef, reference: event.orderReference, status: event.status, dedupe_key: `payments:${event.eventId}`, payload: rawBody, received_at: ctx.now(), processed_at: ctx.now(), outcome: 'pending' });
    const payment = ctx.db.get<{ id: string; order_id: string; status: string; amount_paise: number }>('SELECT * FROM payments WHERE checkout_id = ?', [event.checkoutId]);
    if (!payment) { openTask(ctx, { kind: 'payment_mismatch', title: `Payment event for unknown checkout ${event.checkoutId}`, detail: `Order reference ${event.orderReference}; status ${event.status}`, refType: 'checkout', refId: event.checkoutId }); return { outcome: 'unknown_checkout' }; }
    const order = getOrder(ctx, payment.order_id);
    if (order.reference !== event.orderReference) { openTask(ctx, { kind: 'payment_mismatch', title: `Payment event names ${event.orderReference} but the checkout belongs to ${order.reference}`, refType: 'order', refId: order.id }); return { outcome: 'reference_mismatch', orderId: order.id }; }
    const now = ctx.now();
    if (event.status === 'captured') {
      if (event.amountPaise !== order.total_paise) {
        ctx.db.update('payments', payment.id, { status: 'captured', signature_verified: 1, event_id: event.eventId, provider_ref: event.providerRef, raw: rawBody, updated_at: now });
        openTask(ctx, { kind: 'payment_mismatch', title: `Captured ₹${event.amountPaise / 100} for ${order.reference}, expected ₹${order.total_paise / 100}`, detail: 'The order stays pending until an administrator reconciles it.', refType: 'order', refId: order.id });
        return { outcome: 'amount_mismatch', orderId: order.id };
      }
      if (order.status === 'paid' || order.status === 'activated') return { outcome: 'already_paid', orderId: order.id };
      if (order.status !== 'pending_payment') {
        // a genuine capture for an order we had already failed, cancelled or refunded: keep the record and raise it, never throw
        // (throwing would roll back the dedupe row and make the provider retry forever)
        ctx.db.update('payments', payment.id, { status: 'captured', signature_verified: 1, event_id: event.eventId, provider_ref: event.providerRef, raw: rawBody, updated_at: now });
        openTask(ctx, { kind: 'payment_mismatch', title: `Captured ₹${event.amountPaise / 100} for ${order.reference}, which is ${order.status}`, detail: 'Refund the capture or reconcile the order by hand; nothing was activated.', refType: 'order', refId: order.id });
        audit(ctx, 'payment.captured_unexpected', { type: 'order', id: order.id }, null, { eventId: event.eventId, orderStatus: order.status, amountPaise: event.amountPaise });
        return { outcome: 'captured_unexpected', orderId: order.id };
      }
      ctx.db.update('payments', payment.id, { status: 'captured', signature_verified: 1, event_id: event.eventId, provider_ref: event.providerRef, raw: rawBody, updated_at: now });
      moveOrder(ctx, order, 'paid', { paid_at: now });
      if (order.coupon_id) coupons.recordUse(ctx, order.coupon_id);
      emit(ctx, 'OrderPaid', { type: 'order', id: order.id }, { reference: order.reference, memberId: order.member_id, simulated: event.simulated });
      audit(ctx, 'payment.captured', { type: 'order', id: order.id }, event.simulated ? 'simulated payment' : null, { eventId: event.eventId, amountPaise: event.amountPaise });
      activateOrder(ctx, order.id);
      return { outcome: 'captured', orderId: order.id };
    }
    if (event.status === 'failed') {
      ctx.db.update('payments', payment.id, { status: 'failed', signature_verified: 1, event_id: event.eventId, raw: rawBody, updated_at: now });
      if (order.status === 'pending_payment') moveOrder(ctx, order, 'failed', { failure_reason: 'Payment failed at the provider' });
      notify(ctx, { userId: order.member_id, category: 'payment', title: 'Payment didn’t go through', body: `Nothing was charged for ${order.reference}. You can try again from your account.`, data: { orderId: order.id } });
      audit(ctx, 'payment.failed', { type: 'order', id: order.id }, null, { eventId: event.eventId });
      return { outcome: 'failed', orderId: order.id };
    }
    if (event.status === 'refunded') {
      const refund = ctx.db.get<{ id: string }>("SELECT id FROM refunds WHERE order_id = ? AND status IN ('requested','processing') ORDER BY created_at DESC LIMIT 1", [order.id]);
      if (!refund && order.status !== 'refund_pending' && order.status !== 'refunded') {
        if (event.amountPaise === payment.amount_paise && (order.status === 'paid' || order.status === 'activated')) {
          // the provider refunded in full without a request from us (a chargeback, a refund from its dashboard): the services end too
          const refundId = ids.refund();
          ctx.db.insert('refunds', { id: refundId, payment_id: payment.id, order_id: order.id, amount_paise: event.amountPaise, status: 'completed', reason: 'refunded by the payment provider', requested_by: 'provider', provider_ref: event.providerRef, created_at: now, completed_at: now });
          moveOrder(ctx, order, 'refund_pending');
          tearDownServices(ctx, order, 'refunded by the payment provider');
          ctx.db.update('payments', payment.id, { status: 'refunded', updated_at: now });
          moveOrder(ctx, getOrder(ctx, order.id), 'refunded');
          emit(ctx, 'OrderRefunded', { type: 'order', id: order.id }, { reference: order.reference, memberId: order.member_id, refundId, amountPaise: event.amountPaise });
          openTask(ctx, { kind: 'payment_mismatch', title: `Provider refunded ${order.reference} without a request from Bioptime`, detail: 'Entitlements, programme and assignment were ended and any open bookings are being cancelled; find out why the provider refunded.', refType: 'order', refId: order.id });
          notify(ctx, { userId: order.member_id, category: 'payment', title: 'Refund completed', body: `₹${event.amountPaise / 100} for ${order.reference} has been refunded and the package has ended.`, data: { orderId: order.id } });
          audit(ctx, 'payment.refunded_by_provider', { type: 'order', id: order.id }, null, { eventId: event.eventId, amountPaise: event.amountPaise });
          return { outcome: 'refunded_by_provider', orderId: order.id };
        }
        openTask(ctx, { kind: 'payment_mismatch', title: `Refund event of ₹${event.amountPaise / 100} for ${order.reference} (${order.status}) matches no request`, detail: 'Nothing was changed; reconcile with the provider by hand.', refType: 'order', refId: order.id });
        audit(ctx, 'payment.refund_mismatch', { type: 'order', id: order.id }, null, { eventId: event.eventId, amountPaise: event.amountPaise, orderStatus: order.status });
        return { outcome: 'refund_mismatch', orderId: order.id };
      }
      if (refund) ctx.db.update('refunds', refund.id, { status: 'completed', completed_at: now, provider_ref: event.providerRef });
      ctx.db.update('payments', payment.id, { status: 'refunded', updated_at: now });
      if (order.status === 'refund_pending') {
        moveOrder(ctx, order, 'refunded');
        const done = refund ?? ctx.db.get<{ id: string }>('SELECT id FROM refunds WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', [order.id]);
        emit(ctx, 'OrderRefunded', { type: 'order', id: order.id }, { reference: order.reference, memberId: order.member_id, refundId: done?.id ?? null, amountPaise: event.amountPaise });
      }
      notify(ctx, { userId: order.member_id, category: 'payment', title: 'Refund completed', body: `₹${event.amountPaise / 100} for ${order.reference} has been refunded.`, data: { orderId: order.id } });
      return { outcome: 'refunded', orderId: order.id };
    }
    return { outcome: 'ignored' };
  });
}

/* ---------- activation: programme + entitlements + assignment request, once ---------- */
export function activateOrder(ctx: Ctx, orderId: string): { programmeId: string } {
  return ctx.db.tx(() => {
    const order = getOrder(ctx, orderId);
    const existing = ctx.db.get<{ id: string }>('SELECT id FROM programmes WHERE order_id = ?', [order.id]);
    if (order.status === 'activated' && existing) return { programmeId: existing.id };
    if (order.status !== 'paid') throw errors.state(`Only a paid order can be activated (this one is ${order.status})`);
    const now = ctx.now();
    let months: number | null = null, consultations = 0, bloodwork = 0, coaching: string = 'standard', unit = String(getSetting(ctx, 'entitlement_unit'));
    let customPlan: { id: string; proposal: string; status: string } | undefined;
    if (order.package_version_id) {
      const v = ctx.db.get<PackageVersionRow>('SELECT * FROM package_versions WHERE id = ?', [order.package_version_id])!;
      months = v.duration_months; consultations = v.consultations; bloodwork = v.bloodwork_entitlements; coaching = v.coaching; unit = v.entitlement_unit;
    } else if (order.custom_plan_id) {
      customPlan = ctx.db.get<{ id: string; proposal: string; status: string }>('SELECT id, proposal, status FROM custom_plan_requests WHERE id = ?', [order.custom_plan_id]);
      if (!customPlan || customPlan.status !== 'payment_pending') throw errors.state('This bespoke request is no longer waiting for payment', { code: 'REQUEST_NOT_PENDING' });
      // the terms the member accepted, written on the order at acceptance; the live proposal only for orders made before that snapshot
      const snap = j.out<{ terms?: { durationMonths?: number | null; consultations?: number; bloodworkEntitlements?: number } }>(order.metadata as unknown as string, {}).terms;
      const p = snap ?? j.out<{ durationMonths?: number; consultations?: number; bloodworkEntitlements?: number }>(customPlan.proposal, {});
      months = p.durationMonths ?? null; consultations = p.consultations ?? 0; bloodwork = p.bloodworkEntitlements ?? 0; coaching = 'as_agreed';
    }
    const programmeId = ids.programme();
    const endAt = months ? addMonths(now, months) : null;
    ctx.db.insert('programmes', { id: programmeId, member_id: order.member_id, order_id: order.id, package_version_id: order.package_version_id, custom_plan_id: order.custom_plan_id, status: 'active', start_at: now, end_at: endAt, created_at: now });
    entitlements.grant(ctx, { memberId: order.member_id, orderId: order.id, programmeId, packageVersionId: order.package_version_id, serviceType: 'bloodwork', unit, quantity: bloodwork, expiresAt: endAt, idempotencyKey: `grant:bloodwork:${order.id}` });
    entitlements.grant(ctx, { memberId: order.member_id, orderId: order.id, programmeId, packageVersionId: order.package_version_id, serviceType: 'consultation', unit: 'session', quantity: consultations, expiresAt: endAt, idempotencyKey: `grant:consultation:${order.id}` });
    moveOrder(ctx, order, 'activated', { activated_at: now });
    ctx.db.update('users', order.member_id, { updated_at: now });
    const member = ctx.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [order.member_id]);
    const meta = j.out<{ packageName?: string }>(order.metadata, {});
    // a member who already has a coach (a second package bought while one runs: they run side by side) is not told a
    // coach is being found for them (release round, 5 Nov 2026)
    const coach = ctx.db.get<{ name: string }>("SELECT COALESCE(c.display_name, u.name) AS name FROM coach_assignments a JOIN users u ON u.id = a.coach_id LEFT JOIN coach_profiles c ON c.user_id = a.coach_id WHERE a.member_id = ? AND a.status = 'active' ORDER BY a.effective_at DESC LIMIT 1", [order.member_id]);
    const coachLine = coaching === 'none' ? 'Your programme is ready in the app.' : coach ? `${coach.name} stays your coach while we confirm the coach for this package.` : 'We are matching you with a coach; you will be told when they are assigned.';
    emit(ctx, 'PackageActivated', { type: 'programme', id: programmeId }, { orderId: order.id, memberId: order.member_id, coaching, endAt });
    notify(ctx, { userId: order.member_id, category: 'payment', title: 'Payment received', body: `${meta.packageName ?? 'Your plan'} is active from today${endAt ? ' until ' + istDayLabel(endAt) : ''}. ${coachLine}${member?.state === 'onboarding' || member?.state === 'pending_verification' ? ' Finish onboarding to unlock everything.' : ''}`, data: { orderId: order.id, programmeId } });
    audit(ctx, 'order.activated', { type: 'order', id: order.id }, null, { programmeId, consultations, bloodwork, coaching });
    if (customPlan) {
      ctx.db.update('custom_plan_requests', customPlan.id, { status: 'activated', programme_id: programmeId, order_id: order.id, updated_at: now });
      ctx.db.insert('custom_plan_events', { id: ids.customPlanEvent(), request_id: customPlan.id, from_state: 'payment_pending', to_state: 'activated', actor_id: null, note: `Order ${order.reference} paid`, at: now });
    }
    return { programmeId };
  });
}

/* ---------- refunds and cancellation ---------- */
export function requestRefund(ctx: Ctx, provider: PaymentProvider, orderId: string, reason: string) {
  if (!reason) throw errors.badRequest('A reason is required for a refund', 'REASON_REQUIRED');
  return ctx.db.tx(() => {
    const order = getOrder(ctx, orderId);
    if (order.status !== 'paid' && order.status !== 'activated') throw errors.state(`Only a paid order can be refunded (this one is ${order.status})`);
    const payment = ctx.db.get<{ id: string; provider_ref: string | null; amount_paise: number }>("SELECT * FROM payments WHERE order_id = ? AND status = 'captured'", [order.id]);
    if (!payment) throw errors.state('No captured payment to refund');
    const now = ctx.now();
    const refundId = ids.refund();
    ctx.db.insert('refunds', { id: refundId, payment_id: payment.id, order_id: order.id, amount_paise: payment.amount_paise, status: 'requested', reason, requested_by: ctx.actor?.id ?? 'system', created_at: now });
    moveOrder(ctx, order, 'refund_pending');
    tearDownServices(ctx, order, `refund: ${reason}`);
    const result = provider.requestRefund({ providerRef: payment.provider_ref ?? '', amountPaise: payment.amount_paise }, reason);
    ctx.db.update('refunds', refundId, { status: result.status === 'completed' ? 'completed' : 'processing', provider_ref: result.providerRef, completed_at: result.status === 'completed' ? now : null });
    if (result.status === 'completed') {
      ctx.db.update('payments', payment.id, { status: 'refunded', updated_at: now });
      moveOrder(ctx, getOrder(ctx, order.id), 'refunded');
      emit(ctx, 'OrderRefunded', { type: 'order', id: order.id }, { reference: order.reference, memberId: order.member_id, refundId, amountPaise: payment.amount_paise });
    }
    notify(ctx, { userId: order.member_id, category: 'payment', title: 'Refund in progress', body: `₹${payment.amount_paise / 100} for ${order.reference} is being refunded. ${reason}`, data: { orderId: order.id } });
    audit(ctx, 'order.refund', { type: 'order', id: order.id }, reason, { refundId, amountPaise: payment.amount_paise, providerStatus: result.status });
    return presentOrder(ctx, getOrder(ctx, order.id));
  });
}

/** Everything a refunded order had bought stops: entitlements, programme, assignment, open consultations. Open laboratory
 *  bookings need the vendor, so they are listed by openBookingsForOrder and cancelled by the caller that holds the vendor. */
export function tearDownServices(ctx: Ctx, order: OrderRow, reason: string): void {
  const now = ctx.now();
  entitlements.cancelForOrder(ctx, order.id, reason);
  const programme = ctx.db.get<{ id: string }>('SELECT id FROM programmes WHERE order_id = ?', [order.id]);
  if (programme) {
    ctx.db.update('programmes', programme.id, { status: 'cancelled', ended_at: now });
    ctx.db.run("UPDATE coach_assignments SET status = 'ended', ended_at = ?, reason = reason || ' · order refunded' WHERE programme_id = ? AND status IN ('active','paused','pending')", [now, programme.id]);
    ctx.db.run("UPDATE assignment_requests SET status = 'cancelled', resolved_at = ?, reason = 'order refunded' WHERE programme_id = ? AND status IN ('open','exception')", [now, programme.id]);
    const open = ctx.db.all<{ id: string }>("SELECT id FROM appointments WHERE programme_id = ? AND status IN ('requested','scheduled')", [programme.id]);
    for (const a of open) {
      ctx.db.update('appointments', a.id, { status: 'cancelled', updated_at: now });
      audit(ctx, 'appointment.cancel', { type: 'appointment', id: a.id }, reason, { orderId: order.id });
    }
  }
}

/** Laboratory bookings still open on a refunded order (the caller cancels them with the vendor). */
export function openBookingsForOrder(ctx: Ctx, orderId: string): string[] {
  const programme = ctx.db.get<{ id: string }>('SELECT id FROM programmes WHERE order_id = ?', [orderId]);
  if (!programme) return [];
  return ctx.db.all<{ id: string }>("SELECT id FROM bloodwork_bookings WHERE programme_id = ? AND status IN ('confirmed','scheduled')", [programme.id]).map((b) => b.id);
}

export function cancelOrder(ctx: Ctx, orderId: string, reason: string) {
  const order = getOrder(ctx, orderId);
  if (ctx.actor?.role === 'member' && order.member_id !== ctx.actor.id) throw errors.forbidden();
  moveOrder(ctx, order, 'cancelled', { cancelled_at: ctx.now(), failure_reason: reason });
  audit(ctx, 'order.cancel', { type: 'order', id: order.id }, reason);
  return presentOrder(ctx, getOrder(ctx, orderId));
}

export function listOrders(ctx: Ctx, opts: { memberId?: string; status?: string; limit: number; cursor?: string | null }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.memberId) { where.push('member_id = ?'); params.push(opts.memberId); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  // the cursor is '<created_at>~<id>' so orders sharing a timestamp are never skipped at a page boundary; a bare
  // timestamp (an older client) still means strictly before that time
  if (opts.cursor) {
    const [at, id] = opts.cursor.split('~');
    if (id) { where.push('(created_at < ? OR (created_at = ? AND id < ?))'); params.push(at!, at!, id); }
    else { where.push('created_at < ?'); params.push(at!); }
  }
  const rows = ctx.db.all<OrderRow>(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC LIMIT ?`, [...params, opts.limit + 1]);
  const items = rows.slice(0, opts.limit).map((o) => presentOrder(ctx, o));
  const last = rows[opts.limit - 1];
  return { items, nextCursor: rows.length > opts.limit && last ? `${last.created_at}~${last.id}` : null };
}

/** Programmes ending within n days get one expiry notice; ended ones are closed. */
export function expireProgrammes(ctx: Ctx, noticeDays = 7): { ended: number; noticed: number } {
  const now = ctx.now();
  let ended = 0, noticed = 0;
  for (const p of ctx.db.all<{ id: string; member_id: string; end_at: string }>("SELECT id, member_id, end_at FROM programmes WHERE status = 'active' AND end_at IS NOT NULL AND end_at <= ?", [now])) {
    ctx.db.update('programmes', p.id, { status: 'ended', ended_at: now });
    ctx.db.run("UPDATE coach_assignments SET status = 'ended', ended_at = ?, reason = CASE WHEN reason = '' THEN 'Programme ended' ELSE reason END WHERE programme_id = ? AND status IN ('active','paused')", [now, p.id]);
    notify(ctx, { userId: p.member_id, category: 'package_expiry', title: 'Your package has ended', body: 'Your results and notes stay yours. Choose a new package to keep coaching and bloodwork going.', data: { programmeId: p.id } });
    emit(ctx, 'ProgrammeEnded', { type: 'programme', id: p.id }, { memberId: p.member_id });
    ended++;
  }
  const soon = addDays(now, noticeDays);
  for (const p of ctx.db.all<{ id: string; member_id: string; end_at: string }>("SELECT id, member_id, end_at FROM programmes WHERE status = 'active' AND end_at IS NOT NULL AND end_at > ? AND end_at <= ?", [now, soon])) {
    if (ctx.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'package_expiry' AND json_extract(data, '$.programmeId') = ? AND json_extract(data, '$.notice') = 1", [p.member_id, p.id])) continue;
    notify(ctx, { userId: p.member_id, category: 'package_expiry', title: 'Your package ends soon', body: `It ends on ${istDayLabel(p.end_at)}. Unused consultations and blood tests expire with it; book them now or choose a new package.`, data: { programmeId: p.id, notice: 1 } });
    noticed++;
  }
  return { ended, noticed };
}

export function overviewForAdmin(ctx: Ctx) {
  const pending = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM orders WHERE status = 'pending_payment'")?.n ?? 0;
  const mismatches = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM support_tasks WHERE kind = 'payment_mismatch' AND status IN ('open','in_progress')")?.n ?? 0;
  return { pendingPayment: pending, mismatches };
}

export function noteUnusedExport() { void notifyPrivileged; }
