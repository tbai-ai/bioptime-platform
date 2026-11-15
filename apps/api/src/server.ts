/* Entry point: configuration, database and migrations, adapters, the app, the background jobs, then listen. */
import { loadConfig } from './config.js';
import { Db } from './db/db.js';
import { adoptStandinOrders, createServices } from './services.js';
import { buildApp } from './http/app.js';
import { JobRunner, jobDefinitions } from './jobs.js';
import { systemCtx } from './context.js';
import { syncCatalogue } from './domain/bloodwork.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Db(config.databasePath);
  const applied = db.migrate();
  const log = (line: string) => console.log(`[bioptime-api] ${line}`);
  const services = createServices(config, db, log);
  // the stand-in laboratory runs in this process: hand it the orders it did not place (the seed's, or before a restart)
  const adopted = adoptStandinOrders(db, services.standin);
  const app = await buildApp({ config, db, services, logger: true });
  const ctx = systemCtx(db, config);
  if (!db.get('SELECT 1 FROM bloodwork_tests LIMIT 1')) { try { await syncCatalogue(ctx, services.vendor); } catch (e) { log(`catalogue sync skipped: ${(e as Error).message}`); } }
  const jobs = new JobRunner(ctx, jobDefinitions(services.vendor, { safetyNetMinutes: config.LABSTACK_SAFETY_NET_MINUTES, catalogueHours: config.LABSTACK_CATALOGUE_SYNC_HOURS }), log);
  if (config.jobsEnabled) jobs.start();
  // the providers' signing keys for Sign in with Google / Apple, fetched in the background so the first
  // GET /public/config already knows whether Apple sign-in can be offered (api/auth/social.ts)
  services.identity.warm([...(Object.keys(config.googleClientIds).length ? ['google' as const] : []), ...(config.appleAudiences.length ? ['apple' as const] : [])]);
  await app.listen({ port: config.PORT, host: config.HOST });
  log(`mode=${config.BIOPTIME_MODE} labstack=${config.LABSTACK_MODE} payments=${config.PAYMENT_PROVIDER} db=${config.databasePath}${applied.length ? ` migrated=${applied.join(',')}` : ''}`);
  log(`website ${config.PUBLIC_ORIGIN}/  dashboard ${config.PUBLIC_ORIGIN}/dashboard  api ${config.PUBLIC_ORIGIN}/api/health  openapi ${config.PUBLIC_ORIGIN}/api/openapi.json`);
  if (adopted) log(`stand-in laboratory: ${adopted} existing orders taken over`);
  if (config.isDemo) log('DEMO MODE: synthetic data, simulated payments, stand-in laboratory, notification outbox. Nothing here is real.');
  const stop = async () => { jobs.stop(); await app.close(); db.close(); process.exit(0); };
  process.on('SIGINT', () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });
}

main().catch((e) => { console.error(e); process.exit(1); });
