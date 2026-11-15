/* The "Coach AI" tab on the coach's client record (the web's modules/ai/CoachAiTab.tsx): this client's consent and
   health sharing, a draft request for them, and the drafts about them. Nothing is applied silently: a draft is
   accepted and copied, and the coach sends it themselves. */
import React from 'react';
import type { RecordTabContext } from '@/lib/coach/moduleTabs';
import { AiDraftPanel } from '@/components/coachModules/aiDraftPanel';
import { useRecordTick } from '@/components/coachModules/shared';

export function CoachAiTab({ ctx }: { ctx: RecordTabContext }) {
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads the consent card and the drafts
  return <AiDraftPanel key={ctx.memberId} memberId={ctx.memberId} refreshKey={tick} />;
}
