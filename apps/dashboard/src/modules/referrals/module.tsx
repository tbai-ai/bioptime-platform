/* Referrals in the portal (flag 'referrals'). Pages load lazily; the server enforces everything again (feature
   'referrals', the member role, members.manage).
   - Member portal: /client/refer, "Refer a friend" in the main navigation: the member's code and link, a share button,
     and who joined with it by first name. Rewards are an owner decision: the page says they are set by the Bioptime team
     and promises none.
   - Admin workspace (members.manage): /admin/referrals, every referral with its status (signed up, became a paying
     member). */
import React, { Suspense } from 'react';
import { Skeleton } from '../../ui';
import type { PortalModule } from '../types';

const ClientRefer = React.lazy(() => import('./ClientRefer').then((m) => ({ default: m.ClientRefer })));
const AdminReferrals = React.lazy(() => import('./AdminReferrals').then((m) => ({ default: m.AdminReferrals })));
const wait = (node: React.ReactNode, rows = 5) => <Suspense fallback={<Skeleton rows={rows} />}>{node}</Suspense>;

export const referrals: PortalModule = {
  key: 'referrals',
  title: 'Referrals',
  routes: [
    { workspace: 'client', path: 'refer', element: wait(<ClientRefer />) },
    { workspace: 'admin', path: 'referrals', permission: 'members.manage', element: wait(<AdminReferrals />, 6) },
  ],
  nav: [
    { workspace: 'client', to: '/refer', label: 'Refer a friend', before: '/profile' },
    { workspace: 'admin', to: '/referrals', label: 'Referrals', permission: 'members.manage', before: '/coaches' },
  ],
};
