/* Feature flags: the switches behind every module. A route declares `feature` in def() and answers FEATURE_DISABLED
   while the flag is off; the clients learn the enabled flags from GET /public/config and hide what is off. Flags live in
   feature_flags (seeded by 0008_foundation.sql); a module flag starts off and only an administrator holding
   modules.manage switches it on, with a reason, audited as feature_flag.update. The demo seed switches every module on
   in demo mode.

   An enabled flag can be narrowed by its audience: roles (who sees it at all) and packageIds (members with an active
   programme of one of those packages; coaches and administrators are not narrowed by packages). System work (jobs,
   event handlers) reads the switch alone.

   The module settings edited on /admin/modules are declared here too, with their validation. */
import type { Actor, Ctx } from '../context.js';
import { ROLES, type Role } from '@bioptime/domain';
import { j } from '../db/db.js';
import { AppError, errors } from '../lib/errors.js';
import { requirePermission } from '../auth/permissions.js';
import { audit } from './audit.js';
import { getSetting, setSetting, type SettingKey } from './settings.js';
import { storageRequirement, storesPrivateFiles } from './files.js';
import { MODULES, featureOf, moduleForFeature } from '../modules/index.js';
import { PHONE_SIGN_IN_FLAG, phoneSignInRequirement } from '../auth/phoneSignIn.js';
import type { ModuleKey } from '../modules/types.js';

export type FlagAudience = { roles?: Role[]; packageIds?: string[] };
type FlagRow = { key: string; enabled: number; audience: string; description: string; updated_at: string; updated_by: string | null };
export type FeatureFlag = { key: string; enabled: boolean; audience: FlagAudience; description: string; updatedAt: string | null; updatedBy: string | null; module: ModuleKey | null; stored: boolean };

function flagRow(ctx: Ctx, key: string): FlagRow | undefined {
  return ctx.db.get<FlagRow>('SELECT * FROM feature_flags WHERE key = ?', [key]);
}

function present(r: FlagRow): FeatureFlag {
  return { key: r.key, enabled: !!r.enabled, audience: j.out<FlagAudience>(r.audience, {}), description: r.description, updatedAt: r.updated_at, updatedBy: r.updated_by, module: moduleForFeature(r.key)?.key ?? null, stored: true };
}

/** The switch alone: is the flag on? For jobs, event handlers and other system work. A flag with no row is off. */
export function isEnabled(ctx: Ctx, key: string): boolean {
  return !!flagRow(ctx, key)?.enabled;
}

/** The switch and its audience, for one person (or a signed-out visitor when actor is null). */
export function isEnabledFor(ctx: Ctx, key: string, actor: Actor = ctx.actor): boolean {
  const r = flagRow(ctx, key);
  if (!r?.enabled) return false;
  return inAudience(ctx, j.out<FlagAudience>(r.audience, {}), actor);
}

function inAudience(ctx: Ctx, audience: FlagAudience, actor: Actor): boolean {
  const roles = audience.roles ?? [];
  const packageIds = audience.packageIds ?? [];
  if (roles.length && (!actor || !roles.includes(actor.role))) return false;
  if (packageIds.length) {
    if (!actor) return false;
    if (actor.role !== 'member') return true; // coaches and administrators run the feature for those members
    const placeholders = packageIds.map(() => '?').join(', ');
    return !!ctx.db.get(`SELECT 1 FROM programmes g JOIN package_versions v ON v.id = g.package_version_id WHERE g.member_id = ? AND g.status IN ('active','paused') AND v.package_id IN (${placeholders}) LIMIT 1`, [actor.id, ...packageIds]);
  }
  return true;
}

/** Fails with FEATURE_DISABLED unless the flag is on for the caller. Called by def() for routes that declare a feature. */
export function requireFeature(ctx: Ctx, key: string): void {
  if (!isEnabledFor(ctx, key)) throw new AppError('FEATURE_DISABLED', 403, 'This part of Bioptime is not switched on.', { feature: key });
}

/** Every flag: the stored rows plus any flag a registered module declares that has no row yet (off). */
export function listFlags(ctx: Ctx): FeatureFlag[] {
  const out = ctx.db.all<FlagRow>('SELECT * FROM feature_flags ORDER BY key').map(present);
  for (const m of MODULES) {
    const key = featureOf(m);
    if (!out.some((f) => f.key === key)) out.push({ key, enabled: false, audience: {}, description: '', updatedAt: null, updatedBy: null, module: m.key, stored: false });
  }
  return out;
}

