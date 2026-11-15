/* The module descriptor. A module (M1 to M11, LabStack operations, growth and referrals) is one ApiModule listed in
   api/modules/index.ts; its routes, background jobs, domain-event handlers, private-file access rules, adherence
   provider and demo rows all hang off that one entry, so no shared file changes when a module grows.

   Rules every module follows (checked where possible):
   - Every route goes through def() (api/http/route.ts) with auth, a permission where the route is administrative, and
     `feature: '<flag>'`. buildApp refuses to start when a module registers a route without a feature unless the
     route is listed in `ungated` (for example a member deleting their own data while the module is switched off), and
     when a module registers any route that def() did not create (app.get(), app.route(), a plugin's own routes): each
     module's routes() runs in its own scope whose onRoute hook checks def()'s mark.
   - Reminders a module queues (api/domain/reminders.ts schedule/replace) use a ref_type listed in
     REMINDER_REF_MODULES there, so a reminder that falls due while the module is off is skipped, never sent later.
   - Coach payloads pass the field policy (api/auth/fieldPolicy.ts); health data for coaches only through
     requireHealthAccess; every mutation calls audit().
   - Private files go through api/domain/files.ts (savePrivateFile, fileToken) and the module's `fileAccess` resolver.
   - Jobs and event handlers run only while the module's flag is on, unless they say otherwise (clean-up that privacy
     needs, such as deleting files after a consent is withdrawn, sets runWhenDisabled). */
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.js';
import type { Services } from '../services.js';
import type { JobDef } from '../jobs.js';
import type { FileAccessResolver } from '../domain/files.js';
import type { ModuleKey } from '@bioptime/domain';

/** The module keys (MODULE_KEYS in @bioptime/domain), one per registry entry; their flags are seeded off by
 *  0008_foundation.sql (growth and referrals by 0031_growth_referrals_flags.sql). */
export type { ModuleKey };

/** A row of domain_events, as the outbox hands it to handlers. */
export type DomainEventRow = { id: string; type: string; aggregate_type: string; aggregate_id: string; payload: string; attempts: number };
export type ModuleEventHandler = (ctx: Ctx, event: DomainEventRow, payload: Record<string, unknown>) => void | Promise<void>;

/** A background job. It runs only while the module's flag is on unless runWhenDisabled is set. */
export type ModuleJob = JobDef & { runWhenDisabled?: boolean };

/** One line of GET /me/adherence: each provider is listed separately; there is no composite score. pct is null when nothing was due. */
export type AdherenceSummary = { key: string; label: string; due: number; done: number; pct: number | null; note?: string; /** due items marked skipped (plan actions) */ skipped?: number };
export type AdherenceProvider = { key: string; label: string; compute: (ctx: Ctx, memberId: string, range: { from: string; to: string }) => AdherenceSummary };

/** What the demo seed hands a module: the owner's context (for audited writes), the system context, and the demo people. */
export type DemoSeedContext = { owner: Ctx; system: Ctx; services: Services; ownerId: string; adminId: string; coachIds: string[]; memberIds: string[] };

export type ApiModule = {
  key: ModuleKey;
  /** The feature flag the module's routes require (its own key unless it says otherwise). */
  feature?: string;
  /** Registers the module's routes inside the /api prefix (in the module's own scope), each through def(). */
  routes(app: FastifyInstance): void;
  /** "METHOD /path" of routes that stay reachable while the flag is off. Every other route must declare `feature`. */
  ungated?: string[];
  jobs?: ModuleJob[];
  /** Domain-event handlers by event type, merged with the core handlers (api/domain/events.ts). */
  events?: Record<string, ModuleEventHandler[]>;
  /** Run the event handlers even while the flag is off (default: skipped). */
  eventsWhenDisabled?: boolean;
  /** Who may open a private file of each kind the module stores (file_metadata.kind → resolver). A module with any
   *  resolver stores private files, so production refuses to enable it on local storage. */
  fileAccess?: Record<string, FileAccessResolver>;
  /** The module's adherence provider for GET /me/adherence (M2 reads the registry when a request arrives). */
  adherence?: AdherenceProvider;
  /** Rows for the running product in demo mode, written by the demo seed, with no labels: since the owner's decision of
   *  24 October 2026 no name, title or note says "Demo" or "Sample" (payment documents and the practice laboratory's
   *  screens carry one small plain "simulated" note). */
  seedDemo?: (demo: DemoSeedContext) => void | Promise<void>;
  /** The member's own records this module adds to their data export (api/domain/dataExport.ts buildArchive): only
   *  what the member's own screens show, never coach drafts, team notes or unpublished plans. */
  exportSections?: import('../domain/dataExport.js').ExportSectionDef[];
};
