import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../../lib/validate.js';
import { errors } from '../../lib/errors.js';
import { def } from '../route.js';
import { systemCtx } from '../../context.js';
import * as orders from '../../domain/orders.js';
import * as bloodwork from '../../domain/bloodwork.js';
import { processPending } from '../../domain/events.js';
import { openTask } from '../../domain/support.js';
import type { WebhookPayload } from '../../adapters/labstack/types.js';

const labPayload = z.object({ orderId: z.string(), referenceId: z.string(), orderStatus: z.string(), events: z.array(z.object({ event: z.string(), at: z.string().optional(), link: z.string().optional(), partial: z.boolean().optional() })).default([]) });

export function webhookRoutes(app: FastifyInstance): void {
  // a refund the provider started on its own ends the services too; bookings held by the laboratory need the vendor call
  const cancelBookingsAfterProviderRefund = async (r: { outcome: string; orderId?: string }) => {
    if (r.outcome !== 'refunded_by_provider' || !r.orderId) return;
    const ctx = systemCtx(app.db, app.config);
    for (const bookingId of orders.openBookingsForOrder(ctx, r.orderId)) {
      try { await bloodwork.cancel(ctx, app.services.vendor, bookingId, 'order refunded by the payment provider'); }
      catch (e) { openTask(ctx, { kind: 'failed_booking', title: `Booking ${bookingId} could not be cancelled after a provider refund`, detail: (e as Error).message, refType: 'booking', refId: bookingId }); }
    }
  };
  def(app, { method: 'POST', path: '/integrations/payments/webhook', summary: 'Payment provider webhook (HMAC signature in X-Signature); idempotent on event id', tag: 'webhooks', auth: 'webhook', rateLimit: { max: 120, timeWindow: '1 minute' } }, async (req) => {
    const sig = req.headers['x-signature'];
    const r = orders.handlePaymentWebhook(systemCtx(app.db, app.config), app.services.payments, req.rawBody ?? JSON.stringify(req.body ?? {}), Array.isArray(sig) ? sig[0] : sig);
    await cancelBookingsAfterProviderRefund(r);
    await processPending(systemCtx(app.db, app.config));
    return r;
  });

  def(app, { method: 'POST', path: '/integrations/labstack/webhook', summary: 'LabStack order webhook (agreed header); applies only changes, repeats change nothing', tag: 'webhooks', auth: 'webhook', rateLimit: { max: 300, timeWindow: '1 minute' } }, async (req) => {
    const payload = parse(labPayload, req.body) as WebhookPayload;
    const r = await bloodwork.handleWebhook(systemCtx(app.db, app.config), app.services.vendor, req.headers as Record<string, string | string[] | undefined>, payload);
    await processPending(systemCtx(app.db, app.config));
    return r;
  });

  if (!app.config.isProduction) {
    // The payment simulator: a tester "pays" from the checkout page; the server builds a signed event and feeds it through
    // the real webhook handler. Only the member who owns the order, or an administrator, may trigger it.
    def(app, { method: 'POST', path: '/payments/simulator/complete', summary: 'DEMO/DEV ONLY: simulate the provider capturing or failing a checkout', tag: 'demo', auth: 'any', body: z.object({ checkoutId: z.string(), outcome: z.enum(['captured', 'failed']).default('captured') }) }, async (req) => {
      const i = parse(z.object({ checkoutId: z.string(), outcome: z.enum(['captured', 'failed']).default('captured') }), req.body);
      const payment = app.db.get<{ order_id: string; amount_paise: number }>('SELECT order_id, amount_paise FROM payments WHERE checkout_id = ?', [i.checkoutId]);
      if (!payment) throw errors.notFound('Checkout');
      const order = orders.getOrder(req.ctx, payment.order_id);
      const actor = req.ctx.actor!;
      // only the member who owns the checkout, or an administrator: a coach may never settle someone's payment
      if (!((actor.role === 'member' && order.member_id === actor.id) || actor.role === 'admin' || actor.role === 'owner')) throw errors.forbidden();
      if (!app.services.payments.simulateEvent) throw errors.state('The configured provider is not the simulator');
      const { body, signature } = app.services.payments.simulateEvent(i.checkoutId, order.reference, payment.amount_paise, i.outcome);
      const r = orders.handlePaymentWebhook(systemCtx(app.db, app.config), app.services.payments, body, signature);
      await cancelBookingsAfterProviderRefund(r);
      await processPending(systemCtx(app.db, app.config));
      return { ...r, simulated: true, order: orders.presentOrder(req.ctx, orders.getOrder(req.ctx, order.id)) };
    });

    def(app, { method: 'POST', path: '/labstack/standin/step', summary: 'DEMO/DEV ONLY (manual speed): move a stand-in order one status forward', tag: 'demo', auth: 'admin', body: z.object({ bookingId: z.string() }) }, async (req) => {
      const { bookingId } = parse(z.object({ bookingId: z.string() }), req.body);
      const b = bloodwork.getBooking(req.ctx, bookingId);
      if (!app.services.standin || !b.vendorOrderId) throw errors.state('No stand-in order for that booking');
      const next = await app.services.standin.step(b.vendorOrderId);
      await processPending(systemCtx(app.db, app.config));
      return { next, booking: bloodwork.getBooking(req.ctx, bookingId) };
    });
  }
}