/** Switches that are on but cannot run on this server, with what is missing: phone sign-in while production has no SMS
 *  provider (its routes answer PHONE_SIGN_IN_UNAVAILABLE whatever the switch says). */
function unavailable(ctx: Ctx, key: string): string | null {
  return key === PHONE_SIGN_IN_FLAG ? phoneSignInRequirement(ctx) : null;
}

/** The flags that are on for the caller: what GET /public/config tells the clients. A switch that is on but cannot run
 *  here is left out, so no client offers a link that would only answer that it is unavailable. */
export function enabledFeatures(ctx: Ctx): string[] {
  return ctx.db.all<FlagRow>('SELECT * FROM feature_flags WHERE enabled = 1 ORDER BY key').filter((r) => inAudience(ctx, j.out<FlagAudience>(r.audience, {}), ctx.actor) && !unavailable(ctx, r.key)).map((r) => r.key);
}

function cleanAudience(ctx: Ctx, a: FlagAudience): FlagAudience {
  const roles = [...new Set(a.roles ?? [])];
  for (const r of roles) if (!(ROLES as readonly string[]).includes(r)) throw errors.badRequest(`Unknown role ${r}`, 'AUDIENCE_INVALID');
  const packageIds = [...new Set(a.packageIds ?? [])];
  if (packageIds.length) {
    const known = new Set(ctx.db.all<{ id: string }>(`SELECT id FROM packages WHERE id IN (${packageIds.map(() => '?').join(', ')})`, packageIds).map((p) => p.id));
    const unknown = packageIds.filter((p) => !known.has(p));
    if (unknown.length) throw errors.badRequest(`Unknown package ${unknown.join(', ')}`, 'AUDIENCE_INVALID');
  }
  return { ...(roles.length ? { roles } : {}), ...(packageIds.length ? { packageIds } : {}) };
}

/** Switch a flag or change its audience. modules.manage; a reason is required and recorded. Production refuses to
 *  enable a module that stores private files while storage is local disk, and to switch phone sign-in on while it has
 *  no SMS provider (the codes would go to the outbox, which delivers nothing). */
