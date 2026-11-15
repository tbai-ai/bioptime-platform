/* M1 Habits and reminders: the member's own habits and check-ins, coach-set habits and what the member may change on
   them, the coach's view (assigned clients only; the habits a coach set always, the member's own habits and check-in
   notes only while coach_sharing is granted; the field policy's safety net), the member's data export,
   the administrator's read-only view behind members.manage, validation, the audit trail, reminders through the
   foundation queue (the reminders preference and quiet hours), the follow-up that waits for the owner's threshold and
   its privacy clean-up (which also runs while the module is off), the feature flag, the adherence provider and the
   labelled demo rows. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, client, DEMO, DEMO_PASSWORDS, userId } from '../helpers.js';
import type { Ctx } from '../../src/context.js';
import { findRestrictedFields, restrictedKeys, setRestrictedFieldReporter } from '../../src/auth/fieldPolicy.js';
import { setUserPermission } from '../../src/auth/permissions.js';
import { moduleJobs } from '../../src/jobs.js';
import { habits as habitsModule } from '../../src/modules/habits.js';
import * as habits from '../../src/domain/habits.js';
import * as reminders from '../../src/domain/reminders.js';
import { setSetting } from '../../src/domain/settings.js';
import { setPreferences } from '../../src/domain/notifications.js';
import { buildArchive } from '../../src/domain/dataExport.js';
import { coachSafe } from '../../src/http/routes/habits.js';
import { addDaysToDate } from '@bioptime/domain/modules/habits';

let h: Awaited<ReturnType<typeof makeApp>>;
before(async () => { h = await makeApp(); });
after(async () => { await h.app.close(); h.db.close(); });

const as = (email: string, now?: string): Ctx => {
  const u = h.db.get<{ id: string; role: 'member' | 'coach' | 'admin' | 'owner'; name: string }>('SELECT id, role, name FROM users WHERE email = ?', [email])!;
  return { ...h.ctx, actor: { id: u.id, role: u.role, email, name: u.name }, ...(now ? { now: () => now } : {}) };
};
const at = (iso: string): Ctx => ({ ...h.ctx, now: () => iso });
const signedIn = async (email: string, password: string, mfa = false) => { const c = client(h.app); await c.login(email, password, password === DEMO_PASSWORDS.member ? 'member' : 'dashboard', mfa); return c; };
const habitByTitle = (memberEmail: string, title: string) => h.db.get<{ id: string; created_by_role: string; status: string }>('SELECT * FROM habits WHERE member_id = ? AND title = ?', [userId(h.ctx, memberEmail), title])!;
/** The error code, or the state error's own code (errors.state answers INVALID_STATE with details.code). */
const code = (r: { json: { error?: { code: string; details?: unknown } } }) => (r.json.error?.details as { code?: string } | undefined)?.code ?? r.json.error?.code;
const auditCount = (action: string, targetId: string) => h.db.get<{ n: number }>('SELECT COUNT(*) n FROM audit_events WHERE action = ? AND target_id = ?', [action, targetId])!.n;
const today = () => habits.localDate(new Date().toISOString(), 'Asia/Kolkata');
/** A habit written straight through the domain (start date in the past allowed), for reminder and follow-up tests. */
/** The check-in notes the demo seed writes: Ananya's on her evening walk, Deepa's on protein at breakfast. */
const ANANYA_NOTES = ['Walked after dinner with a friend.', 'Shorter loop, it rained.'];
const DEEPA_NOTE = 'Travelling, hotel breakfast.';
const seedHabit = (email: string, title: string, startDaysAgo: number, extra: Partial<habits.HabitInput> = {}) => {
  const memberId = userId(h.ctx, email);
  return habits.createHabit(as(email), memberId, { role: 'member', id: memberId }, { title, schedule: { type: 'daily' }, startDate: addDaysToDate(today(), -startDaysAgo), ...extra }, { seed: true });
};

test('the demo seed writes habits in plain words with reminders off; the module registers its jobs, events and adherence', async () => {
  const rows = h.db.all<{ title: string; detail: string; reminders_on: number; reminder_times: string }>('SELECT title, detail, reminders_on, reminder_times FROM habits');
  assert.ok(rows.length >= 4, 'seeded habits exist');
  for (const r of rows) {
    assert.ok(r.detail.length > 0, 'each says what the habit is');
    assert.doesNotMatch(`${r.title} ${r.detail}`, /\bdemo\b|\bsample\b/i, 'the owner removed the demo and sample labels');
    assert.equal(r.reminders_on, 0, 'no reminder time is invented for the demo');
    assert.equal(r.reminder_times, '[]');
  }
  assert.deepEqual(h.db.all<{ note: string }>('SELECT note FROM habit_checkins WHERE note IS NOT NULL').map((n) => n.note).sort(), [...ANANYA_NOTES, DEEPA_NOTE].sort());
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM reminders WHERE ref_type = 'habit'")!.n, 0, 'the seed queues no reminders');
  assert.deepEqual(moduleJobs().filter((j) => j.name.startsWith('habits.')).map((j) => j.name), ['habits.habit_reminders', 'habits.habit_followups', 'habits.habit_followup_privacy']);
  assert.deepEqual((habitsModule.jobs ?? []).filter((j) => j.runWhenDisabled).map((j) => j.name), ['habit_followup_privacy'], 'only the privacy clean-up runs while the module is off');
  assert.ok(habitsModule.events?.CoachAssigned?.length, 'the reassignment handler is registered');
  assert.equal(typeof habitsModule.adherence?.compute, 'function');
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const mods = await owner.get('/api/admin/modules');
  const m = (mods.json.modules as Array<{ key: string; jobs: string[]; events: string[]; adherence: boolean; demoSeed: boolean }>).find((x) => x.key === 'habits')!;
  assert.ok(m.adherence && m.demoSeed);
  assert.equal(h.db.get<{ value: string | null }>("SELECT value FROM settings WHERE key = 'habit_followup_missed_days'")?.value ?? null, null, 'the follow-up threshold stays undecided');
});

