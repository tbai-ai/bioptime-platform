/* Payment provider adapter. Only the simulator exists today (no gateway has been chosen): it creates a checkout and, when a
   tester "pays", emits a signed event to the same webhook handler a real provider would call. The client never decides. */
import { hmacHex, randomToken, safeEqual } from '../lib/crypto.js';

export type Checkout = { checkoutId: string; providerRef: string; url: string; expiresAt: string; simulated: boolean };
export type PaymentEvent = { eventId: string; checkoutId: string; orderReference: string; status: 'captured' | 'failed' | 'refunded'; amountPaise: number; currency: string; providerRef: string; occurredAt: string; simulated: boolean };

export interface PaymentProvider {
  readonly name: string;
  createCheckout(order: { id: string; reference: string; totalPaise: number; currency: string }, publicOrigin: string): Checkout;
  /** Verify the signature a webhook carried and return the event, or null when it does not verify. */
  verifyWebhook(rawBody: string, signature: string | undefined): PaymentEvent | null;
  /** Simulator only: build a signed event for a checkout so the demo can exercise the real webhook path. */
  simulateEvent?(checkoutId: string, orderReference: string, amountPaise: number, outcome: 'captured' | 'failed'): { body: string; signature: string };
  requestRefund(payment: { providerRef: string; amountPaise: number }, reason: string): { providerRef: string; status: 'processing' | 'completed' };
}

export class SimulatorProvider implements PaymentProvider {
  readonly name = 'simulator';
  constructor(private readonly secret: string) {}

  createCheckout(order: { id: string; reference: string; totalPaise: number; currency: string }, publicOrigin: string): Checkout {
    const checkoutId = 'chk_' + randomToken(12);
    return { checkoutId, providerRef: 'sim_' + randomToken(8), url: `${publicOrigin}/checkout/pay?checkout=${checkoutId}`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), simulated: true };
  }

  verifyWebhook(rawBody: string, signature: string | undefined): PaymentEvent | null {
    if (!signature) return null;
    const expected = hmacHex(this.secret, rawBody);
    if (!safeEqual(expected, signature)) return null;
    try {
      const e = JSON.parse(rawBody) as PaymentEvent;
      if (!e.eventId || !e.checkoutId || !e.orderReference || !['captured', 'failed', 'refunded'].includes(e.status)) return null;
      return { ...e, simulated: true };
    } catch {
      return null;
    }
  }

  simulateEvent(checkoutId: string, orderReference: string, amountPaise: number, outcome: 'captured' | 'failed') {
    const event: PaymentEvent = { eventId: 'evt_' + randomToken(10), checkoutId, orderReference, status: outcome, amountPaise, currency: 'INR', providerRef: 'sim_' + randomToken(8), occurredAt: new Date().toISOString(), simulated: true };
    const body = JSON.stringify(event);
    return { body, signature: hmacHex(this.secret, body) };
  }

  requestRefund(payment: { providerRef: string; amountPaise: number }): { providerRef: string; status: 'processing' | 'completed' } {
    return { providerRef: 'simref_' + randomToken(8), status: 'completed' };
  }
}

export function createPaymentProvider(name: string, secret: string): PaymentProvider {
  if (name === 'simulator') return new SimulatorProvider(secret);
  throw new Error(`Unknown payment provider ${name}: no gateway has been configured`);
}
