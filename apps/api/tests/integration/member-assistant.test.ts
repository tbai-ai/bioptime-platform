/* The member assistant behind an off switch (owner decision D2, 30 October 2026; 0044_member_assistant.sql): off by
   default (GET /me/assistant says so and why, and answers while the 'ai' module is off), POST refused with 409
   ASSISTANT_OFF while off and 409 AI_NOT_CONFIGURED when switched on without a provider (nothing is ever generated
   without one), the administrator's switch (settings.manage, reason, audited), the assistant_processing consent
   (offered first, the draft wording recorded only in the preview, withdrawal deletes the conversation), audit rows
   without text, the per-member limit, and each member's conversation private to them. With a recording provider
   registered for the tests only: what a provider receives is the rules and the member's own conversation, nothing
   else. member_consents is rebuilt keeping every row and rowid. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId, type Client } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { Db, MIGRATIONS_DIR } from '../../src/db/db.js';
import { AppError } from '../../src/lib/errors.js';
import { setFlag } from '../../src/domain/features.js';
import { NoneAiProvider, overrideAiProviderForTests, type AiProvider, type AssistantRequest } from '../../src/adapters/ai.js';
import * as assistant from '../../src/domain/assistant.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { overrideAiProviderForTests(h.ctx, null); await h.app.close(); h.db.close(); });

const as = (email: string): Ctx => { const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!; return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name } }; };
const member = async (email: string): Promise<Client> => { const c = client(h.app); await c.login(email, DEMO_PASSWORDS.member, 'member'); return c; };
const admin = async (): Promise<Client> => { const c = client(h.app); await c.login(DEMO.admin, DEMO_PASSWORDS.admin, 'dashboard', true); return c; };
type Status = { on: boolean; offer: boolean; reason: string | null; missing: Array<{ key: string; label: string }>; consent: { granted: boolean; earlierWording: boolean; version: string | null; canGrant: boolean; wording: { version: string; status: string; label: string; text: string } } };
const keys = (s: Status) => s.missing.map((m) => m.key);

const ANSWER = 'Test answer from the recording provider (tests only).';
class RecordingProvider implements AiProvider {
  readonly name = 'test-recorder';
  readonly model = 'test-model';
  readonly configured = true;
  calls: AssistantRequest[] = [];
  fail = false;
  async draft(): Promise<never> { throw new Error('drafts are not part of these tests'); }
  async answer(r: AssistantRequest) {
    this.calls.push(JSON.parse(JSON.stringify(r)) as AssistantRequest);
    if (this.fail) throw new Error('provider internals: request detail that must not be kept');
    return { text: ANSWER, model: 'test-model' };
  }
}

test('0044 rebuilds member_consents keeping every row, its rowid and its index, and adds assistant_processing; the switch starts off', () => {
  const db = new Db(':memory:');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql') && x < '0044').sort()) { db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')); db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [f, 'test']); }
    const now = '2026-10-30T10:00:00.000Z';
    db.insert('users', { id: 'usr_a', email: 'a@demo.bioptime.test', role: 'member', state: 'active', name: 'A', created_at: now, updated_at: now });
    // rows inserted out of rowid order, two at the same time (the later rowid is the later consent)
    db.run("INSERT INTO member_consents (rowid, id, user_id, kind, version, granted, ip, at) VALUES (7, 'cns_b', 'usr_a', 'coach_sharing', 'v1', 0, NULL, ?), (3, 'cns_a', 'usr_a', 'coach_sharing', 'v1', 1, '127.0.0.1', ?), (12, 'cns_c', 'usr_a', 'ai_processing', 'draft', 1, NULL, ?)", [now, now, now]);
    const before = db.all('SELECT rowid AS r, * FROM member_consents ORDER BY rowid');
    assert.throws(() => db.insert('member_consents', { id: 'cns_x', user_id: 'usr_a', kind: 'assistant_processing', version: 'v', granted: 1, at: now }), /CHECK/, 'not before 0044');
    db.migrate();
    assert.deepEqual(db.all('SELECT rowid AS r, * FROM member_consents ORDER BY rowid'), before, 'every row, with its rowid, unchanged');
    assert.deepEqual(db.all<{ name: string }>("PRAGMA table_info('member_consents')").map((c) => c.name), ['id', 'user_id', 'kind', 'version', 'granted', 'ip', 'at']);
    assert.ok(db.all<{ name: string }>("PRAGMA index_list('member_consents')").some((i) => i.name === 'member_consents_user'));
    assert.deepEqual(db.all("PRAGMA foreign_key_list('member_consents')").map((f) => (f as { table: string }).table), ['users']);
    assert.equal(db.get<{ granted: number }>("SELECT granted FROM member_consents WHERE user_id = 'usr_a' AND kind = 'coach_sharing' ORDER BY at DESC, rowid DESC LIMIT 1")!.granted, 0, 'the latest of two at the same time is still the later rowid');
    db.insert('member_consents', { id: 'cns_new', user_id: 'usr_a', kind: 'assistant_processing', version: 'v', granted: 1, at: now });
    assert.throws(() => db.insert('member_consents', { id: 'cns_bad', user_id: 'usr_a', kind: 'bogus', version: 'v', granted: 1, at: now }), /CHECK/);
    assert.throws(() => db.insert('assistant_messages', { id: 'asm_x', member_id: 'usr_a', role: 'coach', body: 'x', created_at: now }), /CHECK/);
    assert.equal(db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'member_assistant'")!.value, '"off"');
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
  } finally { db.close(); }
});

test('off by default: GET /me/assistant says so and why; POST is refused with 409 ASSISTANT_OFF, audited without the text; nothing is stored', async () => {
  const m = await member(DEMO.member);
  const r = await m.get('/api/me/assistant');
  assert.equal(r.status, 200);
  const s = r.json as unknown as Status;
  assert.deepEqual([s.on, s.offer, s.reason], [false, false, 'The assistant is not switched on.']);
  assert.ok(keys(s).includes('assistant_switch') && keys(s).includes('provider') && keys(s).includes('api_key'), keys(s).join());
  assert.deepEqual([s.consent.granted, s.consent.canGrant, s.consent.version], [false, false, null]);
  assert.equal(s.consent.wording.label, 'Draft wording, for counsel’s review outside the preview');
  assert.match(s.consent.wording.text, /Nothing else from your account is sent/);
  assert.equal(assistant.switchOn(h.ctx), false);

  const before = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'assistant.request'")!.n;
  const sent = await m.post('/api/me/assistant/messages', { body: 'Private question · must not be stored' });
  assert.equal(sent.status, 409);
  assert.deepEqual([sent.json.error?.code, sent.json.error?.message], ['ASSISTANT_OFF', 'The assistant is not switched on.']);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'assistant.request'")!.n, before + 1);
  const row = h.db.get<{ actor_id: string; data: string }>("SELECT actor_id, data FROM audit_events WHERE action = 'assistant.request' ORDER BY at DESC, rowid DESC LIMIT 1")!;
  assert.equal(row.actor_id, userId(h.ctx, DEMO.member));
  assert.deepEqual({ outcome: JSON.parse(row.data).outcome, code: JSON.parse(row.data).code }, { outcome: 'refused', code: 'ASSISTANT_OFF' });
  assert.ok(!row.data.includes('Private question'), 'never the text');
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM assistant_messages')!.n, 0);
  assert.deepEqual((await m.get('/api/me/assistant/messages')).json, { on: false, reason: 'The assistant is not switched on.', items: [] });

  // a consent cannot be given to something not offered; withdrawing works
  assert.equal((await m.post('/api/me/assistant/consent', { granted: true, version: assistant.ASSISTANT_CONSENT.version })).json.error?.code, 'ASSISTANT_OFF');
  const withdrawn = await m.post('/api/me/assistant/consent', { granted: false });
  assert.equal(withdrawn.status, 200);
  assert.equal(h.db.get<{ granted: number }>("SELECT granted FROM member_consents WHERE user_id = ? AND kind = 'assistant_processing'", [userId(h.ctx, DEMO.member)])!.granted, 0);
  // members record it only through its own route
  assert.equal((await m.post('/api/me/consents', { kind: 'assistant_processing', version: 'v', granted: true })).status, 400);
  // the provider seam refuses too: no answer without a provider
  await assert.rejects(() => new NoneAiProvider(h.config).answer(), (e: unknown) => e instanceof AppError && e.code === 'AI_NOT_CONFIGURED');
});

test('the switch: settings.manage with a reason, audited; on without a provider the assistant stays off and POST answers 409 AI_NOT_CONFIGURED naming what is missing', async () => {
  const a = await admin();
  const coach = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  const m = await member(DEMO.member);
  assert.equal((await m.put('/api/admin/assistant', { enabled: true, reason: 'test: member' })).status, 403);
  assert.equal((await coach.put('/api/admin/assistant', { enabled: true, reason: 'test: coach' })).status, 403);
  assert.equal((await client(h.app).put('/api/admin/assistant', { enabled: true, reason: 'test: anyone' })).status, 401);
  assert.equal((await a.put('/api/admin/assistant', { enabled: true })).status, 400, 'a reason is required');
  assert.equal(assistant.switchOn(h.ctx), false, 'nothing changed');

  const on = await a.put('/api/admin/assistant', { enabled: true, reason: 'test: switch on without a provider' });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.deepEqual([on.json.enabled, on.json.offered, on.json.provider], [true, false, 'none']);
  assert.ok((on.json.missing as Array<{ key: string }>).some((x) => x.key === 'provider'));
  const audit = h.db.get<{ reason: string; data: string; actor_id: string }>("SELECT reason, data, actor_id FROM audit_events WHERE action = 'assistant.switch' ORDER BY at DESC, rowid DESC LIMIT 1")!;
  assert.deepEqual([audit.reason, JSON.parse(audit.data), audit.actor_id], ['test: switch on without a provider', { from: 'off', to: 'on' }, userId(h.ctx, DEMO.admin)]);
  const again = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'assistant.switch'")!.n;
  assert.equal((await a.put('/api/admin/assistant', { enabled: true, reason: 'test: again' })).status, 200);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'assistant.switch'")!.n, again, 'no change, nothing recorded');

  try {
    const s = (await m.get('/api/me/assistant')).json as unknown as Status;
    assert.deepEqual([s.on, s.offer], [false, false]);
    assert.ok(keys(s).includes('provider') && !keys(s).includes('assistant_switch'), keys(s).join());
    assert.match(s.reason!, /No AI provider is configured/);
    const sent = await m.post('/api/me/assistant/messages', { body: 'Hello' });
    assert.equal(sent.status, 409);
    assert.equal(sent.json.error?.code, 'AI_NOT_CONFIGURED');
    assert.ok(((sent.json.error?.details as { missing: Array<{ key: string }> }).missing).some((x) => x.key === 'provider'));
    assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM assistant_messages')!.n, 0, 'never generated without a provider');
    assert.equal((await m.post('/api/me/assistant/consent', { granted: true, version: assistant.ASSISTANT_CONSENT.version })).json.error?.code, 'AI_NOT_CONFIGURED');
  } finally {
    assert.equal((await a.put('/api/admin/assistant', { enabled: false, reason: 'test: off again' })).status, 200);
  }
});

test('with a provider (a recording stand-in, tests only): offered, consent first, then the rules and the member’s own conversation reach it; private per member; withdrawal deletes the conversation', async () => {
  const provider = new RecordingProvider();
  overrideAiProviderForTests(h.ctx, provider);
  const owner = as(DEMO.owner);
  assistant.setSwitch(owner, true, 'test: on with a recording provider');
  const a = await member(DEMO.member);
  const b = await member(DEMO.member2);
  const ananya = userId(h.ctx, DEMO.member);
  try {
    let s = (await a.get('/api/me/assistant')).json as unknown as Status;
    assert.deepEqual([s.on, s.offer, s.consent.canGrant, keys(s)], [false, true, true, ['member_consent']]);
    assert.match(s.reason!, /Agree to how the assistant uses your messages/);
    assert.equal((await a.post('/api/me/assistant/messages', { body: 'Before consent' })).json.error?.code, 'ASSISTANT_CONSENT_REQUIRED');
    assert.equal(provider.calls.length, 0);
    assert.equal((await a.post('/api/me/assistant/consent', { granted: true, version: 'an-earlier-wording' })).json.error?.code, 'CONSENT_VERSION');
    // outside the preview the draft wording is not recorded
    const live: Ctx = { ...as(DEMO.member), config: { ...h.config, isDemo: false } };
    assert.throws(() => assistant.setAssistantConsent(live, ananya, true, assistant.ASSISTANT_CONSENT.version), (e: unknown) => e instanceof AppError && e.code === 'CONSENT_WORDING_PENDING');
    s = (await a.post('/api/me/assistant/consent', { granted: true, version: assistant.ASSISTANT_CONSENT.version })).json as unknown as Status;
    assert.deepEqual([s.on, s.consent.granted, s.consent.version, s.reason], [true, true, assistant.ASSISTANT_CONSENT.version, null]);

    const first = await a.post('/api/me/assistant/messages', { body: 'How do I log water?' });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    const items = first.json.items as Array<{ role: string; body: string; label: string | null; model: string | null }>;
    assert.deepEqual(items.map((i) => [i.role, i.body]), [['member', 'How do I log water?'], ['assistant', ANSWER]]);
    assert.equal(items[1]!.label, 'Written by an AI assistant, not your coach.');
    assert.equal((await a.post('/api/me/assistant/messages', { body: 'And steps?' })).status, 201);
    assert.equal(provider.calls.length, 2);
    const call = provider.calls[1]!;
    assert.deepEqual(call.messages, [{ role: 'member', text: 'How do I log water?' }, { role: 'assistant', text: ANSWER }, { role: 'member', text: 'And steps?' }], 'the member’s own conversation, oldest first');
    assert.deepEqual(call.guidance, assistant.ASSISTANT_GUIDANCE);
    assert.deepEqual(Object.keys(call).sort(), ['guidance', 'messages', 'promptVersion'], 'nothing else is sent');
    const sentText = JSON.stringify(provider.calls);
    for (const x of [DEMO.member, 'Ananya', ananya]) assert.ok(!sentText.includes(x), `no ${x} reaches the provider`);

    // B sees none of A's conversation, and cannot use it without B's own consent
    assert.deepEqual(((await b.get('/api/me/assistant/messages')).json as { items: unknown[] }).items, []);
    assert.equal((await b.post('/api/me/assistant/messages', { body: 'Hi' })).json.error?.code, 'ASSISTANT_CONSENT_REQUIRED');
    assert.equal(((await a.get('/api/me/assistant/messages')).json as { items: unknown[] }).items.length, 4);

    // the audit has outcomes, never text
    const rows = h.db.all<{ data: string }>("SELECT data FROM audit_events WHERE action = 'assistant.request' AND actor_id = ?", [ananya]);
    assert.ok(rows.some((r) => JSON.parse(r.data).outcome === 'answered'));
    for (const r of rows) for (const t of ['How do I log water', 'And steps', ANSWER]) assert.ok(!r.data.includes(t));

    // a provider failure keeps nothing and shows none of its detail
    provider.fail = true;
    const failed = await a.post('/api/me/assistant/messages', { body: 'This one fails' });
    assert.deepEqual([failed.status, failed.json.error?.code], [502, 'ASSISTANT_FAILED']);
    assert.ok(!failed.text.includes('provider internals'));
    assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM assistant_messages WHERE body = 'This one fails'")!.n, 0);
    provider.fail = false;

    // switched off: the conversation is hidden, not deleted, and nothing more is sent
    assistant.setSwitch(owner, false, 'test: off');
    assert.deepEqual(((await a.get('/api/me/assistant/messages')).json as { items: unknown[] }).items, []);
    assert.equal((await a.post('/api/me/assistant/messages', { body: 'While off' })).json.error?.code, 'ASSISTANT_OFF');
    assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM assistant_messages WHERE member_id = ?', [ananya])!.n, 4);
    assistant.setSwitch(owner, true, 'test: on again');

    // withdrawing deletes the conversation (and is recorded with how many messages, not what they said)
    s = (await a.post('/api/me/assistant/consent', { granted: false })).json as unknown as Status;
    assert.deepEqual([s.on, s.consent.granted], [false, false]);
    assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM assistant_messages WHERE member_id = ?', [ananya])!.n, 0);
    const cleared = h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'assistant.thread_cleared' AND target_id = ?", [ananya])!;
    assert.deepEqual(JSON.parse(cleared.data), { deleted: 4 });
    assert.equal(h.db.get<{ version: string }>("SELECT version FROM member_consents WHERE user_id = ? AND kind = 'assistant_processing' ORDER BY at DESC, rowid DESC LIMIT 1", [ananya])!.version, assistant.ASSISTANT_CONSENT.version, 'the withdrawal names the wording it withdraws');

    // the per-member limit counts every request in the last hour, refusals included
    for (let i = 0; i < assistant.ASSISTANT_PER_HOUR; i++) h.db.insert('audit_events', { id: `aud_probe_${i}`, actor_id: ananya, actor_role: 'member', action: 'assistant.request', target_type: 'user', target_id: ananya, data: '{"outcome":"refused"}', at: new Date().toISOString() });
    const limited = await a.post('/api/me/assistant/messages', { body: 'One too many' });
    assert.deepEqual([limited.status, limited.json.error?.code], [429, 'RATE_LIMITED']);
  } finally {
    assistant.setSwitch(owner, false, 'test: off at the end');
    overrideAiProviderForTests(h.ctx, null);
  }
});

test('with the Coach AI module off: GET /me/assistant and withdrawing the consent still answer; the conversation routes and the switch do not', async () => {
  const owner = as(DEMO.owner);
  const m = await member(DEMO.member2);
  const a = await admin();
  setFlag(owner, 'ai', { enabled: false }, 'test: ai off');
  try {
    const s = (await m.get('/api/me/assistant')).json as unknown as Status;
    assert.deepEqual([s.on, s.offer], [false, false]);
    assert.ok(keys(s).includes('member_audience'));
    assert.equal((await m.post('/api/me/assistant/consent', { granted: false })).status, 200);
    assert.equal((await m.get('/api/me/assistant/messages')).json.error?.code, 'FEATURE_DISABLED');
    assert.equal((await m.post('/api/me/assistant/messages', { body: 'Hi' })).json.error?.code, 'FEATURE_DISABLED');
    assert.equal((await a.put('/api/admin/assistant', { enabled: true, reason: 'test: on while the module is off' })).json.error?.code, 'FEATURE_DISABLED');
    assert.equal(assistant.switchOn(h.ctx), false);
    assert.equal(assistant.adminStatus(owner).moduleOn, false);
  } finally { setFlag(owner, 'ai', { enabled: true }, 'test: ai on'); }
});