test('a member lists, adds and changes their own habits; validation answers field by field; every write is audited', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const list = await member.get('/api/me/habits');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const items = list.json.items as Array<{ title: string; setBy: string; today: { date: string }; week: { done: number; target: number }; streak: { unit: string }; recent: unknown[] }>;
  assert.ok(items.some((i) => i.title === 'Evening walk' && i.setBy === 'coach'));
  assert.ok(items.some((i) => i.title === 'Lights out by 23:00' && i.setBy === 'member'));
  assert.equal(list.json.today, today());
  assert.equal(items[0]!.recent.length, 7);

  const bad = async (body: unknown, path: string) => {
    const r = await member.post('/api/me/habits', body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error?.code, 'VALIDATION_FAILED');
    assert.ok((r.json.error?.details as Array<{ path: string }>).some((d) => d.path.startsWith(path)), `${path} named in ${JSON.stringify(r.json.error?.details)}`);
  };
  await bad({ schedule: { type: 'daily' } }, 'title');
  await bad({ title: 'Stretch', schedule: { type: 'weekdays', weekdays: [] } }, 'schedule');
  await bad({ title: 'Stretch', schedule: { type: 'weekdays', weekdays: [8] } }, 'schedule');
  await bad({ title: 'Stretch', schedule: { type: 'hourly' } }, 'schedule');
  await bad({ title: 'Stretch', schedule: { type: 'times_per_week', timesPerWeek: 9 } }, 'schedule');
  await bad({ title: 'Stretch', schedule: { type: 'daily' }, reminderTimes: ['25:00'] }, 'reminderTimes');
  await bad({ title: 'Stretch', schedule: { type: 'daily' }, reminderTimes: ['07:00', '08:00', '09:00', '10:00', '11:00'] }, 'reminderTimes');
  await bad({ title: 'Stretch', schedule: { type: 'daily' }, remindersOn: true }, 'reminderTimes');
  await bad({ title: 'Stretch', schedule: { type: 'daily' }, startDate: today(), endDate: addDaysToDate(today(), -1) }, 'endDate');
  await bad({ title: 'Stretch', schedule: { type: 'daily' }, startDate: addDaysToDate(today(), -30) }, 'startDate');
  await bad({ title: 'Stretch', schedule: { type: 'daily' }, startDate: '2026-02-30' }, 'startDate');
  await bad({ title: 'Stretch', schedule: { type: 'daily' }, kind: 'medication' }, 'kind');
  await bad({ title: 'Stretch', schedule: { type: 'daily' }, planId: 'pln_someone' }, ''); // members do not link plans: refused by name, not dropped

  const created = await member.post('/api/me/habits', { title: 'Stretch after work', kind: 'movement', schedule: { type: 'weekdays', weekdays: [5, 1, 3, 3] }, reminderTimes: ['18:30', '07:15', '18:30'], remindersOn: true });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual(created.json.schedule, { type: 'weekdays', weekdays: [1, 3, 5] }, 'weekdays are stored sorted and once');
  assert.deepEqual(created.json.reminderTimes, ['07:15', '18:30']);
  assert.equal(created.json.setBy, 'member');
  const id = String(created.json.id);
  const memberId = userId(h.ctx, DEMO.member);
  const row = h.db.get<{ actor_id: string; actor_role: string }>("SELECT actor_id, actor_role FROM audit_events WHERE action = 'habit.create' AND target_id = ?", [id])!;
  assert.equal(row.actor_id, memberId);
  assert.equal(row.actor_role, 'member');

  const upd = await member.patch(`/api/me/habits/${id}`, { title: 'Stretch after work, 10 min', schedule: { type: 'times_per_week', timesPerWeek: 2 } });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  assert.equal(upd.json.scheduleLabel, '2 times a week');
  assert.equal(auditCount('habit.update', id), 1);
  assert.equal((await member.patch(`/api/me/habits/${id}`, {})).json.error?.code, 'NOTHING_TO_CHANGE');
  const paused = await member.patch(`/api/me/habits/${id}`, { status: 'paused' });
  assert.equal(paused.json.status, 'paused');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM reminders WHERE ref_type = 'habit' AND ref_id = ? AND status = 'queued'", [id])!.n, 0, 'a paused habit has no queued reminders');
  assert.equal(code(await member.post(`/api/me/habits/${id}/checkins`, { status: 'done' })), 'HABIT_PAUSED');
  assert.equal((await member.patch(`/api/me/habits/${id}`, { status: 'active' })).json.status, 'active');
  const archived = await member.patch(`/api/me/habits/${id}`, { status: 'archived' });
  assert.equal(archived.json.status, 'archived');
  assert.equal(auditCount('habit.archive', id), 1);
  assert.equal(code(await member.patch(`/api/me/habits/${id}`, { title: 'Again' })), 'HABIT_ARCHIVED');
  assert.ok(!((await member.get('/api/me/habits')).json.items as Array<{ id: string }>).some((i) => i.id === id), 'archived habits leave the list');
  assert.ok(((await member.get('/api/me/habits?archived=1')).json.items as Array<{ id: string }>).some((i) => i.id === id), 'and return when asked');
});

test('check-ins: one per day and idempotent, within the last week, only on due days; undo; notes never reach the audit log', async () => {
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const created = await member.post('/api/me/habits', { title: 'Glass of water on waking', schedule: { type: 'daily' }, startDate: addDaysToDate(today(), -3) });
  const id = String(created.json.id);
  const first = await member.post(`/api/me/habits/${id}/checkins`, { status: 'done', note: 'Private words' });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.created, true);
  assert.equal((first.json.habit as { today: { checkin: { status: string; note: string } } }).today.checkin.note, 'Private words', 'the member sees their own note');
  const again = await member.post(`/api/me/habits/${id}/checkins`, { status: 'done', note: 'Private words' });
  assert.equal(again.status, 200);
  assert.equal(again.json.created, false);
  assert.equal(again.json.changed, false);
  assert.equal(h.db.get<{ n: number }>('SELECT COUNT(*) n FROM habit_checkins WHERE habit_id = ?', [id])!.n, 1, 'one check-in per day');
  assert.equal(auditCount('habit.checkin', id), 1, 'repeating the same check-in writes nothing');
  const changed = await member.post(`/api/me/habits/${id}/checkins`, { status: 'skipped' });
  assert.equal(changed.json.changed, true);
  assert.equal(h.db.get<{ status: string; note: string }>('SELECT status, note FROM habit_checkins WHERE habit_id = ?', [id])!.note, 'Private words', 'an omitted note is kept');
  assert.equal(auditCount('habit.checkin', id), 2);
  for (const a of h.db.all<{ data: string }>("SELECT data FROM audit_events WHERE action = 'habit.checkin' AND target_id = ?", [id])) assert.ok(!a.data.includes('Private words'), 'the note is not copied into the audit log');

  const yesterday = await member.post(`/api/me/habits/${id}/checkins`, { status: 'done', date: addDaysToDate(today(), -1) });
  assert.equal(yesterday.status, 201);
  assert.equal((await member.post(`/api/me/habits/${id}/checkins`, { status: 'done', date: addDaysToDate(today(), 1) })).status, 400, 'not in the future');
  assert.equal(code(await member.post(`/api/me/habits/${id}/checkins`, { status: 'done', date: addDaysToDate(today(), -5) })), 'HABIT_NOT_RUNNING', 'not before the start');
  assert.equal((await member.post(`/api/me/habits/${id}/checkins`, { status: 'maybe' })).status, 400);
  assert.equal((await member.post(`/api/me/habits/${id}/checkins`, { status: 'done', note: 'x'.repeat(501) })).status, 400);
  const old = seedHabit(DEMO.member, 'Old habit for the backfill rule', 20);
  assert.equal((await member.post(`/api/me/habits/${old.id}/checkins`, { status: 'done', date: addDaysToDate(today(), -8) })).status, 400, 'at most a week back');

  const weekdayOnly = await member.post('/api/me/habits', { title: 'Weekday plank', schedule: { type: 'weekdays', weekdays: [((new Date(`${today()}T00:00:00Z`).getUTCDay() + 1) % 7) + 1] } });
  assert.equal(code(await member.post(`/api/me/habits/${weekdayOnly.json.id}/checkins`, { status: 'done' })), 'HABIT_NOT_DUE', 'a weekday habit takes check-ins on its days only');

  const undo = await member.del(`/api/me/habits/${id}/checkins/${addDaysToDate(today(), -1)}`);
  assert.equal(undo.status, 200, JSON.stringify(undo.json));
  assert.equal((await member.del(`/api/me/habits/${id}/checkins/${addDaysToDate(today(), -1)}`)).status, 404);
  assert.equal((await member.del(`/api/me/habits/${id}/checkins/2026-13-01`)).status, 400);
  const undoAudit = h.db.get<{ data: string }>("SELECT data FROM audit_events WHERE action = 'habit.checkin' AND target_id = ? ORDER BY at DESC LIMIT 1", [id])!;
  assert.equal(JSON.parse(undoAudit.data).undone, true);
});

