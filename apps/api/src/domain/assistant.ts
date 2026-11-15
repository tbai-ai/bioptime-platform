/* The member assistant (owner decision D2, 30 October 2026): a server-side seam for an AI assistant that answers
   members, prepared behind a switch that stays off. The member app's AI tab is the human coach chat; it shows an
   assistant only when GET /me/assistant offers one. Migration 0044_member_assistant.sql; routes in
   api/http/routes/assistant.ts, registered by the ai module.

   - Off three ways: the switch (settings.member_assistant, "off" from 0044; an administrator holding settings.manage
     turns it with PUT /admin/assistant while the 'ai' module is on), the provider (AI_PROVIDER accepts only "none", so there is no provider, no
     key and no cost; api/adapters/ai.ts) and the 'ai' module flag for the member.
   - offer: the switch is on, a provider that answers members is configured and the 'ai' flag is on for the member. The
     app then shows the "Coach | Assistant" segment and asks for the consent first. on: offer and the member's
     assistant_processing consent under the current wording.
   - The consent wording is a draft for counsel's review outside the preview: in the preview (demo mode) a member can
     record it; elsewhere recording it is refused (CONSENT_WORDING_PENDING) until counsel approves wording. Withdrawing
     always works, even while everything is off, and deletes the member's conversation with the assistant.
   - A message reaches a provider only while on, with the rules (ASSISTANT_GUIDANCE) and the member's own conversation
     with the assistant, nothing else from their account. While the switch is off POST /me/assistant/messages answers
     409 ASSISTANT_OFF; switched on without a provider, 409 AI_NOT_CONFIGURED naming what is missing. Nothing is
     generated here without a provider, and no answer is made up.
   - Audit: assistant.switch (from, to and the reason), assistant.request (the outcome, a refusal's code and the
     provider; never the text), consent.set for the consent, assistant.thread_cleared when a withdrawal deletes the
     conversation (how many messages).
   - Limits: 20 messages per 10 minutes per address (the route) and ASSISTANT_PER_HOUR per member (here, refusals
     included). */
import type { Ctx } from '../context.js';
import { j } from '../db/db.js';
import { AppError, errors } from '../lib/errors.js';
import { randomId } from '../lib/ids.js';
import { addDays } from '../lib/time.js';
import { audit } from './audit.js';
import { setConsent } from './members.js';
import { isEnabled, isEnabledFor } from './features.js';
import { aiProviderFor, providerRequirements, type AiProvider, type AiRequirement } from '../adapters/ai.js';
// read inside functions only; the file imports nothing (api/domain/aiConstants.ts explains the import cycle)
import { MODULE_FLAG } from './aiConstants.js';

/** The settings row that holds the switch: "on" or "off" (anything else reads as off). */
export const ASSISTANT_SETTING = 'member_assistant';
export const ASSISTANT_PROMPT_VERSION = 'member-assistant-v1';
/** Messages a member may send in an hour (refused ones count too), on top of the per-address route limit. */
export const ASSISTANT_PER_HOUR = 20;
/** How many earlier messages of the member's conversation go with a new one; the consent wording states it. */
export const ASSISTANT_HISTORY = 10;
const OUTPUT_MAX = 4000;
const PROVIDER_TIMEOUT_MS = 60_000;
const THREAD_SHOWN = 100;
export const ASSISTANT_OFF_MESSAGE = 'The assistant is not switched on.';

/** The rules every request carries to the provider. */
export const ASSISTANT_GUIDANCE = [
  'You are an assistant inside the Bioptime app. You are not the member’s coach and you do not speak for them.',
  'Answer briefly and in plain words, using only the conversation given. Where you do not know, say so instead of filling it in.',
  'Give no medical, diagnostic or medication advice and do not interpret laboratory results; suggest the member asks their coach or a doctor.',
  'Do not state nutrient values, calorie counts, clinical numbers or outcomes, and make no promises about results.',
];

const CONSENT_TEXT = [
  'The Bioptime assistant answers questions you write to it, using an AI provider.',
  `When you send a message, Bioptime sends the provider that message, up to ${ASSISTANT_HISTORY} earlier messages of your conversation with the assistant, and the rules the assistant is asked to follow.`,
  'Nothing else from your account is sent: not your profile, your contact details, your coach’s notes, your logged values or your reports.',
  'The assistant is not your coach and gives no medical advice. Its answers are kept in your conversation with it until you withdraw this consent.',
  'You can withdraw this consent at any time; your conversation with the assistant is then deleted.',
].join(' ');

