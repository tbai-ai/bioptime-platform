/* Round 8 (API and seeded data): the owner's decision of 24 October 2026 removes the word "demo" and the "sample" /
   "Sample data" labels from everything viewers see, except one small, plain "simulated" note on payment documents and
   on the practice laboratory's screens. Login emails keep @demo.bioptime.test and the passwords stay the same.

   - every text column of a freshly seeded database is free of "demo" and "sample", outside the login emails and the
     word "sample" where it means the blood sample the laboratory collects;
   - so is every GET response the API builds, for an anonymous visitor, a member, a coach, an administrator and the
     owner: every parameterless route, every one-parameter route with ids taken from the lists, and the printable
     billing and report documents; the lab report and the practice laboratory's placeholder file keep one small plain
     practice laboratory note;
   - GET /public/config carries no sign-in hint (demoHint is gone, with its password);
   - the seeded accounts, packages and coupon read as plain records; the invite notes do not say "demo";
   - the wellness score reads "estimate", never the column's old default "sample";
   - every domain, route, http and module file imports cleanly as the first module of a fresh process (the leaf
     constant files progressConstants.ts, billingConstants.ts, helpConstants.ts and growthConstants.ts; the registry,
     api/modules/index.ts, builds its list on first use), except api/domain/referrals.ts, whose route file reads
     REFERRAL_FEATURE while it loads (for the referrals owner to move to a leaf file);
   - the billing document link the module declares ungated is the route the billing route file registers. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId, type Client } from '../helpers.js';
import { routes as registeredRoutes } from '../../src/http/openapi.js';
import * as members from '../../src/domain/members.js';
import { buildArchive } from '../../src/domain/dataExport.js';
import { DOCUMENT_FILE_ROUTE as ROUTE_FROM_ROUTES } from '../../src/http/routes/billing.js';
import { DOCUMENT_FILE_ROUTE as ROUTE_FROM_CONSTANTS, BILLING_FEATURE } from '../../src/domain/billingConstants.js';
import { billing as billingModule } from '../../src/modules/billing.js';
import { progress as progressModule } from '../../src/modules/progress.js';
import { PHOTO_FILE_KIND } from '../../src/domain/progress.js';
import * as help from '../../src/domain/help.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); });

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The labels the owner removed. */
const LABEL = /\bdemo\b|\bsample\b|sample data/i;
/** "sample" where it means the blood sample the laboratory collects (kept: the owner removed labels, not that word),
 *  including the laboratory operations' own words (home sample collection, sample drop-off, the phlebotomist collects
 *  the sample) and a practice laboratory note saying no sample was collected. */
const BLOOD_SAMPLE = /\b(your|blood|home) sample\b|\bsample (collected|collection|drop-off|on its way|is on its way)\b|\bcollects? the sample\b|\bthe sample is collected\b|\bno sample (is|was) collected\b|processing your sample/gi;
/** Login emails keep their reserved domain. */
const LOGIN_EMAIL = /[a-z0-9._+-]+@demo\.bioptime\.test/gi;
const visible = (v: string) => v.replace(LOGIN_EMAIL, '').replace(BLOOD_SAMPLE, '');

test('after the demo seed, no text column anywhere says demo or sample (login emails and the blood sample aside)', () => {
  const tables = h.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'migrations'").map((t) => t.name);
  assert.ok(tables.length > 40, 'every table is scanned');
  const found: string[] = [];
  let scanned = 0;
  for (const t of tables) {
    for (const row of h.db.all<Record<string, unknown>>(`SELECT * FROM "${t}"`)) {
      for (const [col, v] of Object.entries(row)) {
        if (typeof v !== 'string') continue;
        scanned++;
        const m = visible(v).match(LABEL);
        if (m) found.push(`${t}.${col}: …${visible(v).slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40)}…`);
      }
    }
  }
  assert.ok(scanned > 1000, `${scanned} text values scanned`);
  assert.deepEqual(found, [], 'names, titles, descriptions, notes, notifications, emails in the outbox and audit reasons');
  // the blood sample and the simulated payments are still said where they apply
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE title = 'Sample on its way'"), 'the laboratory’s own word for the blood sample stays');
  assert.ok(h.db.get('SELECT 1 FROM billing_documents WHERE simulated = 1'), 'documents of simulated payments stay marked simulated');
});

