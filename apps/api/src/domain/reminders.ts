/* The reminder queue and the devices push would reach.

   Modules schedule reminders (habit times, lab preparation, session start); the `reminders` job (every minute,
   api/jobs.ts) sends the ones that are due through notify(). It honours the module switch and the person's preferences:
   - the module that queued it (REMINDER_REF_MODULES, by ref_type) is switched off when it falls due: skipped
     (skip_reason module_off) and never sent later, so switching the module back on brings no burst of old reminders.
     A ref_type that no module claims is core and is always delivered (subject to the rules below);
   - the account is suspended, deactivated, closed or awaiting deletion: skipped (account_inactive);
   - reminders switched off (notification_preferences.reminders = 0): skipped (reminders_off);
   - inside their quiet hours: only the in-app notification is written, nothing that buzzes (no push, SMS or email);
     a reminder with no in-app channel is skipped (quiet_hours);
   - lock-screen detail off (the default): push and email carry the title only (notify's sensitive mode).
   Titles and bodies are written by the modules from records people entered or vendors supplied; never from health
   readings, and never with invented advice.

   Push devices are registered by the app (POST /me/devices). Their tokens are stored; nothing is delivered until a push
   provider exists, so push stays "logged" in the outbox (PUSH_PROVIDER=outbox). */
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { j } from '../db/db.js';
import { errors } from '../lib/errors.js';
import { IST_OFFSET_MINUTES, minuteOfDayInZone } from '../lib/time.js';
import { audit } from './audit.js';
import { notify, getPreferences } from './notifications.js';
import { isEnabled } from './features.js';
import { featureOf, moduleByKey } from '../modules/index.js';
import type { ModuleKey } from '../modules/types.js';

export type ReminderChannel = 'in_app' | 'email' | 'sms' | 'push';
export type ReminderInput = { userId: string; refType: string; refId: string; dueAt: string; category: string; title: string; body: string; channels?: ReminderChannel[] };
/** Why a reminder was skipped (reminders.skip_reason, 0020_integration_core.sql). */
export type ReminderSkipReason = 'module_off' | 'account_inactive' | 'reminders_off' | 'quiet_hours';
type ReminderRow = { id: string; user_id: string; ref_type: string; ref_id: string; due_at: string; category: string; title: string; body: string; channels: string; status: 'queued' | 'sent' | 'skipped' | 'cancelled'; notification_id: string | null; sent_at: string | null; created_at: string; skip_reason?: ReminderSkipReason | null };

/** The module behind each ref_type a module schedules (every reminders.schedule / replace call in api/src). The values
 *  are written out rather than imported, because those domain files import this one; a test checks this map against
 *  the calls in the source (tests/integration/integration-core.test.ts). A ref_type missing here is core: always
 *  delivered, whichever modules are on. */
export const REMINDER_REF_MODULES: Readonly<Record<string, ModuleKey>> = Object.freeze({
  habit: 'habits', // api/domain/habits.ts HABIT_REF: habit reminder times
  checkin: 'progress', // api/domain/progress.ts: the weekly check-in is ready
  lab_preparation: 'labFollowups', // api/domain/labFollowups.ts PREPARATION_REF: preparation before a home collection
  live_session: 'sessions', // api/domain/sessions.ts REF: a registered live session or webinar is about to start
});

/** The module a reminder belongs to, or null when it is core. */
export function moduleForReminder(refType: string): ModuleKey | null {
  return Object.prototype.hasOwnProperty.call(REMINDER_REF_MODULES, refType) ? REMINDER_REF_MODULES[refType]! : null;
}

const DEFAULT_CHANNELS: ReminderChannel[] = ['in_app', 'push'];
const CHANNELS: readonly ReminderChannel[] = ['in_app', 'email', 'sms', 'push'];

function check(input: ReminderInput): void {
  if (Number.isNaN(Date.parse(input.dueAt))) throw new Error(`invalid reminder time ${input.dueAt}`);
  if (!input.title.trim()) throw new Error('a reminder needs a title');
  for (const c of input.channels ?? []) if (!CHANNELS.includes(c)) throw new Error(`unknown channel ${c}`);
}

/** Queue a reminder; idempotent per person, record and due time. A queued or cancelled one is (re)queued with the new
 *  wording; one already sent or skipped is left alone. Returns the reminder id. */
export function schedule(ctx: Ctx, input: ReminderInput): string {
  check(input);
  const dueAt = new Date(input.dueAt).toISOString();
  const channels = j.in(input.channels?.length ? input.channels : DEFAULT_CHANNELS);
  const existing = ctx.db.get<ReminderRow>('SELECT * FROM reminders WHERE user_id = ? AND ref_type = ? AND ref_id = ? AND due_at = ?', [input.userId, input.refType, input.refId, dueAt]);
  if (existing) {
    if (existing.status === 'queued' || existing.status === 'cancelled') ctx.db.update('reminders', existing.id, { status: 'queued', category: input.category, title: input.title, body: input.body, channels });
    return existing.id;
  }
  const id = ids.reminder();
  ctx.db.insert('reminders', { id, user_id: input.userId, ref_type: input.refType, ref_id: input.refId, due_at: dueAt, category: input.category, title: input.title, body: input.body, channels, status: 'queued', notification_id: null, sent_at: null, created_at: ctx.now() });
  return id;
}