/** The assistant_processing consent wording: a draft until counsel approves wording (an owner decision), recorded only
 *  in the preview. The version changes whenever the wording does; a consent under an earlier version does not count. */
export const ASSISTANT_CONSENT = {
  version: 'assistant-draft-2026-10-30',
  status: 'pending_counsel' as const,
  label: 'Draft wording, for counsel’s review outside the preview',
  text: CONSENT_TEXT,
  missing: 'Counsel-approved wording for the assistant_processing consent, and the matching privacy notice update (owner decision)',
};

/* ---------- the switch, the provider and the member ---------- */

/** Is the switch on? A missing or unreadable row is off. */
export function switchOn(ctx: Ctx): boolean {
  const row = ctx.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [ASSISTANT_SETTING]);
  return j.out<unknown>(row?.value, 'off') === 'on';
}

/** A provider that can answer members: configured, and with an answer() of its own. */
const answers = (p: AiProvider): boolean => p.configured && typeof p.answer === 'function';

/** What the platform lacks before the assistant can be offered to anyone (nothing about one member). */
function systemMissing(ctx: Ctx): AiRequirement[] {
  const out: AiRequirement[] = [];
  if (!switchOn(ctx)) out.push({ key: 'assistant_switch', label: 'The member assistant switched on by an administrator' });
  const provider = aiProviderFor(ctx);
  if (!provider.configured) {
    const missing = providerRequirements(ctx.config);
    out.push(...(missing.length ? missing : [{ key: 'provider' as const, label: `The ${provider.name} provider is not configured` }]));
  } else if (!answers(provider)) out.push({ key: 'provider', label: `The ${provider.name} provider does not answer members` });
  return out;
}

/** Is the 'ai' flag on for this member (its audience: roles and packages)? */
function inAudience(ctx: Ctx, memberId: string): boolean {
  return isEnabledFor(ctx, MODULE_FLAG, { id: memberId, role: 'member', email: '', name: '' });
}

type ConsentRow = { granted: number; version: string; at: string };
function latestConsent(ctx: Ctx, memberId: string): ConsentRow | undefined {
  return ctx.db.get<ConsentRow>("SELECT granted, version, at FROM member_consents WHERE user_id = ? AND kind = 'assistant_processing' ORDER BY at DESC, rowid DESC LIMIT 1", [memberId]);
}

/** The refusal for the first thing that keeps the assistant from being offered, or null when it is offered. */
function notOffered(ctx: Ctx, memberId: string): AppError | null {
  if (!switchOn(ctx)) return new AppError('ASSISTANT_OFF', 409, ASSISTANT_OFF_MESSAGE);
  const sys = systemMissing(ctx);
  if (sys.length) return new AppError('AI_NOT_CONFIGURED', 409, `The assistant is not configured. Missing: ${sys.map((m) => m.label.charAt(0).toLowerCase() + m.label.slice(1)).join('; ')}.`, { missing: sys });
  if (!inAudience(ctx, memberId)) return new AppError('FEATURE_DISABLED', 403, 'The assistant is not switched on for your account.', { feature: MODULE_FLAG });
  return null;
}

/** GET /me/assistant: whether the assistant is offered to the member and on for them, why not, everything still
 *  missing, and the consent with its wording. Answers while the 'ai' module is off. */
