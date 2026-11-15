/* Round 6, shared portal and app fixes: openLater (dashboard lib/ids.ts) opens documents in a new tab; the part switches
   on /admin/modules sit under their modules; quiet hours as the portal and the app set them, and what they really hold
   back; the data-export copy in both states of the support module; and the Modules page's statement of what switching a
   module off does, checked against the server. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import * as reminders from '../../src/domain/reminders.js';
import { sendReminders } from '../../src/domain/appointments.js';
import { setFlag } from '../../src/domain/features.js';
import { HABIT_REF, HABIT_REMINDER_CATEGORY } from '../../src/domain/habits.js';
import { MODULES, featureOf } from '../../src/modules/index.js';
import { handlersFor, processPending } from '../../src/domain/events.js';
import { emit } from '../../src/domain/audit.js';
import { PHOTO_CONSENT } from '../../src/domain/progress.js';
import { MODULE_KEYS } from '@bioptime/domain';

const PLATFORM = fileURLToPath(new URL('../../../../', import.meta.url));
const source = (rel: string) => fs.readFileSync(path.join(PLATFORM, rel), 'utf8');
/* the dashboard's own files, loaded as they are (a computed specifier keeps them out of the API's typecheck) */
const dashboard = (rel: string): Promise<any> => import(pathToFileURL(path.join(PLATFORM, 'apps/dashboard/src', rel)).href);

let h: Awaited<ReturnType<typeof makeApp>>;
let privateDir = '';
before(async () => {
  privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioptime-portal-shared-'));
  h = await makeApp({ env: { PRIVATE_FILES_DIR: privateDir } });
});
after(async () => {
  delete (globalThis as { window?: unknown }).window;
  await h.app.close();
  h.db.close();
  fs.rmSync(privateDir, { recursive: true, force: true });
});

const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const at = (iso: string): Ctx => ({ ...h.ctx, now: () => iso });
const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const channelsOf = (notificationId: string) => h.db.all<{ channel: string }>('SELECT channel FROM delivery_attempts WHERE notification_id = ? ORDER BY channel', [notificationId]).map((x) => x.channel);

/* ---------- openLater ---------- */

type Popup = { opener: unknown; closed: boolean; location: { href: string }; close(): void };
function fakeBrowser(opts: { blocked?: boolean } = {}) {
  const opened: unknown[][] = [];
  const assigned: string[] = [];
  const popup: Popup = { opener: { page: 'the portal' }, closed: false, location: { href: 'about:blank' }, close() { this.closed = true; } };
  (globalThis as { window?: unknown }).window = {
    open: (...args: unknown[]) => { opened.push(args); return opts.blocked ? null : popup; },
    location: { href: 'http://portalshared.localhost:5630/portal/client/reports/rpt_1', assign: (u: string) => { assigned.push(u); } },
  };
  return { opened, assigned, popup };
}
const settle = () => new Promise((r) => setImmediate(r));

test('openLater: the new tab opens during the click without noopener, is cut off from the portal, then loads the document', async () => {
  const { openLater } = await dashboard('lib/ids.ts');
  const b = fakeBrowser();
  let resolve!: (url: string) => void;
  const errors: unknown[] = [];
  openLater(() => new Promise<string>((r) => { resolve = r; }), (e: unknown) => errors.push(e));
  assert.equal(b.opened.length, 1, 'one tab, opened before the await');
  assert.ok(!b.opened[0]!.some((a) => typeof a === 'string' && a.includes('noopener')), 'noopener makes window.open return null, so it is not passed');
  assert.equal(b.popup.opener, null, 'the opener is cleared at once');
  assert.equal(b.popup.location.href, 'about:blank');
  resolve('/api/reports/file?token=abc');
  await settle();
  assert.equal(b.popup.location.href, 'http://portalshared.localhost:5630/api/reports/file?token=abc', 'the document loads in the new tab, on this site');
  assert.deepEqual(b.assigned, [], 'the portal tab stays where it is');
  assert.deepEqual(errors, []);
});

test('openLater: a blocked popup opens the document here; a failure closes the empty tab; a tab already closed stays closed', async () => {
  const { openLater } = await dashboard('lib/ids.ts');
  let b = fakeBrowser({ blocked: true });
  openLater(() => Promise.resolve('/api/billing/documents/file?token=t1'), () => assert.fail('no error'));
  await settle();
  assert.deepEqual(b.assigned, ['http://portalshared.localhost:5630/api/billing/documents/file?token=t1']);

  b = fakeBrowser();
  const errors: unknown[] = [];
  const boom = new Error('token refused');
  openLater(() => Promise.reject(boom), (e: unknown) => errors.push(e));
  await settle();
  assert.equal(b.popup.closed, true, 'the empty tab is not left behind');
  assert.deepEqual(errors, [boom]);
  assert.deepEqual(b.assigned, []);

  b = fakeBrowser();
  let resolve!: (url: string) => void;
  openLater(() => new Promise<string>((r) => { resolve = r; }), () => assert.fail('no error'));
  b.popup.close();
  resolve('/api/reports/file?token=late');
  await settle();
  assert.equal(b.popup.location.href, 'about:blank');
  assert.deepEqual(b.assigned, [], 'closing the tab while it loaded does not move the portal');
});