/* ---------- every GET response the API builds, for every role ---------- */

type Res = Awaited<ReturnType<Client['get']>>;
type Scan = { requests: number; ok: number; found: string[]; perRole: Record<string, { requests: number; ok: number; paramOk: number }>; billingDocs: string[]; reportDocs: string[] };

/** Every string a JSON body holds, with where it sits; object keys are field names, not text a viewer reads. */
function strings(v: unknown, at: string, out: Array<[string, string]>): void {
  if (typeof v === 'string') out.push([at, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${at}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, `${at}.${k}`, out);
}
/** Values under one key name anywhere in a body (ids for :id, slugs for :slug), in the order they appear. */
function valuesOf(v: unknown, key: string, out: string[]): void {
  if (Array.isArray(v)) v.forEach((x) => valuesOf(x, key, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if ((k === key || (key === 'id' && /(Id|_id)$/.test(k))) && typeof x === 'string') out.push(x); else valuesOf(x, key, out); }
}
/** What a viewer reads in an HTML page: no styles, scripts or tags (class names are not text). */
const pageText = (html: string) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'");

let scanned: Promise<Scan> | null = null;
function scanApi(): Promise<Scan> {
  scanned ??= (async () => {
    const out: Scan = { requests: 0, ok: 0, found: [], perRole: {}, billingDocs: [], reportDocs: [] };
    const mode = h.config.BIOPTIME_MODE;
    const check = (role: string, url: string, res: Res) => {
      out.requests++; out.perRole[role]!.requests++;
      if (res.status === 200) { out.ok++; out.perRole[role]!.ok++; }
      const type = String(res.headers['content-type'] ?? '');
      if (type.includes('css')) return; // a stylesheet holds no text a viewer reads
      const values: Array<[string, string]> = [];
      if (type.includes('json')) strings(res.json, '', values);
      else values.push(['', type.includes('html') ? pageText(res.text) : res.text]);
      for (const [at, v] of values) {
        if (at.endsWith('.mode') && v === mode) continue; // the server mode (BIOPTIME_MODE) is configuration, not a label
        const t = visible(v);
        const m = t.match(LABEL);
        if (m) out.found.push(`${role} GET ${url} (${res.status}) ${at || 'body'}: …${t.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 60).replace(/\s+/g, ' ')}…`);
      }
    };
    const all = [...new Map(registeredRoutes().filter((r) => r.method === 'GET').map((r) => [r.path, r])).values()];
    // the demo-mode-only helper routes answer tools, not viewers; the token routes are opened below with real tokens
    const gets = all.filter((r) => r.tag !== 'demo' && !(r.query as { shape?: Record<string, unknown> } | undefined)?.shape?.token);
    const roles: Array<[string, (c: Client) => Promise<unknown>]> = [
      ['anonymous', async () => undefined],
      ['member', (c) => c.login(DEMO.member, DEMO_PASSWORDS.member)],
      ['coach', (c) => c.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard')],
      ['admin', (c) => c.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true)],
      ['owner', (c) => c.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true)],
    ];
    for (const [role, signIn] of roles) {
      out.perRole[role] = { requests: 0, ok: 0, paramOk: 0 };
      const c = client(h.app);
      await signIn(c);
      const bodies = new Map<string, unknown>();
      for (const r of gets.filter((g) => !g.path.includes(':'))) {
        const res = await c.get(`/api${r.path}`);
        check(role, r.path, res);
        if (res.status === 200) bodies.set(r.path, res.json);
      }
      // one-parameter routes: the values the nearest list holds first, then every value of that kind any answer held
      let pending = gets.filter((g) => (g.path.match(/:/g) ?? []).length === 1);
      for (let pass = 0; pass < 2 && pending.length; pass++) {
        const left: typeof pending = [];
        for (const r of pending) {
          const key = /:(\w+)/.exec(r.path)![1]!;
          const want = key === 'id' ? 'id' : key;
          let parent = r.path.slice(0, r.path.indexOf('/:'));
          while (parent && !bodies.has(parent)) parent = parent.slice(0, parent.lastIndexOf('/'));
          const near: string[] = []; if (parent) valuesOf(bodies.get(parent), want, near);
          const pool: string[] = []; for (const b of bodies.values()) valuesOf(b, want, pool);
          const candidates = [...new Set([...near, ...(pass ? pool : [])])].filter((v) => v.length < 200).slice(0, 40);
          let reached = false;
          for (const v of candidates) {
            const url = r.path.replace(/:\w+/, encodeURIComponent(v));
            const res = await c.get(`/api${url}`);
            if (res.status === 200) { check(role, url, res); bodies.set(url, res.json); out.perRole[role]!.paramOk++; reached = true; break; }
          }
          if (!reached) { if (pass) check(role, r.path, await c.get(`/api${r.path.replace(/:\w+/, 'not-a-record')}`)); else left.push(r); }
        }
        pending = left;
      }
      // the printable documents, opened through their 5-minute tokens as the clients open them
      const ids = (paths: string[], key = 'id') => { const v: string[] = []; for (const p of paths) valuesOf(bodies.get(p), key, v); return [...new Set(v)]; };
      for (const id of ids(['/me/reports', '/coach/reports', '/admin/reports']).filter((v) => v.startsWith('rpt_')).slice(0, 6)) {
        const t = await c.post(`/api/reports/${id}/file-token`);
        if (t.status !== 200) continue;
        const res = await client(h.app).get(`/api/reports/file?token=${encodeURIComponent(String(t.json.token))}`);
        check(role, '/reports/file', res);
        if (res.status === 200) out.reportDocs.push(pageText(res.text));
        if (out.reportDocs.length >= 2) break;
      }
      const billingList = role === 'member' ? '/me/billing' : '/admin/billing/documents';
      const billingToken = role === 'member' ? (id: string) => `/api/me/billing/documents/${id}/file-token` : (id: string) => `/api/admin/billing/documents/${id}/file-token`;
      for (const id of ids([billingList]).filter((v) => /^[a-z]+_/.test(v)).slice(0, 12)) {
        const t = await c.post(billingToken(id));
        if (t.status !== 200) continue;
        const res = await client(h.app).get(String(t.json.url));
        check(role, '/billing/documents/file', res);
        if (res.status === 200) { out.billingDocs.push(pageText(res.text)); break; }
      }
    }
    return out;
  })();
  return scanned;
}

test('every GET response, for every role, is free of demo and sample', async () => {
  const r = await scanApi();
  if (process.env.SCAN_DEBUG) console.log(JSON.stringify({ requests: r.requests, ok: r.ok, perRole: r.perRole, billing: r.billingDocs.length, reports: r.reportDocs.length, found: r.found }, null, 1));
  assert.ok(r.requests > 1000, `${r.requests} requests`);
  assert.ok(r.ok > 300, `${r.ok} answered 200`);
  for (const role of ['member', 'coach', 'admin', 'owner']) {
    assert.ok(r.perRole[role]!.ok > 60, `${role}: ${r.perRole[role]!.ok} answered 200`);
    assert.ok(r.perRole[role]!.paramOk > (role === 'member' ? 10 : 20), `${role}: ${r.perRole[role]!.paramOk} detail routes reached`);
  }
  assert.deepEqual(r.found, [], 'API text a viewer reads: notes, messages, labels and errors');
  // the simulated note stays where the owner kept it
  assert.ok(r.billingDocs.length >= 2, 'a billing document was opened as the member and as an administrator');
  for (const d of r.billingDocs) assert.match(d, /Simulated payment/, 'the billing document keeps its small simulated note');
  assert.ok(r.reportDocs.length >= 3, 'a printable lab report was opened as the member, the coach and an administrator');
});

test('the practice laboratory keeps one small plain note: on the printable lab report and in its placeholder file', async () => {
  const r = await scanApi();
  for (const d of r.reportDocs) {
    assert.match(d, /Practice laboratory: no sample was collected/, 'the printable lab report keeps a small practice laboratory note');
    assert.doesNotMatch(visible(d), LABEL);
  }
  // styled like the billing document's simulated note: small and plain, no pill
  const reportSrc = fs.readFileSync(path.join(API_DIR, 'src', 'http', 'report-document.ts'), 'utf8');
  assert.match(reportSrc, /\.simulated\{position:absolute;top:8mm;right:18mm;font-size:8pt;color:#6B655D\}/);
  assert.doesNotMatch(reportSrc, /\.sample\{|border-radius:999px;background:#FFE4A8/, 'no pill');
  // the practice laboratory's placeholder report file (src/adapters/labstack/standin.ts)
  const placeholder = await h.services.vendor.fetchReport('standin://report/round8.pdf');
  assert.ok(placeholder, 'the practice laboratory serves its placeholder');
  assert.equal(placeholder.bytes.toString('utf8'), 'Practice laboratory placeholder for standin://report/round8.pdf. Not a real report.');
  // the integrations page: private file storage on local disk, outside production
  const admin = client(h.app);
  await admin.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true);
  const items = (await admin.get('/api/admin/integrations')).json.items as Array<{ key: string; note?: string }>;
  assert.equal(items.find((i) => i.key === 'storage')?.note, 'Local disk outside every public folder (not for production); files open only through 5-minute tokens.');
});

test('the seeded accounts, packages and coupon read as plain records', async () => {
  const name = (email: string) => h.db.get<{ name: string }>('SELECT name FROM users WHERE email = ?', [email])!.name;
  assert.equal(name(DEMO.owner), 'Bioptime owner');
  assert.equal(name(DEMO.admin), 'Operations admin');
  const pk = await client(h.app).get('/api/packages');
  assert.equal(pk.status, 200);
  for (const p of pk.json.items as Array<{ name: string; description: string; version: { includes: string[] } | null }>) {
    assert.doesNotMatch(`${p.name} ${p.description} ${(p.version?.includes ?? []).join(' ')}`, LABEL, p.name);
    assert.ok(!(p.version?.includes ?? []).some((i) => /commercial decision/i.test(i)), 'no label posing as an inclusion');
  }
  const coupon = h.db.get<{ code: string; note: string }>('SELECT code, note FROM coupons')!;
  assert.equal(coupon.code, 'WELCOME10');
  assert.match(coupon.note, /not a commercial decision/, 'the coupon still says it is not a commercial decision, without the word demo');
});

test('GET /public/config carries no sign-in hint and no password', async () => {
  const r = await client(h.app).get('/api/public/config');
  assert.equal(r.status, 200);
  assert.ok(!('demoHint' in r.json), 'demoHint is left out entirely');
  const text = JSON.stringify(r.json);
  assert.ok(!text.includes(DEMO_PASSWORDS.member) && !/Demo-(Member|Coach|Admin|Owner)-2026/.test(text), 'no password in a public response');
  assert.ok(!/@demo\.bioptime\.test/.test(text), 'no account named');
  assert.equal(r.json.demo, true, 'the mode flag stays for the clients (they show the simulated notes)');
});

test('the invite notes an administrator reads do not say demo', async () => {
  const admin = client(h.app);
  await admin.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true);
  const m = await admin.post('/api/admin/members/invite', { email: 'round8.invited.member@demo.bioptime.test', name: 'Invited Member', reason: 'test: invite' });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  assert.equal(m.json.note, 'The activation link is also in the outbox.');
  const c = await admin.post('/api/admin/coaches/invite', { email: 'round8.invited.coach@demo.bioptime.test', displayName: 'Invited Coach' });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.doesNotMatch(String(c.json.note), /demo/i);
  assert.ok(c.json.token, 'demo mode still returns the token, as before');
});

test('the wellness score reads estimate, never the column’s old default sample, on the profile and in the data export', () => {
  const id = userId(h.ctx, DEMO.member);
  assert.equal(members.getProfile(h.ctx, id).profile.wellnessScoreLabel, 'estimate');
  // a row written before the seed set the label (or by a registration, which takes the column default) reads the same
  h.db.run("UPDATE member_profiles SET wellness_score_label = 'sample' WHERE user_id = ?", [id]);
  try {
    assert.equal(members.getProfile(h.ctx, id).profile.wellnessScoreLabel, 'estimate');
    const archive = buildArchive(h.ctx, id, 'drq_round8_wellness_label');
    assert.equal((archive.sections.profile as { wellness_score_label?: unknown } | null)?.wellness_score_label, 'estimate');
  } finally { h.db.run("UPDATE member_profiles SET wellness_score_label = 'estimate' WHERE user_id = ?", [id]); }
});

test('the constants read while the registry loads come from files that import nothing, and match what the routes use', () => {
  assert.equal(ROUTE_FROM_CONSTANTS, ROUTE_FROM_ROUTES, 'the route file re-exports the constant');
  const [docMethod, docPath] = ROUTE_FROM_CONSTANTS.split(' ');
  const docRoute = registeredRoutes().find((r) => r.method === docMethod && r.path === docPath);
  assert.ok(docRoute, 'the ungated document link is a route the billing route file registers');
  assert.equal(docRoute.feature, undefined, 'it declares no flag (it checks billing itself, as the token holder)');
  const billingRouteSrc = fs.readFileSync(path.join(API_DIR, 'src', 'http', 'routes', 'billing.ts'), 'utf8');
  assert.match(billingRouteSrc, /import \{ BILLING_FEATURE, DOCUMENT_FILE_ROUTE \} from '\.\.\/\.\.\/domain\/billingConstants\.js';/);
  assert.doesNotMatch(billingRouteSrc, /DOCUMENT_FILE_ROUTE = '/, 'the string is not declared a second time');
  assert.deepEqual(billingModule.ungated, [ROUTE_FROM_CONSTANTS]);
  assert.equal(BILLING_FEATURE, 'billing');
  assert.equal(billingModule.feature, BILLING_FEATURE);
  assert.ok(progressModule.fileAccess?.[PHOTO_FILE_KIND], 'the progress module resolves its photo files');
  assert.deepEqual([...help.HELP_AUDIENCES], ['member', 'coach', 'all']);
  assert.ok(help.SLUG_RE.test('asking-for-help'));
  for (const leaf of ['progressConstants.ts', 'billingConstants.ts', 'helpConstants.ts', 'growthConstants.ts']) {
    const src = fs.readFileSync(path.join(API_DIR, 'src', 'domain', leaf), 'utf8');
    assert.ok(!/^import(?! type)/m.test(src), `${leaf} has no runtime import`);
  }
});

/** Imports one file as the first module of a fresh process; resolves with the exit code and stderr. */
function importFirst(rel: string): Promise<{ rel: string; status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const url = pathToFileURL(path.join(API_DIR, rel)).href;
    const child = spawn(process.execPath, ['--import', 'tsx', '-e', `const m = await import(${JSON.stringify(url)}); console.log('imported', Object.keys(m).length);`], { cwd: API_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('close', (status) => { clearTimeout(timer); resolve({ rel, status, stdout, stderr }); });
  });
}

test('every domain, route, http and module file imports cleanly as the first module of a fresh process', async () => {
  // api/modules/*.ts too: the registry builds its list on first use, not while it loads
  const dirs = ['src/domain', 'src/http/routes', 'src/http', 'src/modules'];
  // api/domain/referrals.ts loads the registry, which loads the referrals route file, which reads REFERRAL_FEATURE from
  // api/domain/referrals.ts while it loads: for the referrals owner to move to a leaf file, as growth did
  const inProgress = /^$/; // every file now loads first in a fresh process
  const files = dirs.flatMap((d) => fs.readdirSync(path.join(API_DIR, d)).filter((f) => f.endsWith('.ts')).map((f) => `${d}/${f}`)).filter((f) => !inProgress.test(f));
  assert.ok(files.length > 80, `${files.length} files`);
  for (const must of ['src/domain/progress.ts', 'src/domain/billing.ts', 'src/domain/help.ts', 'src/http/routes/billing.ts', 'src/http/routes/support.ts', 'src/domain/growth.ts', 'src/http/routes/growth.ts', 'src/http/routes/referrals.ts', 'src/modules/index.ts', 'src/modules/growth.ts', 'src/modules/referrals.ts', 'src/modules/billing.ts']) assert.ok(files.includes(must), must);
  // only files that start nothing when imported (never the server or the command line, which open the database)
  assert.ok(!files.some((f) => /^src\/(server|cli)\.ts$/.test(f)));
  const results: Awaited<ReturnType<typeof importFirst>>[] = [];
  const queue = [...files];
  await Promise.all(Array.from({ length: 6 }, async () => { for (let f = queue.shift(); f; f = queue.shift()) results.push(await importFirst(f)); }));
  const failed = results.filter((r) => r.status !== 0 || !/imported \d+/.test(r.stdout) || /before initialization/.test(r.stderr));
  assert.deepEqual(failed.map((r) => `${r.rel}: ${(r.stderr.match(/\w*Error[^\n]*/) ?? [r.stderr.slice(0, 200)])[0]}`), []);
});
