/* The adapters the API runs with: the lab vendor (stand-in or live), the payment provider (simulator until a gateway is
   chosen), and the loop that feeds the outbox after a stand-in webhook. */
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import { systemCtx } from './context.js';
import { createPaymentProvider, type PaymentProvider } from './adapters/payments.js';
import { StandinLabStack, type AdoptedOrder } from './adapters/labstack/standin.js';
import { LiveLabStack } from './adapters/labstack/live.js';
import type { LabVendor } from './adapters/labstack/types.js';
import { handleWebhook } from './domain/bloodwork.js';
import { processPending } from './domain/events.js';
import { ProviderKeys } from './auth/social.js';
import { toIstOffsetString } from './lib/time.js';

/** identity: Google's and Apple's signing keys for Sign in with Google / Apple (api/auth/social.ts), cached here so one
 *  process fetches each provider's keys at most once an hour; tests give it a fetcher of their own. */
export type Services = { vendor: LabVendor; payments: PaymentProvider; standin: StandinLabStack | null; identity: ProviderKeys };

export function createServices(config: Config, db: Db, log: (line: string) => void = () => {}): Services {
  const payments = createPaymentProvider(config.PAYMENT_PROVIDER, config.PAYMENT_WEBHOOK_SECRET);
  const identity = new ProviderKeys();
  let vendor: LabVendor;
  let standin: StandinLabStack | null = null;
  if (config.LABSTACK_MODE === 'live') {
    vendor = new LiveLabStack({ baseUrl: config.LABSTACK_BASE_URL, apiKey: config.LABSTACK_API_KEY, apiKeyNext: config.LABSTACK_API_KEY_NEXT || undefined, log });
  } else {
    const s = new StandinLabStack({
      speed: config.LABSTACK_STANDIN_SPEED,
      webhookHeader: config.LABSTACK_WEBHOOK_HEADER,
      webhookValue: config.LABSTACK_WEBHOOK_VALUE,
      deliver: async (payload, header) => {
        // the stand-in "posts" to the local route: same handler, same header check, same idempotency
        const ctx = systemCtx(db, config);
        await handleWebhook(ctx, s, { [header.name.toLowerCase()]: header.value }, payload);
        await processPending(ctx);
      },
    });
    standin = s;
    vendor = s;
  }
  return { vendor, payments, standin, identity };
}

/** The vendor status a booking stands at, as the stand-in reports it (the booking's own status decides; a stale vendor
 *  status such as an earlier no-show is not repeated). */
const ADOPTED_STATUS: Record<string, string> = { confirmed: 'CREATED', scheduled: 'PHLEBO_ASSIGNED', sample_collected: 'SAMPLE_COLLECTED', processing: 'SAMPLE_PROCESSED', results_ready: 'REPORT_DELIVERED', completed: 'REPORT_DELIVERED', cancelled: 'CANCELED' };

/** Server start only (api/server.ts): the stand-in lives in this process, so the orders the demo seed placed (in the
 *  seed's own process) and those placed before a restart are unknown to it, and moving or cancelling such a booking was
 *  refused as "unknown order" (release round, 5 Nov 2026). Every booking that holds a stand-in order is handed to it
 *  as it stands. Not for the seed itself, which starts from an empty database. */
export function adoptStandinOrders(db: Db, standin: StandinLabStack | null): number {
  if (!standin) return 0;
  const rows = db.all<{ reference: string; member_id: string; status: string; slot_at: string; vendor_order_id: string; pincode: string; address: string; city: string; state: string; lab_id: string | null; vendor_test_id: string | null; kind: string | null; name: string | null; email: string | null }>(
    "SELECT b.reference, b.member_id, b.status, b.slot_at, b.vendor_order_id, b.pincode, b.address, b.city, b.state, b.lab_id, t.vendor_test_id, t.kind, u.name, u.email FROM bloodwork_bookings b LEFT JOIN bloodwork_tests t ON t.id = b.test_id LEFT JOIN users u ON u.id = b.member_id WHERE b.vendor_order_id IS NOT NULL AND b.vendor_order_id LIKE 'LS-%'");
  const orders: AdoptedOrder[] = rows.map((r) => ({
    orderId: r.vendor_order_id, referenceId: r.reference, orderStatus: ADOPTED_STATUS[r.status] ?? 'CREATED', appointment: toIstOffsetString(r.slot_at), cancelled: r.status === 'cancelled',
    req: { referenceId: r.reference, uniqueId: r.member_id, orderType: 'HOME_SAMPLE', appointment: toIstOffsetString(r.slot_at), name: r.name ?? '', email: r.email ?? '', mobile: '', address: r.address, city: r.city, state: r.state, pincode: r.pincode, gender: '', ...(r.vendor_test_id ? (r.kind === 'package' ? { packageIds: [r.vendor_test_id] } : { testIds: [r.vendor_test_id] }) : {}), labId: r.lab_id ?? undefined },
  }));
  return standin.adopt(orders);
}
