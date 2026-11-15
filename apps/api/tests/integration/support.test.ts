/* M4 Support: support requests (requesters see only their own; internal notes never reach them), the help centre
   (audiences, drafts, publishing under content.manage), the parts' own switches, imports (administrators with
   imports.manage only, a dry run that writes nothing, an error report, an idempotent apply, no invitation before an
   administrator sends them, imported progress labelled 'import'), data export (generated for requests in progress,
   reachable only by its member through a short-lived token) and the coach onboarding checklist. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { restrictedKeys, findRestrictedFields, adminRestrictedKeys } from '../../src/auth/fieldPolicy.js';
import { moduleJobs } from '../../src/jobs.js';
import * as dataExport from '../../src/domain/dataExport.js';
import { resolveFileToken } from '../../src/domain/files.js';
import { parseCsv } from '../../src/domain/imports.js';
import { MODULES } from '../../src/modules/index.js';

let h: Awaited<ReturnType<typeof makeApp>>;
let privateDir = '';

before(async () => {
  privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioptime-support-'));
  h = await makeApp({ env: { PRIVATE_FILES_DIR: privateDir } });
});
after(async () => {
  await h.app.close();
  h.db.close();
  fs.rmSync(privateDir, { recursive: true, force: true });
});

const signedIn = async (email: string, password: string) => {
  const c = client(h.app);
  const privileged = password === DEMO_PASSWORDS.admin || password === DEMO_PASSWORDS.owner;
  await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', privileged);
  return c;
};
const count = (sql: string, params: string[] = []) => h.db.get<{ n: number }>(sql, params)!.n;
const setPermission = (email: string, permission: string, granted: boolean) => h.db.run('INSERT INTO user_permissions (user_id, permission, granted, reason, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, NULL) ON CONFLICT(user_id, permission) DO UPDATE SET granted = excluded.granted', [userId(h.ctx, email), permission, granted ? 1 : 0, 'support test', new Date().toISOString()]);
/** The error code, or the specific code an INVALID_STATE answer carries in its details. */
const code = (r: { json: { error?: { code: string; details?: unknown } } }) => r.json.error?.code === 'INVALID_STATE' ? (r.json.error.details as { code?: string } | undefined)?.code : r.json.error?.code;
const setFlag = (key: string, on: boolean) => h.db.run('UPDATE feature_flags SET enabled = ? WHERE key = ?', [on ? 1 : 0, key]);
const audited = (action: string, targetId: string) => h.db.get<{ actor_id: string | null; reason: string | null; data: string }>('SELECT actor_id, reason, data FROM audit_events WHERE action = ? AND target_id = ? ORDER BY at DESC LIMIT 1', [action, targetId]);

test('the module registers its routes, job, file kind and switches; the demo seed adds labelled sample rows', async () => {
  const m = MODULES.find((x) => x.key === 'support')!;
  assert.ok(m.fileAccess?.data_export, 'the data_export file kind has its own access resolver');
  assert.ok(moduleJobs().some((j) => j.name === 'support.data_exports'));
  const flags = Object.fromEntries(h.db.all<{ key: string; enabled: number }>("SELECT key, enabled FROM feature_flags WHERE key IN ('support','support_requests','help_centre','imports')").map((f) => [f.key, f.enabled]));
  assert.deepEqual(flags, { support: 1, support_requests: 1, help_centre: 1, imports: 1 }, 'demo mode switches the module and its parts on');
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const features = (await member.get('/api/public/config')).json.features as string[];
  for (const f of ['support', 'support_requests', 'help_centre', 'imports']) assert.ok(features.includes(f), f);
  const articles = (await member.get('/api/help/articles')).json.items as Array<{ title: string; audience: string }>;
  assert.ok(articles.length >= 3);
  // the owner removed every "demo" and "sample" label (24 October 2026): the seeded rows read as plain records
  const labelWords = /\bdemo\b|\bsample\b/i;
  for (const a of articles) { assert.doesNotMatch(a.title, labelWords); assert.ok(['member', 'all'].includes(a.audience), 'a member reads member and all articles only'); }
  for (const a of h.db.all<{ slug: string; title: string; body: string; category: string }>('SELECT slug, title, body, category FROM help_articles')) assert.doesNotMatch(`${a.slug} ${a.title} ${a.body} ${a.category}`, labelWords);
  assert.deepEqual(h.db.all<{ reference: string }>('SELECT reference FROM support_requests ORDER BY reference').map((r) => r.reference), ['SUP-0901', 'SUP-0902', 'SUP-0903'], 'seeded requests sit below the SUP sequence (SUP-1001 up), so a new request never collides');
  for (const r of h.db.all<{ subject: string }>('SELECT subject FROM support_requests')) assert.doesNotMatch(r.subject, labelWords);
  for (const b of h.db.all<{ body: string }>('SELECT body FROM support_messages')) assert.doesNotMatch(b.body, labelWords);
  const staged = h.db.get<{ status: string; file_name: string }>('SELECT status, file_name FROM import_jobs')!;
  assert.equal(staged.status, 'validated', 'the seeded import is staged, not applied');
  assert.equal(staged.file_name, 'members-to-invite.csv');
  for (const e of ['nisha.pillai@demo.bioptime.test', 'arun.kumar@demo.bioptime.test']) assert.equal(count(`SELECT COUNT(*) n FROM users WHERE email = '${e}'`), 0, 'nobody was created or invited by the seed');
});

