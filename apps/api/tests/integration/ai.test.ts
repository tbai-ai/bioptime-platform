/* M11 Coach AI drafting: with AI_PROVIDER=none every request is refused with AI_NOT_CONFIGURED naming what is missing,
   and nothing is generated or stored; permissions (the member's own consent, a coach's assigned clients only, ai.manage
   for usage); validation; the audit trail; the feature flag; and, with a recording provider registered for the tests
   only, the context a provider would receive (never a restricted key, health detail only with both coach_sharing and
   ai_processing, never another member's data), the review workflow (accept, discard; nothing ever sent), retention,
   reassignment, usage counts and the per-coach rate limit. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { findRestrictedFields, restrictedKeys } from '../../src/auth/fieldPolicy.js';
import { setUserPermission } from '../../src/auth/permissions.js';
import { moduleJobs } from '../../src/jobs.js';
import { setFlag } from '../../src/domain/features.js';
import { setSetting } from '../../src/domain/settings.js';
import { setConsent } from '../../src/domain/members.js';
import { ai as aiModule } from '../../src/modules/ai.js';
import * as aiDomain from '../../src/domain/ai.js';
import { overrideAiProviderForTests, type AiDraftRequest, type AiProvider } from '../../src/adapters/ai.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { overrideAiProviderForTests(h.ctx, null); await h.app.close(); h.db.close(); });

const as = (email: string): Ctx => {
  const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!;
  return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } };
};
const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const code = (r: { json: { error?: { code: string; details?: unknown } } }) => (r.json.error?.details as { code?: string } | undefined)?.code ?? r.json.error?.code;
const missingKeys = (r: { json: { error?: { details?: unknown } } }) => ((r.json.error?.details as { missing?: Array<{ key: string }> } | undefined)?.missing ?? []).map((m) => m.key);
const PRIYA = 'priya.nair@demo.bioptime.test'; // Asha's second client: shares health records, has not agreed to Coach AI
const INSTRUCTION = 'Test instruction ZQX-7731: keep it to three short points.';
const OUTPUT = 'Test draft text from the recording provider (tests only).';

/** A provider that records what it receives. Registered against this test's in-memory database only. */
class RecordingProvider implements AiProvider {
  readonly name = 'test-recorder';
  readonly model = 'test-model';
  readonly configured = true;
  calls: AiDraftRequest[] = [];
  fail = false;
  async draft(r: AiDraftRequest) {
    this.calls.push(JSON.parse(JSON.stringify(r)) as AiDraftRequest);
    if (this.fail) throw new Error('provider internals: stack and request detail that must not be stored');
    return { text: OUTPUT, model: 'test-model' };
  }
}

/** Rows a member could ever see: none of them may change because of Coach AI. */
const memberVisible = (memberId: string) => ({
  messages: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.member_id = ?', [memberId])!.n,
  notifications: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', [memberId])!.n,
  plans: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM coaching_plans WHERE member_id = ?', [memberId])!.n,
  versions: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM coaching_plan_versions v JOIN coaching_plans p ON p.id = v.plan_id WHERE p.member_id = ?', [memberId])!.n,
  tasks: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM plan_tasks WHERE member_id = ?', [memberId])!.n,
  responses: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM checkins WHERE member_id = ? AND response IS NOT NULL', [memberId])!.n,
  outbox: h.db.get<{ n: number }>('SELECT COUNT(*) n FROM outbox_messages')!.n, // no email, SMS or push to anyone
});

test('the module registers its routes, retention job, reassignment handler and demo seed; the seed records one demo consent and no draft', async () => {
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM ai_drafts')!.n, 0, 'no AI text is seeded');
  const ananya = userId(h.ctx, DEMO.member);
  const consent = h.db.get<{ granted: number; version: string }>("SELECT granted, version FROM member_consents WHERE user_id = ? AND kind = 'ai_processing' ORDER BY at DESC LIMIT 1", [ananya])!;
  assert.equal(consent.granted, 1);
  assert.match(consent.version, /^draft-/, 'the seeded consent says it is under draft wording');
  assert.doesNotMatch(consent.version, /demo/, 'members see the version next to their consent: no demo label');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM member_consents WHERE kind = 'ai_processing'")!.n, 1, 'one demo member only');
  assert.ok(moduleJobs().some((j) => j.name === 'ai.draft_retention'));
  assert.ok(aiModule.events?.CoachAssigned?.length);
  assert.deepEqual(aiModule.ungated, ['GET /me/ai/consent', 'POST /me/ai/consent', 'GET /me/assistant', 'POST /me/assistant/consent']);
  assert.equal(h.db.get<{ value: string | null }>("SELECT value FROM settings WHERE key = 'ai_draft_retention_days'")?.value ?? null, null, 'retention stays an owner decision');
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const mods = await owner.get('/api/admin/modules');
  const m = (mods.json.modules as Array<{ key: string; jobs: string[]; events: string[]; demoSeed: boolean }>).find((x) => x.key === 'ai')!;
  assert.deepEqual(m.jobs, ['draft_retention']);
  assert.deepEqual(m.events, ['CoachAssigned']);
  assert.ok(m.demoSeed);
});