test('a member reaches only their own habits; on a habit their coach set they change only the reminders', async () => {
  const ananya = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const vikram = await signedIn(DEMO.member2, DEMO_PASSWORDS.member);
  const walk = habitByTitle(DEMO.member, 'Evening walk');
  assert.equal(walk.created_by_role, 'coach');
  assert.equal((await vikram.patch(`/api/me/habits/${walk.id}`, { remindersOn: false })).status, 404, 'another member’s habit is not found');
  assert.equal((await vikram.post(`/api/me/habits/${walk.id}/checkins`, { status: 'done' })).status, 404, 'a member cannot check in on another member’s habit');
  assert.equal((await vikram.del(`/api/me/habits/${walk.id}/checkins/${today()}`)).status, 404);
  assert.ok(!((await vikram.get('/api/me/habits')).json.items as Array<{ id: string }>).some((i) => i.id === walk.id));
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  assert.equal((await coach.get('/api/me/habits')).status, 403, 'the member routes are for members');
  assert.equal((await client(h.app).get('/api/me/habits')).status, 401);

  const refused = await ananya.patch(`/api/me/habits/${walk.id}`, { title: 'Short walk' });
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error?.code, 'HABIT_SET_BY_COACH');
  assert.equal((await ananya.patch(`/api/me/habits/${walk.id}`, { status: 'paused' })).json.error?.code, 'HABIT_SET_BY_COACH');
  const ok = await ananya.patch(`/api/me/habits/${walk.id}`, { reminderTimes: ['19:30'], remindersOn: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.reminderTimes, ['19:30']);
  assert.equal(ok.json.remindersOn, true);
  assert.equal((await ananya.patch(`/api/me/habits/${walk.id}`, { remindersOn: false })).json.remindersOn, false);
});

test('a coach sees an assigned client’s habits and completion; check-in notes only while coach_sharing is granted; nothing restricted', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const rahul = await signedIn(DEMO.coach2, DEMO_PASSWORDS.coach);
  const meera = await signedIn(DEMO.coach3, DEMO_PASSWORDS.coach);
  const ananyaId = userId(h.ctx, DEMO.member), deepaId = userId(h.ctx, DEMO.memberNoShare);
  const keys = restrictedKeys();

  const view = await asha.get(`/api/coach/clients/${ananyaId}/habits`);
  assert.equal(view.status, 200, JSON.stringify(view.json));
  assert.equal(view.json.notesShared, true);
  const walk = (view.json.habits as Array<{ title: string; weekly: unknown[]; checkins: Array<{ note?: string | null }> }>).find((x) => x.title === 'Evening walk')!;
  assert.equal(walk.weekly.length, 5, 'four finished weeks and this one');
  assert.ok(walk.checkins.some((c) => typeof c.note === 'string' && ANANYA_NOTES.includes(c.note)), 'notes while shared');
  assert.deepEqual(findRestrictedFields(view.json, keys), [], 'no phone, email, address, PIN or date of birth');
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'health.viewed' AND target_id = ? AND data LIKE '%habit-checkin-notes%'", [ananyaId]), 'reading notes is audited');

  assert.equal((await rahul.get(`/api/coach/clients/${ananyaId}/habits`)).json.error?.code, 'NO_ACCESS', 'only the assigned coach');
  assert.equal((await rahul.post(`/api/coach/clients/${ananyaId}/habits`, { title: 'Not yours', schedule: { type: 'daily' } })).status, 403);
  const walkId = habitByTitle(DEMO.member, 'Evening walk').id;
  assert.equal((await rahul.patch(`/api/coach/habits/${walkId}`, { title: 'Not yours' })).status, 404);
  assert.equal((await rahul.post(`/api/coach/habits/${walkId}/archive`, { reason: 'not mine to archive' })).status, 404);

  // Deepa does not share health information with her coach: completion yes, notes no
  const deepa = await meera.get(`/api/coach/clients/${deepaId}/habits`);
  assert.equal(deepa.status, 200, JSON.stringify(deepa.json));
  assert.equal(deepa.json.notesShared, false);
  const text = JSON.stringify(deepa.json);
  for (const hb of deepa.json.habits as Array<{ today: { checkin: Record<string, unknown> | null }; checkins: Array<Record<string, unknown>> }>) {
    assert.ok(hb.checkins.every((c) => !('note' in c)), 'no note on any check-in');
    assert.ok(!hb.today.checkin || !('note' in hb.today.checkin));
  }
  assert.ok(!text.includes(DEEPA_NOTE), 'her note stays with her');
  const protein = (deepa.json.habits as Array<{ title: string; checkins: Array<{ status: string }>; week: unknown }>).find((x) => x.title === 'Protein at breakfast')!;
  assert.ok(protein.checkins.length > 0 && protein.checkins.every((c) => c.status === 'done' || c.status === 'skipped'), 'completion is visible');

  // a habit Deepa wrote herself: not in her coach's view at all (title, detail, target, completion) while she does not share
  const own = seedHabit(DEMO.memberNoShare, 'Deepa own probe', 2, { detail: 'Own detail probe', targetLabel: 'Own target probe' });
  habits.checkIn(as(DEMO.memberNoShare), deepaId, own.id, { status: 'done', note: 'Own note probe' });
  const hidden = await meera.get(`/api/coach/clients/${deepaId}/habits`);
  assert.equal(hidden.status, 200);
  assert.equal(hidden.json.memberHabitsShared, false);
  const hiddenText = JSON.stringify(hidden.json);
  for (const s of ['Deepa own probe', 'Own detail probe', 'Own target probe', 'Own note probe', own.id]) assert.ok(!hiddenText.includes(s), `${s} stays with the member`);
  assert.ok((hidden.json.habits as Array<{ setBy: string }>).every((x) => x.setBy === 'coach'), 'only the habits a coach set, as plan tasks');
  assert.ok((hidden.json.habits as Array<{ title: string }>).some((x) => x.title === 'Protein at breakfast'));
  assert.equal((await meera.patch(`/api/coach/habits/${own.id}`, { title: 'Renamed' })).status, 404, 'not found, as in the view');
  assert.equal((await meera.post(`/api/coach/habits/${own.id}/archive`, { reason: 'probe' })).status, 404);
  assert.ok(!h.db.get("SELECT 1 FROM audit_events WHERE action = 'health.viewed' AND target_id = ? AND data LIKE '%habit%'", [deepaId]), 'nothing shared, nothing recorded as a health read');

  // Deepa shares: her own habit and its note reach Meera, and the read is audited; withdrawn, both leave again
  const deepaSelf = await signedIn(DEMO.memberNoShare, DEMO_PASSWORDS.member);
  assert.equal((await deepaSelf.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true })).status, 200);
  try {
    const sharedView = await meera.get(`/api/coach/clients/${deepaId}/habits`);
    assert.equal(sharedView.json.memberHabitsShared, true);
    const ownShared = (sharedView.json.habits as Array<{ id: string; setBy: string; detail: string; targetLabel: string; checkins: Array<{ note?: string | null }> }>).find((x) => x.id === own.id)!;
    assert.equal(ownShared.setBy, 'member');
    assert.equal(ownShared.detail, 'Own detail probe');
    assert.ok(ownShared.checkins.some((c) => c.note === 'Own note probe'));
    assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'health.viewed' AND target_id = ? AND data LIKE '%member-written-habits%'", [deepaId]), 'reading the member’s own habits is audited');
    assert.equal((await meera.patch(`/api/coach/habits/${own.id}`, { title: 'Renamed' })).json.error?.code, 'HABIT_SET_BY_MEMBER', 'visible now, still the member’s to change');
  } finally {
    assert.equal((await deepaSelf.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
  }
  assert.ok(!JSON.stringify((await meera.get(`/api/coach/clients/${deepaId}/habits`)).json).includes('Deepa own probe'), 'withdrawn: gone again');
  habits.updateHabit(as(DEMO.memberNoShare), own.id, { role: 'member', id: deepaId }, { status: 'archived' });

  // Ananya withdraws sharing: her notes and her own habits leave the coach view at once, and come back with a new grant
  const ananya = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  assert.equal((await ananya.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
  const withdrawn = await asha.get(`/api/coach/clients/${ananyaId}/habits`);
  assert.equal(withdrawn.json.notesShared, false);
  assert.equal(withdrawn.json.memberHabitsShared, false);
  assert.ok(ANANYA_NOTES.every((note) => !JSON.stringify(withdrawn.json).includes(note)));
  assert.ok(!JSON.stringify(withdrawn.json).includes('Lights out by 23:00'), 'her own habit leaves the view');
  assert.ok((withdrawn.json.habits as Array<{ title: string }>).some((x) => x.title === 'Evening walk'), 'the habit her coach set stays');
  await ananya.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true });
  const regranted = await asha.get(`/api/coach/clients/${ananyaId}/habits`);
  assert.equal(regranted.json.notesShared, true);
  assert.ok((regranted.json.habits as Array<{ title: string }>).some((x) => x.title === 'Lights out by 23:00'));
});