test('support requests: validation, the SUP reference, an audited create, an alert to administrators without the text', async () => {
  const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const bad = await member.post('/api/support-requests', { category: 'billing', subject: 'x', body: 'hi' });
  assert.equal(bad.status, 400);
  assert.equal(code(bad), 'VALIDATION_FAILED');
  assert.equal((await member.post('/api/support-requests', { category: 'refunds', subject: 'Where is my refund', body: 'Please check my order.' })).status, 400, 'categories are a fixed list');
  const before = count("SELECT COUNT(*) n FROM notifications WHERE category = 'operations'");
  const r = await member.post('/api/support-requests', { category: 'billing', subject: 'Question about my order', body: 'My blood sugar note is private; the order shows pending.' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.reference as string, /^SUP-\d{4,}$/);
  assert.equal(r.json.status, 'open');
  const id = r.json.id as string;
  const a = audited('support_request.create', id);
  assert.equal(a?.actor_id, userId(h.ctx, DEMO.member2), 'audited with the actor');
  const alerts = h.db.all<{ body: string; title: string }>("SELECT title, body FROM notifications WHERE category = 'operations' ORDER BY created_at DESC LIMIT 5");
  assert.ok(count("SELECT COUNT(*) n FROM notifications WHERE category = 'operations'") > before, 'administrators are told');
  assert.ok(alerts.every((n) => !n.body.includes('blood sugar') && !n.title.includes('Question about')), 'the alert carries neither the subject nor the text');
});

test('requesters see only their own requests; coaches too; anyone else gets "not found"', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const other = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const anon = client(h.app);
  const mine = await member.post('/api/support-requests', { category: 'app', subject: 'Cannot open my report', body: 'The report page spins.' });
  const id = mine.json.id as string;
  assert.equal((await anon.get(`/api/support-requests/${id}`)).status, 401);
  assert.equal((await other.get(`/api/support-requests/${id}`)).status, 404);
  assert.equal((await coach.get(`/api/support-requests/${id}`)).status, 404, 'not even the assigned coach');
  assert.equal((await other.post(`/api/support-requests/${id}/messages`, { body: 'me too' })).status, 404);
  const list = (await member.get('/api/support-requests')).json.items as Array<{ id: string }>;
  const own = h.db.all<{ id: string }>('SELECT id FROM support_requests WHERE requester_id = ?', [userId(h.ctx, DEMO.member)]).map((x) => x.id).sort();
  assert.deepEqual(list.map((x) => x.id).sort(), own, 'exactly my requests');
  const coachReq = await coach.post('/api/support-requests', { category: 'account', subject: 'Update my bio photo', body: 'How do I change my photo?' });
  assert.equal(coachReq.status, 201);
  assert.equal((await member.get(`/api/support-requests/${coachReq.json.id}`)).status, 404);
  const coachView = await coach.get(`/api/support-requests/${coachReq.json.id}`);
  assert.deepEqual(findRestrictedFields(coachView.json, restrictedKeys()), [], 'no contact or identity field in a coach payload');
  assert.deepEqual(findRestrictedFields((await coach.get('/api/support-requests')).json, restrictedKeys()), []);
  assert.equal((await member.get('/api/admin/support-requests')).status, 403);
  assert.equal((await coach.get('/api/admin/support-requests')).status, 403);
});

test('internal notes never reach the requester; replies notify without their text; a closed request takes no reply', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin);
  const memberId = userId(h.ctx, DEMO.member);
  const created = await member.post('/api/support-requests', { category: 'bloodwork', subject: 'Collection slot missed', body: 'Nobody came for my collection.' });
  const id = created.json.id as string;
  const notes = () => count("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND category = 'support'", [memberId]);
  const n0 = notes();

  const internal = await admin.post(`/api/admin/support-requests/${id}/messages`, { body: 'Internal: check the vendor log for this booking.', internal: true });
  assert.equal(internal.status, 201, JSON.stringify(internal.json));
  assert.equal(notes(), n0, 'an internal note notifies nobody');
  let view = await member.get(`/api/support-requests/${id}`);
  assert.ok(!JSON.stringify(view.json).includes('vendor log'), 'the internal note is not in the requester’s thread');
  assert.equal((view.json.messages as unknown[]).length, 1);
  assert.ok(!JSON.stringify((await member.get('/api/support-requests')).json).includes('vendor log'));

  const reply = await admin.post(`/api/admin/support-requests/${id}/messages`, { body: 'We have rebooked the collection for tomorrow morning.' });
  assert.equal(reply.status, 201);
  assert.equal(reply.json.status, 'waiting_on_requester');
  assert.equal((reply.json.assignedTo as { id: string }).id, userId(h.ctx, DEMO.admin), 'whoever answers an unowned request takes it');
  assert.equal(notes(), n0 + 1, 'the requester is notified of a reply');
  const n = h.db.get<{ title: string; body: string }>("SELECT title, body FROM notifications WHERE user_id = ? AND category = 'support' ORDER BY created_at DESC LIMIT 1", [memberId])!;
  assert.ok(!n.body.includes('rebooked'), 'the notification says a reply arrived, not what it says');
  view = await member.get(`/api/support-requests/${id}`);
  const msgs = view.json.messages as Array<{ body: string; fromTeam: boolean; authorName: string; mine: boolean }>;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1]!.fromTeam, true);
  assert.equal(msgs[1]!.authorName, 'Bioptime team');
  assert.ok(!('internal' in msgs[1]!), 'the requester view has no internal flag at all');

  const back = await member.post(`/api/support-requests/${id}/messages`, { body: 'Thank you, tomorrow works.' });
  assert.equal(back.status, 201);
  assert.equal(back.json.status, 'open', 'a requester reply reopens the request');
  const team = await admin.get(`/api/admin/support-requests/${id}`);
  const all = team.json.messages as Array<{ internal: boolean; body: string }>;
  assert.equal(all.length, 4);
  assert.equal(all.filter((m) => m.internal).length, 1, 'the team sees its internal note');
  assert.deepEqual(findRestrictedFields(team.json, adminRestrictedKeys()), [], 'never a phone number in the team view');
  assert.equal(JSON.parse(audited('support_request.reply', id)!.data).by, 'requester');
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'support_request.reply' AND target_id = ? AND data LIKE '%\"internal\":true%'", [id]), 'internal notes are audited too');

  const closed = await admin.patch(`/api/admin/support-requests/${id}`, { status: 'closed', reason: 'Rebooked and confirmed' });
  assert.equal(closed.status, 200);
  assert.ok(closed.json.resolvedAt);
  assert.equal(audited('support_request.update', id)?.reason, 'Rebooked and confirmed');
  const late = await member.post(`/api/support-requests/${id}/messages`, { body: 'One more thing' });
  assert.equal(late.status, 409);
  assert.equal(code(late), 'REQUEST_CLOSED');
});

test('the queue: operations.manage, filters, assignment to administrators only', async () => {
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin);
  const q = await admin.get('/api/admin/support-requests?status=active');
  assert.equal(q.status, 200, JSON.stringify(q.json));
  const items = q.json.items as Array<{ status: string; requester: { email: string } }>;
  assert.ok(items.length > 0 && items.every((r) => r.status === 'open' || r.status === 'waiting_on_requester'));
  assert.deepEqual(findRestrictedFields(q.json, adminRestrictedKeys()), []);
  const memberId = userId(h.ctx, DEMO.member);
  const byMember = (await admin.get(`/api/admin/support-requests?requesterId=${memberId}`)).json.items as Array<{ requester: { id: string } }>;
  assert.ok(byMember.length > 0 && byMember.every((r) => r.requester.id === memberId), 'the client-record tab lists one member');
  const target = items[0] as unknown as { id: string };
  const toCoach = await admin.patch(`/api/admin/support-requests/${target.id}`, { assignedTo: userId(h.ctx, DEMO.coach) });
  assert.equal(toCoach.status, 400);
  assert.equal(code(toCoach), 'ASSIGNEE_INVALID');
  assert.equal(code(await admin.patch(`/api/admin/support-requests/${target.id}`, {})), 'NOTHING_TO_CHANGE');
  assert.equal((await admin.patch(`/api/admin/support-requests/${target.id}`, { status: 'paused' })).status, 400);
  setPermission(DEMO.admin, 'operations.manage', false);
  try {
    const denied = await admin.get('/api/admin/support-requests');
    assert.equal(denied.status, 403);
    assert.equal(code(denied), 'PERMISSION_DENIED');
  } finally { setPermission(DEMO.admin, 'operations.manage', true); }
});

