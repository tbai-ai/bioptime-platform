/* Background jobs inside the server process: the simplest reliable design for one instance. Each run is logged; failures
   never stop the next run. Timers are unref'd so tests and the CLI exit cleanly. */
import type { Ctx } from './context.js';
import type { LabVendor } from './adapters/labstack/types.js';
import { ids } from './lib/ids.js';
import { processPending } from './domain/events.js';
import { expireDue } from './domain/entitlements.js';
import { expireProgrammes } from './domain/orders.js';
import { sendReminders, flagOverdue } from './domain/appointments.js';
import { safetyNet, syncCatalogue } from './domain/bloodwork.js';
import { expireProposals } from './domain/customPlans.js';
import { openTask } from './domain/support.js';
import { onCoachAvailabilityChanged } from './domain/assignments.js';
import { dispatchDue } from './domain/reminders.js';
import { isEnabled } from './domain/features.js';
import { MODULES, featureOf } from './modules/index.js';

/** A background job. `idle` says when a run did nothing worth a jobs_log row (the minute-by-minute reminders job). */
export type JobDef = { name: string; everyMs: number; run: (ctx: Ctx) => Promise<unknown> | unknown; idle?: (result: unknown) => boolean };

/** Each module's jobs, prefixed with the module key. A job runs only while its module's flag is on unless it sets
 *  runWhenDisabled; a run skipped for that reason leaves no jobs_log row. */
export function moduleJobs(): JobDef[] {
  return MODULES.flatMap((m) => (m.jobs ?? []).map((job): JobDef => ({
    name: job.name.startsWith(`${m.key}.`) ? job.name : `${m.key}.${job.name}`,
    everyMs: job.everyMs,
    run: (ctx) => (job.runWhenDisabled || isEnabled(ctx, featureOf(m)) ? job.run(ctx) : { featureOff: featureOf(m) }),
    idle: (r) => (!!r && typeof r === 'object' && 'featureOff' in r) || (job.idle ? job.idle(r) : false),
  })));
}

export function jobDefinitions(vendor: LabVendor, config: { safetyNetMinutes: number; catalogueHours: number }): JobDef[] {
  return [
    { name: 'outbox', everyMs: 2_000, run: (ctx) => processPending(ctx) },
    { name: 'labstack_safety_net', everyMs: config.safetyNetMinutes * 60_000, run: (ctx) => safetyNet(ctx, vendor) },
    { name: 'labstack_catalogue', everyMs: config.catalogueHours * 3_600_000, run: (ctx) => syncCatalogue(ctx, vendor) },
    { name: 'entitlement_expiry', everyMs: 3_600_000, run: (ctx) => ({ expired: expireDue(ctx), programmes: expireProgrammes(ctx) }) },
    { name: 'appointment_reminders', everyMs: 15 * 60_000, run: (ctx) => ({ reminders: sendReminders(ctx), overdue: flagOverdue(ctx, (input) => openTask(ctx, input)) }) },
    { name: 'proposal_expiry', everyMs: 3_600_000, run: (ctx) => ({ expired: expireProposals(ctx) }) },
    { name: 'coach_return', everyMs: 3_600_000, run: (ctx) => {
      const back = ctx.db.all<{ user_id: string }>('SELECT user_id FROM coach_profiles WHERE available = 0 AND unavailable_until IS NOT NULL AND unavailable_until <= ?', [ctx.now()]);
      for (const c of back) { ctx.db.update('coach_profiles', c.user_id, { available: 1, unavailable_until: null, updated_at: ctx.now() }, 'user_id'); onCoachAvailabilityChanged(ctx, c.user_id, true, 'unavailable period ended'); }
      return { resumed: back.length };
    } },
    // the reminder queue (api/domain/reminders.ts); runs that found nothing due are not logged
    { name: 'reminders', everyMs: 60_000, run: (ctx) => dispatchDue(ctx), idle: (r) => { const x = r as { sent?: number; inAppOnly?: number; skipped?: number } | undefined; return !!x && !x.sent && !x.inAppOnly && !x.skipped; } },
    ...moduleJobs(),
  ];
}

export class JobRunner {
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();
  constructor(private readonly ctx: Ctx, private readonly jobs: JobDef[], private readonly log: (line: string) => void = () => {}) {}

  start(): void {
    for (const job of this.jobs) {
      const t = setInterval(() => { void this.runOne(job); }, job.everyMs);
      t.unref();
      this.timers.push(t);
    }
  }

  async runOne(job: JobDef): Promise<unknown> {
    if (this.running.has(job.name)) return undefined;
    this.running.add(job.name);
    const id = ids.job();
    const started = this.ctx.now();
    // the outbox (every 2 s) is never logged; a job with `idle` gets its row only when the run did something or failed
    const logged = job.name !== 'outbox';
    if (logged && !job.idle) this.ctx.db.insert('jobs_log', { id, job: job.name, started_at: started });
    try {
      const result = await job.run(this.ctx);
      if (logged && job.idle && !job.idle(result)) this.ctx.db.insert('jobs_log', { id, job: job.name, started_at: started });
      if (logged && (!job.idle || !job.idle(result))) this.ctx.db.update('jobs_log', id, { finished_at: this.ctx.now(), ok: 1, detail: JSON.stringify(result ?? null).slice(0, 500) });
      return result;
    } catch (e) {
      this.log(`job ${job.name} failed: ${(e as Error).message}`);
      if (logged && job.idle) this.ctx.db.insert('jobs_log', { id, job: job.name, started_at: started });
      if (logged) this.ctx.db.update('jobs_log', id, { finished_at: this.ctx.now(), ok: 0, detail: String((e as Error).message).slice(0, 500) });
      return undefined;
    } finally {
      this.running.delete(job.name);
    }
  }

  async runAllOnce(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const job of this.jobs) out[job.name] = await this.runOne(job);
    return out;
  }

  stop(): void { for (const t of this.timers) clearInterval(t); this.timers = []; }
}
