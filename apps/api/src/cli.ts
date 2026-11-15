/* Command line: migrate · seed · reset-demo · create-admin · create-owner · openapi · media:import-exercises · media:verify */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, PLATFORM_ROOT } from './config.js';
import { Db } from './db/db.js';
import { systemCtx } from './context.js';
import { createServices } from './services.js';
import { seedDemo } from './seed/seed.js';
import { createPrivilegedUser, getUserByEmail, inviteOwner } from './auth/service.js';
import { buildApp, API_VERSION } from './http/app.js';
import { buildOpenApi } from './http/openapi.js';
import { importExercises, verifyExercises } from './domain/exerciseMedia.js';

const [, , command, ...args] = process.argv;
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i === -1 ? undefined : args[i + 1]; };

async function main(): Promise<void> {
  const config = loadConfig(command === 'reset-demo' || command === 'seed' ? { LABSTACK_STANDIN_SPEED: 'manual', JOBS_ENABLED: 'false' } : {});
  switch (command) {
    case 'migrate': {
      const db = new Db(config.databasePath);
      const applied = db.migrate();
      console.log(applied.length ? `applied ${applied.join(', ')}` : 'already up to date');
      db.close();
      return;
    }
    case 'seed': {
      if (!config.isDemo && !flag('force')) throw new Error('seed is for demo mode; set BIOPTIME_MODE=demo or pass --force in development');
      const db = new Db(config.databasePath);
      db.migrate();
      const services = createServices(config, db);
      const summary = await seedDemo(systemCtx(db, config), services);
      console.log(JSON.stringify(summary, null, 1));
      db.close();
      return;
    }
    case 'reset-demo': {
      if (!config.isDemo) throw new Error('reset-demo refuses to run outside demo mode');
      for (const suffix of ['', '-wal', '-shm']) { const p = config.databasePath + suffix; if (fs.existsSync(p)) fs.unlinkSync(p); }
      const db = new Db(config.databasePath);
      db.migrate();
      const services = createServices(config, db);
      const summary = await seedDemo(systemCtx(db, config), services);
      console.log(JSON.stringify(summary, null, 1));
      db.close();
      return;
    }
    case 'create-admin': {
      const email = flag('email'), name = flag('name') ?? 'Administrator', role = (flag('role') ?? 'admin') as 'admin' | 'owner';
      const password = process.env.ADMIN_PASSWORD ?? flag('password');
      if (!email || !password) throw new Error('usage: create-admin --email x --name "Name" [--role admin|owner] with ADMIN_PASSWORD in the environment (or --password)');
      const db = new Db(config.databasePath);
      db.migrate();
      if (getUserByEmail(systemCtx(db, config), email)) throw new Error('that email already has an account');
      const u = createPrivilegedUser(systemCtx(db, config), { email, name, password, role });
      console.log(`created ${u.role} ${u.email} (${u.id}); enrol MFA after the first sign-in`);
      db.close();
      return;
    }
    case 'create-owner': {
      // A real owner (Rohan, Avinash): an account in the invited state and a single-use activation link (72 hours)
      // through which the person sets their own password; at their first sign-in at /login/admin they must enrol an
      // authenticator before anything else (MFA_ENROLMENT_REQUIRED). No password is ever taken on the command line. In
      // production the link only goes by email (the outbox); elsewhere it is printed for the person running this.
      if (args.includes('--password') || process.env.ADMIN_PASSWORD) throw new Error('create-owner never takes a password: the owner sets it from the activation link');
      const email = flag('email'), name = flag('name');
      if (!email || !name) throw new Error('usage: create-owner --email <email> --name "<name>"');
      const db = new Db(config.databasePath);
      db.migrate();
      try {
        const r = inviteOwner(systemCtx(db, config), { email, name });
        if (config.isProduction) console.log(`invited owner ${r.user.email} (${r.user.id}): the activation link was sent by email (queued for delivery); it works once and expires ${r.expiresAt}`);
        else console.log([
          `invited owner ${r.user.email} (${r.user.id}); the activation link works once and expires ${r.expiresAt}:`,
          `  ${r.activateUrl}`,
          `Then sign in at ${config.PUBLIC_ORIGIN}/login/admin: setting up an authenticator app comes before anything else.`,
        ].join('\n'));
      } finally { db.close(); }
      return;
    }
    case 'openapi': {
      const db = new Db(':memory:');
      db.migrate();
      const services = createServices(config, db);
      const app = await buildApp({ config, db, services });
      await app.ready();
      const spec = buildOpenApi(config.PUBLIC_ORIGIN, API_VERSION);
      const out = flag('out') ?? path.join(PLATFORM_ROOT, 'docs', 'openapi.json');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(spec, null, 2));
      console.log(`wrote ${out} (${Object.keys(spec.paths as object).length} paths)`);
      await app.close();
      db.close();
      return;
    }
    case 'media:import-exercises': {
      // the exercise clips and posters (api/domain/exerciseMedia.ts): a folder of transcoded files and its manifest.json
      // in, hashed names and the media manifest out (EXERCISE_MEDIA_DIR). Files and the manifest only: no database
      const from = flag('from');
      if (!from) throw new Error('usage: media:import-exercises --from <folder> [--manifest <file>] [--merge] [--keep-old]');
      const r = importExercises(config, from, { manifest: flag('manifest'), merge: args.includes('--merge'), prune: !args.includes('--keep-old') });
      for (const w of r.warnings) console.warn(`warning: ${w}`);
      console.log(`manifest version ${r.version}: ${r.items} exercises, ${(r.bytes / 1048576).toFixed(1)} MB in ${config.exerciseMediaDir}; ${r.written.length} files written, ${r.pruned.length} old files removed`);
      return;
    }
    case 'media:verify': {
      const r = verifyExercises(config);
      for (const p of r.problems) console.error(p);
      console.log(r.ok ? `ok: ${r.items} exercises, ${(r.bytes / 1048576).toFixed(1)} MB, every file matches the manifest` : `${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}`);
      if (!r.ok) process.exitCode = 1;
      return;
    }
    default:
      console.log('commands: migrate | seed | reset-demo | create-admin --email --name [--role] | create-owner --email --name | openapi [--out file] | media:import-exercises --from <folder> [--manifest file] [--merge] [--keep-old] | media:verify');
  }
}

main().catch((e) => { console.error((e as Error).message); process.exit(1); });