test('the coach payload safety net looks before it trims: a restricted key is reported (paths only) and stripped, never sent and never a 500', () => {
  const seen: Array<{ where: string; paths: string[] }> = [];
  const prev = setRestrictedFieldReporter((where, paths) => { seen.push({ where, paths: [...paths] }); });
  try {
    const clean = { habits: [{ title: 'Evening walk', checkins: [{ date: '2026-10-01', status: 'done' }] }] };
    assert.equal(coachSafe(h.ctx, clean), clean, 'a clean payload goes out as built');
    assert.equal(seen.length, 0, 'and nothing is reported');
    // a restricted key anywhere, however deep or however spelt, is reported (its path, never its value) and dropped
    const leaks = [{ habits: [{ title: 'x', member: { phone: '+919700000013' } }] }, { email: 'someone@example.test' }, { items: [[{ Date_Of_Birth: '1974-11-21' }]] }, { a: { b: { pin_code: '600028' } } }];
    for (const leak of leaks) assert.deepEqual(findRestrictedFields(coachSafe(h.ctx, leak), restrictedKeys()), [], JSON.stringify(leak));
    assert.equal(seen.length, leaks.length, 'one report per payload');
    assert.ok(seen.every((r) => r.where === 'habits coach route'));
    assert.deepEqual(seen.map((r) => r.paths), [['.habits[0].member.phone'], ['.email'], ['.items[0][0].Date_Of_Birth'], ['.a.b.pin_code']]);
    for (const v of ['+919700000013', 'someone@example.test', '1974-11-21', '600028']) assert.ok(!JSON.stringify(seen).includes(v), `no value is reported (${v})`);
  } finally { setRestrictedFieldReporter(prev); }
});