test('with AI_PROVIDER none every draft request is refused with AI_NOT_CONFIGURED naming what is missing; nothing is generated or stored', async () => {
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const ananya = userId(h.ctx, DEMO.member), priya = userId(h.ctx, PRIYA);
  const status = await coach.get('/api/coach/ai/status');
  assert.equal(status.status, 200, JSON.stringify(status.json));
  assert.equal(status.json.configured, false);
  assert.equal(status.json.provider, 'none');
  assert.equal(status.json.model, null);
  const keys = (status.json.missing as Array<{ key: string; label: string }>).map((m) => m.key);
  assert.deepEqual(keys, ['provider', 'api_key', 'dpa', 'retention'], 'provider, API key, data-processing agreement and the retention decision');
  assert.match((status.json.missing as Array<{ label: string }>)[0]!.label, /AI_PROVIDER accepts only "none"/);
  assert.ok((status.json.purposes as Array<{ purpose: string; available: boolean }>).every((p) => p.available), 'progress, nutrition and workouts are on in the demo');

  const forAnanya = await coach.get(`/api/coach/ai/status?memberId=${ananya}`);
  assert.equal((forAnanya.json.member as { aiConsent: { granted: boolean } }).aiConsent.granted, true);
  assert.ok(!(forAnanya.json.missing as Array<{ key: string }>).some((m) => m.key === 'member_consent'));
  assert.deepEqual(findRestrictedFields(forAnanya.json, restrictedKeys()), [], 'the coach payload passes the field policy');
  const forPriya = await coach.get(`/api/coach/ai/status?memberId=${priya}`);
  assert.ok((forPriya.json.missing as Array<{ key: string; label: string }>).some((m) => m.key === 'member_consent' && m.label.includes('Priya')), 'the client’s consent is named');

  const before = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'ai.draft_request'")!.n;
  const r = await coach.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: priya, instructions: INSTRUCTION });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.error?.code, 'AI_NOT_CONFIGURED');
  assert.match(r.json.error!.message, /^Coach AI is not configured\. Missing: /);
  assert.deepEqual(missingKeys(r), ['provider', 'api_key', 'dpa', 'retention', 'member_consent']);
  const general = await coach.post('/api/coach/ai/drafts', { purpose: 'plan_outline' });
  assert.equal(general.json.error?.code, 'AI_NOT_CONFIGURED', 'a general outline is refused the same way');
  assert.deepEqual(missingKeys(general), ['provider', 'api_key', 'dpa', 'retention']);

  // the owner decides retention: still refused, now naming only the provider's requirements
  setSetting(as(DEMO.owner), 'ai_draft_retention_days', 30, 'test: thirty days');
  const again = await coach.post('/api/coach/ai/drafts', { purpose: 'message_reply', memberId: ananya });
  assert.equal(again.json.error?.code, 'AI_NOT_CONFIGURED');
  assert.deepEqual(missingKeys(again), ['provider', 'api_key', 'dpa']);
  setSetting(as(DEMO.owner), 'ai_draft_retention_days', null, 'test: back to undecided');

  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM ai_drafts')!.n, 0, 'a refused request stores nothing');
  const audits = h.db.all<{ actor_id: string; actor_role: string; data: string }>("SELECT actor_id, actor_role, data FROM audit_events WHERE action = 'ai.draft_request' ORDER BY at");
  assert.equal(audits.length, before + 3, 'each refused request is audited');
  for (const a of audits.slice(before)) {
    assert.equal(a.actor_id, userId(h.ctx, DEMO.coach));
    assert.equal(a.actor_role, 'coach');
    const d = JSON.parse(a.data) as { outcome: string; code: string; purpose: string };
    assert.equal(d.outcome, 'refused');
    assert.equal(d.code, 'AI_NOT_CONFIGURED');
    assert.ok(!a.data.includes('ZQX-7731'), 'instructions never reach the audit log');
  }

  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const mine = await member.get('/api/me/ai/consent');
  assert.equal(mine.status, 200);
  assert.equal(mine.json.inUse, false);
  assert.match(String(mine.json.note), /No AI provider is configured, so nothing about you is sent/);
});

test('permissions: members and administrators cannot use the coach routes; a coach reaches only assigned clients; ai.manage guards usage', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const vikram = userId(h.ctx, DEMO.member2), deepa = userId(h.ctx, DEMO.memberNoShare);

  assert.equal((await member.post('/api/coach/ai/drafts', { purpose: 'plan_outline' })).status, 403);
  assert.equal((await member.get('/api/coach/ai/drafts')).status, 403);
  assert.equal((await admin.get('/api/coach/ai/status')).status, 403);
  assert.equal((await coach.get('/api/admin/ai/usage')).status, 403);
  assert.equal((await member.get('/api/admin/ai/usage')).status, 403);
  assert.equal((await coach.get('/api/me/ai/consent')).status, 403, 'the consent is the member’s own');
  assert.equal((await coach.post('/api/me/ai/consent', { granted: false })).status, 403);

  const denied = await admin.get('/api/admin/ai/usage');
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error?.code, 'PERMISSION_DENIED', 'ai.manage is not an administrator default');
  assert.equal((await owner.get('/api/admin/ai/usage')).status, 200, 'owners hold every permission');
  setUserPermission(as(DEMO.owner), userId(h.ctx, DEMO.admin), 'ai.manage', true, 'test: Coach AI usage');
  assert.equal((await admin.get('/api/admin/ai/usage')).status, 200);
  setUserPermission(as(DEMO.owner), userId(h.ctx, DEMO.admin), 'ai.manage', false, 'test: done');

  for (const other of [vikram, deepa]) {
    const s = await coach.get(`/api/coach/ai/status?memberId=${other}`);
    assert.equal(s.status, 403);
    assert.equal(s.json.error?.code, 'NO_ACCESS');
    const d = await coach.post('/api/coach/ai/drafts', { purpose: 'message_reply', memberId: other });
    assert.equal(d.json.error?.code, 'NO_ACCESS', 'refused before anything about the client is read');
    assert.equal((await coach.get(`/api/coach/ai/drafts?memberId=${other}`)).json.error?.code, 'NO_ACCESS');
  }
  assert.equal((await coach.get('/api/coach/ai/status?memberId=usr_doesnotexist')).json.error?.code, 'NO_ACCESS', 'an unknown id answers like someone else’s client');
});

