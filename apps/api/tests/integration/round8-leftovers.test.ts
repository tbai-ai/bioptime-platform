/* Round 8 leftovers: Coach AI in place in the coach's Messages thread (a reply draft) and plan editor (a plan outline),
   and the Messages page's list and thread errors.

   The portal side (apps/dashboard/src/modules/ai/shared.tsx AiDraftInline, pages/Messages.tsx, pages/PlanEditor.tsx) is
   checked through its own files: the pure helpers and the draft card are loaded as they are (computed specifiers keep
   them out of the API's typecheck) and the pages' wiring is read from source. The server side is what the in-place
   panel relies on: GET /coach/ai/status answers a coach only for a client assigned to them and only while the 'ai'
   module is on (403 otherwise, which hides the panel), says plainly when no AI provider is configured, and asking for
   a draft never sends a message or changes a plan. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { setFlag } from '../../src/domain/features.js';

const PLATFORM = fileURLToPath(new URL('../../../../', import.meta.url));
const source = (rel: string) => fs.readFileSync(path.join(PLATFORM, rel), 'utf8');
const load = (spec: string): Promise<any> => import(spec);
const dashboard = (rel: string): Promise<any> => load(pathToFileURL(path.join(PLATFORM, 'apps/dashboard/src', rel)).href);
/** A file's code without its comments, for checks on what a viewer can see. */
const code = (rel: string) => source(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

const MESSAGES = 'apps/dashboard/src/pages/Messages.tsx';
const PLAN_EDITOR = 'apps/dashboard/src/pages/PlanEditor.tsx';
const AI_SHARED = 'apps/dashboard/src/modules/ai/shared.tsx';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const as = (email: string): Ctx => {
  const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!;
  return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } };
};
const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const errCode = (r: { json: { error?: { code: string; details?: unknown } } }) => (r.json.error?.details as { code?: string } | undefined)?.code ?? r.json.error?.code;
/** What a member could ever see change: none of it may move because a coach asked Coach AI for a draft. */
const memberVisible = (memberId: string) => ({
  messages: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.member_id = ?', [memberId])!.n,
  notifications: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', [memberId])!.n,
  plans: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM coaching_plans WHERE member_id = ?', [memberId])!.n,
  versions: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM coaching_plan_versions v JOIN coaching_plans p ON p.id = v.plan_id WHERE p.member_id = ?', [memberId])!.n,
  summaries: h.db.all<{ summary: string | null }>('SELECT v.summary FROM coaching_plan_versions v JOIN coaching_plans p ON p.id = v.plan_id WHERE p.member_id = ? ORDER BY v.id', [memberId]).map((x) => x.summary ?? ''),
});

/* ---------- the server side the in-place panel relies on ---------- */

