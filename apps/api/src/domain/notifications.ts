/* Notifications: the backend creates the record; channel adapters report what really happened. In demo mode the email,
   SMS and push adapters write to an outbox and record the attempt as "logged" (never "sent"). */
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { j } from '../db/db.js';
import { getSetting } from './settings.js';

export type NotifyInput = {
  userId: string;
  category: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channels?: Array<'in_app' | 'email' | 'sms' | 'push'>;
  eventId?: string;
  /** Sensitive detail that must not reach a lock screen or an email subject; kept in data only. */
  sensitive?: boolean;
};

export function notify(ctx: Ctx, input: NotifyInput): string {
  const id = ids.notification();
  const now = ctx.now();
  ctx.db.insert('notifications', {
    id, user_id: input.userId, category: input.category, title: input.title, body: input.body,
    data: j.in(input.data ?? {}), event_id: input.eventId ?? null, created_at: now, read_at: null,
  });
  const prefs = ctx.db.get<{ email: number; sms: number; push: number; reminders: number; marketing: number }>('SELECT * FROM notification_preferences WHERE user_id = ?', [input.userId]);
  const user = ctx.db.get<{ email: string; phone: string | null; name: string }>('SELECT email, phone, name FROM users WHERE id = ?', [input.userId]);
  const channels = input.channels ?? ['in_app', 'email', 'push'];
  // an administrator may override the email wording per category (Settings › Notification templates); placeholders are filled here
  const templates = getSetting<Record<string, { subject?: string; body?: string }>>(ctx, 'notification_templates') ?? {};
  const tpl = templates[input.category];
  const fill = (s: string) => s.replace(/\{\{\s*(title|body|name)\s*\}\}/g, (_m, k: string) => (k === 'title' ? input.title : k === 'body' ? input.body : (user?.name ?? '')));
  const emailSubject = tpl?.subject ? fill(tpl.subject) : input.title;
  const emailBody = tpl?.body ? fill(tpl.body) : input.body;
  for (const channel of channels) {
    const attemptId = ids.delivery();
    let status: 'logged' | 'skipped' | 'sent' | 'failed' = 'skipped';
    let provider = 'none';
    let error: string | null = null;
    if (channel === 'in_app') { status = 'sent'; provider = 'in_app'; }
    else if (channel === 'email') {
      provider = ctx.config.EMAIL_PROVIDER;
      if (prefs && !prefs.email && input.category !== 'security' && input.category !== 'verification') { error = 'email preference off'; }
      else if (!user?.email) { error = 'no email address'; }
      else { status = 'logged'; writeOutbox(ctx, 'email', user.email, emailSubject, input.sensitive ? `${input.title}. Open the Bioptime app for the detail.` : emailBody, id); }
    } else if (channel === 'sms') {
      provider = ctx.config.SMS_PROVIDER;
      if (!user?.phone) error = 'no phone number';
      else if (prefs && !prefs.sms) error = 'sms preference off';
      else { status = 'logged'; writeOutbox(ctx, 'sms', user.phone, null, input.sensitive ? `${input.title}. Open the app for the detail.` : `${input.title}: ${input.body}`.slice(0, 160), id); }
    } else if (channel === 'push') {
      provider = ctx.config.PUSH_PROVIDER;
      if (prefs && !prefs.push) error = 'push preference off';
      else { status = 'logged'; writeOutbox(ctx, 'push', input.userId, input.title, input.sensitive ? 'Open the app for the detail.' : input.body, id); }
    }
    ctx.db.insert('delivery_attempts', { id: attemptId, notification_id: id, channel, provider, status, provider_ref: null, error, attempts: 1, created_at: now, updated_at: now });
  }
  return id;
}

function writeOutbox(ctx: Ctx, channel: 'email' | 'sms' | 'push', to: string, subject: string | null, body: string, notificationId: string): void {
  // The outbox adapter: nothing is delivered, the message is recorded so the team can see what would have gone out.
  ctx.db.insert('outbox_messages', { id: ids.outbox(), channel, to_address: to, subject, body, notification_id: notificationId, status: 'logged', created_at: ctx.now() });
}