test('help centre: audiences, drafts, publishing with a reason under content.manage, sanitised bodies', async () => {
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  assert.equal((await member.post('/api/admin/help-articles', { title: 'Mine', body: '<p>x</p>', audience: 'member' })).status, 403);
  assert.equal((await coach.get('/api/admin/help-articles')).status, 403);
  const draft = await admin.post('/api/admin/help-articles', { title: 'Changing your sign-in email', body: '<p>Write to us.</p><script>alert(1)</script><a href="javascript:alert(2)">x</a>', audience: 'member', category: 'Account' });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  assert.equal(draft.json.slug, 'changing-your-sign-in-email');
  assert.equal(draft.json.status, 'draft');
  assert.ok(!/script|javascript:/i.test(draft.json.body as string), 'the body is sanitised on save');
  const id = draft.json.id as string;
  assert.equal(code(await admin.post('/api/admin/help-articles', { title: 'Changing your sign-in email', body: '<p>Again</p>', audience: 'all' })), 'SLUG_TAKEN');
  assert.equal(code(await admin.post('/api/admin/help-articles', { title: 'Empty', body: '<p> </p>', audience: 'all' })), 'BODY_EMPTY');
  assert.equal((await admin.post('/api/admin/help-articles', { title: 'Bad slug', slug: 'Bad Slug', body: '<p>x</p>', audience: 'all' })).status, 400);
  assert.equal((await member.get('/api/help/articles/changing-your-sign-in-email')).status, 404, 'a draft is not readable');
  assert.ok(!((await member.get('/api/help/articles')).json.items as Array<{ id: string }>).some((a) => a.id === id));
  assert.equal((await admin.post(`/api/admin/help-articles/${id}/publish`, {})).status, 400, 'publishing needs a reason');
  const pub = await admin.post(`/api/admin/help-articles/${id}/publish`, { reason: 'Reviewed by the team' });
  assert.equal(pub.status, 200);
  assert.equal(audited('help_article.publish', id)?.reason, 'Reviewed by the team');
  const read = await member.get('/api/help/articles/changing-your-sign-in-email');
  assert.equal(read.status, 200);
  assert.equal(read.json.bodyText, 'Write to us.\nalert(1)x', 'a plain-text copy for the app (dropped tags leave their text)');
  assert.equal((await coach.get('/api/help/articles/changing-your-sign-in-email')).status, 404, 'a member article is not shown to coaches');
  const coachList = (await coach.get('/api/help/articles')).json.items as Array<{ audience: string }>;
  assert.ok(coachList.length > 0 && coachList.every((a) => a.audience === 'coach' || a.audience === 'all'));
  assert.equal(((await coach.get('/api/help/articles?audience=member')).json.items as unknown[]).length, coachList.length, 'a coach cannot widen the audience');
  assert.equal(code(await admin.patch(`/api/admin/help-articles/${id}`, { title: 'Changing the email you sign in with' })), 'REASON_REQUIRED', 'a published article changes with a reason');
  assert.equal((await admin.patch(`/api/admin/help-articles/${id}`, { title: 'Changing the email you sign in with', reason: 'Clearer title' })).status, 200);
  assert.equal((await admin.post(`/api/admin/help-articles/${id}/unpublish`, { reason: 'Superseded' })).json.status, 'draft');
  assert.equal((await member.get('/api/help/articles/changing-your-sign-in-email')).status, 404);
  setPermission(DEMO.admin, 'content.manage', false);
  try { assert.equal(code(await admin.get('/api/admin/help-articles')), 'PERMISSION_DENIED'); } finally { setPermission(DEMO.admin, 'content.manage', true); }
});

test('switches: the module flag and each part’s own flag answer FEATURE_DISABLED; the export download stays reachable', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  setFlag('help_centre', false);
  try {
    const off = await member.get('/api/help/articles');
    assert.equal(off.status, 403);
    assert.equal(code(off), 'FEATURE_DISABLED');
    assert.equal((await member.get('/api/support-requests')).status, 200, 'the other parts carry on');
    assert.ok(!((await member.get('/api/public/config')).json.features as string[]).includes('help_centre'));
  } finally { setFlag('help_centre', true); }
  setFlag('support', false);
  try {
    assert.equal(code(await member.get('/api/support-requests')), 'FEATURE_DISABLED');
    assert.equal(code(await member.get('/api/me/data-exports')), 'FEATURE_DISABLED');
    const ungated = await member.post('/api/me/data-requests/drq_doesnotexist/file-token');
    assert.equal(ungated.status, 404, 'the export download is not behind the flag: it answers for the record itself');
  } finally { setFlag('support', true); }
});

const MEMBERS_CSV = [
  'Email,Name,Phone,Note',
  'new.one@demo.bioptime.test,New One (test),+91 97000 00201,from the old system',
  '"new.two@demo.bioptime.test","Two, New (test)",,',
  'not-an-email,Broken Row,,',
  `${DEMO.member},Already Here,,`,
  'new.one@demo.bioptime.test,Duplicate One,,',
  'new.three@demo.bioptime.test,X,12,',
].join('\r\n');