test('openLater: every caller hands it a loader that returns this site’s path and an error handler', () => {
  for (const file of ['apps/dashboard/src/pages/Report.tsx', 'apps/dashboard/src/pages/client/ClientReport.tsx', 'apps/dashboard/src/modules/billing/shared.tsx', 'apps/dashboard/src/modules/messaging/shared.tsx', 'apps/dashboard/src/modules/support/HelpCentre.tsx', 'apps/dashboard/src/modules/nutrition/shared.tsx']) {
    const s = source(file);
    assert.match(s, /import \{ openLater \} from '\.\.\/(\.\.\/)?lib\/ids'/, file);
    assert.match(s, /openLater\(\(\) => api\.post<\{ (token|url): string \}>\(/, file);
  }
  assert.ok(!/window\.open\('', '_blank', 'noopener'\)/.test(source('apps/dashboard/src/lib/ids.ts')));
  // the data export download (HelpCentre) and the meal photos (nutrition/shared.tsx) no longer open their link after an
  // await with window.open(url, '_blank', 'noopener'), which a popup blocker stops without a word; nothing else does
  const dir = path.join(PLATFORM, 'apps/dashboard/src');
  const files = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
  assert.deepEqual(files.filter((f) => /window\.open\([^)]*'noopener'/.test(fs.readFileSync(path.join(dir, f), 'utf8'))), [], 'no window.open with noopener in the portal');
  // the meal photo helper keeps its promise: its callers' catch shows the error in a toast
  assert.match(source('apps/dashboard/src/modules/nutrition/shared.tsx'), /export function openPrivateFile\(fileId: string\): Promise<void>/);
  assert.match(source('apps/dashboard/src/modules/support/HelpCentre.tsx'), /\(err\) => toast\(errorText\(err\), 'error'\)/);
});

/* ---------- /admin/modules: part switches ---------- */

test('modules page: each part switch is listed under its module, right after the module’s own switch', async () => {
  const mf = await dashboard('pages/admin/moduleFlags.ts');
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const r = await owner.get('/api/admin/modules');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const flags = r.json.flags as Array<{ key: string; module: string | null; description: string }>;
  // every switch the migrations describe as a module part is placed, under a module switch that exists
  const parts = flags.filter((f) => /^M\d+ part:/.test(f.description)).map((f) => f.key).sort();
  assert.deepEqual(parts, [...(mf.PART_FLAGS as Map<string, string>).keys()].sort());
  assert.deepEqual(Object.fromEntries(mf.PART_FLAGS), { support_requests: 'support', help_centre: 'support', imports: 'support', public_webinars: 'sessions' });
  for (const [, m] of mf.PART_FLAGS as Map<string, string>) assert.ok(flags.some((f) => f.key === m && f.module === m), `${m} is a module switch`);

  const sorted = mf.sortFlags(flags, [...MODULE_KEYS]) as typeof flags;
  const keys = sorted.map((f) => f.key);
  const s = keys.indexOf('support'), w = keys.indexOf('sessions');
  assert.deepEqual(keys.slice(s, s + 4), ['support', 'help_centre', 'imports', 'support_requests']);
  assert.deepEqual(keys.slice(w, w + 2), ['sessions', 'public_webinars']);
  assert.deepEqual(keys.filter((k) => (MODULE_KEYS as readonly string[]).includes(k)), [...MODULE_KEYS], 'modules keep the registry order');
  const outside = sorted.findIndex((f) => mf.moduleOfFlag(f) === null);
  assert.ok(outside > 0 && sorted.slice(outside).every((f) => mf.moduleOfFlag(f) === null), 'switches outside the modules come last');
  assert.ok(sorted.slice(outside).some((f) => f.key === 'bespoke'));
  assert.equal(mf.isPartFlag({ key: 'support', module: 'support' }), false);
  assert.equal(mf.isPartFlag({ key: 'constructor', module: null }), false);

  // "In the portal" for a stored switch outside the modules: every one the portal reads directly is described
  const dir = path.join(PLATFORM, 'apps/dashboard/src');
  const files = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
  const read = new Set(files.flatMap((f) => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/features\??\.has\('([A-Za-z_]+)'\)/g)].map((m) => m[1]!)));
  const stored = flags.filter((f) => mf.moduleOfFlag(f) === null).map((f) => f.key);
  assert.deepEqual(stored.filter((k) => read.has(k)).sort(), [...(mf.STORED_SWITCH_READS as Map<string, string>).keys()].sort());
});