test('a coach sets, changes, pauses and archives habits for an assigned client; the member is told; every write is audited', async () => {
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const ananya = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const ananyaId = userId(h.ctx, DEMO.member), ashaId = userId(h.ctx, DEMO.coach);
  const planId = h.db.get<{ id: string }>("SELECT id FROM coaching_plans WHERE member_id = ? AND status = 'published'", [ananyaId])!.id;
  const otherPlan = h.db.get<{ id: string }>('SELECT id FROM coaching_plans WHERE member_id != ? LIMIT 1', [ananyaId])!.id;

  assert.equal((await asha.post(`/api/coach/clients/${ananyaId}/habits`, { title: 'Morning light', schedule: { type: 'daily' }, planId: otherPlan })).json.error?.code, 'VALIDATION_FAILED', 'only the client’s own plan');
  const created = await asha.post(`/api/coach/clients/${ananyaId}/habits`, { title: 'Morning light, 10 minutes outside', kind: 'habit', schedule: { type: 'weekdays', weekdays: [1, 2, 3, 4, 5] }, planId, reminderTimes: ['08:00'], remindersOn: true });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = String(created.json.id);
  assert.equal(created.json.setBy, 'coach');
  assert.equal(created.json.planId, planId);
  const row = h.db.get<{ actor_id: string; actor_role: string; data: string }>("SELECT actor_id, actor_role, data FROM audit_events WHERE action = 'habit.create' AND target_id = ?", [id])!;
  assert.equal(row.actor_id, ashaId);
  assert.equal(row.actor_role, 'coach');
  assert.ok(h.db.get("SELECT 1 FROM notifications WHERE user_id = ? AND title = 'Your coach added a habit' AND data LIKE ?", [ananyaId, `%${id}%`]), 'the member is told in the app');
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM delivery_attempts d JOIN notifications n ON n.id = d.notification_id WHERE n.user_id = ? AND n.title = 'Your coach added a habit' AND d.channel = 'email'", [ananyaId])!.n, 0, 'not by email');
  assert.ok(((await ananya.get('/api/me/habits')).json.items as Array<{ id: string }>).some((i) => i.id === id));

  const changed = await asha.patch(`/api/coach/habits/${id}`, { schedule: { type: 'times_per_week', timesPerWeek: 4 }, targetLabel: '10 minutes', reason: 'Weekends work better for her' });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  assert.equal(changed.json.scheduleLabel, '4 times a week');
  assert.equal(h.db.get<{ reason: string }>("SELECT reason FROM audit_events WHERE action = 'habit.update' AND target_id = ? ORDER BY at DESC LIMIT 1", [id])!.reason, 'Weekends work better for her');
  const rem = await asha.patch(`/api/coach/habits/${id}`, { reminderTimes: ['09:00'] });
  assert.equal(rem.json.error?.code, 'VALIDATION_FAILED', 'reminders are the member’s choice once the habit exists');
  assert.match(rem.json.error!.message, /reminderTimes/, 'the refused field is named');
  const own = habitByTitle(DEMO.member, 'Lights out by 23:00');
  assert.equal((await asha.patch(`/api/coach/habits/${own.id}`, { title: 'Lights out by 22:30' })).json.error?.code, 'HABIT_SET_BY_MEMBER');
  assert.equal((await asha.post(`/api/coach/habits/${own.id}/archive`, { reason: 'tidy up' })).json.error?.code, 'HABIT_SET_BY_MEMBER');

  assert.equal((await asha.patch(`/api/coach/habits/${id}`, { status: 'paused' })).json.status, 'paused');
  assert.equal(code(await ananya.post(`/api/me/habits/${id}/checkins`, { status: 'done' })), 'HABIT_PAUSED');
  assert.equal((await asha.patch(`/api/coach/habits/${id}`, { status: 'active' })).json.status, 'active');
  assert.equal((await ananya.post(`/api/me/habits/${id}/checkins`, { status: 'done' })).status, 201);

  assert.equal((await asha.post(`/api/coach/habits/${id}/archive`, {})).status, 400, 'archiving needs a reason');
  const archived = await asha.post(`/api/coach/habits/${id}/archive`, { reason: 'Replaced by the new walking habit' });
  assert.equal(archived.status, 200);
  assert.equal(archived.json.status, 'archived');
  assert.equal(h.db.get<{ reason: string }>("SELECT reason FROM audit_events WHERE action = 'habit.archive' AND target_id = ?", [id])!.reason, 'Replaced by the new walking habit');
  assert.equal(code(await asha.patch(`/api/coach/habits/${id}`, { title: 'Again' })), 'HABIT_ARCHIVED');
});

test('an administrator reads a member’s habits only with members.manage; the module setting needs settings.manage', async () => {
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const ananyaId = userId(h.ctx, DEMO.member), adminId = userId(h.ctx, DEMO.admin);
  const ok = await admin.get(`/api/admin/members/${ananyaId}/habits`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok((ok.json.habits as unknown[]).length > 0);
  assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'member.record_viewed' AND target_id = ? AND data LIKE '%habits%'", [ananyaId]), 'the read is audited');
  assert.equal((await admin.get(`/api/admin/members/${userId(h.ctx, DEMO.coach)}/habits`)).status, 404, 'member records only');
  assert.equal((await coach.get(`/api/admin/members/${ananyaId}/habits`)).status, 403);
  assert.equal((await member.get(`/api/admin/members/${ananyaId}/habits`)).status, 403);

  setUserPermission(as(DEMO.owner), adminId, 'members.manage', false, 'test: a content-only administrator');
  try {
    const refused = await admin.get(`/api/admin/members/${ananyaId}/habits`);
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error?.code, 'PERMISSION_DENIED');
  } finally { setUserPermission(as(DEMO.owner), adminId, 'members.manage', true, 'test: restore'); }

  setUserPermission(as(DEMO.owner), adminId, 'settings.manage', false, 'test: no settings');
  try {
    assert.equal((await admin.patch('/api/admin/module-settings', { key: 'habit_followup_missed_days', value: 3, reason: 'test' })).json.error?.code, 'PERMISSION_DENIED');
  } finally { setUserPermission(as(DEMO.owner), adminId, 'settings.manage', true, 'test: restore'); }
  assert.equal((await admin.patch('/api/admin/module-settings', { key: 'habit_followup_missed_days', value: 0, reason: 'test: too low' })).json.error?.code, 'SETTING_INVALID');
});