test('validation: purposes, the fields that go with each purpose, records that must belong to the client, sizes and unknown fields', async () => {
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const ananya = userId(h.ctx, DEMO.member), vikram = userId(h.ctx, DEMO.member2);
  const bad = async (body: unknown, path: string) => {
    const r = await coach.post('/api/coach/ai/drafts', body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error?.code, 'VALIDATION_FAILED');
    assert.ok((r.json.error?.details as Array<{ path: string }>).some((d) => d.path.startsWith(path)), `${path} named in ${JSON.stringify(r.json.error?.details)}`);
  };
  await bad({ purpose: 'diagnosis', memberId: ananya }, 'purpose');
  await bad({ memberId: ananya }, 'purpose');
  await bad({ purpose: 'message_reply' }, 'memberId');
  await bad({ purpose: 'checkin_response', memberId: ananya }, 'checkinId');
  await bad({ purpose: 'plan_outline', memberId: ananya, checkinId: 'chk_x' }, 'checkinId');
  await bad({ purpose: 'message_reply', memberId: ananya, planId: 'pln_x' }, 'planId');
  await bad({ purpose: 'plan_outline', planId: 'pln_x' }, 'planId');
  await bad({ purpose: 'plan_outline', memberId: ananya, instructions: 'x'.repeat(aiDomain.INSTRUCTIONS_MAX + 1) }, 'instructions');
  await bad({ purpose: 'plan_outline', memberId: ananya, sendToClient: true }, '');

  const vikramPlan = h.db.get<{ id: string }>('SELECT id FROM coaching_plans WHERE member_id = ?', [vikram])!.id;
  const notMine = await coach.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: ananya, planId: vikramPlan });
  assert.equal(notMine.status, 404, 'another client’s plan is not found');
  const otherCheckin = await coach.post('/api/coach/ai/drafts', { purpose: 'checkin_response', memberId: ananya, checkinId: 'chk_doesnotexist' });
  assert.equal(otherCheckin.status, 404);

  // a purpose whose module is off
  h.db.run("UPDATE feature_flags SET enabled = 0 WHERE key = 'nutrition'");
  try {
    const s = await coach.get('/api/coach/ai/status');
    const meal = (s.json.purposes as Array<{ purpose: string; available: boolean; unavailableReason: string | null }>).find((p) => p.purpose === 'meal_plan_outline')!;
    assert.equal(meal.available, false);
    assert.match(meal.unavailableReason!, /Nutrition/);
    assert.equal(code(await coach.post('/api/coach/ai/drafts', { purpose: 'meal_plan_outline', memberId: ananya })), 'PURPOSE_UNAVAILABLE');
  } finally { h.db.run("UPDATE feature_flags SET enabled = 1 WHERE key = 'nutrition'"); }

  assert.equal((await coach.post('/api/coach/ai/drafts/aid_doesnotexist/accept', { finalText: '' })).status, 400, 'the final text is required');
  assert.equal((await coach.post('/api/coach/ai/drafts/aid_doesnotexist/accept', { finalText: 'x'.repeat(aiDomain.FINAL_TEXT_MAX + 1) })).status, 400);
  assert.equal((await coach.post('/api/coach/ai/drafts/aid_doesnotexist/accept', { finalText: 'Fine' })).status, 404);
  assert.equal((await coach.post('/api/coach/ai/drafts/aid_doesnotexist/discard', { reason: 'x'.repeat(501) })).status, 400);
  assert.equal((await coach.get('/api/coach/ai/drafts?status=sent')).status, 400);
  assert.equal(code(await coach.post('/api/coach/ai/drafts/aid_doesnotexist/discard', {})), 'NOT_FOUND');

  const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  assert.equal(code(await member.post('/api/me/ai/consent', { granted: true })), 'CONSENT_VERSION', 'the wording version is required to agree');
  assert.equal(code(await member.post('/api/me/ai/consent', { granted: true, version: 'old' })), 'CONSENT_VERSION');
  assert.equal((await member.post('/api/me/ai/consent', { granted: 'yes' })).status, 400);
});