test('imports: administrators with imports.manage only; the dry run writes nothing and reports every error', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin);
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner);
  const body = { kind: 'members', fileName: 'old-crm export.csv', csv: MEMBERS_CSV };
  assert.equal((await member.post('/api/admin/imports', body)).status, 403);
  assert.equal((await coach.post('/api/admin/imports', body)).status, 403);
  const noPerm = await admin.post('/api/admin/imports', body);
  assert.equal(noPerm.status, 403);
  assert.equal(code(noPerm), 'PERMISSION_DENIED', 'administrators do not hold imports.manage by default');

  const snapshot = () => ({ users: count('SELECT COUNT(*) n FROM users'), profiles: count('SELECT COUNT(*) n FROM member_profiles'), progress: count('SELECT COUNT(*) n FROM progress_entries'), notifications: count('SELECT COUNT(*) n FROM notifications'), outbox: count('SELECT COUNT(*) n FROM outbox_messages'), tokens: count('SELECT COUNT(*) n FROM auth_tokens'), jobs: count('SELECT COUNT(*) n FROM import_jobs'), rows: count('SELECT COUNT(*) n FROM import_rows') });
  const s0 = snapshot();
  const dry = await owner.post('/api/admin/imports', { ...body, dryRun: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.json));
  assert.equal(dry.json.stored, false);
  assert.equal(dry.json.rowCount, 6);
  assert.equal(dry.json.validCount, 2);
  assert.deepEqual(snapshot(), s0, 'a dry run with dryRun writes nothing at all');

  const staged = await owner.post('/api/admin/imports', body);
  assert.equal(staged.status, 201, JSON.stringify(staged.json));
  assert.equal(staged.json.status, 'validated');
  assert.equal(staged.json.fileName, 'old-crm-export.csv');
  const errorsByRow = Object.fromEntries((staged.json.report as { errors: Array<{ row: number; errors: string[] }> }).errors.map((e) => [e.row, e.errors.join(' | ')]));
  assert.match(errorsByRow[4]!, /email: not a valid email/);
  assert.match(errorsByRow[5]!, /already exists/);
  assert.match(errorsByRow[6]!, /same address is on row 2/);
  assert.match(errorsByRow[7]!, /name: 2 to 120/);
  assert.match(errorsByRow[7]!, /phone/);
  const s1 = snapshot();
  assert.deepEqual({ ...s1, jobs: s0.jobs, rows: s0.rows }, s0, 'staging writes only the job and its rows');
  assert.equal(s1.jobs, s0.jobs + 1);
  const rows = staged.json.rows as Array<{ row: number; outcome: string; data: Record<string, string> }>;
  assert.equal(rows.find((r) => r.row === 2)!.data.phone, '+919700000201', 'the owner holds members.view_restricted: phone numbers shown');
  assert.equal(rows.find((r) => r.row === 3)!.data.name, 'Two, New (test)', 'quoted commas survive');
  assert.ok(audited('import.upload', staged.json.id as string));
  assert.ok(audited('import.validate', staged.json.id as string));

  const broken = await owner.post('/api/admin/imports', { kind: 'members', fileName: 'x.csv', csv: 'mail,name\na@b.test,Someone\n' });
  assert.equal(broken.json.status, 'failed');
  assert.deepEqual((broken.json.fileErrors as Array<{ code: string }>).map((e) => e.code).sort(), ['MISSING_COLUMN', 'UNKNOWN_COLUMN']);
  assert.equal((await owner.post('/api/admin/imports', { kind: 'members', fileName: 'x.csv', csv: '' })).status, 400, 'an empty upload fails validation');
  assert.equal(code(await owner.post(`/api/admin/imports/${broken.json.id}/apply`, { reason: 'try anyway' })), 'IMPORT_STATE');
});

test('imports: apply once, create invited accounts silently, send invitations only when asked', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner);
  const staged = await owner.post('/api/admin/imports', { kind: 'members', fileName: 'apply-test.csv', csv: 'email,name,phone\napply.one@demo.bioptime.test,Apply One (test),+919700000301\napply.two@demo.bioptime.test,Apply Two (test),\n' });
  const id = staged.json.id as string;
  assert.equal(code(await owner.post(`/api/admin/imports/${id}/send-invitations`, { reason: 'too early' })), 'IMPORT_STATE', 'nothing is sent before the import is applied');
  assert.equal((await owner.post(`/api/admin/imports/${id}/apply`, {})).status, 400, 'applying needs a reason');
  const emails = ['apply.one@demo.bioptime.test', 'apply.two@demo.bioptime.test'];
  const applied = await owner.post(`/api/admin/imports/${id}/apply`, { reason: 'Migrating the first two clients' });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  assert.equal(applied.json.status, 'applied');
  assert.equal(applied.json.appliedCount, 2);
  const users = h.db.all<{ id: string; state: string; password_hash: string | null; phone: string | null }>(`SELECT id, state, password_hash, phone FROM users WHERE email IN (?, ?)`, emails);
  assert.equal(users.length, 2);
  for (const u of users) {
    assert.equal(u.state, 'invited');
    assert.equal(u.password_hash, null);
    assert.ok(h.db.get('SELECT member_code FROM member_profiles WHERE user_id = ?', [u.id]), 'a member profile with its code');
    assert.equal(count('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', [u.id]), 0, 'no notification');
    assert.equal(count('SELECT COUNT(*) n FROM auth_tokens WHERE user_id = ?', [u.id]), 0, 'no activation link');
    const a = audited('member.import', u.id)!;
    assert.equal(JSON.parse(a.data).importJobId, id, 'provenance: the job and the file');
    assert.equal(a.reason, 'Migrating the first two clients');
  }
  assert.equal(count('SELECT COUNT(*) n FROM outbox_messages WHERE to_address IN (?, ?)', emails), 0, 'nothing went out');
  assert.equal(audited('import.apply', id)?.reason, 'Migrating the first two clients');

  const again = await owner.post(`/api/admin/imports/${id}/apply`, { reason: 'double click' });
  assert.equal(again.status, 200);
  assert.equal(again.json.alreadyApplied, true);
  assert.equal(count('SELECT COUNT(*) n FROM users WHERE email IN (?, ?)', emails), 2, 'applying twice creates nothing twice');
  // a second file with the same people is refused row by row: the accounts now exist
  const repeat = await owner.post('/api/admin/imports', { kind: 'members', fileName: 'apply-test.csv', csv: 'email,name\napply.one@demo.bioptime.test,Apply One (test)\n' });
  assert.equal(repeat.json.status, 'failed');

  const sent = await owner.post(`/api/admin/imports/${id}/send-invitations`, { reason: 'Clients told to expect the email' });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.sent, 2);
  assert.equal(count("SELECT COUNT(*) n FROM outbox_messages WHERE channel = 'email' AND to_address IN (?, ?)", emails), 2, 'one activation email each, through the outbox');
  for (const u of users) assert.equal(count("SELECT COUNT(*) n FROM auth_tokens WHERE user_id = ? AND kind = 'password_reset'", [u.id]), 1);
  assert.ok(!JSON.stringify(sent.json).includes('token'), 'no activation link in the response');
  const twice = await owner.post(`/api/admin/imports/${id}/send-invitations`, { reason: 'pressed again' });
  assert.equal(twice.json.sent, 0, 'rows already invited are skipped');
  assert.equal(count("SELECT COUNT(*) n FROM outbox_messages WHERE channel = 'email' AND to_address IN (?, ?)", emails), 2);
  assert.ok(audited('import.invite', id));
  assert.equal(code(await owner.post(`/api/admin/imports/${id}/cancel`, { reason: 'too late' })), 'IMPORT_STATE');
});