/** Cancel the queued reminders for a record (all of its people and times, or narrowed by person and time). Returns how many. */
export function cancel(ctx: Ctx, ref: { refType: string; refId: string; userId?: string; dueAt?: string }): number {
  const where = ["status = 'queued'", 'ref_type = ?', 'ref_id = ?'];
  const params: string[] = [ref.refType, ref.refId];
  if (ref.userId) { where.push('user_id = ?'); params.push(ref.userId); }
  if (ref.dueAt) { where.push('due_at = ?'); params.push(new Date(ref.dueAt).toISOString()); }
  return ctx.db.run(`UPDATE reminders SET status = 'cancelled' WHERE ${where.join(' AND ')}`, params).changes;
}

/** The one reminder a record should have for a person: other queued times for it are cancelled, this one is queued
 *  (a booking that moves takes its preparation reminder with it). */
export function replace(ctx: Ctx, input: ReminderInput): string {
  const dueAt = new Date(input.dueAt).toISOString();
  ctx.db.run("UPDATE reminders SET status = 'cancelled' WHERE status = 'queued' AND user_id = ? AND ref_type = ? AND ref_id = ? AND due_at != ?", [input.userId, input.refType, input.refId, dueAt]);
  return schedule(ctx, { ...input, dueAt });
}

export function listForRef(ctx: Ctx, refType: string, refId: string) {
  return ctx.db.all<ReminderRow>('SELECT * FROM reminders WHERE ref_type = ? AND ref_id = ? ORDER BY due_at', [refType, refId]).map((r) => ({ ...r, channels: j.out<ReminderChannel[]>(r.channels, DEFAULT_CHANNELS) }));
}

/* ---------- quiet hours ---------- */

/** The person's timezone: the member or coach profile's, else India. */
export function timezoneOf(ctx: Ctx, userId: string): string {
  const r = ctx.db.get<{ tz: string | null }>('SELECT COALESCE((SELECT timezone FROM member_profiles WHERE user_id = ?), (SELECT timezone FROM coach_profiles WHERE user_id = ?)) AS tz', [userId, userId]);
  return r?.tz || 'Asia/Kolkata';
}

/** Minutes after local midnight of an instant in a named timezone (India when the zone is unknown). */
export function localMinute(iso: string, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    const h = Number(parts.find((p) => p.type === 'hour')?.value), m = Number(parts.find((p) => p.type === 'minute')?.value);
    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  } catch { /* an unknown zone falls back to India */ }
  return minuteOfDayInZone(iso, IST_OFFSET_MINUTES);
}