test('with a configured provider (a recording stand-in, tests only): the context follows consents, the field policy and assignment; drafts are reviewed, never sent', async () => {
  const provider = new RecordingProvider();
  overrideAiProviderForTests(h.ctx, provider);
  setSetting(as(DEMO.owner), 'ai_draft_retention_days', 30, 'test: thirty days');
  try {
    const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
    const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
    const ananya = userId(h.ctx, DEMO.member), priya = userId(h.ctx, PRIYA);
    const visibleBefore = memberVisible(ananya);
    const status = await coach.get(`/api/coach/ai/status?memberId=${ananya}`);
    assert.equal(status.json.configured, true, JSON.stringify(status.json.missing));

    // a plan outline: profile, the current plan and, with both consents, recent values
    const r = await coach.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: ananya, instructions: INSTRUCTION });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.status, 'ready');
    assert.equal(r.json.output, OUTPUT);
    assert.equal(r.json.provider, 'test-recorder');
    assert.match(String(r.json.label), /Nothing is sent to the client/);
    const call = provider.calls.at(-1)!;
    assert.equal(call.purpose, 'plan_outline');
    assert.equal(call.instructions, INSTRUCTION);
    assert.equal(call.promptVersion, aiDomain.PROMPT_VERSION);
    assert.ok(call.guidance.some((g) => /no medical/i.test(g)), 'the rules travel with every request');
    const ctxJson = JSON.stringify(call.context);
    assert.deepEqual(findRestrictedFields(call, restrictedKeys()), [], 'no restricted key reaches a provider');
    for (const secret of [DEMO.member, '+919700000011', '1992-03-14', '560001', 'Lake View Road', 'Rao']) assert.ok(!ctxJson.includes(secret), `${secret} never reaches a provider`);
    for (const other of ['Priya', 'Vikram', 'Deepa', userId(h.ctx, PRIYA), userId(h.ctx, DEMO.member2)]) assert.ok(!ctxJson.includes(other), 'no other member’s data');
    assert.equal((call.context.client as { firstName: string }).firstName, 'Ananya');
    assert.ok(Array.isArray(call.context.recentProgress) && (call.context.recentProgress as unknown[]).length > 0, 'health values with both consents');
    assert.ok(call.context.currentPlan, 'the coach’s current plan');
    assert.equal((r.json.contextScope as { health: boolean }).health, true);
    const refs = r.json.inputRefs as Array<{ type: string; id: string }>;
    assert.ok(refs.some((x) => x.type === 'user' && x.id === ananya) && refs.some((x) => x.type === 'coaching_plan') && refs.some((x) => x.type === 'progress_entry'));
    const row = h.db.get<{ input_refs: string; context_scope: string }>('SELECT input_refs, context_scope FROM ai_drafts WHERE id = ?', [String(r.json.id)])!;
    assert.ok(!row.input_refs.includes('sleep') && !row.context_scope.includes('Ananya'), 'the context itself is never stored, only ids and sections');
    const aud = h.db.get<{ data: string; actor_role: string }>("SELECT data, actor_role FROM audit_events WHERE action = 'ai.draft_request' AND target_id = ?", [String(r.json.id)])!;
    assert.equal(aud.actor_role, 'coach');
    assert.equal((JSON.parse(aud.data) as { outcome: string }).outcome, 'requested');
    assert.ok(!aud.data.includes('ZQX-7731') && !aud.data.includes(OUTPUT), 'neither instructions nor text in the audit log');
    assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'health.viewed' AND target_id = ? AND data LIKE '%coach-ai-context%'", [ananya]), 'health detail sent to a provider is recorded');

    // a message reply: the conversation with this coach
    const reply = await coach.post('/api/coach/ai/drafts', { purpose: 'message_reply', memberId: ananya });
    assert.equal(reply.status, 201);
    const conv = provider.calls.at(-1)!.context.conversation as Array<{ from: string; text: string }>;
    assert.ok(conv.some((m) => m.from === 'client' && m.text.includes('third night running')));
    assert.ok(!('recentProgress' in provider.calls.at(-1)!.context), 'a reply carries the messages, not the values');

    // a check-in response: answers only with both consents
    const checkin = h.db.get<{ id: string }>("SELECT id FROM checkins WHERE member_id = ? AND status = 'submitted' LIMIT 1", [ananya])!;
    const cr = await coach.post('/api/coach/ai/drafts', { purpose: 'checkin_response', memberId: ananya, checkinId: checkin.id });
    assert.equal(cr.status, 201);
    assert.ok((provider.calls.at(-1)!.context.checkin as { questions: Array<{ answer?: unknown }> }).questions.some((q) => q.answer !== undefined));

    // Ananya stops sharing health records with her coach: no values, no answers
    const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
    assert.equal((await member.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
    await coach.post('/api/coach/ai/drafts', { purpose: 'checkin_response', memberId: ananya, checkinId: checkin.id });
    const noHealth = provider.calls.at(-1)!.context;
    assert.ok((noHealth.checkin as { questions: Array<{ answer?: unknown }> }).questions.every((q) => q.answer === undefined), 'no answers without coach_sharing');
    assert.match(String((noHealth.checkin as { answersWithheld?: string }).answersWithheld), /does not share/);
    const outline = await coach.post('/api/coach/ai/drafts', { purpose: 'workout_outline', memberId: ananya });
    assert.ok(!('recentProgress' in provider.calls.at(-1)!.context));
    assert.equal((outline.json.contextScope as { health: boolean }).health, false);
    assert.equal((await member.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true })).status, 200);

    // no ai_processing consent: refused before the provider is asked
    const calls = provider.calls.length;
    const refused = await coach.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: priya });
    assert.equal(refused.json.error?.code, 'AI_CONSENT_REQUIRED');
    assert.deepEqual(missingKeys(refused), ['member_consent']);
    assert.equal(provider.calls.length, calls, 'the provider never hears about a client who has not agreed');
    assert.equal((await rahul.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: ananya })).json.error?.code, 'NO_ACCESS');
    assert.equal(provider.calls.length, calls);

    // review: accept with edits, discard, and nothing reaches the client
    const accepted = await coach.post(`/api/coach/ai/drafts/${String(r.json.id)}/accept`, { finalText: 'My own edited outline.' });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    assert.equal(accepted.json.status, 'accepted');
    assert.equal(accepted.json.finalText, 'My own edited outline.');
    assert.equal((JSON.parse(h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'ai.draft_accept' AND target_id = ?", [String(r.json.id)])!.data) as { edited: boolean }).edited, true);
    assert.equal(code(await coach.post(`/api/coach/ai/drafts/${String(r.json.id)}/accept`, { finalText: 'Again' })), 'DRAFT_NOT_READY');
    assert.equal(code(await coach.post(`/api/coach/ai/drafts/${String(r.json.id)}/discard`, {})), 'DRAFT_ACCEPTED');
    const discarded = await coach.post(`/api/coach/ai/drafts/${String(reply.json.id)}/discard`, { reason: 'Not the tone I want' });
    assert.equal(discarded.json.status, 'discarded');
    assert.equal(discarded.json.output, null, 'a discarded draft’s text is cleared at once');
    assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'ai.draft_discard' AND target_id = ? AND reason = 'Not the tone I want'", [String(reply.json.id)]));
    assert.equal(code(await coach.post(`/api/coach/ai/drafts/${String(reply.json.id)}/discard`, {})), 'DRAFT_DISCARDED');
    assert.equal(code(await coach.post(`/api/coach/ai/drafts/${String(reply.json.id)}/accept`, { finalText: 'x' })), 'DRAFT_NOT_READY');
    assert.equal((await rahul.get(`/api/coach/ai/drafts/${String(cr.json.id)}`)).status, 404, 'another coach’s draft is not found');
    assert.equal((await rahul.post(`/api/coach/ai/drafts/${String(cr.json.id)}/discard`, {})).status, 404);

    const list = await coach.get(`/api/coach/ai/drafts?memberId=${ananya}`);
    assert.equal(list.status, 200);
    assert.ok((list.json.items as Array<{ id: string }>).some((d) => d.id === r.json.id));
    assert.deepEqual(findRestrictedFields(list.json, restrictedKeys()), []);
    assert.equal(((await coach.get('/api/coach/ai/drafts?status=accepted')).json.items as unknown[]).length, 1);
    assert.deepEqual(memberVisible(ananya), visibleBefore, 'no message, notification, plan, task or check-in reply was written for the client');

    // a provider failure keeps none of the provider's own detail
    provider.fail = true;
    const failed = await coach.post('/api/coach/ai/drafts', { purpose: 'plan_outline' });
    assert.equal(failed.json.status, 'failed');
    assert.equal(failed.json.error, 'The AI provider could not make a draft');
    assert.ok(!JSON.stringify(failed.json).includes('internals'));
    provider.fail = false;
    assert.equal((provider.calls.at(-1)!.context as { client?: unknown }).client, undefined, 'a general outline carries no client');

    // Ananya withdraws ai_processing: open drafts about her are discarded and the AI text of accepted ones cleared
    const open = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM ai_drafts WHERE member_id = ? AND status IN ('requested','ready','failed')", [ananya])!.n;
    assert.ok(open > 0);
    const withdrawn = await member.post('/api/me/ai/consent', { granted: false });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.json.granted, false);
    assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM ai_drafts WHERE member_id = ? AND status IN ('requested','ready','failed')", [ananya])!.n, 0);
    assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM ai_drafts WHERE member_id = ? AND output IS NOT NULL', [ananya])!.n, 0);
    assert.equal(h.db.get<{ final_text: string }>('SELECT final_text FROM ai_drafts WHERE id = ?', [String(r.json.id)])!.final_text, 'My own edited outline.', 'the coach’s own text stays');
    assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'ai.drafts_cleared' AND target_id = ? AND reason = 'ai_processing consent withdrawn'", [ananya]));
    assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'consent.set' AND target_id = ? AND data LIKE '%ai_processing%'", [ananya]));
    assert.equal((await coach.post('/api/coach/ai/drafts', { purpose: 'message_reply', memberId: ananya })).json.error?.code, 'AI_CONSENT_REQUIRED');
    const regrant = await member.post('/api/me/ai/consent', { granted: true, version: aiDomain.AI_CONSENT.version });
    assert.equal(regrant.json.granted, true);
    assert.deepEqual(memberVisible(ananya), visibleBefore);
  } finally {
    overrideAiProviderForTests(h.ctx, null);
    setSetting(as(DEMO.owner), 'ai_draft_retention_days', null, 'test: back to undecided');
  }
});

