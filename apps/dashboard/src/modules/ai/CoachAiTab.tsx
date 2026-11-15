/* The Coach AI tab on the client record (coach workspace only, /coach/clients/:id?tab=ai): this client's Coach AI
   consent and health sharing, a draft request for them, and the drafts about them. Administrators get no such tab:
   drafts belong to the coach who asked for them, and usage is counted on /admin/ai. */
import React from 'react';
import type { ClientRecordTabContext } from '../types';
import { AiDraftPanel } from './shared';

export default function CoachAiTab({ ctx }: { ctx: ClientRecordTabContext }) {
  return <AiDraftPanel memberId={ctx.memberId} />;
}