export function assistantStatus(ctx: Ctx, memberId: string) {
  const sys = systemMissing(ctx);
  const audience = inAudience(ctx, memberId);
  const c = latestConsent(ctx, memberId);
  const granted = !!c?.granted;
  const current = granted && c!.version === ASSISTANT_CONSENT.version;
  const missing: AiRequirement[] = [
    ...sys,
    ...(audience ? [] : [{ key: 'member_audience' as const, label: 'The assistant switched on for your account (the Coach AI module’s audience)' }]),
    ...(current ? [] : [
      ...(ctx.config.isDemo ? [] : [{ key: 'consent_wording' as const, label: ASSISTANT_CONSENT.missing }]),
      { key: 'member_consent' as const, label: granted ? 'Your consent under the current wording (you agreed to an earlier one)' : 'Your consent to how the assistant uses your messages' },
    ]),
  ];
  const offer = sys.length === 0 && audience;
  const on = offer && current;
  const reason = !switchOn(ctx) ? ASSISTANT_OFF_MESSAGE
    : sys.length ? 'No AI provider is configured for the assistant, so nothing is sent to one.'
      : !audience ? 'The assistant is not switched on for your account.'
        : !current ? 'Agree to how the assistant uses your messages to start.' : null;
  return {
    on, offer, reason, missing,
    consent: {
      granted: current, earlierWording: granted && !current, version: c?.version ?? null, at: c?.at ?? null,
      canGrant: offer && ctx.config.isDemo,
      wording: { version: ASSISTANT_CONSENT.version, status: ASSISTANT_CONSENT.status, label: ASSISTANT_CONSENT.label, text: ASSISTANT_CONSENT.text },
    },
  };
}

/** POST /me/assistant/consent. Granting needs the assistant offered, the current wording, and (until counsel approves
 *  wording) the preview; withdrawing always works and deletes the member's conversation with the assistant. */
export function setAssistantConsent(ctx: Ctx, memberId: string, granted: boolean, version?: string) {
  if (granted) {
    const refusal = notOffered(ctx, memberId);
    if (refusal) throw refusal;
    if (!ctx.config.isDemo) throw new AppError('CONSENT_WORDING_PENDING', 409, 'The assistant consent cannot be recorded yet: its wording is pending', { missing: ASSISTANT_CONSENT.missing });
    if (version !== ASSISTANT_CONSENT.version) throw errors.badRequest('Agree to the current wording (its version changed); reload and read it again', 'CONSENT_VERSION');
  }
  ctx.db.tx(() => {
    setConsent(ctx, memberId, { kind: 'assistant_processing', version: granted ? ASSISTANT_CONSENT.version : (latestConsent(ctx, memberId)?.version ?? ASSISTANT_CONSENT.version), granted });
    if (!granted) {
      const deleted = ctx.db.run('DELETE FROM assistant_messages WHERE member_id = ?', [memberId]).changes;
      if (deleted) audit(ctx, 'assistant.thread_cleared', { type: 'user', id: memberId }, 'assistant_processing consent withdrawn', { deleted });
    }
  });
  return assistantStatus(ctx, memberId);
}

/* ---------- the conversation ---------- */

type MessageRow = { id: string; member_id: string; role: 'member' | 'assistant'; body: string; model: string | null; prompt_version: string | null; created_at: string };

function presentMessage(m: MessageRow) {
  return { id: m.id, role: m.role, body: m.body, createdAt: m.created_at, model: m.model, label: m.role === 'assistant' ? 'Written by an AI assistant, not your coach.' : null };
}

/** GET /me/assistant/messages: the member's conversation with the assistant while it is on for them; empty otherwise. */
export function listMessages(ctx: Ctx, memberId: string) {
  const status = assistantStatus(ctx, memberId);
  if (!status.on) return { on: false, reason: status.reason, items: [] };
  const rows = ctx.db.all<MessageRow>('SELECT * FROM assistant_messages WHERE member_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?', [memberId, THREAD_SHOWN]).reverse();
  return { on: true, reason: null, items: rows.map(presentMessage) };
}

function requestsInLastHour(ctx: Ctx, memberId: string): number {
  return ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'assistant.request' AND actor_id = ? AND at > ?", [memberId, addDays(ctx.now(), -1 / 24)])?.n ?? 0;
}

/** POST /me/assistant/messages. The checks run in this order: the member's hourly limit; the switch (ASSISTANT_OFF);
 *  a provider that answers members (AI_NOT_CONFIGURED, naming what is missing); the 'ai' flag for the member; their
 *  consent under the current wording (ASSISTANT_CONSENT_REQUIRED). Only then does the provider get the rules and the
 *  member's own conversation. The message and the answer are kept together, and only if the assistant is still on
 *  for the member when the answer comes back. */
