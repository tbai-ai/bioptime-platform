/* M3 Billing documents and refund requests: what the module adds to the portal.
   - Member portal: /client/billing (documents, paid orders, refund requests), linked before Profile.
   - Admin workspace (orders.manage): /admin/billing (Documents and Refund requests tabs), linked after Orders; a
     Billing tab on the client record; a card on the Overview. Orders.tsx is left untouched.
   - Coach workspace: nothing. Coaches see no payment data.
   The seller's details and the GST rate are module settings, edited on /admin/modules. */
import React, { Suspense } from 'react';
import { Skeleton } from '../../ui';
import type { PortalModule } from '../types';

const ClientBilling = React.lazy(() => import('./ClientBilling'));
const AdminBilling = React.lazy(() => import('./AdminBilling'));
const ClientRecordBilling = React.lazy(() => import('./ClientRecordBilling'));
const BillingCard = React.lazy(() => import('./BillingCard'));

/** A tab or card loads its chunk in place, without blanking the page around it. */
const Lazy = ({ children, rows = 4 }: { children: React.ReactNode; rows?: number }) => <Suspense fallback={<Skeleton rows={rows} />}>{children}</Suspense>;

export const billing: PortalModule = {
  key: 'billing',
  title: 'Billing',
  routes: [
    { workspace: 'client', path: 'billing', element: <ClientBilling /> },
    { workspace: 'admin', path: 'billing', permission: 'orders.manage', element: <AdminBilling /> },
  ],
  nav: [
    { workspace: 'client', to: '/billing', label: 'Billing', before: '/profile' },
    { workspace: 'admin', to: '/billing', label: 'Billing', before: '/appointments', permission: 'orders.manage' },
  ],
  clientTabs: [
    { id: 'billing', label: 'Billing', workspaces: ['admin'], permission: 'orders.manage', render: ({ memberId }) => <Lazy><ClientRecordBilling memberId={memberId} /></Lazy> },
  ],
  cards: [
    { id: 'billing-overview', placement: 'adminOverview', span: 4, permission: 'orders.manage', render: () => <Lazy rows={2}><BillingCard /></Lazy> },
  ],
  settings: [
    { key: 'billing_entity', hint: 'The legal entity, GSTIN and registered address, exactly as the owner and counsel confirm them, for example {"legalName": "…", "gstin": "…", "address": "…"}; an optional sacCode is printed on each line. Until legalName, gstin and address are all set, members get receipts labelled “not a tax invoice”.' },
    { key: 'gst_rate_bp', hint: 'GST for new orders in basis points (1800 is 18%, the rate applied so far). Orders and their documents keep the rate they were priced with. The rate is an owner decision.' },
  ],
};