test('modules page: a part switch really needs its module’s switch too', async () => {
  const owner = as(DEMO.owner);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  assert.equal((await member.get('/api/help/articles')).status, 200);
  setFlag(owner, 'support', { enabled: false }, 'test: module off, part on');
  try {
    const r = await member.get('/api/help/articles');
    assert.equal(r.json.error?.code, 'FEATURE_DISABLED');
    assert.equal((r.json.error?.details as { feature?: string }).feature, 'support');
  } finally { setFlag(owner, 'support', { enabled: true }, 'test: module on again'); }
  setFlag(owner, 'help_centre', { enabled: false }, 'test: part off');
  try { assert.equal((await member.get('/api/help/articles')).json.error?.code, 'FEATURE_DISABLED'); }
  finally { setFlag(owner, 'help_centre', { enabled: true }, 'test: part on again'); }

  // the switch-on dialog says so: a part switched on while its module is off brings nothing back by itself
  const page = source('apps/dashboard/src/pages/admin/Modules.tsx');
  assert.ok(page.includes("This switch alone brings nothing back: what it covers also needs ${m} switched on, and ${m} is off now. Until ${m} is on too, its server routes keep refusing requests${read ? ' and the portal keeps hiding it' : ''}."));
  assert.ok(page.includes('What it covers in ${m} works again for the people both this switch and ${m} reach: its server routes answer and the portal shows what needs it (${inPortal}); a portal already open may show it only once it is reloaded.'));
  // and it speaks of the portal only for a part the portal reads, by the same test as the "In the portal" column
  assert.ok(page.includes('const inPortal = partPortalParts(moduleOfFlag(f), f.key);') && page.includes('const read = inPortal !== NOT_READ;'));
  assert.ok(page.includes('What it covers in ${m} works again for the people both this switch and ${m} reach: its server routes answer. No portal page reads this switch, so the portal looks the same either way.'));
  assert.ok(page.includes("${read ? '' : ' No portal page reads this switch, so the portal looks the same either way.'}"));
  assert.ok(page.includes(") || NOT_READ;") && page.includes('STORED_SWITCH_READS.get(f.key) ?? NOT_READ'), 'one wording for the column and the dialog');
  // which parts the portal reads: a page, link, tab or card that names it, or a features check in a page. Support's three
  // parts are; public_webinars is not (the public listing is GET /public/webinars, which no portal page reads)
  const mfParts = (await dashboard('pages/admin/moduleFlags.ts')).PART_FLAGS as Map<string, string>;
  const dashDir = path.join(PLATFORM, 'apps/dashboard/src');
  const portalSource = (fs.readdirSync(dashDir, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && f !== path.join('pages', 'admin', 'moduleFlags.ts')).map((f) => fs.readFileSync(path.join(dashDir, f), 'utf8')).join('\n');
  const readParts = [...mfParts.keys()].filter((k) => portalSource.includes(`'${k}'`) || portalSource.includes(`"${k}"`));
  assert.deepEqual(readParts.sort(), ['help_centre', 'imports', 'support_requests']);
  const declaresFeature = [...mfParts.keys()].filter((k) => portalSource.includes(`feature: '${k}'`));
  assert.deepEqual(declaresFeature.sort(), ['help_centre', 'imports', 'support_requests'], 'every part the portal reads also names a page, link, tab or card, so its column is not "Not read by the portal"');
  // and the public webinar routes answer only while both switches are on, whatever the portal shows
  const visitor = client(h.app);
  const flagWas = (key: string) => h.db.get<{ enabled: number }>('SELECT enabled FROM feature_flags WHERE key = ?', [key])?.enabled === 1;
  const sessionsWere = flagWas('sessions'), publicWere = flagWas('public_webinars');
  try {
    setFlag(owner, 'sessions', { enabled: true }, 'test: module on');
    setFlag(owner, 'public_webinars', { enabled: true }, 'test: part on');
    assert.equal((await visitor.get('/api/public/webinars')).status, 200, 'both on: the listing answers');
    setFlag(owner, 'sessions', { enabled: false }, 'test: module off, part on');
    const off = await visitor.get('/api/public/webinars');
    assert.equal(off.json.error?.code, 'FEATURE_DISABLED');
    assert.equal((off.json.error?.details as { feature?: string }).feature, 'sessions', 'the part alone brings nothing back');
    setFlag(owner, 'sessions', { enabled: true }, 'test: module on, part off');
    setFlag(owner, 'public_webinars', { enabled: false }, 'test: module on, part off');
    const partOff = await visitor.get('/api/public/webinars');
    assert.equal((partOff.json.error?.details as { feature?: string }).feature, 'public_webinars');
  } finally {
    setFlag(owner, 'sessions', { enabled: sessionsWere }, 'test: as it was');
    setFlag(owner, 'public_webinars', { enabled: publicWere }, 'test: as it was');
  }
  // and switching a module on leaves its parts that are off, and the stored switches that narrow it, off: progressPhotos
  // narrows Progress the way a part does (the photo routes check it on top of the module's switch)
  const mf = await dashboard('pages/admin/moduleFlags.ts');
  assert.deepEqual(Object.fromEntries(mf.STORED_SWITCH_NARROWS), { progressPhotos: 'progress' });
  assert.ok(page.includes('STORED_SWITCH_NARROWS.get(x.key) === f.module') && page.includes("isPartFlag(x) ? moduleOfFlag(x) === f.module"), 'the module switch-on dialog names them');
  const photosWere = h.db.get<{ enabled: number }>("SELECT enabled FROM feature_flags WHERE key = 'progressPhotos'")?.enabled === 1;
  setFlag(owner, 'progressPhotos', { enabled: false }, 'test: stored switch off, module on');
  try {
    assert.equal((await member.get('/api/me/progress/photos')).status, 200, 'the module answers');
    const up = await member.post('/api/me/progress/photos', { dataBase64: Buffer.from('x').toString('base64'), pose: 'front' });
    assert.equal(up.json.error?.code, 'FEATURE_DISABLED');
    assert.equal((up.json.error?.details as { feature?: string }).feature, 'progressPhotos', 'what the stored switch covers stays off');
  } finally { setFlag(owner, 'progressPhotos', { enabled: photosWere }, 'test: photos as they were'); }
});

/* ---------- client-record billing: following the cursor ---------- */

test('client-record billing: one member’s documents and refund requests page through the cursor the tab follows, nothing skipped or repeated', async () => {
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const memberId = userId(h.ctx, DEMO.member);
  // the tab's own walk: limit 1 makes every row a page of its own, so rows that share a time cross a page boundary
  const walk = async (base: string) => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 500; i++) {
      const r = await admin.get(`${base}${base.includes('?') ? '&' : '?'}limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      seen.push(...(r.json.items as Array<{ id: string }>).map((x) => x.id));
      cursor = r.json.nextCursor as string | null;
      if (!cursor) return seen;
      assert.match(cursor, /~/, 'the "<time>~<id>" cursor');
    }
    return assert.fail('the cursor never ended');
  };
  // (ties in time are billing.test.ts's own check; here, the walk the portal makes reaches every row once)
  const all = await admin.get('/api/admin/billing/documents?limit=200');
  const allIds = (all.json.items as Array<{ id: string }>).map((d) => d.id);
  assert.ok(allIds.length >= 2, 'the demo has documents to page through');
  assert.equal(all.json.nextCursor, null);
  assert.deepEqual(await walk('/api/admin/billing/documents'), allIds);
  const docs = await admin.get(`/api/admin/billing/documents?memberId=${memberId}&limit=200`);
  const docIds = (docs.json.items as Array<{ id: string; memberId: string }>).map((d) => d.id);
  assert.ok(docIds.length >= 1, 'the demo member has a document');
  assert.deepEqual(await walk(`/api/admin/billing/documents?memberId=${memberId}`), docIds);
  // the demo seeds no refund requests: the member asks, withdraws and asks again, so the walk crosses a page boundary
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const paidOrder = h.db.get<{ order_id: string }>("SELECT order_id FROM billing_documents WHERE member_id = ? AND kind = 'receipt' ORDER BY issued_at LIMIT 1", [memberId])!.order_id;
  const asked = await member.post(`/api/me/orders/${paidOrder}/refund-request`, { reason: 'Paging test, first ask' });
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  assert.equal((await member.post(`/api/me/refund-requests/${asked.json.id}/withdraw`)).json.status, 'withdrawn');
  const again = await member.post(`/api/me/orders/${paidOrder}/refund-request`, { reason: 'Paging test, second ask' });
  assert.equal(again.status, 201, JSON.stringify(again.json));
  try {
    const requests = await admin.get('/api/admin/refund-requests?limit=200');
    assert.equal(requests.status, 200, JSON.stringify(requests.json));
    const requestIds = (requests.json.items as Array<{ id: string }>).map((r) => r.id);
    assert.ok(requestIds.length >= 2, 'refund requests to page through');
    assert.deepEqual(await walk('/api/admin/refund-requests'), requestIds);
    const mine = (await admin.get(`/api/admin/refund-requests?memberId=${memberId}&limit=200`)).json.items as Array<{ id: string; memberId: string }>;
    assert.ok(mine.length >= 2 && mine.every((r) => r.memberId === memberId), 'memberId narrows the list to the member');
    assert.deepEqual(await walk(`/api/admin/refund-requests?memberId=${memberId}`), mine.map((r) => r.id));
  } finally { await member.post(`/api/me/refund-requests/${again.json.id}/withdraw`); }

  // and the tab follows it: every page of the documents (they decide what an order is missing), Load more for orders
  // and refund requests, with the same helper as /admin/billing
  const tab = source('apps/dashboard/src/modules/billing/ClientRecordBilling.tsx');
  assert.ok(tab.includes('allPages((cursor) => api.get<Page<BillingDoc>>(`/admin/billing/documents${qs({ memberId, limit: DOC_PAGE, cursor })}`), DOC_PAGES)'));
  assert.ok(tab.includes('useMorePages(requests.data, (cursor) => api.get<Page<RefundRequest>>(requestsPath(cursor)))') && tab.includes('useMorePages(orders.data, (cursor) => api.get<Page<Order>>(ordersPath(cursor)))'));
  assert.equal((tab.match(/>Load more<\/Button>/g) ?? []).length, 2);
  assert.ok(tab.includes('return allDocs && ('), 'no order is offered missing documents while some are not loaded');
  assert.match(source('apps/dashboard/src/modules/billing/AdminBilling.tsx'), /import \{ useMorePages, type Page \} from '\.\/morePages'/);
  // an older order whose documents were not loaded is not said to have none
  assert.ok(tab.includes(": allDocs ? <p className=\"muted small\">No documents: paid while billing documents were switched off.</p> : <p className=\"muted small\">"));
});

/* ---------- Messages: a refused conversation list; Workouts: Open for a client who does not share ---------- */

test('messages: an administrator without members.manage is refused the conversation list, and the list card says so', async () => {
  const adminId = userId(h.ctx, DEMO.admin);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  assert.equal((await admin.get('/api/conversations')).status, 200, 'with members.manage the list answers');
  const row = h.db.get<{ granted: number; reason: string | null; updated_at: string }>("SELECT granted, reason, updated_at FROM user_permissions WHERE user_id = ? AND permission = 'members.manage'", [adminId]);
  h.db.run("INSERT INTO user_permissions (user_id, permission, granted, reason, updated_at, updated_by) VALUES (?, 'members.manage', 0, 'portalShared test', ?, NULL) ON CONFLICT(user_id, permission) DO UPDATE SET granted = 0", [adminId, new Date().toISOString()]);
  try {
    const r = await admin.get('/api/conversations');
    assert.equal(r.status, 403);
    assert.equal(r.json.error?.code, 'PERMISSION_DENIED');
  } finally {
    if (row) h.db.run("UPDATE user_permissions SET granted = ?, reason = ?, updated_at = ? WHERE user_id = ? AND permission = 'members.manage'", [row.granted, row.reason, row.updated_at, adminId]);
    else h.db.run("DELETE FROM user_permissions WHERE user_id = ? AND permission = 'members.manage'", [adminId]);
  }
  assert.equal((await admin.get('/api/conversations')).status, 200, 'and answers again once the permission is back');
  // the list card shows the error with the existing Alert, not an empty list
  assert.ok(source('apps/dashboard/src/pages/Messages.tsx').includes('<Card dense>{convs.error ? <Alert kind="error">{convs.error}</Alert> : convs.loading && !convs.data ? <Skeleton /> : list.length ?'));
});

test('workouts tab: a coach whose client does not share health data gets Open, not Review, as on the Today card', async () => {
  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach);
  const deepa = await meera.get(`/api/coach/clients/${userId(h.ctx, DEMO.memberNoShare)}/workouts`);
  assert.equal(deepa.status, 200, JSON.stringify(deepa.json));
  assert.equal(deepa.json.healthShared, false, 'Deepa does not share with her coach');
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const ananya = await asha.get(`/api/coach/clients/${userId(h.ctx, DEMO.member)}/workouts`);
  assert.equal(ananya.status, 200, JSON.stringify(ananya.json));
  assert.equal(ananya.json.healthShared, true);
  const tab = source('apps/dashboard/src/modules/workouts/WorkoutsTab.tsx');
  assert.ok(tab.includes('const health = d.healthShared !== false;'));
  assert.ok(tab.includes("{isPrivileged ? 'View' : health ? 'Review' : 'Open'}</Button>"));
});

/* ---------- quiet hours ---------- */

test('quiet hours: the form’s values round-trip through the API, are audited, and clear again', async () => {
  const q = await dashboard('pages/client/quietHours.ts');
  assert.deepEqual(q.quietHoursBody('22:00', '07:00'), { startMinute: 1320, endMinute: 420 });
  assert.equal(q.quietHoursBody('07:00', '07:00'), null, 'equal ends would mean none, so the form refuses them');
  assert.equal(q.quietHoursBody('7:00', '08:00'), null);
  assert.equal(q.quietHoursBody('', ''), null);
  assert.equal(q.quietHoursBody('24:00', '06:00'), null);
  assert.equal(q.minuteToClock(0), '00:00');
  assert.equal(q.minuteToClock(1439), '23:59');
  assert.equal(q.minuteToClock(1440), '');
  assert.equal(q.minuteToClock(null), '');
  assert.equal(q.zoneName('Asia/Kolkata'), 'India Standard Time');
  assert.equal(q.zoneName(''), 'India Standard Time');

  const memberId = userId(h.ctx, DEMO.memberNoShare);
  const c = await signedIn(DEMO.memberNoShare, DEMO_PASSWORDS.member);
  assert.equal(q.savedQuietHours((await c.get('/api/notification-preferences')).json), null, 'none to begin with');
  const put = await c.put('/api/notification-preferences/quiet-hours', q.quietHoursBody('22:30', '06:45'));
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const saved = q.savedQuietHours((await c.get('/api/notification-preferences')).json);
  assert.deepEqual(saved, { start: 1350, end: 405 });
  assert.equal(`${q.minuteToClock(saved.start)} to ${q.minuteToClock(saved.end)}`, '22:30 to 06:45');
  const audit = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'notification_preferences.quiet_hours' AND target_id = ?", [memberId])!;
  assert.equal(audit.n, 1);
  const profile = await c.get('/api/me/profile');
  assert.equal(q.zoneName((profile.json.profile as { timezone?: string }).timezone), 'India Standard Time', 'the zone the server reads the window in');

  assert.equal((await c.put('/api/notification-preferences/quiet-hours', { startMinute: null, endMinute: null })).status, 200);
  assert.equal(q.savedQuietHours((await c.get('/api/notification-preferences')).json), null, 'Turn off clears them');
  // the app keeps its own copy of these helpers; it must agree with the portal's
  const app = source('apps/mobile/src/app/notifications.tsx');
  assert.ok(app.includes("api('PUT', '/notification-preferences/quiet-hours'"));
  assert.ok(app.includes('const CLOCK_RE = /^([01]\\d|2[0-3]):([0-5]\\d)$/;') && source('apps/dashboard/src/pages/client/quietHours.ts').includes('export const CLOCK_RE = /^([01]\\d|2[0-3]):([0-5]\\d)$/;'));
});

test('quiet hours hold back what the copy says: queued reminders go in-app only with no email; consultation reminders still arrive by email', async () => {
  const memberId = userId(h.ctx, DEMO.member);
  const c = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const appt = h.db.get<{ id: string; start_at: string }>("SELECT id, start_at FROM appointments WHERE member_id = ? AND status = 'scheduled' AND reminder_sent_at IS NULL ORDER BY start_at LIMIT 1", [memberId]);
  assert.ok(appt, 'the demo member has a scheduled consultation');
  const now = new Date(Date.parse(appt!.start_at) - 24 * 3_600_000).toISOString();
  // a quiet window around that moment, in the member's own zone
  const m = reminders.localMinute(now, reminders.timezoneOf(h.ctx, memberId));
  assert.equal((await c.put('/api/notification-preferences/quiet-hours', { startMinute: (m + 1410) % 1440, endMinute: (m + 30) % 1440 })).status, 200);
  assert.equal(reminders.inQuietHours(h.ctx, memberId, now), true);
  try {
    // a live session reminder (in-app, email and push) falling due inside quiet hours: in-app only, never sent again
    const id = reminders.schedule(h.ctx, { userId: memberId, refType: 'portal_shared_probe', refId: 'p1', dueAt: now, category: 'session_reminder', title: 'Sample session', body: 'Starts soon.', channels: ['in_app', 'email', 'push'] });
    reminders.dispatchDue(at(now)); // other demo reminders due by then go out too; only this one is checked
    const row = h.db.get<{ status: string; notification_id: string }>('SELECT status, notification_id FROM reminders WHERE id = ?', [id])!;
    assert.equal(row.status, 'sent');
    assert.deepEqual(channelsOf(row.notification_id), ['in_app'], 'shown in the portal and the app, with no email for it');
    assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM outbox_messages WHERE notification_id = ?", [row.notification_id])!.n, 0);
    reminders.dispatchDue(at(new Date(Date.parse(now) + 3 * 3_600_000).toISOString()));
    assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND json_extract(data, '$.reminderId') = ?", [memberId, id])!.n, 1, 'not sent again after quiet hours end');

    // the consultation reminder is sent directly, not through the queue: quiet hours do not touch it
    assert.ok(sendReminders(at(now)) >= 1);
    const n = h.db.get<{ id: string }>("SELECT id FROM notifications WHERE user_id = ? AND category = 'appointment_reminder' ORDER BY created_at DESC LIMIT 1", [memberId])!;
    assert.ok(channelsOf(n.id).includes('email'), 'consultation reminders arrive as usual');
  } finally {
    await c.put('/api/notification-preferences/quiet-hours', { startMinute: null, endMinute: null });
  }
  for (const file of ['apps/dashboard/src/pages/client/Profile.tsx', 'apps/mobile/src/app/notifications.tsx']) {
    const s = source(file);
    assert.ok(s.includes('Habit, check-in, blood test preparation and live session reminders that fall due inside your quiet hours'), file);
    assert.ok(s.includes('with no email, and are not sent again afterwards'), file);
    assert.ok(s.includes('including consultation reminders, messages from your coach, results and security messages'), file);
  }
});

test('quiet hours copy names every source of queued reminders', () => {
  // the reminder queue's callers: habits (habit reminders), progress (check-ins), lab follow-ups (test preparation), sessions
  const callers = fs.readdirSync(path.join(PLATFORM, 'apps/api/src/domain')).filter((f) => /reminders\.(schedule|replace)\(/.test(source(`apps/api/src/domain/${f}`)) && f !== 'reminders.ts').sort();
  assert.deepEqual(callers, ['habits.ts', 'labFollowups.ts', 'progress.ts', 'sessions.ts'], 'a new caller means the quiet-hours copy in the portal and the app needs another look');
  // inside quiet hours the queue keeps only the in-app channel and skips a reminder that has none (dispatchDue); the
  // copy says these reminders appear in the portal and the app, so every caller must queue them with in-app
  for (const f of callers) {
    for (const call of source(`apps/api/src/domain/${f}`).split('\n').filter((l) => /reminders\.(schedule|replace)\(/.test(l))) {
      const channels = /channels: \[([^\]]*)\]/.exec(call);
      assert.ok(!channels || channels[1]!.includes("'in_app'"), `${f}: ${call.trim().slice(0, 120)} queues no in-app notification`);
    }
  }
});

/* ---------- your data: the copy in both states ---------- */

test('data export with the support module on: the team approves, the file is prepared, a notification says so, the member downloads it under Help and support', async () => {
  const memberId = userId(h.ctx, DEMO.member2);
  const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const r = await member.post('/api/me/data-requests', { kind: 'export' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = String(r.json.id);
  let mine = (await member.get('/api/me/data-exports')).json.items as Array<{ id: string; status: string; file: unknown }>;
  assert.equal(mine.find((e) => e.id === id)?.status, 'requested');
  assert.equal(mine.find((e) => e.id === id)?.file, null, 'nothing to download until the team approves it');
  const g = await admin.post(`/api/admin/data-exports/${id}/generate`, { reason: 'test: approve the export' });
  assert.equal(g.status, 200, JSON.stringify(g.json));
  mine = (await member.get('/api/me/data-exports')).json.items as typeof mine;
  assert.ok(mine.find((e) => e.id === id)?.file, 'listed with its file under Your data export');
  const note = h.db.get<{ id: string; title: string }>("SELECT id, title FROM notifications WHERE user_id = ? AND category = 'support' ORDER BY created_at DESC LIMIT 1", [memberId])!;
  assert.equal(note.title, 'Your data export is ready');
  assert.equal((await member.post(`/api/me/data-requests/${id}/file-token`)).status, 200);

  const portal = source('apps/dashboard/src/pages/client/Profile.tsx'), app = source('apps/mobile/src/app/settings/data.tsx');
  assert.ok(portal.includes('<Link to="/help?tab=export">Help and support › Your data export</Link>'));
  assert.ok(app.includes("router.push('/help')") && app.includes('Help and support › Your data'));
  for (const s of [portal, app]) {
    assert.ok(!s.includes('prepared by the team and confirmed by email') && !s.includes('The team prepares it and confirms by email'), 'the export is not confirmed by email');
    assert.ok(s.includes('Once the Bioptime team approves'));
  }
  // the screens the copy points to exist under those names
  assert.ok(source('apps/dashboard/src/modules/support/HelpCentre.tsx').includes("{ id: 'export' as Tab, label: 'Your data export' }"));
  assert.ok(source('apps/dashboard/src/modules/support/module.tsx').includes("{ workspace: 'client', to: '/help', label: 'Help and support' }"));
  assert.ok(source('apps/mobile/src/app/help.tsx').includes("{ id: 'export', title: 'Your data' }"));
  assert.ok(source('apps/mobile/src/lib/modules/support.ts').includes("title: 'Help and support'") && source('apps/mobile/src/lib/modules/support.ts').includes("placement: 'me'"));
});

test('data export with the support module off: the request reaches the team’s queue and there is no download in the portal or the app', async () => {
  const memberId = userId(h.ctx, DEMO.memberNoCoach);
  const member = await signedIn(DEMO.memberNoCoach, DEMO_PASSWORDS.member);
  setFlag(as(DEMO.owner), 'support', { enabled: false }, 'test: support off');
  try {
    assert.ok(!((await member.get('/api/public/config')).json.features as string[]).includes('support'), 'the portal and the app see the module off');
    const asked = new Date().toISOString();
    const r = await member.post('/api/me/data-requests', { kind: 'export' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.status, 'requested');
    const task = h.db.get<{ title: string; status: string }>("SELECT title, status FROM support_tasks WHERE kind = 'data_request' AND ref_type = 'data_request' AND ref_id = ?", [String(r.json.id)]);
    assert.equal(task?.title, 'Data export requested', 'the team’s queue');
    assert.equal(task?.status, 'open');
    assert.equal((await member.get('/api/me/data-exports')).json.error?.code, 'FEATURE_DISABLED', 'no download list while the module is off');
    assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM outbox_messages o JOIN users u ON u.email = o.to_address WHERE u.id = ? AND o.created_at >= ?', [memberId, asked])!.n, 0, 'no email is sent about the request');
  } finally { setFlag(as(DEMO.owner), 'support', { enabled: true }, 'test: support on again'); }
  for (const s of [source('apps/dashboard/src/pages/client/Profile.tsx'), source('apps/mobile/src/app/settings/data.tsx')]) {
    assert.ok(s.includes('Bioptime team’s queue; the team prepares the copy. There is no download for it in the'));
  }
});

test('help article "Getting a copy of your data": it names the app’s path as the app draws it (Profile › Settings › Your data)', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const r = await member.get('/api/help/articles/copy-of-your-data');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const text = JSON.stringify(r.json);
  assert.ok(text.includes('Profile › Settings › Your data') && text.includes('in the app'), 'the app path (the Me tab became Profile)');
  assert.ok(!/Me › /.test(text), 'no Me tab any more');
  // the three names exist, in that order: the Profile tab, its Settings sub-tab and the Your data row and screen
  assert.ok(source('apps/mobile/src/fx/nav/tabs.ts').includes("{ name: 'profile', href: '/(tabs)/profile', label: 'Profile', icon: 'user' }"));
  assert.ok(source('apps/mobile/src/screens/profile/data.ts').includes("{ value: 'settings', label: 'Settings' }"));
  assert.ok(source('apps/mobile/src/screens/profile/Settings.tsx').includes(`title="Your data" sub="Ask for a copy of your data or for deletion" onPress={() => router.push('/settings/data')}`));
  assert.ok(source('apps/mobile/src/app/settings/data.tsx').includes('<Overlay kind="back" title="Your data"'));
});

/* ---------- /admin/modules: what switching a module off does ---------- */

test('modules page: the statement of what switching a module off does matches the server', async () => {
  const page = source('apps/dashboard/src/pages/admin/Modules.tsx');
  // jobs: only the privacy clean-up keeps running
  const keepRunning = MODULES.flatMap((m) => (m.jobs ?? []).filter((j) => j.runWhenDisabled).map((j) => `${m.key}.${j.name}`)).sort();
  assert.deepEqual(keepRunning, ['ai.draft_retention', 'growth.privacy_retention', 'habits.habit_followup_privacy', 'messaging.attachments_cleanup', 'progress.photo_retention']);
  // each is described in JOBS_WHILE_OFF, in registry order, and the page and the switch-off dialog say those sentences
  const mf = await dashboard('pages/admin/moduleFlags.ts');
  const jobsWhileOff = mf.JOBS_WHILE_OFF as Map<string, string>;
  assert.deepEqual([...jobsWhileOff.keys()].sort(), keepRunning, 'a module that adds or drops a job that runs while it is off needs its sentence changed');
  const jobModule = (k: string) => k.slice(0, k.indexOf('.'));
  assert.deepEqual([...jobsWhileOff.keys()].map(jobModule), MODULE_KEYS.filter((k) => keepRunning.some((j) => jobModule(j) === k)), 'listed in registry order');
  assert.equal(jobsWhileOff.get('habits.habit_followup_privacy'), 'coach follow-ups that name a habit the member wrote themselves are closed within minutes once the member stops sharing health information with their coach');
  assert.deepEqual(mf.jobsWhileOff('habits'), [jobsWhileOff.get('habits.habit_followup_privacy')]);
  assert.deepEqual(mf.jobsWhileOff('billing'), [], 'a module with no such job');
  const habitsJob = MODULES.find((m) => m.key === 'habits')!.jobs!.find((j) => j.name === 'habit_followup_privacy')!;
  assert.ok(habitsJob.everyMs <= 5 * 60_000, '"within minutes": the habits privacy job runs at least every five minutes');
  assert.equal(jobsWhileOff.get('messaging.attachments_cleanup'), 'files added to a message but not sent within 24 hours are deleted');
  assert.equal((await import('../../src/domain/attachments.js')).PENDING_TTL_HOURS, 24);
  assert.ok(page.includes("Its background jobs stop, except the clean-up that privacy needs, which keeps running: ${[...JOBS_WHILE_OFF].map(([key, what]) => `with ${moduleTitle(jobKeyModule(key))} off, ${what}`).join('; ')}.") && page.includes('${OFF_JOBS}'), 'the note under the switches');
  assert.ok(page.includes("except the clean-up that privacy needs, which keeps running: ${jobsWhileOff(f.module).join('; ')}"), 'the switch-off dialog of a module with such a job');
  // event handlers: no module asks for them while it is off (the next test checks what that means in practice)
  assert.deepEqual(MODULES.filter((m) => m.eventsWhenDisabled).map((m) => m.key), []);
  assert.ok(page.includes('Its event handlers do not run while it is off, and events dealt with in that time are not passed to them later.'));
  // routes: the ones still reachable are consent, deleting one’s own records, and the data export's file link
  const ungated = MODULES.flatMap((m) => m.ungated ?? []).sort();
  assert.deepEqual(ungated, ['DELETE /conversations/:id/attachments/:attachmentId', 'DELETE /me/meal-logs/:id', 'DELETE /me/meal-logs/:id/photo', 'DELETE /me/progress/photos/:id', 'GET /billing/documents/file', 'GET /me/ai/consent', 'GET /me/assistant', 'POST /me/ai/consent', 'POST /me/assistant/consent', 'POST /me/data-requests/:id/file-token', 'POST /me/progress/photos/consent', 'POST /public/newsletter/unsubscribe'].sort());
  assert.ok(page.includes('apart from the few that let people see or withdraw a consent or delete their own records, and the file links described below'));
  assert.ok(page.includes("a portal or app already open may keep showing some of them until it is reloaded, and the module's routes refuse what they ask for"));
  // the billing document route is listed as ungated but checks the billing switch itself: a real token, issued while
  // billing is on, is refused once billing is off
  const billingMember = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const doc = ((await billingMember.get('/api/me/billing')).json.documents as Array<{ id: string }>)[0];
  assert.ok(doc, 'the demo member has a billing document');
  const docToken = await billingMember.post(`/api/me/billing/documents/${doc!.id}/file-token`);
  assert.equal(docToken.status, 200, JSON.stringify(docToken.json));
  const docUrl = `/api/billing/documents/file?token=${encodeURIComponent(docToken.json.token as string)}`;
  assert.equal((await client(h.app).get(docUrl)).status, 200, 'the token works while billing is on');
  setFlag(as(DEMO.owner), 'billing', { enabled: false }, 'test: billing off');
  try { assert.equal((await client(h.app).get(docUrl)).json.error?.code, 'FEATURE_DISABLED'); }
  finally { setFlag(as(DEMO.owner), 'billing', { enabled: true }, 'test: billing on again'); }

  // reminders: what the page says must be what the reminder queue does with a module's reminder while the module is off
  const habit = h.db.get<{ id: string; member_id: string }>('SELECT id, member_id FROM habits ORDER BY created_at LIMIT 1');
  assert.ok(habit, 'the demo seed has a habit');
  const due = '2026-11-05T05:30:00.000Z'; // 11:00 in India, outside any quiet hours set here
  const id = reminders.schedule(h.ctx, { userId: habit!.member_id, refType: HABIT_REF, refId: habit!.id, dueAt: due, category: HABIT_REMINDER_CATEGORY, title: 'Habit reminder', body: 'Probe.', channels: ['in_app', 'push'] });
  setFlag(as(DEMO.owner), 'habits', { enabled: false }, 'test: habits off');
  let status = '';
  try {
    reminders.dispatchDue(at(due));
    status = h.db.get<{ status: string }>('SELECT status FROM reminders WHERE id = ?', [id])!.status;
  } finally { setFlag(as(DEMO.owner), 'habits', { enabled: true }, 'test: habits on again'); }
  assert.equal(status, 'skipped', 'a reminder of a module that is off is not delivered');
  assert.equal(h.db.get<{ skip_reason: string | null }>('SELECT skip_reason FROM reminders WHERE id = ?', [id])!.skip_reason, 'module_off');
  assert.ok(page.includes('The reminder queue skips its reminders while it is off, and they are not sent later; those due after it is back on go out as usual.'), 'the page says so');
  reminders.dispatchDue(at('2026-11-05T06:30:00.000Z'));
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM reminders WHERE id = ?', [id])!.status, 'skipped', 'not sent later, after the module is back on');
  const later = reminders.schedule(h.ctx, { userId: habit!.member_id, refType: HABIT_REF, refId: habit!.id, dueAt: '2026-11-05T07:30:00.000Z', category: HABIT_REMINDER_CATEGORY, title: 'Habit reminder', body: 'Probe.', channels: ['in_app', 'push'] });
  reminders.dispatchDue(at('2026-11-05T07:30:00.000Z'));
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM reminders WHERE id = ?', [later])!.status, 'sent', 'one due after it is back on goes out as usual');
  assert.ok(page.includes('apart from the few that let people see or withdraw a consent'));
});

test('modules page: event handlers do not run while their module is off, and events dealt with then are not passed to them later', async () => {
  const withEvents = MODULES.filter((m) => Object.keys(m.events ?? {}).length);
  assert.ok(withEvents.length > 0);
  for (const m of withEvents) {
    for (const [type, list] of Object.entries(m.events!)) {
      setFlag(as(DEMO.owner), featureOf(m), { enabled: false }, `test: ${m.key} off`);
      try { assert.ok(list.every((fn) => !handlersFor(h.ctx, type).includes(fn)), `${m.key} ${type}: not run while off`); }
      finally { setFlag(as(DEMO.owner), featureOf(m), { enabled: true }, `test: ${m.key} on again`); }
      assert.ok(list.every((fn) => handlersFor(h.ctx, type).includes(fn)), `${m.key} ${type}: run while on`);
    }
  }
  // in practice: a handler of messaging's, watched for the length of this test
  const messaging = MODULES.find((m) => m.key === 'messaging')!;
  const list = messaging.events!.AnnouncementPublished!;
  const seen: string[] = [];
  const spy = (_ctx: Ctx, e: { id: string }) => { seen.push(e.id); };
  list.push(spy);
  try {
    setFlag(as(DEMO.owner), 'messaging', { enabled: false }, 'test: messaging off');
    let whileOff = '';
    try {
      whileOff = emit(h.ctx, 'AnnouncementPublished', { type: 'announcement', id: 'ann_portal_shared_probe' }, { announcementId: 'ann_portal_shared_probe' });
      await processPending(h.ctx);
      assert.ok(h.db.get<{ processed_at: string | null }>('SELECT processed_at FROM domain_events WHERE id = ?', [whileOff])!.processed_at, 'dealt with while the module is off');
    } finally { setFlag(as(DEMO.owner), 'messaging', { enabled: true }, 'test: messaging on again'); }
    await processPending(h.ctx);
    assert.ok(!seen.includes(whileOff), 'not passed to the handler, then or after the module is back on');
    const whileOn = emit(h.ctx, 'AnnouncementPublished', { type: 'announcement', id: 'ann_portal_shared_probe' }, { announcementId: 'ann_portal_shared_probe' });
    await processPending(h.ctx);
    assert.ok(seen.includes(whileOn), 'an event while it is on reaches the handler');
  } finally { list.splice(list.indexOf(spy), 1); }
});

/* ---------- /admin/modules: private files while their module is off ---------- */

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('modules page: what the page says about each module’s private files while it is off is what the shared file link does', async () => {
  const mf = await dashboard('pages/admin/moduleFlags.ts');
  const filesWhileOff = mf.FILES_WHILE_OFF as Map<string, string>;
  // every module that stores private files is described, and only those
  const storing = MODULES.filter((m) => Object.keys(m.fileAccess ?? {}).length).map((m) => m.key).sort();
  assert.deepEqual(storing, ['messaging', 'nutrition', 'progress', 'support'], 'a module that starts storing files needs a sentence in FILES_WHILE_OFF');
  assert.deepEqual([...filesWhileOff.keys()].sort(), storing);
  assert.deepEqual([...filesWhileOff.keys()], MODULE_KEYS.filter((k) => filesWhileOff.has(k)), 'listed in registry order');
  // the page and the switch-off dialog say these sentences
  const page = source('apps/dashboard/src/pages/admin/Modules.tsx');
  assert.ok(page.includes("[...FILES_WHILE_OFF].map(([key, what]) => `with ${moduleTitle(key)} off, ${what}`)") && page.includes('${OFF_FILES}'), 'the note under the switches');
  assert.ok(page.includes('sentence(FILES_WHILE_OFF.get(f.module)!)'), 'the switch-off dialog of a module that stores files');

  const owner = as(DEMO.owner);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const otherCoach = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const anon = client(h.app);
  const opens = async (c: ReturnType<typeof client>, fileId: string) => {
    const t = await c.post(`/api/files/${fileId}/token`);
    if (t.status !== 200) return t.status;
    return (await anon.get(t.json.url as string)).status;
  };
  const whileOff = async <T>(flag: string, fn: () => Promise<T>): Promise<T> => {
    setFlag(owner, flag, { enabled: false }, `test: ${flag} off`);
    try { return await fn(); } finally { setFlag(owner, flag, { enabled: true }, `test: ${flag} on again`); }
  };

  // Nutrition: the meal photo rule reads the switch for coaches only. The member opens their own; the assigned coach
  // (the demo member shares health records with them) opens it while Nutrition is on, and not while it is off.
  assert.equal(filesWhileOff.get('nutrition'), 'the link still opens a member’s own meal photos for them, but none for coaches');
  const today = String((await member.get('/api/me/nutrition')).json.today);
  const log = await member.post('/api/me/meal-logs', { date: today, slot: 'other', outcome: 'extra', description: 'Portal shared probe' });
  assert.equal(log.status, 201, JSON.stringify(log.json));
  const meal = await member.post(`/api/me/meal-logs/${log.json.id as string}/photo`, { filename: 'meal.png', dataBase64: PNG_1x1.toString('base64') });
  const mealFile = String(meal.json.photoFileId);
  assert.ok(mealFile.startsWith('fil_'), JSON.stringify(meal.json));
  assert.equal(await opens(coach, mealFile), 200, 'the assigned coach opens it while Nutrition is on');
  const coachUrl = (await coach.post(`/api/files/${mealFile}/token`)).json.url as string;
  await whileOff('nutrition', async () => {
    assert.equal((await member.get('/api/me/nutrition')).json.error?.code, 'FEATURE_DISABLED', 'the module’s own routes refuse');
    assert.equal(await opens(member, mealFile), 200, 'the member still opens their own meal photo');
    assert.equal(await opens(coach, mealFile), 404, 'the assigned coach cannot');
    assert.equal((await anon.get(coachUrl)).status, 404, 'not even with a link issued while Nutrition was on: the rule is read again when it is redeemed');
    assert.equal(await opens(otherCoach, mealFile), 404, 'nor a coach who is not assigned');
    assert.equal(await opens(admin, mealFile), 404, 'nor an administrator');
  });
  assert.equal(await opens(coach, mealFile), 200, 'the assigned coach opens it again once Nutrition is back on');
  // ...and, with Nutrition on, only while the member shares health records with that coach
  const sharing = h.db.get<{ id: string; granted: number }>("SELECT id, granted FROM member_consents WHERE user_id = ? AND kind = 'coach_sharing' ORDER BY rowid DESC LIMIT 1", [userId(h.ctx, DEMO.member)]);
  assert.equal(sharing?.granted, 1, 'the demo member shares health records with their coach');
  h.db.update('member_consents', sharing!.id, { granted: 0 });
  try { assert.equal(await opens(coach, mealFile), 404, 'not once the member stops sharing'); }
  finally { h.db.update('member_consents', sharing!.id, { granted: 1 }); }

  // Progress: members open their own photos; coaches open none, not even a shared one they could open while it was on.
  assert.equal(filesWhileOff.get('progress'), 'the link still opens a member’s own progress photos for them, but none for coaches');
  const photosWere = h.db.get<{ enabled: number }>("SELECT enabled FROM feature_flags WHERE key = 'progressPhotos'")?.enabled === 1;
  setFlag(owner, 'progressPhotos', { enabled: true }, 'test: photos on');
  try {
    assert.equal((await member.post('/api/me/progress/photos/consent', { granted: true, version: PHOTO_CONSENT.version })).status, 200);
    const up = await member.post('/api/me/progress/photos', { dataBase64: PNG_1x1.toString('base64'), pose: 'front', filename: 'front.png' });
    assert.equal(up.status, 201, JSON.stringify(up.json));
    const photo = up.json as { id: string; fileId: string };
    assert.equal((await member.patch(`/api/me/progress/photos/${photo.id}`, { shareWithCoach: true })).json.sharedWithCoach, true);
    assert.equal(await opens(coach, photo.fileId), 200, 'shared: the assigned coach opens it while Progress is on');
    await whileOff('progress', async () => {
      assert.equal((await member.get('/api/me/progress/photos')).json.error?.code, 'FEATURE_DISABLED', 'the module’s own routes refuse');
      assert.equal(await opens(member, photo.fileId), 200, 'the member still opens their own progress photo');
      assert.equal(await opens(coach, photo.fileId), 404, 'the coach cannot');
    });
  } finally { setFlag(owner, 'progressPhotos', { enabled: photosWere }, 'test: photos as they were'); }

  // Messaging (Attachments and announcements): files on messages stay listed by name, and nobody opens them.
  assert.equal(filesWhileOff.get('messaging'), 'files on messages stay listed by name in conversations, but the link opens none of them');
  const conv = h.db.get<{ id: string }>('SELECT id FROM conversations WHERE member_id = ? ORDER BY created_at LIMIT 1', [userId(h.ctx, DEMO.member)])!;
  const att = await member.post(`/api/conversations/${conv.id}/attachments`, { dataBase64: PNG_1x1.toString('base64'), filename: 'portal-shared-probe.png' });
  assert.equal(att.status, 201, JSON.stringify(att.json));
  assert.equal((await member.post(`/api/conversations/${conv.id}/messages`, { body: 'A file', attachmentIds: [att.json.id] })).status, 201);
  const attFile = h.db.get<{ file_id: string }>('SELECT file_id FROM message_attachments WHERE id = ?', [att.json.id as string])!.file_id;
  assert.equal(await opens(coach, attFile), 200, 'the coach opens it while the module is on');
  await whileOff('messaging', async () => {
    const thread = await member.get(`/api/conversations/${conv.id}/messages`);
    assert.ok((thread.json.items as Array<{ attachments: Array<{ id: string; name: string }> }>).some((m) => m.attachments.some((a) => a.id === att.json.id && a.name === 'portal-shared-probe.png')), 'still listed by name in the conversation');
    assert.equal(await opens(member, attFile), 404, 'the member cannot open it');
    assert.equal(await opens(coach, attFile), 404, 'the coach cannot open it');
    assert.equal((await member.post(`/api/attachments/${att.json.id as string}/file-token`)).json.error?.code, 'FEATURE_DISABLED');
  });

  // Support: a data export already made still downloads for its member, through either link; nobody else opens it.
  assert.equal(filesWhileOff.get('support'), 'the link still opens a data export already made, for its member');
  const req = await member.post('/api/me/data-requests', { kind: 'export' });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.equal((await admin.post(`/api/admin/data-exports/${req.json.id as string}/generate`, { reason: 'test: export for the file check' })).status, 200);
  const exportFile = h.db.get<{ file_id: string }>('SELECT file_id FROM data_requests WHERE id = ?', [req.json.id as string])!.file_id;
  await whileOff('support', async () => {
    assert.equal((await member.get('/api/me/data-exports')).json.error?.code, 'FEATURE_DISABLED', 'the module’s own routes refuse');
    assert.equal(await opens(member, exportFile), 200, 'the member downloads it through the file link');
    const t = await member.post(`/api/me/data-requests/${req.json.id as string}/file-token`);
    assert.equal(t.status, 200, 'and through the export’s own link, which stays open');
    assert.equal((await anon.get(t.json.url as string)).status, 200);
    assert.equal(await opens(coach, exportFile), 404, 'not their coach');
  });

  // the page's whole sentence, in registry order with the portal's module titles
  const titles = new Map<string, string>([['progress', 'Progress'], ['support', 'Support'], ['nutrition', 'Nutrition'], ['messaging', 'Attachments and announcements']]);
  for (const [key, title] of titles) assert.ok(source(`apps/dashboard/src/modules/${key}/${key === 'progress' || key === 'nutrition' ? 'index.ts' : 'module.tsx'}`).includes(`title: '${title}'`), `${key} is titled ${title} in the portal`);
});