export function setFlag(ctx: Ctx, key: string, patch: { enabled?: boolean; audience?: FlagAudience }, reason: string): FeatureFlag {
  const actor = requirePermission(ctx, 'modules.manage');
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  const current = flagRow(ctx, key);
  const declared = MODULES.some((m) => featureOf(m) === key);
  if (!current && !declared) throw errors.notFound('Feature flag', 'FLAG_UNKNOWN');
  const enabled = patch.enabled ?? !!current?.enabled;
  const audience = patch.audience !== undefined ? cleanAudience(ctx, patch.audience) : j.out<FlagAudience>(current?.audience, {});
  if (enabled && !current?.enabled && key === PHONE_SIGN_IN_FLAG) {
    const missing = phoneSignInRequirement(ctx);
    if (missing) throw errors.state(`Phone sign-in cannot be switched on. Missing: ${missing}`, { code: 'SMS_NOT_CONFIGURED', missing });
  }
  if (enabled && !current?.enabled && storesPrivateFiles(key)) {
    const missing = storageRequirement(ctx);
    if (missing) throw errors.state(`This module stores private files. Missing: ${missing}`, { code: 'STORAGE_NOT_CONFIGURED', missing });
  }
  const now = ctx.now();
  ctx.db.run('INSERT INTO feature_flags (key, enabled, audience, description, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, audience = excluded.audience, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    [key, enabled ? 1 : 0, j.in(audience), current?.description ?? '', now, actor.id]);
  audit(ctx, 'feature_flag.update', { type: 'feature_flag', id: key }, reason.trim(), { enabled, audience, previous: current ? { enabled: !!current.enabled, audience: j.out<FlagAudience>(current.audience, {}) } : null });
  return present(flagRow(ctx, key)!);
}

/** Demo seed only: every module flag on, so the demo shows every module. One audit row lists them. */
export function enableModulesForDemo(ctx: Ctx, reason: string): string[] {
  if (!ctx.config.isDemo) throw new Error('enableModulesForDemo runs in demo mode only');
  const keys = [...new Set(MODULES.map(featureOf))];
  const now = ctx.now();
  for (const key of keys) {
    ctx.db.run("INSERT INTO feature_flags (key, enabled, audience, description, updated_at, updated_by) VALUES (?, 1, '{}', '', ?, ?) ON CONFLICT(key) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by", [key, now, ctx.actor?.id ?? null]);
  }
  audit(ctx, 'feature_flag.update', { type: 'feature_flag', id: 'modules' }, reason, { enabled: true, keys });
  return keys;
}

/* ---------- module settings (/admin/modules) ---------- */

type SettingRule = { key: SettingKey; module: ModuleKey; label: string; hint: string; kind: 'days' | 'basis_points' | 'seller'; min?: number; max?: number; nullable: boolean };

/** The settings the modules read. null means not decided yet (an owner decision); the feature that reads it stays off. */
export const MODULE_SETTINGS: SettingRule[] = [
  { key: 'habit_followup_missed_days', module: 'habits', label: 'Coach follow-up after missed habit days', hint: 'Due days without a check-in before the assigned coach gets a follow-up. Empty: no follow-ups.', kind: 'days', min: 1, max: 60, nullable: true },
  { key: 'progress_photo_retention_days', module: 'progress', label: 'Progress photo retention (days)', hint: 'How long progress photos are kept. Empty: until the member deletes them.', kind: 'days', min: 1, max: 3650, nullable: true },
  { key: 'billing_entity', module: 'billing', label: 'Seller details on billing documents', hint: 'The legal entity, GSTIN and registered address, as the owner and counsel confirm them. Empty: receipts only, labelled "not a tax invoice".', kind: 'seller', nullable: true },
  { key: 'gst_rate_bp', module: 'billing', label: 'GST rate (basis points)', hint: '1800 is the 18% the platform applies today. The rate is an owner decision.', kind: 'basis_points', min: 0, max: 10000, nullable: false },
  { key: 'ai_draft_retention_days', module: 'ai', label: 'Coach AI draft retention (days)', hint: 'How long Coach AI drafts are kept. Empty: not decided; Coach AI stays off.', kind: 'days', min: 1, max: 3650, nullable: true },
];

export function moduleSettings(ctx: Ctx) {
  return MODULE_SETTINGS.map((s) => ({ ...s, value: getSetting(ctx, s.key) }));
}

const SELLER_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

function checkSettingValue(rule: SettingRule, value: unknown): unknown {
  if (value === null || value === undefined || value === '') {
    if (!rule.nullable) throw errors.badRequest(`${rule.label} cannot be empty`, 'SETTING_INVALID');
    return null;
  }
  if (rule.kind === 'days' || rule.kind === 'basis_points') {
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < (rule.min ?? 0) || n > (rule.max ?? Number.MAX_SAFE_INTEGER)) throw errors.badRequest(`${rule.label}: a whole number from ${rule.min} to ${rule.max}`, 'SETTING_INVALID');
    return n;
  }
  // seller details: an object of short text fields, with the legal name required. The fields themselves come from the
  // owner and counsel; nothing is filled in here.
  if (typeof value !== 'object' || Array.isArray(value)) throw errors.badRequest(`${rule.label}: expected an object such as {"legalName": "…", "gstin": "…", "address": "…"}`, 'SETTING_INVALID');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20) throw errors.badRequest(`${rule.label}: at most 20 fields`, 'SETTING_INVALID');
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!SELLER_KEY.test(k) || typeof v !== 'string' || v.length > 500) throw errors.badRequest(`${rule.label}: field ${k} must be text of at most 500 characters`, 'SETTING_INVALID');
    if (v.trim()) out[k] = v.trim();
  }
  if (!out.legalName || out.legalName.length < 2) throw errors.badRequest(`${rule.label}: legalName is required`, 'SETTING_INVALID');
  if (out.gstin !== undefined && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(out.gstin)) throw errors.badRequest(`${rule.label}: the GSTIN is 15 characters (state code, PAN, entity number, Z, check character)`, 'SETTING_INVALID');
  return out;
}

/** Change one module setting. settings.manage; a reason is required and recorded (settings.update). */
export function setModuleSetting(ctx: Ctx, key: string, value: unknown, reason: string) {
  requirePermission(ctx, 'settings.manage');
  const rule = MODULE_SETTINGS.find((s) => s.key === key);
  if (!rule) throw errors.notFound('Module setting', 'SETTING_UNKNOWN');
  if (!reason || reason.trim().length < 3) throw errors.badRequest('Say why: the reason is recorded in the audit log', 'REASON_REQUIRED');
  setSetting(ctx, rule.key, checkSettingValue(rule, value), reason.trim());
  return { ...rule, value: getSetting(ctx, rule.key) };
}
