/* M3 Billing documents and refund requests: the app entry of this module, on the Me tab. The screen is
   src/app/billing.tsx; it sets its own title with <Stack.Screen options>. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'billing', title: 'Billing', sub: 'Receipts, invoices and refund requests', route: '/billing', icon: 'receipt-outline', placement: 'me' },
];