/** Is a minute of the day inside a quiet window? The window may cross midnight (22:00 to 07:00); equal ends mean none. */
export function withinQuiet(minute: number, start: number | null | undefined, end: number | null | undefined): boolean {
  if (start === null || start === undefined || end === null || end === undefined || start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** Is this person inside their quiet hours at this instant? */
export function inQuietHours(ctx: Ctx, userId: string, at: string = ctx.now()): boolean {
  const p = getPreferences(ctx, userId) as { quiet_start_minute?: number | null; quiet_end_minute?: number | null };
  return withinQuiet(localMinute(at, timezoneOf(ctx, userId)), p.quiet_start_minute, p.quiet_end_minute);
}

/** Set or clear (both null) a person's quiet hours, in minutes after local midnight. Audited. */
export function setQuietHours(ctx: Ctx, userId: string, start: number | null, end: number | null) {
  const valid = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0 && v < 1440);
  if (!valid(start) || !valid(end) || (start === null) !== (end === null)) throw errors.badRequest('Quiet hours need a start and an end between 00:00 and 23:59, or neither', 'QUIET_HOURS_INVALID');
  ctx.db.run('INSERT INTO notification_preferences (user_id, quiet_start_minute, quiet_end_minute, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET quiet_start_minute = excluded.quiet_start_minute, quiet_end_minute = excluded.quiet_end_minute, updated_at = excluded.updated_at',
    [userId, start, end, ctx.now()]);
  audit(ctx, 'notification_preferences.quiet_hours', { type: 'user', id: userId }, null, { start, end });
  return getPreferences(ctx, userId);
}

/* ---------- the dispatcher ---------- */

/** Send every queued reminder that is due. Run by the `reminders` job each minute. A due reminder whose module is off,
 *  or whose person cannot or does not want to receive it, is marked skipped with its reason and never sent later. */
export function dispatchDue(ctx: Ctx, limit = 200): { sent: number; inAppOnly: number; skipped: number } {
  const now = ctx.now();
  const due = ctx.db.all<ReminderRow>("SELECT * FROM reminders WHERE status = 'queued' AND due_at <= ? ORDER BY due_at LIMIT ?", [now, limit]);
  let sent = 0, inAppOnly = 0, skipped = 0;
  const moduleOn = new Map<ModuleKey, boolean>(); // the switch alone (system work), read once per run
  const skip = (r: ReminderRow, reason: ReminderSkipReason) => { ctx.db.update('reminders', r.id, { status: 'skipped', skip_reason: reason }); skipped++; };
  for (const r of due) {
    const key = moduleForReminder(r.ref_type);
    if (key) {
      if (!moduleOn.has(key)) { const m = moduleByKey(key); moduleOn.set(key, !!m && isEnabled(ctx, featureOf(m))); }
      if (!moduleOn.get(key)) { skip(r, 'module_off'); continue; }
    }
    const user = ctx.db.get<{ state: string }>('SELECT state FROM users WHERE id = ?', [r.user_id]);
    const prefs = getPreferences(ctx, r.user_id) as { reminders?: number; lock_screen_detail?: number; quiet_start_minute?: number | null; quiet_end_minute?: number | null };
    const closed = !user || ['suspended', 'deactivated', 'deletion_requested', 'closed'].includes(user.state);
    let channels = j.out<ReminderChannel[]>(r.channels, DEFAULT_CHANNELS);
    const quiet = withinQuiet(localMinute(now, timezoneOf(ctx, r.user_id)), prefs.quiet_start_minute, prefs.quiet_end_minute);
    if (quiet) channels = channels.filter((c) => c === 'in_app');
    if (closed) { skip(r, 'account_inactive'); continue; }
    if (prefs.reminders === 0) { skip(r, 'reminders_off'); continue; }
    if (!channels.length) { skip(r, 'quiet_hours'); continue; }
    const notificationId = notify(ctx, { userId: r.user_id, category: r.category, title: r.title, body: r.body, channels, sensitive: !prefs.lock_screen_detail, data: { reminderId: r.id, refType: r.ref_type, refId: r.ref_id, ...(quiet ? { quietHours: true } : {}) } });
    ctx.db.update('reminders', r.id, { status: 'sent', notification_id: notificationId, sent_at: ctx.now() });
    if (quiet) inAppOnly++; else sent++;
  }
  return { sent, inAppOnly, skipped };
}

/* ---------- push devices ---------- */

type DeviceRow = { id: string; user_id: string; platform: 'ios' | 'android'; token: string; app_version: string | null; created_at: string; last_seen_at: string; revoked_at: string | null };

/** What a device record shows its owner: never the token itself. */
function presentDevice(d: DeviceRow) {
  return { id: d.id, platform: d.platform, appVersion: d.app_version, createdAt: d.created_at, lastSeenAt: d.last_seen_at, revoked: !!d.revoked_at, delivery: 'logged' as const };
}

/** Register (or refresh) this device for the signed-in person. A token another account held moves to this one. */
export function registerDevice(ctx: Ctx, userId: string, input: { platform: 'ios' | 'android'; token: string; appVersion?: string }) {
  const now = ctx.now();
  const existing = ctx.db.get<DeviceRow>('SELECT * FROM push_devices WHERE token = ?', [input.token]);
  if (existing && existing.user_id === userId && !existing.revoked_at) {
    ctx.db.update('push_devices', existing.id, { last_seen_at: now, app_version: input.appVersion ?? existing.app_version, platform: input.platform });
    return presentDevice(ctx.db.get<DeviceRow>('SELECT * FROM push_devices WHERE id = ?', [existing.id])!);
  }
  if (existing) {
    ctx.db.update('push_devices', existing.id, { user_id: userId, platform: input.platform, app_version: input.appVersion ?? null, created_at: now, last_seen_at: now, revoked_at: null });
    audit(ctx, 'push_device.register', { type: 'push_device', id: existing.id }, null, { platform: input.platform, reassigned: existing.user_id !== userId });
    return presentDevice(ctx.db.get<DeviceRow>('SELECT * FROM push_devices WHERE id = ?', [existing.id])!);
  }
  const id = ids.pushDevice();
  ctx.db.insert('push_devices', { id, user_id: userId, platform: input.platform, token: input.token, app_version: input.appVersion ?? null, created_at: now, last_seen_at: now, revoked_at: null });
  audit(ctx, 'push_device.register', { type: 'push_device', id }, null, { platform: input.platform });
  return presentDevice(ctx.db.get<DeviceRow>('SELECT * FROM push_devices WHERE id = ?', [id])!);
}

/** Stop using a device (sign-out on the phone, or the person removing it). Only its owner may. */
export function revokeDevice(ctx: Ctx, userId: string, deviceId: string) {
  const d = ctx.db.get<DeviceRow>('SELECT * FROM push_devices WHERE id = ? AND user_id = ?', [deviceId, userId]);
  if (!d) throw errors.notFound('Device');
  if (!d.revoked_at) {
    ctx.db.update('push_devices', d.id, { revoked_at: ctx.now() });
    audit(ctx, 'push_device.revoke', { type: 'push_device', id: d.id }, null, { platform: d.platform });
  }
  return presentDevice(ctx.db.get<DeviceRow>('SELECT * FROM push_devices WHERE id = ?', [d.id])!);
}

export function listDevices(ctx: Ctx, userId: string) {
  return ctx.db.all<DeviceRow>('SELECT * FROM push_devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC', [userId]).map(presentDevice);
}
