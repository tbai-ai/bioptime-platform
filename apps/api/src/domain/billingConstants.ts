/* M3 Billing: the constants read while the module registry is being built. This file imports nothing, on purpose.

   api/domain/billing.ts imports the module registry (through api/domain/features.ts and api/domain/notifications.ts),
   the registry imports api/modules/billing.ts, and that imports api/http/routes/billing.ts, which reads
   BILLING_FEATURE at the top of the file; the descriptor itself reads DOCUMENT_FILE_ROUTE ({ ungated: [...] }). So when
   api/domain/billing.ts or the route file was the first file a process loaded, one of them was read before it was set
   ("Cannot access 'BILLING_FEATURE' / 'DOCUMENT_FILE_ROUTE' before initialization"). api/domain/billing.ts re-exports
   BILLING_FEATURE from here as its first import, and the descriptor reads DOCUMENT_FILE_ROUTE from here.
   tests/integration/round7-privacy.test.ts loads both files first in a fresh process to keep it so. */

export const BILLING_FEATURE = 'billing';

/** The document file link: redeemed by a browser that may carry no session, so the route checks the flag itself. The
 *  route file declares the same string; a test keeps the two equal. */
export const DOCUMENT_FILE_ROUTE = 'GET /billing/documents/file';
