/* Runtime settings the admin can change without a deploy; defaults come from the configuration. */
import type { Ctx } from '../context.js';
import { j } from '../db/db.js';
import { audit } from './audit.js';

export type SettingKey = 'assignment_policy' | 'entitlement_unit' | 'cancellation_cutoff_minutes' | 'appointment_cutoff_minutes' | 'review_sla_hours' | 'support_email' | 'demo_banner'
  | 'reminder_hours_before' | 'max_open_appointments' | 'features' | 'notification_templates' | 'coach_field_policy'
  | 'habit_followup_missed_days' | 'progress_photo_retention_days' | 'billing_entity' | 'gst_rate_bp' | 'ai_draft_retention_days';

export const SETTING_KEYS: SettingKey[] = ['assignment_policy', 'entitlement_unit', 'cancellation_cutoff_minutes', 'appointment_cutoff_minutes', 'review_sla_hours', 'support_email', 'demo_banner', 'reminder_hours_before', 'max_open_appointments', 'features', 'notification_templates', 'coach_field_policy',
  'habit_followup_missed_days', 'progress_photo_retention_days', 'billing_entity', 'gst_rate_bp', 'ai_draft_retention_days'];

const DEFAULTS: Record<SettingKey, unknown> = {
  assignment_policy: 'manual',
  entitlement_unit: 'collection',
  cancellation_cutoff_minutes: 30,
  appointment_cutoff_minutes: 120,
  review_sla_hours: 48,
  support_email: 'support@bioptime.com',
  demo_banner: true,
  reminder_hours_before: 24,
  max_open_appointments: 2,
  features: { messaging: true, bespoke: true, progressPhotos: false, selfBooking: true },
  notification_templates: {},
  coach_field_policy: { city: true, state: true }, // what a coach may see of a client; phone, address and PIN stay hidden unless opened here
  // module settings (edited on /admin/modules). null means "not decided": an owner decision, and the feature that reads it stays off
  habit_followup_missed_days: null, // M1: due days without a check-in before the coach gets a follow-up
  progress_photo_retention_days: null, // M2: null keeps photos until the member deletes them
  billing_entity: null, // M3: the seller's legal name, GSTIN and address; no tax invoice is issued without it
  gst_rate_bp: 1800, // M3: GST in basis points, matching the rate api/domain/orders.ts applies today; the rate stays an owner decision
  ai_draft_retention_days: null, // M11: how long Coach AI drafts are kept
};

export function getSetting<T = unknown>(ctx: Ctx, key: SettingKey): T {
  const row = ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  if (row) return j.out<T>(row.value, DEFAULTS[key] as T);
  if (key === 'assignment_policy') return ctx.config.ASSIGNMENT_POLICY as T;
  if (key === 'entitlement_unit') return ctx.config.ENTITLEMENT_UNIT as T;
  return DEFAULTS[key] as T;
}

export function setSetting(ctx: Ctx, key: SettingKey, value: unknown, reason?: string): void {
  ctx.db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    [key, j.in(value), ctx.now(), ctx.actor?.id ?? null]);
  audit(ctx, 'settings.update', { type: 'setting', id: key }, reason ?? null, { value });
}

export function allSettings(ctx: Ctx): Record<SettingKey, unknown> {
  const out = {} as Record<SettingKey, unknown>;
  for (const k of Object.keys(DEFAULTS) as SettingKey[]) out[k] = getSetting(ctx, k);
  return out;
}