test('imports: an administrator with imports.manage but no members.view_restricted runs progress imports only and never sees phone numbers', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin);
  const staged = await owner.post('/api/admin/imports', { kind: 'members', fileName: 'phones.csv', csv: 'email,name,phone\nphone.one@demo.bioptime.test,Phone One (test),+919700000401\n' });
  setPermission(DEMO.admin, 'imports.manage', true);
  setPermission(DEMO.admin, 'members.view_restricted', false);
  try {
    const list = await admin.get('/api/admin/imports');
    assert.equal(list.status, 200);
    const view = await admin.get(`/api/admin/imports/${staged.json.id}`);
    assert.equal(view.status, 200);
    assert.ok(!JSON.stringify(view.json).includes('+919700000401'), 'phone numbers are stripped');
    assert.deepEqual(findRestrictedFields(view.json, adminRestrictedKeys()), []);
    const up = await admin.post('/api/admin/imports', { kind: 'members', fileName: 'm.csv', csv: 'email,name\nx.y@demo.bioptime.test,X Y (test)\n' });
    assert.equal(up.status, 403, 'a members file carries contact fields');
    assert.equal((await admin.post(`/api/admin/imports/${staged.json.id}/apply`, { reason: 'try' })).status, 403);
    const prog = await admin.post('/api/admin/imports', { kind: 'progress_history', fileName: 'p.csv', csv: `member,metric,value,unit,at\n${DEMO.member},weight_kg,71.2,kg,2025-01-10\n`, dryRun: true });
    assert.equal(prog.status, 200, JSON.stringify(prog.json));
    assert.equal(prog.json.validCount, 1);
  } finally {
    setPermission(DEMO.admin, 'imports.manage', false);
    setPermission(DEMO.admin, 'members.view_restricted', true);
  }
});

test('progress history import: validated against the metric catalogue, written with source import and its provenance, never twice', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner);
  const memberId = userId(h.ctx, DEMO.member2);
  const code = h.db.get<{ member_code: string }>('SELECT member_code FROM member_profiles WHERE user_id = ?', [memberId])!.member_code;
  const csv = [
    'member,metric,value,unit,at,note',
    `${DEMO.member2},weight_kg,84.5,kg,2025-06-01,clinic scale`,
    `${code},waist_cm,96,cm,2025-06-01T08:00:00+05:30,`,
    `${DEMO.member2},weight_kg,84.5,lb,2025-06-08,`,
    `${DEMO.member2},glucose,5.4,mmol/L,2025-06-08,`,
    `${DEMO.member2},weight_kg,heavy,kg,2025-06-08,`,
    `nobody@demo.bioptime.test,weight_kg,70,kg,2025-06-08,`,
    `${DEMO.member2},weight_kg,84,kg,2099-01-01,`,
    `${DEMO.member2},sleep_hours,30,h,2025-06-08,`,
    `${DEMO.member2},weight_kg,84.5,kg,2025-02-30,`,
  ].join('\n');
  const staged = await owner.post('/api/admin/imports', { kind: 'progress_history', fileName: 'old-app-weights.csv', csv });
  assert.equal(staged.status, 201, JSON.stringify(staged.json));
  assert.equal(staged.json.validCount, 2);
  const errs = Object.fromEntries((staged.json.report as { errors: Array<{ row: number; errors: string[] }> }).errors.map((e) => [e.row, e.errors.join(' | ')]));
  assert.match(errs[4]!, /unit: Weight is recorded in kg/);
  assert.match(errs[5]!, /metric: one of/);
  assert.match(errs[6]!, /value: a number/);
  assert.match(errs[7]!, /member: no member/);
  assert.match(errs[8]!, /in the future/);
  assert.match(errs[9]!, /cannot be above 16/);
  assert.match(errs[10]!, /at: a date/);
  const before = count("SELECT COUNT(*) n FROM progress_entries WHERE member_id = ? AND source = 'import'", [memberId]);
  const applied = await owner.post(`/api/admin/imports/${staged.json.id}/apply`, { reason: 'History from the previous app' });
  assert.equal(applied.json.appliedCount, 2);
  const rows = h.db.all<{ metric: string; value: number; unit: string; at: string; source: string; note: string; created_by: string }>("SELECT * FROM progress_entries WHERE member_id = ? AND source = 'import' ORDER BY metric", [memberId]);
  assert.equal(rows.length, before + 2);
  for (const r of rows) {
    assert.equal(r.source, 'import', 'imported progress carries source import');
    assert.match(r.note, new RegExp(`Imported from old-app-weights\\.csv \\(import ${staged.json.id}, row \\d\\)`), 'and names its file, job and row');
    assert.equal(r.created_by, userId(h.ctx, DEMO.owner));
  }
  assert.equal(rows.find((r) => r.metric === 'weight_kg')!.at, '2025-06-01T06:30:00.000Z', 'a date alone is noon in India');
  assert.equal(rows.find((r) => r.metric === 'waist_cm')!.at, '2025-06-01T02:30:00.000Z');
  assert.match(rows.find((r) => r.metric === 'weight_kg')!.note, /· clinic scale$/);
  const again = await owner.post('/api/admin/imports', { kind: 'progress_history', fileName: 'old-app-weights.csv', csv });
  assert.equal(again.json.validCount, 0, 'the same history cannot be imported twice');
  assert.match(JSON.stringify(again.json.report), /already recorded/);
  // the member sees the imported values labelled
  const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const mine = (await member.get('/api/me/progress?metric=weight_kg')).json.items as Array<{ source: string }>;
  assert.ok(mine.some((p) => p.source === 'import'));
});

test('csv parser: quotes, doubled quotes, CRLF, a byte-order mark and blank lines', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,\n'), [['a', 'b'], ['x, y', 'say "hi"'], ['1', '']]);
  assert.throws(() => parseCsv('a,b\n"open,1\n'), /quoted field/);
});

