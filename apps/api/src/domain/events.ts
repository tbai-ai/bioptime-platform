/* The outbox: domain events written inside transactions are processed here, after commit, with retries. Handlers do the
   cross-aggregate reactions (an activation opens an assignment request; an assignment makes sure a conversation
   exists) so the originating transaction stays small. */
import type { Ctx } from '../context.js';
import { j } from '../db/db.js';
import { addMinutes } from '../lib/time.js';
import { createRequest, ensureConversation } from './assignments.js';
import { isEnabled } from './features.js';
import { MODULES, featureOf } from '../modules/index.js';

type EventRow = { id: string; type: string; aggregate_type: string; aggregate_id: string; payload: string; attempts: number };
type Handler = (ctx: Ctx, event: EventRow, payload: Record<string, unknown>) => void | Promise<void>;

export const handlers: Record<string, Handler[]> = {
  PackageActivated: [(ctx, e, p) => {
    if (p.coaching === 'none') return;
    createRequest(ctx, { memberId: String(p.memberId), programmeId: e.aggregate_id, orderId: p.orderId ? String(p.orderId) : null });
  }],
  CoachAssigned: [(ctx, _e, p) => { ensureConversation(ctx, String(p.memberId), String(p.coachId)); }],
};

/** The core handlers for an event type, then each module's (api/modules/index.ts), read when the event is processed.
 *  A module's handlers run only while its flag is on, unless the module sets eventsWhenDisabled. */
export function handlersFor(ctx: Ctx, type: string): Handler[] {
  const out: Handler[] = [...(handlers[type] ?? [])];
  for (const m of MODULES) {
    const list = m.events?.[type];
    if (list?.length && (m.eventsWhenDisabled || isEnabled(ctx, featureOf(m)))) out.push(...list);
  }
  return out;
}

export async function processPending(ctx: Ctx, limit = 100): Promise<{ processed: number; failed: number }> {
  const now = ctx.now();
  const rows = ctx.db.all<EventRow>('SELECT * FROM domain_events WHERE processed_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?) AND attempts < 8 ORDER BY created_at LIMIT ?', [now, limit]);
  let processed = 0, failed = 0;
  for (const e of rows) {
    const payload = j.out<Record<string, unknown>>(e.payload, {});
    try {
      for (const h of handlersFor(ctx, e.type)) await h(ctx, e, payload);
      ctx.db.update('domain_events', e.id, { processed_at: ctx.now() });
      processed++;
    } catch (err) {
      const attempts = e.attempts + 1;
      ctx.db.update('domain_events', e.id, { attempts, last_error: String((err as Error).message).slice(0, 500), next_attempt_at: addMinutes(ctx.now(), Math.min(60, 2 ** attempts)) });
      failed++;
    }
  }
  return { processed, failed };
}

export function deadLetters(ctx: Ctx) {
  return ctx.db.all('SELECT id, type, aggregate_type, aggregate_id, attempts, last_error, created_at FROM domain_events WHERE processed_at IS NULL AND attempts >= 8 ORDER BY created_at DESC LIMIT 100');
}