test('reminders: queued for the next 24 hours in the member’s timezone, cancelled by a check-in, sent in-app and by push (never email), skipped when reminders are off, in-app only in quiet hours', async () => {
  const email = DEMO.member2;
  const memberId = userId(h.ctx, email);
  const day = today();
  // 06:00 in India on the member's local day; the habit reminds at 07:30 and 21:00
  const sixAm = habits.localTimeToIso(day, '06:00', 'Asia/Kolkata');
  const h1 = habits.createHabit(as(email, sixAm), memberId, { role: 'member', id: memberId }, { title: 'Reminder probe', schedule: { type: 'daily' }, reminderTimes: ['07:30', '21:00'], remindersOn: true }, { seed: true });
  const queued = () => h.db.all<{ due_at: string; status: string; category: string; channels: string }>("SELECT due_at, status, category, channels FROM reminders WHERE ref_type = 'habit' AND ref_id = ? ORDER BY due_at", [h1.id]);
  // the 24-hour window from 06:00 local
  habits.syncReminders(at(sixAm), h1);
  const q = queued().filter((r) => r.status === 'queued');
  assert.deepEqual(q.map((r) => r.due_at), [habits.localTimeToIso(day, '07:30', 'Asia/Kolkata'), habits.localTimeToIso(day, '21:00', 'Asia/Kolkata')].filter((d) => d > sixAm), 'the next 24 hours, at the local times');
  assert.equal(habits.localTimeToIso(day, '07:30', 'Asia/Kolkata'), new Date(Date.parse(`${day}T02:00:00Z`)).toISOString(), '07:30 IST is 02:00 UTC');
  assert.ok(q.every((r) => r.category === 'habit_reminder' && JSON.parse(r.channels).join() === 'in_app,push'));

  // the dispatcher at 07:31: an in-app notification and a logged push, no email
  const sevenThirtyOne = habits.localTimeToIso(day, '07:31', 'Asia/Kolkata');
  const sent = reminders.dispatchDue(at(sevenThirtyOne));
  assert.ok(sent.sent >= 1, JSON.stringify(sent));
  const n = h.db.get<{ id: string; title: string; body: string }>("SELECT id, title, body FROM notifications WHERE user_id = ? AND category = 'habit_reminder' ORDER BY created_at DESC LIMIT 1", [memberId])!;
  assert.equal(n.title, 'Habit reminder');
  assert.match(n.body, /Reminder probe/);
  const channels = h.db.all<{ channel: string }>('SELECT channel FROM delivery_attempts WHERE notification_id = ?', [n.id]).map((r) => r.channel).sort();
  assert.deepEqual(channels, ['in_app', 'push']);

  // a check-in cancels the rest of the day's reminders
  habits.checkIn(as(email, habits.localTimeToIso(day, '08:00', 'Asia/Kolkata')), memberId, h1.id, { status: 'done' });
  assert.ok(queued().filter((r) => r.due_at === habits.localTimeToIso(day, '21:00', 'Asia/Kolkata')).every((r) => r.status === 'cancelled'), 'checked in: the evening reminder is cancelled');
  habits.undoCheckIn(as(email, habits.localTimeToIso(day, '08:00', 'Asia/Kolkata')), memberId, h1.id, day);
  habits.syncReminders(at(habits.localTimeToIso(day, '08:00', 'Asia/Kolkata')), habits.getHabitRow(h.ctx, h1.id)!);
  assert.equal(queued().find((r) => r.due_at === habits.localTimeToIso(day, '21:00', 'Asia/Kolkata'))!.status, 'queued', 'undo brings it back');

  // reminders switched off in the member's preferences: skipped, nothing sent
  setPreferences(h.ctx, memberId, { reminders: false });
  const nine = habits.localTimeToIso(day, '21:01', 'Asia/Kolkata');
  const before = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND category = 'habit_reminder'", [memberId])!.n;
  const skipped = reminders.dispatchDue(at(nine));
  assert.ok(skipped.skipped >= 1);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND category = 'habit_reminder'", [memberId])!.n, before, 'nothing sent while reminders are off');
  setPreferences(h.ctx, memberId, { reminders: true });

  // quiet hours 20:00 to 07:00 local: tomorrow's 07:30 is outside, a 06:30 reminder inside reaches the app only
  reminders.setQuietHours(h.ctx, memberId, 20 * 60, 7 * 60);
  try {
    const tomorrow = addDaysToDate(day, 1);
    const early = habits.createHabit(as(email, sixAm), memberId, { role: 'member', id: memberId }, { title: 'Quiet hours probe', schedule: { type: 'daily' }, reminderTimes: ['06:30'], remindersOn: true }, { seed: true });
    habits.syncReminders(at(habits.localTimeToIso(day, '07:00', 'Asia/Kolkata')), early);
    const dueAt = habits.localTimeToIso(tomorrow, '06:30', 'Asia/Kolkata');
    assert.ok(h.db.get("SELECT 1 FROM reminders WHERE ref_id = ? AND due_at = ? AND status = 'queued'", [early.id, dueAt]), 'tomorrow 06:30 is queued');
    const r = reminders.dispatchDue(at(habits.localTimeToIso(tomorrow, '06:31', 'Asia/Kolkata')));
    assert.ok(r.inAppOnly >= 1, JSON.stringify(r));
    const quiet = h.db.get<{ id: string; data: string }>("SELECT id, data FROM notifications WHERE user_id = ? AND category = 'habit_reminder' AND body LIKE '%Quiet hours probe%'", [memberId])!;
    assert.deepEqual(h.db.all<{ channel: string }>('SELECT channel FROM delivery_attempts WHERE notification_id = ?', [quiet.id]).map((x) => x.channel), ['in_app'], 'in quiet hours nothing buzzes');
  } finally { reminders.setQuietHours(h.ctx, memberId, null, null); }

  // pausing cancels what is queued; the job queues nothing for a paused habit
  habits.updateHabit(as(email), h1.id, { role: 'member', id: memberId }, { status: 'paused' });
  assert.equal(queued().filter((r) => r.status === 'queued').length, 0);
  const job = habits.runReminderJob(at(sixAm));
  assert.ok(job.habits >= 0);
  assert.equal(queued().filter((r) => r.status === 'queued').length, 0);
});