test('data export: generated once in progress, reachable only by its member through a 5-minute token', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const other = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin);
  const memberId = userId(h.ctx, DEMO.member);
  const req = await member.post('/api/me/data-requests', { kind: 'export' });
  assert.equal(req.status, 201);
  const id = req.json.id as string;
  assert.deepEqual(dataExport.generatePending(h.ctx), { generated: 0, failed: 0 }, 'a request still marked requested waits for the team');
  assert.equal(((await member.get('/api/me/data-exports')).json.items as Array<{ id: string; file: unknown }>).find((x) => x.id === id)!.file, null);
  assert.equal(code(await member.post(`/api/me/data-requests/${id}/file-token`)), 'EXPORT_NOT_READY');

  assert.equal((await admin.patch(`/api/admin/data-requests/${id}`, { status: 'in_progress', note: 'Identity confirmed' })).status, 200);
  const job = moduleJobs().find((j) => j.name === 'support.data_exports')!;
  const ran = await job.run(h.ctx) as { generated: number };
  assert.equal(ran.generated, 1);
  const row = h.db.get<{ status: string; file_id: string; completed_at: string }>('SELECT status, file_id, completed_at FROM data_requests WHERE id = ?', [id])!;
  assert.equal(row.status, 'completed', 'the export request is fulfilled');
  assert.ok(row.file_id && row.completed_at);
  const file = h.db.get<{ kind: string; owner_id: string; mime: string; storage_path: string; ref_id: string }>('SELECT kind, owner_id, mime, storage_path, ref_id FROM file_metadata WHERE id = ?', [row.file_id])!;
  assert.deepEqual({ kind: file.kind, owner: file.owner_id, mime: file.mime, ref: file.ref_id }, { kind: 'data_export', owner: memberId, mime: 'application/json', ref: id });
  assert.ok(fs.existsSync(path.join(privateDir, file.storage_path)), 'in the private store');
  assert.equal(fs.statSync(path.join(privateDir, file.storage_path)).mode & 0o777, 0o600);
  assert.ok(audited('data_export.generate', id));
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND title = 'Your data export is ready'", [memberId]));
  assert.equal(count("SELECT COUNT(*) n FROM support_tasks WHERE kind = 'data_request' AND ref_id = ? AND status = 'open'", [id]), 0, 'the operations task is resolved');
  assert.deepEqual(dataExport.generatePending(h.ctx), { generated: 0, failed: 0 }, 'never generated twice');

  // only the member, only through a token
  assert.equal((await other.post(`/api/me/data-requests/${id}/file-token`)).status, 404);
  assert.equal((await other.post(`/api/files/${row.file_id}/token`)).status, 404);
  assert.equal((await coach.post(`/api/files/${row.file_id}/token`)).status, 404, 'not the coach, whatever the sharing consent');
  assert.equal((await admin.post(`/api/files/${row.file_id}/token`)).status, 404, 'not an administrator');
  assert.equal((await admin.post(`/api/me/data-requests/${id}/file-token`)).status, 403);
  const t = await member.post(`/api/me/data-requests/${id}/file-token`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal(t.json.expiresInSeconds, 300);
  assert.ok(audited('data_export.download', id));
  const dl = await h.app.inject({ method: 'GET', url: t.json.url as string });
  assert.equal(dl.statusCode, 200);
  assert.match(String(dl.headers['content-type']), /application\/json/);
  assert.match(String(dl.headers['cache-control']), /no-store/);
  const archive = JSON.parse(dl.body) as { format: string; memberId: string; sections: Record<string, unknown>; notIncluded: unknown[] };
  assert.equal(archive.format, 'bioptime-data-export');
  assert.equal(archive.memberId, memberId);
  for (const s of ['account', 'profile', 'consents', 'orders', 'appointments', 'progressEntries', 'messages', 'supportRequests', 'dataRequests']) assert.ok(s in archive.sections, s);
  assert.equal((archive.sections.account as { email: string }).email, DEMO.member);
  assert.ok(!/password_hash|mfa_secret|token_hash|"raw"/.test(dl.body), 'no secrets or provider payloads');
  assert.ok(!dl.body.includes('Ask which app version first'), 'internal support notes are not exported');
  assert.ok(!dl.body.includes('Identity confirmed'), 'the administrator’s note on the data request is not exported');
  assert.ok(archive.notIncluded.length > 0, 'what is left out is listed');
  assert.doesNotMatch((archive as unknown as { about: string }).about, /the records Bioptime holds about you/, 'the archive does not claim to be complete');
  assert.match((archive as unknown as { about: string }).about, /notIncluded/);
  // a token belongs to its holder and expires
  const later: Ctx = { ...h.ctx, now: () => new Date(Date.now() + 6 * 60_000).toISOString() };
  assert.throws(() => resolveFileToken(later, String(t.json.token)), (e: { code?: string }) => e.code === 'LINK_EXPIRED');
  const anon = await h.app.inject({ method: 'GET', url: '/api/files/download?token=forged.token' });
  assert.equal(anon.statusCode, 403);
  // the team sees that it exists, never what it says
  const list = await admin.get('/api/admin/data-exports');
  assert.equal(list.status, 200);
  const entry = (list.json.items as Array<{ id: string; file: { size: number } | null }>).find((x) => x.id === id)!;
  assert.ok(entry.file && entry.file.size > 0);
  assert.ok(!JSON.stringify(list.json).includes('bioptime-data-export"'), 'no archive content');
  assert.equal((await member.get('/api/admin/data-exports')).status, 403);
  const mine = ((await member.get('/api/me/data-exports')).json.items as Array<{ id: string; file: { name: string } | null }>).find((x) => x.id === id)!;
  assert.match(mine.file!.name, /^bioptime-data-export-\d{4}-\d{2}-\d{2}\.json$/);
});

test('data export: an administrator generates a requested export now, with a reason; members.manage only', async () => {
  const member = await signedIn(DEMO.memberNoShare, DEMO_PASSWORDS.member);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin);
  const coach = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach);
  const id = (await member.post('/api/me/data-requests', { kind: 'export' })).json.id as string;
  assert.equal((await coach.post(`/api/admin/data-exports/${id}/generate`, { reason: 'x' })).status, 403);
  assert.equal((await admin.post(`/api/admin/data-exports/${id}/generate`, {})).status, 400);
  const gen = await admin.post(`/api/admin/data-exports/${id}/generate`, { reason: 'Identity confirmed by phone' });
  assert.equal(gen.status, 200, JSON.stringify(gen.json));
  assert.equal(gen.json.status, 'completed');
  assert.equal(audited('data_request.update', id)?.reason, 'Identity confirmed by phone');
  assert.equal(code(await admin.post(`/api/admin/data-exports/${id}/generate`, { reason: 'again' })), 'ALREADY_GENERATED');
  const deletion = (await member.post('/api/me/data-requests', { kind: 'deletion' })).json.id as string;
  assert.equal((await admin.post(`/api/admin/data-exports/${deletion}/generate`, { reason: 'wrong kind' })).status, 404);
  setPermission(DEMO.admin, 'members.manage', false);
  try { assert.equal(code(await admin.get('/api/admin/data-exports')), 'PERMISSION_DENIED'); } finally { setPermission(DEMO.admin, 'members.manage', true); }
});