export async function sendMessage(ctx: Ctx, memberId: string, body: string) {
  const text = body.trim();
  if (requestsInLastHour(ctx, memberId) >= ASSISTANT_PER_HOUR) throw errors.tooMany(`You have sent the assistant ${ASSISTANT_PER_HOUR} messages in the last hour. Try again later.`);
  const provider = aiProviderFor(ctx);
  const record = (outcome: 'answered' | 'refused' | 'failed', code?: string) => audit(ctx, 'assistant.request', { type: 'user', id: memberId }, null, { outcome, ...(code ? { code } : {}), provider: provider.name, model: provider.model, promptVersion: ASSISTANT_PROMPT_VERSION });
  const refuse = (e: AppError): never => { record('refused', e.code); throw e; };

  const refusal = notOffered(ctx, memberId);
  if (refusal) refuse(refusal);
  if (!assistantStatus(ctx, memberId).on) refuse(new AppError('ASSISTANT_CONSENT_REQUIRED', 409, 'Agree to how the assistant uses your messages first.', { wording: ASSISTANT_CONSENT.version }));

  const history = ctx.db.all<MessageRow>('SELECT * FROM assistant_messages WHERE member_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?', [memberId, ASSISTANT_HISTORY]).reverse();
  const receivedAt = ctx.now();
  let timer: NodeJS.Timeout | undefined;
  let answer = '';
  let model: string | null = provider.model;
  try {
    const result = await Promise.race([
      provider.answer!({ promptVersion: ASSISTANT_PROMPT_VERSION, guidance: ASSISTANT_GUIDANCE, messages: [...history.map((m) => ({ role: m.role, text: m.body })), { role: 'member' as const, text }] }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AppError('AI_TIMEOUT', 504, 'The AI provider did not answer in time')), PROVIDER_TIMEOUT_MS); }),
    ]);
    answer = typeof result?.text === 'string' ? result.text.trim().slice(0, OUTPUT_MAX) : '';
    model = result?.model || provider.model;
  } catch {
    // the provider's own message can carry request detail: none of it is kept or shown
    answer = '';
  } finally { if (timer) clearTimeout(timer); }
  if (!answer) { record('failed', 'ASSISTANT_FAILED'); throw new AppError('ASSISTANT_FAILED', 502, 'The assistant could not answer just now. Try again later.'); }
  // the switch turned off or the consent withdrawn while the provider was answering: nothing is kept
  if (!assistantStatus(ctx, memberId).on) refuse(new AppError('ASSISTANT_OFF', 409, ASSISTANT_OFF_MESSAGE));

  const mine: MessageRow = { id: randomId('asm'), member_id: memberId, role: 'member', body: text, model: null, prompt_version: null, created_at: receivedAt };
  const reply: MessageRow = { id: randomId('asm'), member_id: memberId, role: 'assistant', body: answer, model, prompt_version: ASSISTANT_PROMPT_VERSION, created_at: ctx.now() };
  ctx.db.tx(() => {
    ctx.db.insert('assistant_messages', mine);
    ctx.db.insert('assistant_messages', reply);
    record('answered');
  });
  return { items: [presentMessage(mine), presentMessage(reply)] };
}

/* ---------- administration ---------- */

/** The switch and what else the assistant lacks before it can be offered (no member detail). */
export function adminStatus(ctx: Ctx) {
  const provider = aiProviderFor(ctx);
  const missing = systemMissing(ctx);
  const moduleOn = isEnabled(ctx, MODULE_FLAG);
  return {
    enabled: switchOn(ctx), moduleOn, offered: missing.length === 0 && moduleOn, provider: provider.name, model: provider.model, missing,
    consentWording: { version: ASSISTANT_CONSENT.version, status: ASSISTANT_CONSENT.status, label: ASSISTANT_CONSENT.label },
    note: 'Members see the assistant only while the switch is on, a provider that answers members is configured, the Coach AI module is on for them and they agreed to its consent.',
  };
}

/** PUT /admin/assistant: turn the switch (reason required; audited when it changes). Turning it off hides every
 *  conversation at once; nothing is deleted. */
export function setSwitch(ctx: Ctx, enabled: boolean, reason: string) {
  const from = switchOn(ctx);
  if (from !== enabled) {
    ctx.db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
      [ASSISTANT_SETTING, j.in(enabled ? 'on' : 'off'), ctx.now(), ctx.actor?.id ?? null]);
    audit(ctx, 'assistant.switch', { type: 'setting', id: ASSISTANT_SETTING }, reason, { from: from ? 'on' : 'off', to: enabled ? 'on' : 'off' });
  }
  return adminStatus(ctx);
}
