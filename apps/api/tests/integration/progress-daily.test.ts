/* Daily totals (30 October 2026): steps from the member's phone and water the member logs, through PUT
   /me/progress/daily. One entry per member, metric, India date, source and provider, updated in place (sending the same
   total again changes nothing); a day's value is the largest across its sources, never their sum, and names every
   source; today or up to 30 days back; the health_data consent is required; a member writes only their own; the summary
   and the series show one point per day; GET /me carries today's steps and water, and the coach's client view does not;
   water joins the metric list of a database that has one; progress_entries keeps its columns. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import { Db, MIGRATIONS_DIR } from '../../src/db/db.js';
import { addDays, dateInZone } from '../../src/lib/time.js';
import { putDailyTotal } from '../../src/domain/plans.js';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => {
  h = await makeApp();
  // as 0039 does on a database that has its metric list (the seed writes the list after the migrations ran)
  h.db.run("INSERT INTO metric_config (metric, label, unit, enabled, min_value, max_value, sort) SELECT 'water_ml', 'Water', 'ml', 1, 0, 10000, 0 WHERE NOT EXISTS (SELECT 1 FROM metric_config WHERE metric = 'water_ml')");
});
after(async () => { await h.app.close(); h.db.close(); });

const member = async (email: string) => { const c = client(h.app); await c.login(email, DEMO_PASSWORDS.member, 'member'); return c; };
const owner = async () => { const c = client(h.app); await c.login(DEMO.owner, DEMO_PASSWORDS.owner, 'dashboard', true); return c; };
const today = () => dateInZone(h.ctx.now());
const daysAgo = (n: number) => dateInZone(addDays(`${today()}T06:30:00.000Z`, -n));
const keyRows = (memberEmail: string, metric: string) => h.db.all<{ day: string; source: string; provider: string; entry_id: string }>('SELECT day, source, provider, entry_id FROM progress_daily_totals WHERE member_id = ? AND metric = ? ORDER BY day, source', [userId(h.ctx, memberEmail), metric]);
const steps = (date: string, value: number, source: 'device' | 'member' = 'device') => ({ metric: 'steps', date, value, source, ...(source === 'device' ? { provider: 'phone' } : {}) });

test('water joins the metric list of a database that has one (and a new database leaves it to the seed); progress_entries keeps its columns', () => {
  const older = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f < '0039').sort();
  const before39 = (db: Db) => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const f of older) { db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')); db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [f, 'test']); }
  };
  const columns = (db: Db) => db.all<{ name: string }>("PRAGMA table_info('progress_entries')").map((c) => c.name);
  const live = new Db(':memory:');
  try {
    before39(live);
    live.insert('metric_config', { metric: 'steps', label: 'Steps', unit: 'steps', enabled: 1, min_value: 0, max_value: 100000, sort: 0 });
    const cols = columns(live);
    live.migrate();
    assert.deepEqual({ ...live.get('SELECT metric, label, unit, enabled, min_value, max_value FROM metric_config WHERE metric = ?', ['water_ml'])! }, { metric: 'water_ml', label: 'Water', unit: 'ml', enabled: 1, min_value: 0, max_value: 10000 });
    assert.deepEqual(columns(live), cols, 'progress_entries keeps exactly its columns: the daily key lives in its own table');
    const pk = live.all<{ name: string; pk: number }>("PRAGMA table_info('progress_daily_totals')").filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    assert.deepEqual(pk, ['member_id', 'metric', 'day', 'source', 'provider']);
    assert.deepEqual(live.all("PRAGMA foreign_key_list('progress_daily_totals')").map((f) => (f as { table: string }).table), ['users'], 'no foreign key points at progress_entries, so it can be rebuilt as 0008 did');
  } finally { live.close(); }
  const fresh = new Db(':memory:');
  try {
    fresh.migrate();
    assert.equal(fresh.get<{ n: number }>('SELECT COUNT(*) n FROM metric_config')!.n, 0, 'an empty metric list stays empty: the built-in list (PROGRESS_METRICS) or the seed provides it');
  } finally { fresh.close(); }
});

test('a daily total is kept once per day, source and provider: the same total again changes nothing, a new one updates it in place', async () => {
  const m = await member(DEMO.member);
  const auditCount = () => h.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'progress.daily' AND target_id = ?", [userId(h.ctx, DEMO.member)])!.n;
  const first = await m.put('/api/me/progress/daily', steps(today(), 4200));
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const entry = first.json.entry as { id: string; value: number; source: string; provider: string; day: string; at: string; unit: string };
  assert.equal(entry.value, 4200);
  assert.equal(entry.source, 'device');
  assert.equal(entry.provider, 'phone');
  assert.equal(entry.day, today());
  assert.equal(entry.unit, 'steps');
  assert.equal(dateInZone(entry.at), today(), 'the entry’s time falls inside its India day');
  assert.equal((first.json.day as { value: number }).value, 4200);
  assert.equal(auditCount(), 1);

  const again = await m.put('/api/me/progress/daily', steps(today(), 4200));
  assert.equal((again.json.entry as { id: string }).id, entry.id);
  assert.equal(auditCount(), 1, 'nothing changed, nothing recorded');
  const more = await m.put('/api/me/progress/daily', steps(today(), 5100));
  assert.equal((more.json.entry as { id: string; value: number }).id, entry.id, 'updated in place');
  assert.equal((more.json.entry as { value: number }).value, 5100);
  assert.equal(keyRows(DEMO.member, 'steps').length, 1);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM progress_entries WHERE member_id = ? AND metric = 'steps'", [userId(h.ctx, DEMO.member)])!.n, 1, 'one entry, however often the phone sends');
  assert.equal(auditCount(), 2);
  for (const r of h.db.all<{ data: string; reason: string | null }>("SELECT data, reason FROM audit_events WHERE action = 'progress.daily'")) {
    const d = JSON.parse(r.data) as Record<string, unknown>;
    assert.deepEqual(Object.keys(d).sort(), ['created', 'date', 'metric', 'provider', 'source']);
    assert.ok(!r.data.includes('4200') && !r.data.includes('5100'), 'the audit never carries the value');
  }
});

test('the day’s value is the largest across its sources, never their sum, and every source is named', async () => {
  const m = await member(DEMO.member2);
  const day = daysAgo(1);
  assert.equal((await m.put('/api/me/progress/daily', steps(day, 6000))).status, 200);
  const typed = await m.put('/api/me/progress/daily', steps(day, 7400, 'member'));
  assert.equal(typed.status, 200, JSON.stringify(typed.json));
  const p = typed.json.day as { day: string; value: number; source: string; sourceLabel: string; sources: Array<{ source: string; provider: string | null; label: string; value: number }> };
  assert.equal(p.day, day);
  assert.equal(p.value, 7400, 'the larger of the two, not 13 400');
  assert.equal(p.source, 'member');
  assert.equal(p.sourceLabel, 'Self-reported');
  assert.deepEqual(p.sources, [{ source: 'member', provider: null, label: 'Self-reported', value: 7400 }, { source: 'device', provider: 'phone', label: 'From this phone', value: 6000 }]);
  const counted = await m.put('/api/me/progress/daily', steps(day, 8100));
  const q = counted.json.day as typeof p;
  assert.equal(q.value, 8100);
  assert.equal(q.sourceLabel, 'From this phone');
  assert.equal(keyRows(DEMO.member2, 'steps').length, 2, 'one entry per source');
  const entry = typed.json.entry as { at: string };
  assert.equal(dateInZone(entry.at), day, 'an earlier day’s entry is timed inside that day');

  // water: the member is its only source
  const w = await m.put('/api/me/progress/daily', { metric: 'water_ml', date: today(), value: 1250, source: 'member' });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal((w.json.entry as { unit: string }).unit, 'ml');
  assert.equal((w.json.day as { value: number }).value, 1250);
});

test('dates: today and up to 30 days back (India); a future date and an older one are refused', async () => {
  const m = await member(DEMO.member);
  const tomorrow = dateInZone(addDays(`${today()}T06:30:00.000Z`, 1));
  const r1 = await m.put('/api/me/progress/daily', steps(tomorrow, 100));
  assert.equal(r1.status, 400);
  assert.equal(r1.json.error?.code, 'DATE_IN_FUTURE');
  const r2 = await m.put('/api/me/progress/daily', steps(daysAgo(31), 100));
  assert.equal(r2.json.error?.code, 'DATE_TOO_OLD');
  assert.equal((await m.put('/api/me/progress/daily', steps(daysAgo(30), 100))).status, 200, 'thirty days back is still accepted');
  assert.equal((await m.put('/api/me/progress/daily', steps('2026-02-30', 100))).status, 400, 'a real date');
  // the demo seed may write an older history (never through the route); the other checks still hold
  const ananya = { memberId: userId(h.ctx, DEMO.member), metric: 'steps' as const, value: 7000, source: 'device' as const, provider: 'phone' as const };
  const older = putDailyTotal({ ...h.ctx, actor: null }, { ...ananya, date: daysAgo(55) }, { seed: true });
  assert.equal(older.day!.value, 7000);
  assert.throws(() => putDailyTotal(h.ctx, { ...ananya, date: tomorrow }, { seed: true }), /not happened yet/);
});

test('validation: water only from the member, a device names its provider, the member’s own total names none, the range holds, only daily metrics', async () => {
  const m = await member(DEMO.member);
  const bad = async (body: Record<string, unknown>, code: string, why: string) => { const r = await m.put('/api/me/progress/daily', body); assert.equal(r.status, 400, `${why}: ${JSON.stringify(r.json)}`); assert.equal(r.json.error?.code, code, why); };
  await bad({ metric: 'water_ml', date: today(), value: 300, source: 'device', provider: 'phone' }, 'VALIDATION_FAILED', 'water from a device');
  await bad({ metric: 'steps', date: today(), value: 300, source: 'device' }, 'VALIDATION_FAILED', 'a device without its provider');
  await bad({ metric: 'steps', date: today(), value: 300, source: 'member', provider: 'phone' }, 'VALIDATION_FAILED', 'the member’s total with a provider');
  await bad({ metric: 'steps', date: today(), value: -1, source: 'member' }, 'VALIDATION_FAILED', 'a negative total');
  await bad({ metric: 'weight_kg', date: today(), value: 70, source: 'member' }, 'VALIDATION_FAILED', 'weight is not a daily total');
  await bad({ metric: 'steps', date: today(), value: 300, source: 'coach' }, 'VALIDATION_FAILED', 'only device or member');
  await bad({ metric: 'water_ml', date: today(), value: 10001, source: 'member' }, 'VALUE_OUT_OF_RANGE', 'above the metric’s maximum');
});

test('the health_data consent is required; a member writes only their own totals; nobody else writes through the route', async () => {
  const m = await member(DEMO.member);
  assert.equal((await m.post('/api/me/consents', { kind: 'health_data', version: '2026-10-30', granted: false })).status, 200);
  const refused = await m.put('/api/me/progress/daily', steps(today(), 900, 'member'));
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error?.code, 'CONSENT_REQUIRED');
  assert.equal((await m.post('/api/me/consents', { kind: 'health_data', version: '2026-10-30', granted: true })).status, 200);
  assert.equal((await m.put('/api/me/progress/daily', steps(today(), 900, 'member'))).status, 200);

  // a member id in the body is not a field of the route: the total is always the caller's own
  const before = keyRows(DEMO.memberNoShare, 'steps').length;
  const other = await m.put('/api/me/progress/daily', { ...steps(today(), 3333, 'member'), memberId: userId(h.ctx, DEMO.memberNoShare) });
  assert.equal(other.status, 200);
  assert.equal((other.json.entry as { member_id: string }).member_id, userId(h.ctx, DEMO.member));
  assert.equal(keyRows(DEMO.memberNoShare, 'steps').length, before, 'nothing written for the other member');

  const coach = client(h.app);
  await coach.login(DEMO.coach, DEMO_PASSWORDS.coach, 'dashboard');
  assert.equal((await coach.put('/api/me/progress/daily', steps(today(), 100, 'member'))).status, 403, 'a coach has no daily totals');
  assert.equal((await client(h.app).put('/api/me/progress/daily', steps(today(), 100, 'member'))).status, 401);
});

test('the summary and the series show one point per day with its sources; water only while its metric is on', async () => {
  const m = await member(DEMO.member2);
  const sum = await m.get('/api/me/progress/summary');
  assert.equal(sum.status, 200);
  const metrics = sum.json.metrics as Array<{ metric: string; daily?: boolean; latest: { value: number; day: string } | null; series: Array<{ day: string; value: number; sources: unknown[] }> }>;
  const st = metrics.find((x) => x.metric === 'steps')!;
  assert.equal(st.daily, true);
  const yesterday = st.series.find((p) => p.day === daysAgo(1))!;
  assert.equal(yesterday.value, 8100);
  assert.equal(yesterday.sources.length, 2);
  assert.equal(new Set(st.series.map((p) => p.day)).size, st.series.length, 'one point per day');
  assert.ok(metrics.some((x) => x.metric === 'water_ml'), 'water is listed while it is on');

  const series = await m.get(`/api/me/progress/series?metric=steps&from=${daysAgo(7)}&to=${today()}`);
  assert.equal(series.status, 200, JSON.stringify(series.json));
  assert.equal(series.json.daily, true);
  const points = series.json.points as Array<{ day: string; value: number; sourceLabel: string }>;
  const y = points.find((p) => p.day === daysAgo(1))!;
  assert.equal(y.value, 8100);
  assert.equal(y.sourceLabel, 'From this phone');
  assert.equal(new Set(points.map((p) => p.day)).size, points.length, 'one point per day');

  const o = await owner();
  assert.equal((await o.patch('/api/admin/metrics-config/water_ml', { enabled: false, reason: 'test: water off' })).status, 200);
  try {
    const off = (await m.get('/api/me/progress/summary')).json.metrics as Array<{ metric: string }>;
    assert.ok(!off.some((x) => x.metric === 'water_ml'), 'not listed while it is off');
    assert.equal((await m.put('/api/me/progress/daily', { metric: 'water_ml', date: today(), value: 500, source: 'member' })).json.error?.code, 'METRIC_DISABLED');
    const me = await m.get('/api/me');
    assert.equal((me.json.today as { waterMl: unknown }).waterMl, null);
    assert.deepEqual((me.json.today as { metrics: string[] }).metrics, ['steps']);
  } finally {
    await o.patch('/api/admin/metrics-config/water_ml', { enabled: true, reason: 'test: water back on' });
  }
});

test('GET /me carries today’s steps and water (the day’s value); the coach’s client view leaves them out', async () => {
  const m = await member(DEMO.member2);
  assert.equal((await m.put('/api/me/progress/daily', steps(today(), 2500))).status, 200);
  assert.equal((await m.put('/api/me/progress/daily', steps(today(), 2100, 'member'))).status, 200);
  const me = await m.get('/api/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.today, { date: today(), steps: 2500, waterMl: 1250, metrics: ['steps', 'water_ml'] });
  const fresh = await member(DEMO.memberNoCoach);
  assert.deepEqual((await fresh.get('/api/me')).json.today, { date: today(), steps: null, waterMl: null, metrics: ['steps', 'water_ml'] }, 'nothing logged today reads null, never zero');

  const coachRow = h.db.get<{ email: string }>("SELECT u.email FROM coach_assignments a JOIN users u ON u.id = a.coach_id WHERE a.member_id = ? AND a.status = 'active'", [userId(h.ctx, DEMO.member2)])!;
  const coach = client(h.app);
  await coach.login(coachRow.email, DEMO_PASSWORDS.coach, 'dashboard');
  const view = await coach.get(`/api/coach/clients/${userId(h.ctx, DEMO.member2)}`);
  assert.equal(view.status, 200);
  assert.ok(!('today' in view.json), 'health values reach a coach only through the routes that check sharing');
});