/** The member's own archive for one export request: generated by an administrator, then downloaded by the member. */
async function exportFor(member: Awaited<ReturnType<typeof signedIn>>, admin: Awaited<ReturnType<typeof signedIn>>, reason: string) {
  const id = (await member.post('/api/me/data-requests', { kind: 'export' })).json.id as string;
  const gen = await admin.post(`/api/admin/data-exports/${id}/generate`, { reason });
  assert.equal(gen.status, 200, JSON.stringify(gen.json));
  const t = await member.post(`/api/me/data-requests/${id}/file-token`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  const dl = await h.app.inject({ method: 'GET', url: t.json.url as string });
  assert.equal(dl.statusCode, 200);
  return { body: dl.body, archive: JSON.parse(dl.body) as { about: string; sections: Record<string, unknown>; moduleSections?: Record<string, unknown>; notIncluded: Array<{ what: string; why: string; records?: number }> } };
}

test('data export: a bespoke proposal only once sent, and only the terms the member sees; never team notes or draft terms', async () => {
  const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner);
  const created = await member.post('/api/me/custom-plans', { goals: 'Sample goals for the export test', notes: 'MEMBER-OWN-NOTE' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const cpl = created.json.id as string;
  const reference = created.json.reference as string;
  const move = async (body: Record<string, unknown>) => { const r = await owner.post(`/api/admin/custom-plans/${cpl}/transition`, body); assert.equal(r.status, 200, JSON.stringify(r.json)); };
  await move({ to: 'under_review' });
  await move({ to: 'scoping', proposal: { priceInr: 77777, durationLabel: 'Sample 3 months', consultations: 2, notes: 'TEAM-ONLY-MARGIN-NOTE' } });
  const mine = ((await member.get('/api/me/custom-plans')).json.items as Array<{ id: string; proposal: Record<string, unknown> }>).find((x) => x.id === cpl)!;
  assert.deepEqual(mine.proposal, {}, 'the member’s own view withholds the draft');

  const draft = await exportFor(member, owner, 'Sample: identity confirmed for the export test');
  assert.ok(!draft.body.includes('TEAM-ONLY-MARGIN-NOTE'), 'no internal proposal notes');
  assert.ok(!draft.body.includes('77777'), 'no draft price while the proposal is being scoped');
  const row = (draft.archive.sections.bespokeRequests as Array<{ reference: string; proposal: unknown; yourNotes: string | null }>).find((b) => b.reference === reference)!;
  assert.equal(row.proposal, null, 'no proposal before it is sent');
  assert.equal(row.yourNotes, 'MEMBER-OWN-NOTE', 'the member’s own words are theirs to take');

  await move({ to: 'awaiting_internal_approval', approval: 'Sample approval for the export test' });
  await move({ to: 'proposal_sent' });
  const sent = await exportFor(member, owner, 'Sample: second export after the proposal was sent');
  const sentRow = (sent.archive.sections.bespokeRequests as Array<{ reference: string; proposal: Record<string, unknown> | null }>).find((b) => b.reference === reference)!;
  assert.equal(sentRow.proposal?.priceInr, 77777, 'the sent terms are included');
  assert.equal(sentRow.proposal?.durationLabel, 'Sample 3 months');
  assert.ok(!('notes' in sentRow.proposal!) && !('coachId' in sentRow.proposal!), 'only the member-facing terms');
  assert.ok(!sent.body.includes('TEAM-ONLY-MARGIN-NOTE'), 'never the internal notes');
  assert.ok(!sent.body.includes('Sample approval for the export test'), 'never the internal approvals');
});

test('data export: each module with exportSections has its section and none of its kinds under notIncluded; a module without one has its kinds named with the member’s count', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin);
  const memberId = userId(h.ctx, DEMO.member);
  // a known kind with rows for this member (messaging's announcement reads), so the counts below come from the database
  h.db.run("INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at) SELECT id, ?, ? FROM announcements LIMIT 1", [memberId, new Date().toISOString()]);
  type Archive = ReturnType<typeof dataExport.buildArchive>;
  type Sections = Record<string, Record<string, { label: string; records: unknown }>>;
  const tableHas = (table: string, column: string) => !!h.db.get("SELECT 1 FROM pragma_table_info(?) WHERE name = ?", [table, column]);
  /** The member's records of one NOT_YET_EXPORTED kind, counted in the database (tables that do not exist count 0). */
  const recordsOf = (k: (typeof dataExport.NOT_YET_EXPORTED)[number]) => k.tables.reduce((n, [table, column]) => n + (tableHas(table, column) ? count(`SELECT COUNT(*) n FROM ${table} WHERE ${column} = ?`, [memberId]) : 0), 0);
  /** The invariants, for an archive built while `contributing` are the modules that declare exportSections. */
  const checkArchive = (archive: Pick<Archive, 'notIncluded'> & { moduleSections?: unknown }) => {
    const contributing = MODULES.filter((m) => (m.exportSections ?? []).length > 0);
    const sections = (archive.moduleSections ?? {}) as Sections;
    assert.deepEqual(Object.keys(sections).sort(), contributing.map((m) => m.key).sort(), 'moduleSections holds exactly the modules that declare exportSections');
    for (const m of contributing) assert.deepEqual(Object.keys(sections[m.key]!), m.exportSections!.map((d) => d.key), `${m.key}: one entry per declared section`);
    const named = (what: string) => archive.notIncluded.find((n) => n.what === what) as { what: string; why: string; records?: number } | undefined;
    for (const k of dataExport.NOT_YET_EXPORTED) {
      if (contributing.some((m) => m.key === k.module)) { assert.equal(named(k.what), undefined, `${k.module} contributes a section, so "${k.what}" is not under notIncluded`); continue; }
      const n = recordsOf(k);
      if (n > 0) assert.equal(named(k.what)?.records, n, `"${k.what}" is named with the member’s count`);
      else assert.equal(named(k.what), undefined, `"${k.what}": a kind the member has no records of is not listed`);
    }
    for (const n of archive.notIncluded as Array<{ why: string; records?: number }>) if (n.records !== undefined) { assert.ok(n.records > 0); assert.equal(n.why, dataExport.NOT_YET_WHY); }
  };
  // every NOT_YET_EXPORTED kind belongs to a registered module
  for (const k of dataExport.NOT_YET_EXPORTED) assert.ok(MODULES.some((m) => m.key === k.module), `${k.module} is a registered module`);

  // the archive the member downloads
  const first = await exportFor(member, admin, 'Sample: export coverage test');
  checkArchive(first.archive as unknown as Archive);

  // the mechanism, on a module that contributes a section (today every module in NOT_YET_EXPORTED does): without its
  // sections, its kinds are named with the member's count; restored exactly, they leave notIncluded again
  const uncovered = dataExport.NOT_YET_EXPORTED.filter((k) => !MODULES.some((m) => m.key === k.module && (m.exportSections ?? []).length > 0));
  const messaging = MODULES.find((m) => m.key === 'messaging')!;
  const own = messaging.exportSections;
  const reads = dataExport.NOT_YET_EXPORTED.find((k) => k.module === 'messaging')!;
  assert.ok(recordsOf(reads) > 0, 'the member has announcement reads');
  if (!uncovered.length) {
    assert.ok(own?.length, 'messaging contributes a section');
    messaging.exportSections = undefined;
    try {
      const without = dataExport.buildArchive(h.ctx, memberId, 'drq_withoutsections');
      checkArchive(without);
      assert.equal((without.notIncluded as Array<{ what: string; records?: number }>).find((n) => n.what === reads.what)?.records, recordsOf(reads), 'named with the member’s count from the database');
      assert.equal(((without.moduleSections ?? {}) as Sections).messaging, undefined);
    } finally { messaging.exportSections = own; }
    assert.equal(messaging.exportSections, own, 'restored exactly');
  }

  // the hook: whatever a module declares joins the archive under its key (its real sections are saved and restored)
  messaging.exportSections = [{ key: 'announcementReadsHook', label: 'Announcements you have opened (hook test)', build: (ctx, id) => ctx.db.all('SELECT announcement_id, read_at FROM announcement_reads WHERE user_id = ?', [id]) }];
  try {
    const archive = dataExport.buildArchive(h.ctx, memberId, 'drq_hooktest');
    checkArchive(archive);
    assert.equal((((archive.moduleSections ?? {}) as Sections).messaging!.announcementReadsHook!.records as unknown[]).length, recordsOf(reads));
  } finally { messaging.exportSections = own; }
  assert.equal(messaging.exportSections, own, 'the real sections are back');
  const after = dataExport.buildArchive(h.ctx, memberId, 'drq_afterhook');
  checkArchive(after);
  assert.deepEqual(Object.keys(((after.moduleSections ?? {}) as Sections).messaging!), own!.map((d) => d.key));
});