test('follow-ups: none while the owner has not chosen a threshold; then one per slip for the assigned coach, without notes or a broadcast; it moves with a reassignment', async () => {
  const email = DEMO.member;
  const memberId = userId(h.ctx, email), ashaId = userId(h.ctx, DEMO.coach), rahulId = userId(h.ctx, DEMO.coach2);
  const slipping = seedHabit(email, 'Slipping probe', 6, { detail: 'test' });
  const tasks = () => h.db.all<{ id: string; owner_id: string; status: string; title: string; detail: string }>("SELECT * FROM support_tasks WHERE kind = 'coach_follow_up' AND ref_type = 'habit' AND ref_id = ?", [slipping.id]);

  assert.deepEqual(habits.runFollowUpJob(h.ctx), { threshold: null, checked: 0, opened: 0, closed: 0 }, 'a null threshold creates no follow-ups');
  assert.equal(tasks().length, 0);
  // Deepa does not share health information: her own slipping habit opens nothing (the task would name it); one her coach set does
  const deepaId = userId(h.ctx, DEMO.memberNoShare), meeraId = userId(h.ctx, DEMO.coach3);
  const deepaOwn = seedHabit(DEMO.memberNoShare, 'Unshared slipping probe', 6);
  const deepaCoachSet = habits.createHabit(as(DEMO.coach3), deepaId, { role: 'coach', id: meeraId }, { title: 'Coach-set slipping probe', schedule: { type: 'daily' }, startDate: addDaysToDate(today(), -6) }, { seed: true });
  const followUpsOn = (id: string) => h.db.all<{ status: string; title: string; owner_id: string }>("SELECT status, title, owner_id FROM support_tasks WHERE kind = 'coach_follow_up' AND ref_type = 'habit' AND ref_id = ?", [id]);

  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const set = await owner.patch('/api/admin/module-settings', { key: 'habit_followup_missed_days', value: 3, reason: 'test: owner decision for the test' });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  const opsBefore = h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE category = 'operations'")!.n;
  const run = habits.runFollowUpJob(h.ctx);
  assert.ok(run.opened >= 1, JSON.stringify(run));
  assert.equal(tasks().length, 1);
  const t = tasks()[0]!;
  assert.equal(t.owner_id, ashaId, 'the assigned coach owns it');
  assert.match(t.title, /Slipping probe/);
  assert.match(t.detail, /due days without a check-in/);
  assert.equal(h.db.get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE category = 'operations'")!.n, opsBefore, 'no administrator broadcast');
  assert.equal(followUpsOn(deepaOwn.id).length, 0, 'a habit the member wrote, without sharing: no follow-up');
  assert.deepEqual(followUpsOn(deepaCoachSet.id).map((x) => [x.status, x.owner_id]), [['open', meeraId]], 'a habit her coach set: one follow-up, as plan tasks');
  habits.runFollowUpJob(h.ctx);
  assert.equal(tasks().length, 1, 'de-duplicated while open');

  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const home = await asha.get('/api/coach/home');
  assert.ok((home.json.followUps as Array<{ id: string }>).some((f) => f.id === t.id), 'it appears among the Today follow-ups');
  const view = await asha.get(`/api/coach/clients/${memberId}/habits`);
  assert.equal((view.json.habits as Array<{ id: string; followUp: { id: string } | null }>).find((x) => x.id === slipping.id)!.followUp?.id, t.id);
  assert.equal((await asha.patch(`/api/coach/follow-ups/${t.id}`, { status: 'resolved', resolution: 'Talked it through' })).status, 200);
  habits.runFollowUpJob(h.ctx);
  assert.equal(tasks().length, 1, 'once per slip: not again until the member checks in and slips again');

  // the member checks in, then slips again (four days later): a new follow-up
  habits.checkIn(as(email), memberId, slipping.id, { status: 'done' });
  const later = new Date(Date.now() + 4 * 86_400_000 + 60_000).toISOString();
  habits.runFollowUpJob(at(later));
  assert.equal(tasks().filter((x) => x.status === 'open').length, 1, 'a new slip, a new follow-up');

  // reassignment: the open follow-ups (this one and any other slipping habit of the member) move to the new coach
  assert.ok(habits.onCoachAssigned(h.ctx, { memberId, coachId: rahulId }) >= 1);
  assert.equal(tasks().find((x) => x.status === 'open')!.owner_id, rahulId);
  habits.onCoachAssigned(h.ctx, { memberId, coachId: ashaId });

  // the member stops sharing: the open follow-up on her own habit closes (its title names the habit) and none reopens
  const ananya = await signedIn(email, DEMO_PASSWORDS.member);
  assert.equal((await ananya.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
  try {
    const sweep = habits.runFollowUpJob(at(later));
    assert.ok(sweep.closed >= 1, JSON.stringify(sweep));
    assert.ok(tasks().every((x) => x.status !== 'open'), 'no open follow-up names her own habit');
    assert.match(h.db.get<{ resolution: string }>("SELECT resolution FROM support_tasks WHERE kind = 'coach_follow_up' AND ref_id = ? AND status = 'dismissed'", [slipping.id])!.resolution, /no longer shares health information/);
    assert.ok(h.db.get("SELECT 1 FROM audit_events WHERE action = 'support_task.update' AND target_id IN (SELECT id FROM support_tasks WHERE ref_id = ? AND status = 'dismissed')", [slipping.id]), 'closing it is audited');
    habits.runFollowUpJob(at(later));
    assert.ok(tasks().every((x) => x.status !== 'open'), 'and none reopens while she does not share');
  } finally {
    await ananya.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true });
  }
  for (const id of [slipping.id, deepaOwn.id, deepaCoachSet.id]) habits.archiveHabit(h.ctx, id, { role: 'member', id: h.db.get<{ member_id: string }>('SELECT member_id FROM habits WHERE id = ?', [id])!.member_id }, 'test: tidy up');
  setSetting(as(DEMO.owner), 'habit_followup_missed_days', null, 'test: back to undecided');
});

test('the habits flag: off, every habit route answers FEATURE_DISABLED and the jobs stand still, except the privacy clean-up', async () => {
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const member = await signedIn(DEMO.member, DEMO_PASSWORDS.member);
  const coach = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const admin = await signedIn(DEMO.admin, DEMO_PASSWORDS.admin, true);
  const ananyaId = userId(h.ctx, DEMO.member);
  assert.equal((await owner.patch('/api/admin/modules', { key: 'habits', enabled: false, reason: 'test: habits off' })).status, 200);
  try {
    for (const r of [await member.get('/api/me/habits'), await member.post('/api/me/habits', { title: 'Off', schedule: { type: 'daily' } }), await coach.get(`/api/coach/clients/${ananyaId}/habits`), await admin.get(`/api/admin/members/${ananyaId}/habits`)]) {
      assert.equal(r.status, 403);
      assert.equal(r.json.error?.code, 'FEATURE_DISABLED');
    }
    const jobs = moduleJobs().filter((j) => j.name.startsWith('habits.'));
    for (const job of jobs.filter((j) => j.name !== 'habits.habit_followup_privacy')) assert.deepEqual(await job.run(h.ctx), { featureOff: 'habits' });
    const privacy = await jobs.find((j) => j.name === 'habits.habit_followup_privacy')!.run(h.ctx) as { closed?: number; featureOff?: string };
    assert.equal(privacy.featureOff, undefined, 'the follow-up privacy clean-up keeps running while the module is off');
    assert.equal(typeof privacy.closed, 'number');
  } finally { await owner.patch('/api/admin/modules', { key: 'habits', enabled: true, reason: 'test: habits on' }); }
  assert.equal((await member.get('/api/me/habits')).status, 200);
});

test('follow-up privacy: with the habits flag off, a member who stops sharing has the open follow-up on her own habit dismissed by the clean-up job, and the coach’s lists drop it', async () => {
  const email = DEMO.member;
  const memberId = userId(h.ctx, email);
  const owner = await signedIn(DEMO.owner, DEMO_PASSWORDS.owner, true);
  const asha = await signedIn(DEMO.coach, DEMO_PASSWORDS.coach);
  const ananya = await signedIn(email, DEMO_PASSWORDS.member);
  const own = seedHabit(email, 'Private own habit probe', 6, { detail: 'test' });
  const coachSet = habits.createHabit(as(DEMO.coach), memberId, { role: 'coach', id: userId(h.ctx, DEMO.coach) }, { title: 'Coach-set privacy probe', schedule: { type: 'daily' }, startDate: addDaysToDate(today(), -6) }, { seed: true });
  const taskOn = (habitId: string) => h.db.get<{ id: string; status: string; resolution: string | null }>("SELECT id, status, resolution FROM support_tasks WHERE kind = 'coach_follow_up' AND ref_type = 'habit' AND ref_id = ? ORDER BY created_at DESC LIMIT 1", [habitId]);
  const listed = async (taskId: string) => {
    const home = await asha.get('/api/coach/home');
    const mine = await asha.get('/api/coach/follow-ups');
    assert.equal(home.status, 200, JSON.stringify(home.json));
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    return {
      home: (home.json.followUps as Array<{ id: string }>).some((f) => f.id === taskId),
      list: (mine.json.items as Array<{ id: string }>).some((f) => f.id === taskId),
      titleShown: JSON.stringify(home.json).includes('Private own habit probe') || JSON.stringify(mine.json).includes('Private own habit probe'),
    };
  };

  setSetting(as(DEMO.owner), 'habit_followup_missed_days', 3, 'test: owner decision for the test');
  let off = false, withdrawn = false;
  try {
    habits.runFollowUpJob(h.ctx);
    const t = taskOn(own.id)!, kept = taskOn(coachSet.id)!;
    assert.equal(t.status, 'open', 'she shares: her own slipping habit has a follow-up');
    assert.equal(kept.status, 'open');
    assert.deepEqual(await listed(t.id), { home: true, list: true, titleShown: true }, 'while she shares, the coach sees it');

    assert.equal((await owner.patch('/api/admin/modules', { key: 'habits', enabled: false, reason: 'test: habits off' })).status, 200);
    off = true;
    assert.equal((await ananya.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: false })).status, 200);
    withdrawn = true;

    const results = new Map<string, unknown>();
    for (const job of moduleJobs().filter((j) => j.name.startsWith('habits.'))) results.set(job.name, await job.run(h.ctx));
    assert.deepEqual(results.get('habits.habit_followups'), { featureOff: 'habits' }, 'the hourly job stands still while the module is off');
    assert.ok(((results.get('habits.habit_followup_privacy') as { closed?: number }).closed ?? 0) >= 1, JSON.stringify(results.get('habits.habit_followup_privacy')));

    const closed = taskOn(own.id)!;
    assert.equal(closed.status, 'dismissed', 'the follow-up naming her own habit is dismissed');
    assert.match(closed.resolution ?? '', /no longer shares health information/);
    assert.ok(auditCount('support_task.update', closed.id) >= 1, 'closing it is audited');
    assert.deepEqual(await listed(closed.id), { home: false, list: false, titleShown: false }, 'the coach’s Today list and follow-up list no longer show it or its title');
    assert.equal(taskOn(coachSet.id)!.status, 'open', 'a follow-up on a habit the coach set stays, as plan tasks are visible');

    assert.equal(((await moduleJobs().find((j) => j.name === 'habits.habit_followup_privacy')!.run(h.ctx)) as { closed: number }).closed, 0, 'nothing more to close');
  } finally {
    if (withdrawn) await ananya.post('/api/me/consents', { kind: 'coach_sharing', version: '2026-10-17', granted: true });
    if (off) await owner.patch('/api/admin/modules', { key: 'habits', enabled: true, reason: 'test: habits on' });
    for (const id of [own.id, coachSet.id]) {
      const t = taskOn(id);
      if (t && (t.status === 'open' || t.status === 'in_progress')) h.db.run("UPDATE support_tasks SET status = 'dismissed' WHERE id = ?", [t.id]);
    }
    habits.archiveHabit(h.ctx, own.id, { role: 'member', id: memberId }, 'test: tidy up');
    habits.archiveHabit(h.ctx, coachSet.id, { role: 'member', id: memberId }, 'test: tidy up');
    setSetting(as(DEMO.owner), 'habit_followup_missed_days', null, 'test: back to undecided');
  }
});

