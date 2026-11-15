/* M3 Billing documents and refund requests (feature flag 'billing', migration 0011_billing.sql).

   - Routes: api/http/routes/billing.ts (members: their documents and refund requests; administrators with
     orders.manage: documents, voiding, missing documents, refund decisions; the printable document by token).
   - Events: OrderPaid issues the receipt (and the tax invoice once the seller's details are set); OrderRefunded issues
     the credit note and closes any open request on the order. Both run only while the flag is on, like every module
     handler; an order paid while billing was off gets its receipt from POST /admin/billing/orders/:id/issue.
   - No background job: documents follow the payment events, and nothing waits on a timer.
   - Documents are rendered from the database, so the module stores no private files (no fileAccess resolver).
   - Demo seed: receipts for the seeded orders, which the seed pays through the payment simulator before the module
     flags are switched on (each document carries a small "Simulated payment" note), and one open refund request. No
     seller details are filled in: they are the owner's.
   - Data export: the member's documents and refund requests, as their Billing screen shows them (exportSections); the
     void reason, who decided and anything from the payment provider stay out. */
import type { ApiModule } from './types.js';
import { billingRoutes } from '../http/routes/billing.js';
// read while this descriptor loads, so it comes from a file that imports nothing (see api/domain/billingConstants.ts)
import { DOCUMENT_FILE_ROUTE } from '../domain/billingConstants.js';
import * as docs from '../domain/billing.js';

const events: NonNullable<ApiModule['events']> = {
  OrderPaid: [(ctx, e) => { docs.onOrderPaid(ctx, e.aggregate_id); }],
  OrderRefunded: [(ctx, e, p) => { docs.onOrderRefunded(ctx, e.aggregate_id, typeof p.refundId === 'string' ? p.refundId : null); }],
};

export const billing: ApiModule = {
  key: 'billing',
  feature: 'billing',
  routes: billingRoutes,
  // the document link is redeemed by a browser that may carry no session: the handler checks the flag (and access)
  // itself, as the person the token names
  ungated: [DOCUMENT_FILE_ROUTE],
  jobs: [],
  events,
  exportSections: [
    { key: 'documents', label: 'Your receipts, tax invoices and credit notes', build: docs.exportDocuments },
    { key: 'refundRequests', label: 'Your refund requests and the decisions on them', build: docs.exportRefundRequests },
  ],
  seedDemo: ({ system, memberIds }) => {
    const db = system.db;
    // the seed pays its orders through the simulator before the module flags are on, so their receipts are issued here,
    // through the same function the OrderPaid handler calls (marked simulated: the payments went through the simulator)
    for (const o of db.all<{ id: string }>("SELECT id FROM orders WHERE paid_at IS NOT NULL AND status IN ('paid','activated') ORDER BY created_at")) {
      docs.issueForPaidOrder(system, o.id, { reason: 'initial data: receipts for the orders paid before billing documents were switched on' });
    }
    // one open refund request, so the administrator's queue has something to decide
    const order = [...memberIds].reverse().map((id) => db.get<{ id: string; member_id: string }>("SELECT id, member_id FROM orders WHERE member_id = ? AND status = 'activated' ORDER BY created_at DESC LIMIT 1", [id])).find(Boolean);
    if (order) {
      const u = db.get<{ id: string; email: string; name: string }>('SELECT id, email, name FROM users WHERE id = ?', [order.member_id])!;
      docs.createRefundRequest({ ...system, actor: { id: u.id, role: 'member', email: u.email, name: u.name } }, order.id, 'I chose the wrong package by mistake. Please refund this order.');
    }
  },
};