test('coach onboarding: computed from the coach’s own records, for the coach alone', async () => {
  const coach = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin);
  const r = await coach.get('/api/coach/onboarding');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual((r.json.items as Array<{ key: string }>).map((i) => i.key), ['profile', 'hours', 'policies']);
  assert.equal(r.json.complete, true, 'the demo coaches activated through the real flow');
  assert.equal(h.db.get<{ enabled: number }>("SELECT enabled FROM feature_flags WHERE key = 'learning'")?.enabled, 1, 'Learning is on in the demo');
  assert.equal((r.json.training as { available: boolean }).available, false, 'the demo publishes no coach course, so training is not counted');
  assert.match((r.json.training as { note: string }).note, /No training courses for coaches are published yet/);
  const coachId = userId(h.ctx, DEMO.coach2);
  h.db.run('UPDATE availability_rules SET active = 0 WHERE coach_id = ?', [coachId]);
  h.db.run("UPDATE coach_profiles SET bio = '' WHERE user_id = ?", [coachId]);
  try {
    const after = await coach.get('/api/coach/onboarding');
    assert.equal(after.json.complete, false);
    assert.equal(after.json.done, 1);
    const profile = (after.json.items as Array<{ key: string; done: boolean; missing?: string[] }>).find((i) => i.key === 'profile')!;
    assert.deepEqual(profile.missing, ['bio']);
  } finally {
    h.db.run('UPDATE availability_rules SET active = 1 WHERE coach_id = ?', [coachId]);
    h.db.run("UPDATE coach_profiles SET bio = 'Recovery, mobility and sleep routines for busy people.' WHERE user_id = ?", [coachId]);
  }
  assert.equal((await member.get('/api/coach/onboarding')).status, 403);
  assert.equal((await admin.get('/api/coach/onboarding')).status, 403);
});

test('coach onboarding: coach training courses from the Learning module count while it is on and has published some', async () => {
  const coach = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const coachId = userId(h.ctx, DEMO.coach2);
  const now = new Date().toISOString();
  const insertCourse = (id: string, slug: string, status: string, audience: string) => h.db.run("INSERT INTO courses (id, slug, title, summary, audience, package_ids, status, sample, created_at, updated_at, published_at) VALUES (?, ?, ?, 'Sample course for the onboarding test', ?, '[]', ?, 1, ?, ?, ?)", [id, slug, `Sample · ${slug}`, audience, status, now, now, status === 'published' ? now : null]);
  insertCourse('crs_suptraining1', 'sample-coach-training-one', 'published', 'coaches');
  insertCourse('crs_suptraining2', 'sample-coach-training-two', 'published', 'coaches');
  insertCourse('crs_suptraining3', 'sample-coach-training-draft', 'draft', 'coaches');
  insertCourse('crs_supmembers01', 'sample-member-course-not-training', 'published', 'all_members');
  try {
    const r = await coach.get('/api/coach/onboarding');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const items = r.json.items as Array<{ key: string; done: boolean; detail: string; href: string | null }>;
    assert.deepEqual(items.map((i) => i.key), ['profile', 'hours', 'policies', 'training'], 'training joins the checklist');
    const training = items.find((i) => i.key === 'training')!;
    assert.equal(training.done, false);
    assert.equal(training.detail, '0 of 2 training courses for coaches completed.', 'published coach courses only: not drafts, not member courses');
    assert.equal(training.href, '/training');
    assert.deepEqual(r.json.training, { available: true, total: 2, completed: 0 });
    assert.equal(r.json.complete, false);
    assert.equal(r.json.total, 4);

    for (const [i, course] of ['crs_suptraining1', 'crs_suptraining2'].entries()) h.db.run("INSERT INTO course_enrollments (id, course_id, member_id, source, status, enrolled_at, completed_at, updated_at) VALUES (?, ?, ?, 'self', 'completed', ?, ?, ?)", [`cen_suptraining${i}`, course, coachId, now, now, now]);
    const done = await coach.get('/api/coach/onboarding');
    assert.equal(done.json.complete, true);
    assert.equal(done.json.done, 4);
    assert.equal((done.json.items as Array<{ key: string; detail: string }>).find((i) => i.key === 'training')!.detail, 'All 2 training courses for coaches completed.');

    setFlag('learning', false);
    try {
      const off = await coach.get('/api/coach/onboarding');
      assert.deepEqual((off.json.items as Array<{ key: string }>).map((i) => i.key), ['profile', 'hours', 'policies'], 'not counted while Learning is off');
      assert.match((off.json.training as { note: string }).note, /when the Learning module is switched on/);
    } finally { setFlag('learning', true); }
  } finally {
    h.db.run("DELETE FROM course_enrollments WHERE id LIKE 'cen_suptraining%'");
    h.db.run("DELETE FROM courses WHERE id IN ('crs_suptraining1', 'crs_suptraining2', 'crs_suptraining3', 'crs_supmembers01')");
  }
});