/** Every leaf path of a context shape ('client.programme.name', 'conversation.text'; arrays are not marked). */
const shapeLeaves = (shape: object, at = ''): string[] => Object.entries(shape).flatMap(([k, v]) => (v === true ? [at + k] : shapeLeaves(v as object, `${at}${k}.`)));
/** The shape leaves a context actually carries (a branch the shape ends is not walked further). */
const leavesSeen = (value: unknown, shape: object, at = '', out = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) { for (const v of value) leavesSeen(v, shape, at, out); return out; }
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const s = (shape as Record<string, unknown>)[k];
    if (s === true) out.add(at + k); else if (s) leavesSeen(v, s as object, `${at}${k}.`, out);
  }
  return out;
};

test('the consent wording lists exactly what a draft request sends: every context field is named by a consent line, and every line is sent', async () => {
  // the shape check itself
  assert.deepEqual(aiDomain.unlistedContextPaths({ purpose: 'x', client: { firstName: 'A', email: 'a@b.test' }, conversation: [{ text: 'hi', sender: 'usr_x' }] }), ['client.email', 'conversation[].sender']);
  assert.deepEqual(aiDomain.unlistedContextPaths({ client: { preferences: { anything: 1 } } }), [], 'the preferences branch ends at the profile’s own preferences');

  // the consent lines cover every member field of the shape, once, and the wording carries every line in order
  const memberLeaves = shapeLeaves(aiDomain.CONTEXT_SHAPE).filter((p) => p !== 'purpose' && p !== 'purposeLabel').sort();
  const covered = aiDomain.AI_CONSENT_DATA.flatMap((d) => d.covers).sort();
  assert.deepEqual(covered, memberLeaves, 'each field a provider can receive is named by exactly one consent line');
  assert.deepEqual(aiDomain.AI_CONSENT.items, aiDomain.AI_CONSENT_DATA.map((d) => d.text));
  assert.equal(aiDomain.AI_CONSENT.text, [aiDomain.AI_CONSENT.intro, ...aiDomain.AI_CONSENT.items, aiDomain.AI_CONSENT.outro].join(' '));
  assert.ok(aiDomain.AI_CONSENT_DATA.some((d) => d.section === 'instructions'), 'the coach’s instructions are named too');
  assert.ok(!/are never sent/.test(aiDomain.AI_CONSENT.text), 'no promise that message text cannot carry');
  assert.match(aiDomain.AI_CONSENT.text, /never taken from your profile/);
  assert.match(aiDomain.AI_CONSENT.text, /sent as you wrote it/);
  assert.match(aiDomain.AI_CONSENT.intro, /the kind of draft and the rules it is asked to follow/, 'what travels with every request besides the member’s data');
  assert.match(aiDomain.AI_CONSENT_DATA.find((d) => d.section === 'conversation')!.text, /the first 1,000 characters of each/);
  assert.equal(aiDomain.MESSAGE_TEXT_IN_CONTEXT, 1000);
  assert.match(aiDomain.AI_CONSENT.version, /^draft-/);
  assert.equal(aiDomain.AI_CONSENT.label, 'Draft wording, pending review by counsel');

  // what buildContext produces for every purpose, with and without health sharing: only listed fields, and every listed field occurs
  const asha = userId(h.ctx, DEMO.coach), ananya = userId(h.ctx, DEMO.member);
  const member = { id: ananya, name: 'Ananya' };
  const checkin = h.db.get<{ id: string }>("SELECT id FROM checkins WHERE member_id = ? AND status = 'submitted' LIMIT 1", [ananya])!;
  const contexts: Array<Record<string, unknown>> = [];
  const build = (input: aiDomain.DraftInput) => contexts.push(aiDomain.buildContext(as(DEMO.coach), asha, input, member).context);
  for (const purpose of ['plan_outline', 'meal_plan_outline', 'workout_outline', 'message_reply'] as const) build({ purpose, memberId: ananya });
  build({ purpose: 'checkin_response', memberId: ananya, checkinId: checkin.id });
  const m = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  assert.equal((await m.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
  try { build({ purpose: 'checkin_response', memberId: ananya, checkinId: checkin.id }); }
  finally { assert.equal((await m.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true })).status, 200); }
  build({ purpose: 'plan_outline' });
  const seen = new Set<string>();
  for (const c of contexts) {
    assert.deepEqual(aiDomain.unlistedContextPaths(c), [], `only listed fields: ${JSON.stringify(c).slice(0, 200)}`);
    for (const m of (c.conversation as Array<{ text: string }> | undefined) ?? []) assert.ok(m.text.length <= aiDomain.MESSAGE_TEXT_IN_CONTEXT, 'no more of a message than the wording states');
    for (const p of leavesSeen(c, aiDomain.CONTEXT_SHAPE)) seen.add(p);
  }
  assert.deepEqual([...seen].sort(), shapeLeaves(aiDomain.CONTEXT_SHAPE).sort(), 'every field the wording names is one a draft request can send');
});