test('adherence: due days checked in as done, per range, with no composite score', () => {
  const email = DEMO.member2;
  const memberId = userId(h.ctx, email);
  const t = today();
  const probe = seedHabit(email, 'Adherence probe', 4);
  for (const [k, status] of [[4, 'done'], [3, 'skipped'], [2, 'done']] as Array<[number, 'done' | 'skipped']>) {
    h.db.insert('habit_checkins', { id: `hck_test_${probe.id}_${k}`, habit_id: probe.id, member_id: memberId, date: addDaysToDate(t, -k), status, note: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
  const a = habitsModule.adherence!.compute(h.ctx, memberId, { from: addDaysToDate(t, -4), to: addDaysToDate(t, -1) });
  assert.equal(a.key, 'habits');
  // the probe: 4 due days (−4 … −1), 2 done; the member's other habits add their own due and done days
  assert.ok(a.due >= 4 && a.done >= 2, JSON.stringify(a));
  const none = habitsModule.adherence!.compute(h.ctx, userId(h.ctx, DEMO.memberIncomplete), { from: addDaysToDate(t, -7), to: t });
  assert.deepEqual([none.due, none.done, none.pct], [0, 0, null], 'nothing due: no percentage');
});

test('data export: the member’s own habits and check-ins as their Habits page shows them; nothing the team keeps, nobody else’s', () => {
  const memberId = userId(h.ctx, DEMO.member);
  const gone = seedHabit(DEMO.member, 'Export probe, archived', 3, { detail: 'Archived probe detail' });
  habits.updateHabit(as(DEMO.member), gone.id, { role: 'member', id: memberId }, { status: 'archived' });
  // a team-side record about one of her habits that must not travel with the export
  const walkId = habitByTitle(DEMO.member, 'Evening walk').id;
  h.db.insert('support_tasks', { id: `tsk_export_probe_${walkId}`, kind: 'coach_follow_up', ref_type: 'habit', ref_id: walkId, owner_id: userId(h.ctx, DEMO.coach), status: 'open', title: 'Habit slipping: export probe', detail: 'Team-only follow-up text', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });

  const archive = buildArchive(h.ctx, memberId, 'drq_test_habits_export') as { moduleSections?: Record<string, Record<string, { label: string; records: unknown }>>; notIncluded: Array<{ what: string }> };
  const section = archive.moduleSections?.habits?.habits;
  assert.ok(section, 'moduleSections.habits.habits is present');
  assert.match(section.label, /habits and check-ins/i);
  assert.ok(!archive.notIncluded.some((x) => /^Habits and habit check-ins/.test(x.what)), 'habits leave the notIncluded list');
  const records = section.records as Array<Record<string, unknown> & { title: string; setBy: string; status: string; checkins: Array<Record<string, unknown> & { note: string | null }> }>;
  const mine = h.db.all<{ title: string }>('SELECT title FROM habits WHERE member_id = ?', [memberId]).map((r) => r.title).sort();
  assert.deepEqual(records.map((r) => r.title).sort(), mine, 'every habit of hers, archived ones too, and no one else’s');
  const walk = records.find((r) => r.title === 'Evening walk')!;
  assert.equal(walk.setBy, 'your coach');
  assert.equal(records.find((r) => r.title === 'Lights out by 23:00')!.setBy, 'you');
  assert.equal(records.find((r) => r.title === 'Export probe, archived')!.status, 'archived');
  assert.ok(walk.checkins.some((c) => typeof c.note === 'string' && ANANYA_NOTES.includes(c.note)), 'her own check-in notes, which her page shows her');
  assert.deepEqual(Object.keys(walk.checkins[0]!).sort(), ['date', 'note', 'recordedAt', 'status', 'updatedAt']);
  assert.equal(walk.checkins.length, h.db.get<{ n: number }>('SELECT COUNT(*) n FROM habit_checkins WHERE habit_id = ?', [walkId])!.n, 'every check-in, not only the recent days');

  // withheld: ids that point at coaches, plans or other rows, team follow-ups, the reminder queue, other members' habits
  const text = JSON.stringify(section);
  for (const k of ['coachId', 'coach_id', 'planId', 'plan_id', 'memberId', 'member_id', 'created_by', 'pause_log', 'followUp', 'owner_id', 'due_at']) assert.ok(!text.includes(`"${k}"`), `no ${k}`);
  for (const s of ['Habit slipping', 'Team-only follow-up text', 'hab_', 'hck_', 'tsk_', 'Mobility routine', 'Protein at breakfast', 'Ten minutes of reading']) assert.ok(!text.includes(s), `no ${s}`);
  assert.deepEqual(findRestrictedFields(section, restrictedKeys()), [], 'no contact or account fields');
  h.db.run('DELETE FROM support_tasks WHERE id = ?', [`tsk_export_probe_${walkId}`]);
});