test('in-place Coach AI: status answers a coach for an assigned client, says plainly that no provider is configured, and refuses everyone else with 403', async () => {
  const shared = await dashboard('modules/ai/shared.tsx');
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const ananya = userId(h.ctx, DEMO.member);
  const ashaId = userId(h.ctx, DEMO.coach);
  const ok = await asha.get(`/api/coach/ai/status?memberId=${ananya}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((ok.json.member as { id: string }).id, ananya, 'the panel is shown: the client is assigned to this coach');
  assert.equal(ok.json.configured, false, 'no AI provider in the tests');
  const missing = ok.json.missing as Array<{ key: string; label: string }>;
  assert.ok(missing.some((m) => !m.key.startsWith('member_')), 'something outside the client is missing');
  // the closed panel says so plainly, before it is opened
  assert.equal(shared.inlineNote(ok.json, 'intro'), 'Coach AI is not configured, so no draft can be made here yet. Open it to see what is missing.');
  // the coach's reply and plan drafts are both purposes the server offers for a client
  const purposes = ok.json.purposes as Array<{ purpose: string; available: boolean; needsMember: boolean }>;
  assert.ok(purposes.find((p) => p.purpose === 'message_reply')?.available);
  assert.ok(purposes.find((p) => p.purpose === 'plan_outline')?.available);

  // a member who is not assigned to this coach: 403, so the panel stays hidden (and the coach's Messages never lists
  // or opens such a thread in the first place)
  const other = h.db.get<{ id: string }>("SELECT id FROM users WHERE role = 'member' AND id NOT IN (SELECT member_id FROM coach_assignments WHERE coach_id = ? AND status IN ('active','paused')) ORDER BY id LIMIT 1", [ashaId])!;
  const refused = await asha.get(`/api/coach/ai/status?memberId=${other.id}`);
  assert.equal(refused.status, 403);
  assert.equal(errCode(refused), 'NO_ACCESS');
  const listed = (await asha.get('/api/conversations')).json.items as Array<{ memberId: string }>;
  assert.ok(listed.length > 0 && !listed.some((c) => c.memberId === other.id), 'a coach lists only threads with assigned clients');

  // a member or an administrator never gets the coach's status
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  assert.equal((await member.get(`/api/coach/ai/status?memberId=${ananya}`)).status, 403);

  // the module switched off: 403 FEATURE_DISABLED, so the panel stays hidden; the portal reads the same switch first
  const owner = as(DEMO.owner);
  setFlag(owner, 'ai', { enabled: false }, 'test: Coach AI off');
  try {
    const off = await asha.get(`/api/coach/ai/status?memberId=${ananya}`);
    assert.equal(off.status, 403);
    assert.equal(off.json.error?.code, 'FEATURE_DISABLED');
    const config = await asha.get('/api/public/config');
    assert.ok(!(config.json.features as string[]).includes('ai'), 'the portal’s switch list leaves Coach AI out');
  } finally { setFlag(owner, 'ai', { enabled: true }, 'test: Coach AI on again'); }
  const config = await asha.get('/api/public/config');
  assert.ok((config.json.features as string[]).includes('ai'), 'and has it again once it is back on');
});

test('in-place Coach AI: asking for a reply or a plan outline with no provider is refused and sends, saves or notifies nothing', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const ananya = userId(h.ctx, DEMO.member);
  const beforeRows = memberVisible(ananya);
  const draftsBefore = h.db.get<{ n: number }>('SELECT COUNT(*) n FROM ai_drafts')!.n;
  for (const purpose of ['message_reply', 'plan_outline']) {
    const r = await asha.post('/api/coach/ai/drafts', { purpose, memberId: ananya, instructions: 'Keep it short.' });
    assert.equal(errCode(r), 'AI_NOT_CONFIGURED', `${purpose}: ${JSON.stringify(r.json)}`);
  }
  assert.deepEqual(memberVisible(ananya), beforeRows, 'no message, notification, plan or summary changed');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM ai_drafts')!.n, draftsBefore, 'no draft was made up in place of one');
});

test('Messages: a thread the coach may not open is refused with 403, which the page shows in its thread card', async () => {
  const ananya = userId(h.ctx, DEMO.member);
  const ashaId = userId(h.ctx, DEMO.coach);
  const conv = h.db.get<{ id: string }>('SELECT id FROM conversations WHERE member_id = ? AND coach_id = ?', [ananya, ashaId])!;
  const other = h.db.get<{ email: string }>("SELECT email FROM users WHERE role = 'coach' AND id != ? AND id NOT IN (SELECT coach_id FROM coach_assignments WHERE member_id = ? AND status IN ('active','paused')) ORDER BY email LIMIT 1", [ashaId, ananya])!;
  const coach = await signedIn(other.email, DEMO_PASSWORDS.coach);
  const r = await coach.get(`/api/conversations/${conv.id}/messages?limit=100`);
  assert.equal(r.status, 403);
  assert.equal(r.json.error?.code, 'NO_ACCESS');
  assert.ok(r.json.error?.message, 'with a message for the page to show');
});

/* ---------- the portal's own files ---------- */

test('in-place Coach AI: an accepted draft is added after what the coach wrote, never in place of it', async () => {
  const { withDraft, inlineNote } = await dashboard('modules/ai/shared.tsx');
  assert.equal(withDraft('', 'Hello Ananya'), 'Hello Ananya');
  assert.equal(withDraft('   ', '  Hello Ananya \n'), 'Hello Ananya');
  assert.equal(withDraft('Thanks for the update.', 'Hello Ananya'), 'Thanks for the update.\n\nHello Ananya');
  assert.equal(withDraft('Thanks for the update.\n\n', 'Hello Ananya'), 'Thanks for the update.\n\nHello Ananya');
  assert.equal(withDraft('Keep this', '   '), 'Keep this', 'an empty draft changes nothing');
  // the closed panel's line: not configured, not for this client yet, or the page's own introduction
  assert.equal(inlineNote({ configured: false, missing: [{ key: 'member_consent', label: 'x' }] }, 'intro'), 'No draft can use this client’s details yet. Open it to see why.');
  assert.equal(inlineNote({ configured: false, missing: [{ key: 'retention', label: 'x' }, { key: 'member_consent', label: 'y' }] }, 'intro'), 'Coach AI is not configured, so no draft can be made here yet. Open it to see what is missing.');
  assert.equal(inlineNote({ configured: true, missing: [] }, 'Ask for a reply.'), 'Ask for a reply.');
});

test('in-place Coach AI: the draft card puts an accepted draft into the page’s field only through the coach’s own buttons', async () => {
  const React = await load('react');
  const { renderToStaticMarkup } = await load('react-dom/server');
  const { MemoryRouter } = await load('react-router-dom');
  const { DraftCard, AiDraftInline } = await dashboard('modules/ai/shared.tsx');
  const base = {
    id: 'aid_test', purpose: 'message_reply', purposeLabel: 'Reply to a message', memberId: 'usr_test', memberName: 'Test client', output: 'A draft reply.', finalText: null,
    inputRefs: [], contextScope: { client: true, messages: 3 }, promptVersion: 'p1', provider: 'none', model: null, error: null,
    createdAt: '2026-10-24T08:00:00.000Z', updatedAt: '2026-10-24T08:00:00.000Z', acceptedAt: null, discardedAt: null, label: 'AI draft: read and edit before you use it. Nothing is sent to the client.',
  };
  let calls = 0;
  const use = { accept: 'Accept and put in your reply', again: 'Put in your reply', done: 'It is in your reply box above. Nothing is sent until you press Send.', set: () => { calls++; } };
  const html = (d: object, withUse: boolean) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(DraftCard, { d, onChange: () => {}, ...(withUse ? { use } : {}) })));
  const ready = html({ ...base, status: 'ready' }, true);
  assert.ok(ready.includes('Accept and put in your reply') && !ready.includes('Accept and copy'), 'in Messages the ready draft offers the reply box');
  assert.ok(ready.includes('A draft reply.'), 'the draft is shown in an editable box first');
  assert.ok(html({ ...base, status: 'ready' }, false).includes('Accept and copy'), 'the Coach AI page and client tab keep copying');
  const accepted = html({ ...base, status: 'accepted', output: null, finalText: 'My final reply.', acceptedAt: '2026-10-24T08:05:00.000Z' }, true);
  assert.ok(accepted.includes('Put in your reply') && accepted.includes('My final reply.'));
  assert.ok(!accepted.includes('Send it yourself from'), 'no link away to Messages from Messages itself');
  assert.equal(calls, 0, 'rendering puts nothing anywhere: only the coach’s click does');
  // nothing in place for anyone who is not a signed-in coach (no request is made for them either)
  assert.equal(renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(AiDraftInline, { memberId: 'usr_test', purpose: 'message_reply', title: 'Draft a reply', intro: 'x', use }))), '');
});

test('Messages: the reply draft sits under a coach’s open thread only while Coach AI is on, loaded lazily, and only Send sends', () => {
  const page = source(MESSAGES);
  assert.ok(page.includes("const AiDraftInline = React.lazy(() => import('../modules/ai/shared').then((m) => ({ default: m.AiDraftInline })));"));
  assert.ok(!/^import [^\n]*'\.\.\/modules\/ai\/shared'/m.test(page), 'never imported statically: members and administrators do not download it');
  assert.ok(page.includes("const aiOn = isCoach && !!features?.has('ai');"), 'coaches only, while the module is on');
  assert.ok(page.includes("const aiMember: string | null = aiOn && id && !thread.error && t?.conversation?.id === id ? t.conversation.memberId : null;"), 'the client of the thread on screen, once it has loaded');
  assert.ok(page.includes('{aiMember && <Suspense fallback={null}><AiDraftInline key={aiMember} memberId={aiMember} purpose="message_reply"'));
  assert.ok(page.includes("set: setBody }}"), 'an accepted draft goes into the reply box');
  assert.equal(page.match(/api\.post\(`\/conversations\/\$\{id\}\/messages`/g)?.length, 1, 'one place posts a message: Send');
  assert.ok(page.includes('useEffect(() => { setBody(\'\'); }, [id]);'), 'the reply box empties when another conversation opens');
  // the list error and the thread error, each with the existing Alert
  assert.ok(page.includes('<Card dense>{convs.error ? <Alert kind="error">{convs.error}</Alert> : convs.loading && !convs.data ? <Skeleton /> : list.length ?'));
  assert.ok(page.includes(': thread.error ? <Alert kind="error">{thread.error}</Alert> : !t ? <Skeleton /> :'));
  // the composer stays the first text box in the thread card, above the panel
  assert.ok(page.indexOf('<Textarea value={body}') < page.indexOf('<AiDraftInline'));
});

test('plan editor: the outline draft shows for a chosen client while Coach AI is on, loaded lazily, and only Save or Publish writes the plan', () => {
  const page = source(PLAN_EDITOR);
  assert.ok(page.includes("const AiDraftInline = React.lazy(() => import('../modules/ai/shared').then((m) => ({ default: m.AiDraftInline })));"));
  assert.ok(!/^import [^\n]*'\.\.\/modules\/ai\/shared'/m.test(page));
  assert.ok(page.includes("const features = useFeatures(isCoach);\n  const aiOn = isCoach && !!features?.has('ai');"), 'the switch list is asked for unconditionally (a hook), for coaches only');
  assert.ok(page.includes('{aiOn && member && <Suspense fallback={null}><AiDraftInline key={member} memberId={member} purpose="plan_outline"'));
  assert.ok(page.includes('set: setSummary }}'), 'an accepted outline goes into the summary field, unsaved');
  const writes = page.match(/api\.(post|patch)\(/g) ?? [];
  assert.equal(writes.length, 3, 'create, update and publish, all inside save()');
  const save = page.slice(page.indexOf('const save = async'), page.indexOf('const setWeek'));
  assert.equal((save.match(/api\.(post|patch)\(/g) ?? []).length, 3);
});

test('the three files show no "demo" or "sample" label to anyone; the consent line names the draft wording plainly', () => {
  for (const f of [MESSAGES, PLAN_EDITOR, AI_SHARED]) {
    const text = code(f);
    assert.ok(!/\bdemo\b/i.test(text), `${f} shows no "demo"`);
    assert.ok(!/\bsamples?\b/i.test(text), `${f} shows no "sample"`);
  }
  const shared = source(AI_SHARED);
  assert.ok(!shared.includes('demo draft wording'));
  assert.ok(shared.includes("m.aiConsent.version?.includes('draft') ? ' under the draft wording, pending review by counsel' : ''"));
  // the in-place panel: hidden on a 403 or 404 from the status request, closed until the coach opens it, its one-line
  // note shown while closed (the open panel names what is missing itself)
  assert.ok(shared.includes('hidden: e instanceof ApiRequestError && (e.status === 403 || e.status === 404)'));
  assert.ok(shared.includes('state.status && !open && <p className="muted">{inlineNote(state.status, intro)}</p>'));
  assert.ok(shared.includes('{open && <AiDraftPanel key={memberId} memberId={memberId} purpose={purpose} use={use} />}'));
  // the end-to-end check still finds the health-sharing line it looks for (tools/e2e_modules.py)
  assert.ok(shared.includes('Not shared: no values or check-in answers are included'));
});