/** Notification data keys that hold a single-use link with its token: email verification, password reset, member and
 *  owner activation, coach invitation (api/auth/service.ts). The link belongs to the email (a provider adapter sends
 *  it; the record stays with the notification for that, readable by the operator only), never to the in-app inbox:
 *  whoever holds a session, a stolen one or the open preview's shared one, could otherwise verify an address or set a
 *  new password without the mailbox (traffic inspection M5, 15 November 2026). No client reads them: the website and
 *  the app take the demo's token from the answer of the request itself (demoToken), not from the inbox. */
const LINK_KEYS: ReadonlySet<string> = new Set(['verifyUrl', 'resetUrl', 'activateUrl', 'inviteUrl']);
const TOKEN_IN_LINK = /[?&#](?:token|code|key|id_token)=/i;

/** A notification's data as the inbox (GET /notifications) returns it: without the link keys above, and, as a safety
 *  net for a later notification, without any key named like a token, secret or password or any text value that carries
 *  a token, code or key parameter. */
export function inboxData(data: unknown): Record<string, unknown> {
  // a stored value that is not an object (never written by notify(), which always stores one) shows as no data, not an error
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).filter(([k, v]) => !LINK_KEYS.has(k) && !/token|secret|password/i.test(k) && !(typeof v === 'string' && TOKEN_IN_LINK.test(v))));
}

export function listNotifications(ctx: Ctx, userId: string, limit = 50, unreadOnly = false) {
  const rows = ctx.db.all(`SELECT * FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT ?`, [userId, limit]);
  return rows.map((r) => ({ ...r, data: inboxData(j.out<unknown>(r.data, {})) }));
}

export function markRead(ctx: Ctx, userId: string, notificationIds: string[] | 'all'): number {
  if (notificationIds === 'all') return ctx.db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [ctx.now(), userId]).changes;
  let n = 0;
  for (const id of notificationIds) n += ctx.db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', [ctx.now(), id, userId]).changes;
  return n;
}

/** Once the email is confirmed, the "Verify your email" nudges have done their job: they are marked read so the inbox
 *  does not keep asking (release round, 5 Nov 2026). Returns how many were cleared. */
export function clearVerificationNudges(ctx: Ctx, userId: string): number {
  return ctx.db.run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND category = 'verification' AND read_at IS NULL", [ctx.now(), userId]).changes;
}

export function unreadCount(ctx: Ctx, userId: string): number {
  return ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId])?.n ?? 0;
}

export function getPreferences(ctx: Ctx, userId: string) {
  return ctx.db.get('SELECT * FROM notification_preferences WHERE user_id = ?', [userId]) ?? { user_id: userId, email: 1, sms: 1, push: 1, reminders: 1, marketing: 0, lock_screen_detail: 0 };
}

export function setPreferences(ctx: Ctx, userId: string, patch: Partial<Record<'email' | 'sms' | 'push' | 'reminders' | 'marketing' | 'lock_screen_detail', boolean>>) {
  const cur = getPreferences(ctx, userId) as Record<string, number>;
  const next = { ...cur } as Record<string, number | string>;
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v ? 1 : 0;
  ctx.db.run('INSERT INTO notification_preferences (user_id, email, sms, push, reminders, marketing, lock_screen_detail, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, sms = excluded.sms, push = excluded.push, reminders = excluded.reminders, marketing = excluded.marketing, lock_screen_detail = excluded.lock_screen_detail, updated_at = excluded.updated_at',
    [userId, next.email as number, next.sms as number, next.push as number, next.reminders as number, next.marketing as number, next.lock_screen_detail as number, ctx.now()]);
  return getPreferences(ctx, userId);
}

/** Owners and admins: every privileged user gets the operational alert. */
export function notifyPrivileged(ctx: Ctx, input: Omit<NotifyInput, 'userId'>): void {
  const admins = ctx.db.all<{ id: string }>("SELECT id FROM users WHERE role IN ('admin','owner') AND state = 'active'");
  for (const a of admins) notify(ctx, { ...input, userId: a.id, channels: input.channels ?? ['in_app'] });
}
