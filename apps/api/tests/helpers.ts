/* Test harness: an in-memory database, the stand-in vendor at manual speed, no background jobs, the real app. Uploaded
   images, reports and private files go to temporary folders of the app's own (removed when the test process exits),
   never into apps/api/data. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { Db } from '../src/db/db.js';
import { systemCtx, type Ctx } from '../src/context.js';
import { createServices } from '../src/services.js';
import { buildApp } from '../src/http/app.js';
import { seedDemo, DEMO_PASSWORDS, DEMO_MFA_SECRET } from '../src/seed/seed.js';
import { totpCode } from '../src/lib/crypto.js';
import type { FastifyInstance } from 'fastify';
import type { ApiModule } from '../src/modules/types.js';
import type { JwksFetcher } from '../src/auth/social.js';

export { DEMO_PASSWORDS, DEMO_MFA_SECRET };

/* ---------- temporary storage folders ---------- */

const scratchRoots: string[] = [];
let removeOnExit = false;

/** Fresh ASSETS_DIR, REPORTS_DIR and PRIVATE_FILES_DIR under the system temporary folder, removed when the process
 *  exits (or earlier through removeScratchDirs). */
export function scratchDirs(): { ASSETS_DIR: string; REPORTS_DIR: string; PRIVATE_FILES_DIR: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bioptime-test-'));
  scratchRoots.push(root);
  if (!removeOnExit) { removeOnExit = true; process.once('exit', removeScratchDirs); }
  const dirs = { ASSETS_DIR: path.join(root, 'assets'), REPORTS_DIR: path.join(root, 'reports'), PRIVATE_FILES_DIR: path.join(root, 'private') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return dirs;
}

/** Removes every temporary folder this process created (only those: never apps/api/data). */
export function removeScratchDirs(): void {
  for (const root of scratchRoots.splice(0)) { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* already gone */ } }
}

/** The app as the tests use it. opts.env overrides anything, a test's own PRIVATE_FILES_DIR included; opts.modules
 *  replaces the module registry (start-up checks). dirs names the temporary folders this app writes to. */
export async function makeApp(opts: { seed?: boolean; env?: Record<string, string>; modules?: ApiModule[]; jwks?: JwksFetcher } = {}) {
  const dirs = scratchDirs();
  const config = loadConfig({ BIOPTIME_MODE: 'demo', DATABASE_PATH: ':memory:', LABSTACK_STANDIN_SPEED: 'manual', JOBS_ENABLED: 'false', RATE_LIMITS: 'off', WEBSITE_DIR: '/nonexistent-website', DASHBOARD_DIR: '/nonexistent-dashboard', PUBLIC_ORIGIN: 'http://localhost:3000', ...dirs, ...opts.env });
  const db = new Db(':memory:');
  db.migrate();
  const services = createServices(config, db);
  // the tests never reach Google's or Apple's key servers: a test that verifies ID tokens serves keys of its own
  services.identity.useFetcher(opts.jwks ?? (async (url) => { throw new Error(`no network in tests (${url})`); }));
  const app = await buildApp({ config, db, services, ...(opts.modules ? { modules: opts.modules } : {}) });
  await app.ready();
  const ctx = systemCtx(db, config);
  if (opts.seed !== false) await seedDemo(ctx, services);
  return { app, db, config, services, ctx, dirs };
}

export type Client = ReturnType<typeof client>;

export function client(app: FastifyInstance) {
  let cookie = '';
  let bearer = '';
  const headers = () => ({ 'content-type': 'application/json', 'x-bioptime-client': 'web', ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) });
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, extraHeaders: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, headers: { ...headers(), ...extraHeaders }, payload: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw && raw.startsWith('bp_session=')) cookie = raw.split(';')[0]!;
    let json: unknown = null;
    try { json = res.json(); } catch { json = res.body; }
    return { status: res.statusCode, json: json as Record<string, unknown> & { error?: { code: string; message: string; details?: unknown } }, text: res.body, headers: res.headers };
  };
  return {
    get: (url: string, h?: Record<string, string>) => call('GET', url, undefined, h),
    post: (url: string, body?: unknown, h?: Record<string, string>) => call('POST', url, body ?? {}, h),
    patch: (url: string, body?: unknown) => call('PATCH', url, body ?? {}),
    put: (url: string, body?: unknown) => call('PUT', url, body ?? {}),
    del: (url: string) => call('DELETE', url),
    async login(email: string, password: string, workspace: 'member' | 'dashboard' = 'member', mfa = false) {
      const r = await call('POST', '/api/auth/login', { email, password, workspace, ...(mfa ? { mfaCode: totpCode(DEMO_MFA_SECRET) } : {}) });
      if (r.status !== 200) throw new Error(`login failed ${r.status}: ${JSON.stringify(r.json)}`);
      return r.json as { user: { id: string; role: string } };
    },
    useBearer(token: string) { bearer = token; cookie = ''; },
    clear() { cookie = ''; bearer = ''; },
    get cookie() { return cookie; },
  };
}

export function userId(ctx: Ctx, email: string): string {
  const u = ctx.db.get<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
  if (!u) throw new Error(`no user ${email}`);
  return u.id;
}

export const DEMO = {
  member: 'ananya.rao@demo.bioptime.test', member2: 'vikram.shetty@demo.bioptime.test', memberNoCoach: 'karthik.reddy@demo.bioptime.test', memberIncomplete: 'ishaan.mehta@demo.bioptime.test', memberNoShare: 'deepa.krishnan@demo.bioptime.test',
  coach: 'asha.menon@demo.bioptime.test', coach2: 'rahul.verma@demo.bioptime.test', coach3: 'meera.iyer@demo.bioptime.test',
  admin: 'admin@demo.bioptime.test', owner: 'owner@demo.bioptime.test',
};