test('the flag’s audience applies to the client: outside a package-limited rollout no draft uses their details, even with a consent on record, and they can still withdraw it', async () => {
  const provider = new RecordingProvider();
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const priyaApp = await signedIn(PRIYA, DEMO_PASSWORDS.member);
  const ananya = userId(h.ctx, DEMO.member), priya = userId(h.ctx, PRIYA);
  const pkgOf = (id: string) => h.db.get<{ package_id: string }>("SELECT v.package_id FROM programmes g JOIN package_versions v ON v.id = g.package_version_id WHERE g.member_id = ? AND g.status IN ('active','paused') LIMIT 1", [id])!.package_id;
  const ananyaPkg = pkgOf(ananya);
  assert.notEqual(pkgOf(priya), ananyaPkg, 'the demo clients hold different packages');
  // Priya agrees while Coach AI is on for everyone; then the rollout narrows to Ananya's package
  assert.equal((await priyaApp.post('/api/me/ai/consent', { granted: true, version: aiDomain.AI_CONSENT.version })).json.current, true);
  setFlag(as(DEMO.owner), 'ai', { audience: { packageIds: [ananyaPkg] } }, 'test: one package first');
  try {
    const status = await coach.get(`/api/coach/ai/status?memberId=${priya}`);
    assert.equal(status.status, 200, 'coaches are not narrowed by packages');
    const st = status.json.member as { inAudience: boolean; sources: { conversation: unknown; plans: unknown[]; checkins: unknown[] } };
    assert.equal(st.inAudience, false);
    assert.deepEqual(st.sources, { conversation: null, plans: [], checkins: [] }, 'no starting records for a client no draft can be about');
    assert.ok((status.json.missing as Array<{ key: string; label: string }>).some((x) => x.key === 'member_audience' && x.label.includes('Priya')));
    assert.ok(!(status.json.missing as Array<{ key: string }>).some((x) => x.key === 'member_consent'), 'her consent is on record');
    const forAnanya = await coach.get(`/api/coach/ai/status?memberId=${ananya}`);
    assert.equal((forAnanya.json.member as { inAudience: boolean }).inAudience, true);

    // not configured: the audience is named with everything else
    const none = await coach.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: priya });
    assert.equal(none.json.error?.code, 'AI_NOT_CONFIGURED');
    assert.deepEqual(missingKeys(none), ['provider', 'api_key', 'dpa', 'retention', 'member_audience']);

    // configured: refused for Priya before the provider hears of her, and audited as a refusal; Ananya is drafted
    overrideAiProviderForTests(h.ctx, provider);
    setSetting(as(DEMO.owner), 'ai_draft_retention_days', 30, 'test: thirty days');
    const refused = await coach.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: priya });
    assert.equal(refused.status, 403, JSON.stringify(refused.json));
    assert.equal(refused.json.error?.code, 'FEATURE_DISABLED');
    assert.deepEqual(missingKeys(refused), ['member_audience']);
    assert.equal(provider.calls.length, 0, 'the provider never hears about a client outside the audience');
    const audited = h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'ai.draft_request' AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1", [priya])!;
    assert.equal((JSON.parse(audited.data) as { code: string; outcome: string }).code, 'FEATURE_DISABLED');
    assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM ai_drafts WHERE member_id = ?', [priya])!.n, 0);
    const ok = await coach.post('/api/coach/ai/drafts', { purpose: 'plan_outline', memberId: ananya });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(provider.calls.length, 1);

    // Priya, outside the audience: she sees her consent, cannot give it again, and can withdraw it
    const mine = await priyaApp.get('/api/me/ai/consent');
    assert.equal(mine.status, 200);
    assert.equal(mine.json.moduleOn, false);
    assert.equal(mine.json.granted, true);
    assert.equal(mine.json.canGrant, false);
    assert.match(String(mine.json.note), /switched off for your account/);
    assert.equal(code(await priyaApp.post('/api/me/ai/consent', { granted: true, version: aiDomain.AI_CONSENT.version })), 'FEATURE_DISABLED');
    const withdrawn = await priyaApp.post('/api/me/ai/consent', { granted: false });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.json.granted, false);
  } finally {
    overrideAiProviderForTests(h.ctx, null);
    setSetting(as(DEMO.owner), 'ai_draft_retention_days', null, 'test: back to undecided');
    setFlag(as(DEMO.owner), 'ai', { audience: {} }, 'test: everyone again');
  }
});

