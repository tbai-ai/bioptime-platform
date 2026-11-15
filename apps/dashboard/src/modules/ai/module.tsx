/* M11 Coach AI drafting: what the module adds to the portal (flag 'ai').
   - Coach workspace: /coach/ai (choose a client and a purpose, ask for a draft, edit, accept and copy, or discard),
     linked after Messages; a Coach AI tab on the client record with the same panel for that client. The same panel is
     also placed in Messages (a reply draft) and the plan editor (a plan outline) as AiDraftInline (./shared), which
     those pages load lazily while this flag is on; they are not registered here.
   - Admin workspace: /admin/ai, Coach AI usage (ai.manage; counts only), linked before Integrations; the draft
     retention setting on /admin/modules.
   - Member portal: /client/coach-ai, the member's Coach AI consent and what it covers, under a Privacy heading. Members
     never see drafts.
   While no AI provider is configured, every page shows exactly what is missing and every request is refused.

   Withdrawing the consent must stay reachable while the flag is off (or the member is outside its audience) for a
   member who has a granted consent on record (the API leaves GET and POST /me/ai/consent ungated). The registry shows a
   module's pages and links only while its flag is on, so the member page and its link carry
   `whileOff: aiConsentOnRecord` (../types.ts): they also show while the flag is off whenever it resolves true, asked once
   per signed-in member and minute (../runtime.tsx, ../whileOff.ts). Profile › Privacy and sharing links here too while a
   consent is on record. */
import React, { Suspense } from 'react';
import { api } from '../../lib/api';
import { Skeleton } from '../../ui';
import type { PortalModule } from '../types';

const CoachAi = React.lazy(() => import('./CoachAi'));
const CoachAiTab = React.lazy(() => import('./CoachAiTab'));
const AdminAiUsage = React.lazy(() => import('./AdminAiUsage'));
const ClientAiConsent = React.lazy(() => import('./ClientAiConsent'));

/** A tab loads its chunk in place, without blanking the page around it. */
const Lazy = ({ children, rows = 4 }: { children: React.ReactNode; rows?: number }) => <Suspense fallback={<Skeleton rows={rows} />}>{children}</Suspense>;

/** Whether the signed-in member has a granted Coach AI consent on record (under any wording), so the consent page and
 *  its link should show even while the 'ai' flag is off. GET /me/ai/consent works while the module is off; any failure
 *  (a coach or administrator, no network) counts as no. */
export function aiConsentOnRecord(): Promise<boolean> {
  return api.get<{ granted?: boolean }>('/me/ai/consent').then((s) => !!s?.granted, () => false);
}

export const ai: PortalModule = {
  key: 'ai',
  title: 'Coach AI',
  routes: [
    { workspace: 'client', path: 'coach-ai', element: <ClientAiConsent />, whileOff: aiConsentOnRecord },
    { workspace: 'coach', path: 'ai', element: <CoachAi /> },
    { workspace: 'admin', path: 'ai', permission: 'ai.manage', element: <AdminAiUsage /> },
  ],
  nav: [
    { workspace: 'client', to: '/coach-ai', label: 'Coach AI', group: 'Privacy', whileOff: aiConsentOnRecord },
    { workspace: 'coach', to: '/ai', label: 'Coach AI', before: '/profile' },
    { workspace: 'admin', to: '/ai', label: 'Coach AI usage', permission: 'ai.manage', before: '/integrations' },
  ],
  clientTabs: [
    { id: 'ai', label: 'Coach AI', workspaces: ['coach'], render: (ctx) => <Lazy><CoachAiTab ctx={ctx} /></Lazy> },
  ],
  settings: [
    { key: 'ai_draft_retention_days', label: 'Coach AI draft retention (days)', hint: 'How long Coach AI drafts are kept before they are deleted. Empty: not decided, and Coach AI refuses every request until it is. An owner decision; nothing is assumed.' },
  ],
};