test('a consent given under an earlier wording is not used for drafts until the client agrees to the current one; it can still be withdrawn; accepting a draft names why the consent is missing', async () => {
  const provider = new RecordingProvider();
  const ananya = userId(h.ctx, DEMO.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  overrideAiProviderForTests(h.ctx, provider);
  setSetting(as(DEMO.owner), 'ai_draft_retention_days', 30, 'test: thirty days');
  try {
    // a draft made under the current wording; the wording then changes before the coach accepts it
    assert.equal((await member.post('/api/me/ai/consent', { granted: true, version: aiDomain.AI_CONSENT.version })).json.current, true);
    const ready = await coach.post('/api/coach/ai/drafts', { purpose: 'message_reply', memberId: ananya });
    assert.equal(ready.json.status, 'ready', JSON.stringify(ready.json));
    setConsent(as(DEMO.member), ananya, { kind: 'ai_processing', version: 'draft-2026-10-23a', granted: true });
    const late = await coach.post(`/api/coach/ai/drafts/${String(ready.json.id)}/accept`, { finalText: 'My own reply.' });
    assert.equal(late.status, 409, JSON.stringify(late.json));
    assert.equal(late.json.error?.code, 'AI_CONSENT_REQUIRED');
    assert.equal(late.json.error!.message, 'The client agreed to an earlier Coach AI wording and has not agreed to the current one; this draft can no longer be used');
    assert.doesNotMatch(late.json.error!.message, /withdr/, 'the client withdrew nothing, and the coach is not told they did');
    assert.equal((late.json.error!.details as { consent: string }).consent, 'earlier_wording');
    assert.equal(h.db.get<{ status: string }>('SELECT status FROM ai_drafts WHERE id = ?', [String(ready.json.id)])!.status, 'ready', 'refused, not accepted');
    assert.ok(!h.db.get("SELECT 1 FROM audit_events WHERE action = 'ai.draft_accept' AND target_id = ?", [String(ready.json.id)]));

    const mine = await member.get('/api/me/ai/consent');
    assert.equal(mine.json.granted, true, 'on record, so it can be withdrawn');
    assert.equal(mine.json.current, false);
    assert.equal(mine.json.earlierWording, true);
    assert.equal(mine.json.canGrant, true);
    assert.deepEqual((mine.json.wording as { items: string[] }).items, aiDomain.AI_CONSENT.items);
    const st = await coach.get(`/api/coach/ai/status?memberId=${ananya}`);
    assert.deepEqual((st.json.member as { aiConsent: { granted: boolean; earlierWording: boolean } }).aiConsent.granted, false);
    assert.equal((st.json.member as { aiConsent: { earlierWording: boolean } }).aiConsent.earlierWording, true);
    assert.ok((st.json.missing as Array<{ key: string; label: string }>).some((x) => x.key === 'member_consent' && /earlier wording/.test(x.label)));
    const refused = await coach.post('/api/coach/ai/drafts', { purpose: 'message_reply', memberId: ananya });
    assert.equal(refused.json.error?.code, 'AI_CONSENT_REQUIRED');
    assert.match(refused.json.error!.message, /earlier Coach AI wording/);
    assert.equal(provider.calls.length, 1, 'only the draft made under the current wording reached the provider');
    const withdrawn = await member.post('/api/me/ai/consent', { granted: false });
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.json.granted, false);
    assert.equal(withdrawn.json.earlierWording, false);
    assert.equal(h.db.get<{ version: string }>("SELECT version FROM member_consents WHERE user_id = ? AND kind = 'ai_processing' ORDER BY at DESC, rowid DESC LIMIT 1", [ananya])!.version, 'draft-2026-10-23a', 'the withdrawal names the wording it withdraws');
    const again = await member.post('/api/me/ai/consent', { granted: true, version: aiDomain.AI_CONSENT.version });
    assert.equal(again.json.current, true);
    assert.equal(again.json.earlierWording, false);
    assert.equal(aiDomain.aiConsentGranted(h.ctx, ananya), true);
    assert.equal(h.db.get<{ status: string }>('SELECT status FROM ai_drafts WHERE id = ?', [String(ready.json.id)])!.status, 'discarded', 'the withdrawal discarded the open draft');

    // the other reasons are named as they are: a withdrawal on record (recorded here without the API's clean-up, which
    // would discard the draft first) and no consent on record at all
    const second = await coach.post('/api/coach/ai/drafts', { purpose: 'message_reply', memberId: ananya });
    assert.equal(second.json.status, 'ready');
    setConsent(as(DEMO.member), ananya, { kind: 'ai_processing', version: aiDomain.AI_CONSENT.version, granted: false });
    const afterWithdrawal = await coach.post(`/api/coach/ai/drafts/${String(second.json.id)}/accept`, { finalText: 'My own reply.' });
    assert.equal(afterWithdrawal.json.error?.code, 'AI_CONSENT_REQUIRED');
    assert.equal(afterWithdrawal.json.error!.message, 'The client has withdrawn the ai_processing consent; this draft can no longer be used');
    assert.equal((afterWithdrawal.json.error!.details as { consent: string }).consent, 'withdrawn');
    // a ready draft (inserted directly) about an assigned client with no ai_processing row at all
    const pair = h.db.get<{ coach_id: string; member_id: string }>("SELECT coach_id, member_id FROM coach_assignments WHERE status IN ('active','paused') AND member_id NOT IN (SELECT user_id FROM member_consents WHERE kind = 'ai_processing') LIMIT 1")!;
    const orphan = `aid_test${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    h.db.insert('ai_drafts', { id: orphan, coach_id: pair.coach_id, member_id: pair.member_id, purpose: 'message_reply', input_refs: '[]', context_scope: '{}', prompt_version: aiDomain.PROMPT_VERSION, provider: 'test-recorder', model: 'test-model', status: 'ready', output: 'Test text (tests only)', created_at: now, updated_at: now });
    assert.throws(() => aiDomain.acceptDraft(h.ctx, pair.coach_id, orphan, 'My own reply.'), (e: { code?: string; message?: string; details?: { consent?: string } }) =>
      e.code === 'AI_CONSENT_REQUIRED' && e.message === 'The client has no ai_processing consent on record; this draft can no longer be used' && e.details?.consent === 'none');
    h.db.run('DELETE FROM ai_drafts WHERE id IN (?, ?)', [orphan, String(second.json.id)]);
    assert.equal((await member.post('/api/me/ai/consent', { granted: true, version: aiDomain.AI_CONSENT.version })).json.current, true);
  } finally {
    overrideAiProviderForTests(h.ctx, null);
    setSetting(as(DEMO.owner), 'ai_draft_retention_days', null, 'test: back to undecided');
  }
});

test('copy promises only what the code enforces: nutrient values are asked of the provider, not filtered, and a coach reviews every draft', () => {
  const hint = aiDomain.PURPOSES.meal_plan_outline.hint;
  assert.ok(!/No nutrient values are produced/.test(hint));
  assert.match(hint, /asked not to state nutrient values/);
  assert.match(hint, /review every draft before anything reaches your client/);
  assert.ok(aiDomain.DRAFT_GUIDANCE.some((g) => /nutrient values/.test(g)), 'the request itself still travels with every draft');
  assert.ok(aiDomain.RULES.some((r) => /a request, not a guarantee/.test(r) && /review every draft/.test(r)));
  assert.ok(!aiDomain.RULES.some((r) => /are never included/.test(r)), 'message text and instructions are sent as written');
});

test('feature flag: coach and admin routes answer FEATURE_DISABLED while the module is off; a member can still see and withdraw the consent, not grant it', async () => {
  setFlag(as(DEMO.owner), 'ai', { enabled: false }, 'test: switch Coach AI off');
  try {
    const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
    const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
    assert.equal(code(await coach.get('/api/coach/ai/status')), 'FEATURE_DISABLED');
    assert.equal(code(await coach.post('/api/coach/ai/drafts', { purpose: 'plan_outline' })), 'FEATURE_DISABLED');
    assert.equal(code(await owner.get('/api/admin/ai/usage')), 'FEATURE_DISABLED');
    const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
    assert.equal((await member.get('/api/me/ai/consent')).status, 200);
    assert.equal(code(await member.post('/api/me/ai/consent', { granted: true, version: aiDomain.AI_CONSENT.version })), 'FEATURE_DISABLED');
    assert.equal((await member.post('/api/me/ai/consent', { granted: false })).status, 200, 'withdrawing always works');
  } finally { setFlag(as(DEMO.owner), 'ai', { enabled: true }, 'test: switch Coach AI back on'); }
  const member = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const ok = await member.post('/api/me/ai/consent', { granted: true, version: aiDomain.AI_CONSENT.version });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.granted, true);
  assert.equal(ok.json.current, true);
  assert.equal(ok.json.moduleOn, true);
  assert.equal(ok.json.healthShared, true);
  // switched off with a consent on record: the member sees it, cannot give it again, and withdraws it
  setFlag(as(DEMO.owner), 'ai', { enabled: false }, 'test: switch Coach AI off again');
  try {
    const off = await member.get('/api/me/ai/consent');
    assert.equal(off.json.granted, true);
    assert.equal(off.json.moduleOn, false);
    assert.equal(off.json.canGrant, false);
    assert.equal(off.json.inUse, false);
    assert.match(String(off.json.note), /You can still withdraw/);
    assert.equal((await member.post('/api/me/ai/consent', { granted: false })).json.granted, false);
  } finally { setFlag(as(DEMO.owner), 'ai', { enabled: true }, 'test: switch Coach AI back on'); }
});

test('outside the demo the consent cannot be recorded until counsel approves its wording, and Coach AI names that too', async () => {
  const dev: Ctx = { ...as(DEMO.member2), config: { ...h.ctx.config, isDemo: false, BIOPTIME_MODE: 'development' } };
  assert.throws(() => aiDomain.setAiConsent(dev, dev.actor!.id, true, aiDomain.AI_CONSENT.version), (e: { code?: string }) => e.code === 'CONSENT_WORDING_PENDING');
  const state = aiDomain.aiConsentState(dev, dev.actor!.id);
  assert.equal(state.canGrant, false);
  assert.match(String(state.missing), /Counsel-approved wording/);
  assert.ok(aiDomain.systemReadiness(dev).missing.some((m) => m.key === 'consent_wording'));
});

test('retention and reassignment: drafts older than the owner’s period are deleted (audited), none while it is undecided; a reassigned client’s open drafts are discarded', async () => {
  const asha = userId(h.ctx, DEMO.coach), rahul = userId(h.ctx, DEMO.coach2), ananya = userId(h.ctx, DEMO.member);
  const insert = (createdAt: string, status = 'ready', coachId = asha) => {
    const id = `aid_test${Math.random().toString(36).slice(2, 10)}`;
    h.db.insert('ai_drafts', { id, coach_id: coachId, member_id: ananya, purpose: 'plan_outline', input_refs: '[]', context_scope: '{}', prompt_version: aiDomain.PROMPT_VERSION, provider: 'test-recorder', model: 'test-model', status, output: 'Test text (tests only)', created_at: createdAt, updated_at: createdAt });
    return id;
  };
  const old = insert(new Date(Date.now() - 40 * 86_400_000).toISOString());
  const recent = insert(new Date(Date.now() - 2 * 86_400_000).toISOString());
  assert.deepEqual(aiDomain.applyRetention(h.ctx), { deleted: 0, retentionDays: null }, 'nothing is deleted while retention is undecided');
  assert.ok(h.db.get('SELECT 1 FROM ai_drafts WHERE id = ?', [old]));
  setSetting(as(DEMO.owner), 'ai_draft_retention_days', 30, 'test: thirty days');
  try {
    const r = aiDomain.applyRetention(h.ctx);
    assert.ok(r.deleted >= 1);
    assert.equal(r.retentionDays, 30);
    assert.ok(!h.db.get('SELECT 1 FROM ai_drafts WHERE id = ?', [old]));
    assert.ok(h.db.get('SELECT 1 FROM ai_drafts WHERE id = ?', [recent]));
    assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'ai.draft_retention' AND actor_role = 'system'"));
  } finally { setSetting(as(DEMO.owner), 'ai_draft_retention_days', null, 'test: back to undecided'); }

  const rahulsOwn = insert(new Date().toISOString(), 'ready', rahul);
  assert.ok(aiDomain.onCoachAssigned(h.ctx, { memberId: ananya, coachId: rahul }) >= 1);
  assert.equal(h.db.get<{ status: string; output: string | null }>('SELECT status, output FROM ai_drafts WHERE id = ?', [recent])!.status, 'discarded');
  assert.equal(h.db.get<{ output: string | null }>('SELECT output FROM ai_drafts WHERE id = ?', [recent])!.output, null);
  assert.equal(h.db.get<{ status: string }>('SELECT status FROM ai_drafts WHERE id = ?', [rahulsOwn])!.status, 'ready', 'the new coach’s drafts stay');
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'ai.drafts_cleared' AND reason = 'the client was assigned another coach'"));
  h.db.run('DELETE FROM ai_drafts WHERE id = ?', [rahulsOwn]);
});

test('administrators with ai.manage see counts only, never draft text, instructions or client details', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const r = await owner.get('/api/admin/ai/usage');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const totals = r.json.totals as { requests: number; refused: number; drafted: number; accepted: number; discarded: number };
  assert.ok(totals.refused >= 3 && totals.drafted >= 4 && totals.accepted >= 1 && totals.discarded >= 1, JSON.stringify(totals));
  assert.equal(totals.requests, totals.refused + totals.drafted);
  assert.equal((r.json.readiness as { configured: boolean; provider: string }).provider, 'none');
  assert.equal((r.json.readiness as { configured: boolean }).configured, false);
  const byCoach = r.json.byCoach as Array<{ coachName: string; requests: number }>;
  assert.ok(byCoach.some((c) => c.coachName === 'Asha Menon' && c.requests > 0));
  assert.equal((r.json.byPurpose as Array<{ purpose: string }>).length, 5);
  const text = JSON.stringify(r.json);
  for (const s of [OUTPUT, 'ZQX-7731', 'My own edited outline', 'Ananya', 'Priya', DEMO.member]) assert.ok(!text.includes(s), `${s} is not in the usage payload`);
  assert.equal((await owner.get('/api/admin/ai/usage?from=2026-10-20&to=2026-10-01')).status, 400);
  assert.equal((await owner.get('/api/admin/ai/usage?from=2024-01-01&to=2026-10-01')).status, 400, 'at most a year at a time');
  assert.equal((await owner.get('/api/admin/ai/usage?from=yesterday')).status, 400);
});

test('rate limit: a coach may ask for a set number of drafts an hour (refused ones count); another coach is unaffected', async () => {
  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach);
  const meeraId = userId(h.ctx, DEMO.coach3);
  const already = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'ai.draft_request' AND actor_id = ?", [meeraId])!.n;
  for (let i = already; i < aiDomain.DRAFTS_PER_HOUR; i++) assert.equal((await meera.post('/api/coach/ai/drafts', { purpose: 'plan_outline' })).json.error?.code, 'AI_NOT_CONFIGURED');
  const limited = await meera.post('/api/coach/ai/drafts', { purpose: 'plan_outline' });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error?.code, 'RATE_LIMITED');
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  assert.equal((await rahul.post('/api/coach/ai/drafts', { purpose: 'plan_outline' })).json.error?.code, 'AI_NOT_CONFIGURED', 'per coach');
  assert.equal((await meera.get('/api/coach/ai/status')).status, 200, 'reading is not limited');
});
