/* M11 Coach AI drafting (CAPABILITY_MAP.md 4.11): a draft-and-review workflow for coaches.

   - Drafts are never sent. A coach asks for a draft, edits it, accepts it and copies it into the existing routes (a
     message, a plan draft). Nothing here writes a row a member can see.
   - The context is built from the coach's own views: coachMemberView and the field policy (no phone, email, address,
     PIN or date of birth; the context is checked as built and a draft is refused, never sent stripped, if any
     restricted key is in it: AI_CONTEXT_RESTRICTED), an assigned client only, and health detail (progress values,
     check-in answers) only while the member grants both coach_sharing and ai_processing. Any member data at all needs
     the member's ai_processing consent under the current wording, and the 'ai' flag on for the member too (its
     audience), not only for the coach. The context holds only the fields CONTEXT_SHAPE lists, which the consent
     wording names one by one (checked on every request). The context is never stored: a draft keeps the ids of the
     records used (input_refs) and which sections were included (context_scope).
   - What the provider is told (DRAFT_GUIDANCE, for example not to state nutrient values) is a request, not a filter:
     the copy says so, and a coach reviews every draft before anything reaches a member.
   - The provider is AI_PROVIDER (api/adapters/ai.ts). It is "none", so every request is refused with
     AI_NOT_CONFIGURED naming what is missing: the provider and model, its API key in the server environment, a
     data-processing agreement, the owner's retention decision, counsel's consent wording outside the demo, and the
     member's ai_processing consent. Nothing is ever generated here without a provider; no answer is made up.
   - Retention: drafts are deleted after ai_draft_retention_days (an owner decision on /admin/modules). While it is
     undecided, Coach AI refuses requests, so nothing accumulates.
   - Audit: ai.draft_request (purpose, outcome and record ids only; never the instructions or the text),
     ai.draft_accept, ai.draft_discard, ai.drafts_cleared, ai.draft_retention, and consent.set for the consent. */
import type { Ctx } from '../context.js';
import type { DemoSeedContext } from '../modules/types.js';
import { j } from '../db/db.js';
import { randomId } from '../lib/ids.js';
import { AppError, errors } from '../lib/errors.js';
import { addDays } from '../lib/time.js';
import { coachHasMember } from '../auth/permissions.js';
import { coachMemberView, findRestrictedFields, reportRestrictedFields, restrictedKeys } from '../auth/fieldPolicy.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { activeProgramme, getProfile, setConsent } from './members.js';
import { isEnabledFor } from './features.js';
import { moduleByKey } from '../modules/index.js';
import { AI_PURPOSES, aiProviderFor, notConfigured, providerRequirements, type AiPurpose, type AiRequirement } from '../adapters/ai.js';
// the constants api/http/routes/ai.ts reads while it loads live in a file with no imports (the import cycle is explained there)
import { DRAFT_STATUSES, FINAL_TEXT_MAX, INSTRUCTIONS_MAX, MODULE_FLAG, type DraftStatus } from './aiConstants.js';

export { AI_PURPOSES, type AiPurpose };
export { DRAFT_STATUSES, FINAL_TEXT_MAX, INSTRUCTIONS_MAX, MODULE_FLAG, type DraftStatus };

export const PROMPT_VERSION = 'coach-ai-draft-v1';
/** Draft requests a coach may make in an hour (refused ones count too), on top of the per-address route limit. */
export const DRAFTS_PER_HOUR = 20;
const OUTPUT_MAX = 20000;
const PROVIDER_TIMEOUT_MS = 60_000;
const MESSAGES_IN_CONTEXT = 12;
/** How much of each message a draft request carries; the consent wording states it. */
export const MESSAGE_TEXT_IN_CONTEXT = 1000;
const PROGRESS_IN_CONTEXT = 12;
const OPEN_STATUSES = ['requested', 'ready', 'failed'] as const;

const draftId = () => randomId('aid');

/** The purposes. Check-in, meal and workout drafts appear only while M2, M5 and M6 are registered and switched on. */
export const PURPOSES: Record<AiPurpose, { label: string; hint: string; needsMember: boolean; module?: 'progress' | 'nutrition' | 'workouts' }> = {
  message_reply: { label: 'Reply to a message', hint: 'A reply to the latest messages in your conversation with this client.', needsMember: true },
  plan_outline: { label: 'Coaching plan outline', hint: 'An outline to rework in the plan editor. Without a client, a general outline from your instructions only.', needsMember: false },
  checkin_response: { label: 'Check-in response', hint: 'A reply to a check-in this client submitted.', needsMember: true, module: 'progress' },
  meal_plan_outline: { label: 'Meal plan outline', hint: 'An outline to rework in the meal plan editor. The AI provider is asked not to state nutrient values, and you review every draft before anything reaches your client.', needsMember: false, module: 'nutrition' },
  workout_outline: { label: 'Workout outline', hint: 'An outline to rework in the programme editor.', needsMember: false, module: 'workouts' },
};

/** The rules every request carries to the provider. */
export const DRAFT_GUIDANCE = [
  'Write a draft for the coach to read and edit. The coach decides what, if anything, reaches the client.',
  'Use only the context given. Where something needed is missing, say so instead of filling it in.',
  'Give no medical, diagnostic or medication advice and do not interpret laboratory results; suggest the coach refers the client to a doctor where that is needed.',
  'Do not state nutrient values, clinical numbers or outcomes, and make no promises about results.',
];

/** What the coach and the member are told about how drafts work. */
export const RULES = [
  'Drafts are never sent. You edit and accept a draft, then send it yourself through Messages or the plan editor.',
  'A draft about a client needs Coach AI switched on for them and their ai_processing consent under the current wording. Health detail is included only while they also share health records with you.',
  'Phone, email, address, PIN code and date of birth are never taken from the client’s profile. Messages and your instructions are sent as written, so leave contact details out of your instructions.',
  'The AI provider is asked not to give medical advice or state nutrient values; that is a request, not a guarantee, so you review every draft before anything reaches your client.',
  'Drafts are deleted after the retention period the owner sets.',
];

/* ---------- consent ---------- */

/** Every field a provider can receive in a draft's context, as nested keys (`true` ends a branch; arrays are checked
 *  element by element). buildContext refuses to send a context with a key not listed here, and every member field is
 *  named by one of AI_CONSENT_DATA's lines, so the consent wording lists exactly what a draft request sends. */
type ContextShape = { [key: string]: true | ContextShape };
export const CONTEXT_SHAPE = {
  purpose: true, purposeLabel: true,
  client: { firstName: true, age: true, gender: true, goals: true, preferences: true, programme: { name: true, duration: true, status: true } },
  conversation: { from: true, at: true, text: true },
  currentPlan: { title: true, goals: true, summary: true, weeks: { week: true, focus: true, tasks: { title: true, kind: true, day: true } }, tasksDone: true, tasksTotal: true },
  checkin: { title: true, dueDate: true, status: true, questions: { question: true, type: true, answer: true }, answersWithheld: true },
  recentProgress: { metric: true, value: true, unit: true, at: true, source: true },
} satisfies ContextShape;

/** The context paths CONTEXT_SHAPE does not list ('client.email', 'conversation[].sender'): empty for a valid context. */
export function unlistedContextPaths(value: unknown, shape: ContextShape = CONTEXT_SHAPE, at = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => unlistedContextPaths(v, shape, `${at}[]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
    const s = shape[k];
    const path = at ? `${at}.${k}` : k;
    if (!s) return [path];
    return s === true ? [] : unlistedContextPaths(v, s, path);
  });
}

/** The member's data a draft request can send, one line per context section (plus the coach's instructions), with the
 *  CONTEXT_SHAPE paths each line covers. The consent wording and the member's screens show these lines. */
export const AI_CONSENT_DATA: Array<{ section: keyof typeof CONTEXT_SHAPE | 'instructions'; text: string; covers: string[] }> = [
  { section: 'client', text: 'For any draft about you: your first name, your age (not your date of birth), gender, goals, the preferences saved in your profile, and your programme’s name, length and status.',
    covers: ['client.firstName', 'client.age', 'client.gender', 'client.goals', 'client.preferences', 'client.programme.name', 'client.programme.duration', 'client.programme.status'] },
  { section: 'conversation', text: `For a reply to your messages: up to the last ${MESSAGES_IN_CONTEXT} messages between you and your coach, as written (the first ${MESSAGE_TEXT_IN_CONTEXT.toLocaleString('en-IN')} characters of each), with who sent each one and when.`,
    covers: ['conversation.from', 'conversation.at', 'conversation.text'] },
  { section: 'currentPlan', text: 'For a plan, meal plan or workout outline: the plan your coach picks, or their latest plan for you, with its title, goals, summary, week-by-week focus and tasks, and how many of its tasks you have done.',
    covers: ['currentPlan.title', 'currentPlan.goals', 'currentPlan.summary', 'currentPlan.weeks.week', 'currentPlan.weeks.focus', 'currentPlan.weeks.tasks.title', 'currentPlan.weeks.tasks.kind', 'currentPlan.weeks.tasks.day', 'currentPlan.tasksDone', 'currentPlan.tasksTotal'] },
  { section: 'checkin', text: 'For a reply to a check-in: that check-in’s title, due date, status and questions, and your answers only while “My coach may see my health information” is on (otherwise only that your answers are withheld).',
    covers: ['checkin.title', 'checkin.dueDate', 'checkin.status', 'checkin.questions.question', 'checkin.questions.type', 'checkin.questions.answer', 'checkin.answersWithheld'] },
  { section: 'recentProgress', text: `For an outline or a reply to a check-in, only while “My coach may see my health information” is on: up to ${PROGRESS_IN_CONTEXT} of your latest logged values, each with its name, value, unit, date and where it came from.`,
    covers: ['recentProgress.metric', 'recentProgress.value', 'recentProgress.unit', 'recentProgress.at', 'recentProgress.source'] },
  { section: 'instructions', text: 'The instructions your coach writes for that draft.', covers: [] },
];

const CONSENT_INTRO = 'Your coach may use Coach AI to help write drafts for you, such as replies to your messages and plan outlines. For each draft, Bioptime sends the AI provider the kind of draft and the rules it is asked to follow, and only the parts of this list that the draft needs:';
const CONSENT_OUTRO = 'Your phone number, email, address, PIN code and date of birth are never taken from your profile, but anything you write in a message is sent as you wrote it. Your coach reads and edits every draft, and nothing is sent to you automatically. You can withdraw this consent at any time; open drafts about you are then discarded.';

/** The ai_processing consent wording. Counsel has not approved wording (an owner decision), so the demo shows this
 *  draft, labelled as such, and every other mode refuses to record the consent and names what is missing. The version
 *  changes whenever the wording does; a consent recorded under an earlier version is not used for drafts until the
 *  member agrees to the current one (they can still withdraw it). */
export const AI_CONSENT = {
  // the version is shown to members next to their consent, so it carries no "demo" (renamed from demo-draft-2026-10-23b
  // on 24 October 2026; the wording itself did not change, and a fresh seed records the consent under this name)
  version: 'draft-2026-10-23b',
  status: 'pending_counsel' as const,
  label: 'Draft wording, pending review by counsel',
  intro: CONSENT_INTRO,
  items: AI_CONSENT_DATA.map((d) => d.text),
  outro: CONSENT_OUTRO,
  text: [CONSENT_INTRO, ...AI_CONSENT_DATA.map((d) => d.text), CONSENT_OUTRO].join(' '),
  missing: 'Counsel-approved wording for the ai_processing consent, and the matching privacy notice update (owner decision)',
};

type ConsentRow = { granted: number; version: string; at: string };
function latestConsent(ctx: Ctx, memberId: string, kind: string): ConsentRow | undefined {
  return ctx.db.get<ConsentRow>('SELECT granted, version, at FROM member_consents WHERE user_id = ? AND kind = ? ORDER BY at DESC, rowid DESC LIMIT 1', [memberId, kind]);
}
/** A granted ai_processing consent under the current wording: what any draft about the member needs. */
export function aiConsentGranted(ctx: Ctx, memberId: string): boolean {
  const c = latestConsent(ctx, memberId, 'ai_processing');
  return !!c?.granted && c.version === AI_CONSENT.version;
}
/** A granted ai_processing consent on record under any wording: while there is one, the member can always withdraw it. */
export function aiConsentOnRecord(ctx: Ctx, memberId: string): boolean { return !!latestConsent(ctx, memberId, 'ai_processing')?.granted; }
export function healthShared(ctx: Ctx, memberId: string): boolean { return !!latestConsent(ctx, memberId, 'coach_sharing')?.granted; }

/** Is the 'ai' flag on for this member (its audience: roles and packages)? The coach's own check runs in def(); a
 *  draft about a member needs the flag on for the member as well. isEnabledFor reads only the actor's role and id. */
export function memberInAudience(ctx: Ctx, memberId: string): boolean {
  return isEnabledFor(ctx, MODULE_FLAG, { id: memberId, role: 'member', email: '', name: '' });
}

/** The member's own view of the consent and whether Coach AI is in use at all. Works while the module is off, so a
 *  member with a consent on record can always see and withdraw it. */
export function aiConsentState(ctx: Ctx, memberId: string) {
  const c = latestConsent(ctx, memberId, 'ai_processing');
  const granted = !!c?.granted;
  const current = granted && c!.version === AI_CONSENT.version;
  const moduleOn = isEnabledFor(ctx, MODULE_FLAG);
  const inUse = moduleOn && systemMissing(ctx).length === 0;
  return {
    granted, current, earlierWording: granted && !current, version: c?.version ?? null, at: c?.at ?? null,
    wording: { version: AI_CONSENT.version, status: AI_CONSENT.status, label: AI_CONSENT.label, text: AI_CONSENT.text, intro: AI_CONSENT.intro, items: AI_CONSENT.items, outro: AI_CONSENT.outro },
    moduleOn, canGrant: ctx.config.isDemo && moduleOn, missing: ctx.config.isDemo ? null : AI_CONSENT.missing,
    healthShared: healthShared(ctx, memberId), inUse,
    note: !moduleOn ? 'Coach AI is switched off for your account, so your coach cannot ask it for drafts about you. You can still withdraw a consent you gave.'
      : inUse ? 'Your coach can ask Coach AI for drafts only while you agree here.' : 'No AI provider is configured, so nothing about you is sent to one.',
    demo: ctx.config.isDemo,
  };
}

/** Grant or withdraw ai_processing. Withdrawing discards every open draft about the member and clears the AI text of
 *  accepted ones (the coach's own final text stays); granting needs the current wording, and outside the demo it is
 *  refused until counsel approves wording. */
export function setAiConsent(ctx: Ctx, memberId: string, granted: boolean, version?: string) {
  if (granted) {
    if (!ctx.config.isDemo) throw new AppError('CONSENT_WORDING_PENDING', 409, 'The Coach AI consent cannot be recorded yet: its wording is pending', { missing: AI_CONSENT.missing });
    if (version !== AI_CONSENT.version) throw errors.badRequest('Agree to the current wording (its version changed); reload and read it again', 'CONSENT_VERSION');
  }
  ctx.db.tx(() => {
    setConsent(ctx, memberId, { kind: 'ai_processing', version: granted ? AI_CONSENT.version : (latestConsent(ctx, memberId, 'ai_processing')?.version ?? AI_CONSENT.version), granted });
    if (!granted) clearDraftsFor(ctx, { memberId }, 'The client withdrew the ai_processing consent', 'ai_processing consent withdrawn');
  });
  return aiConsentState(ctx, memberId);
}

/** Discard the open drafts about a member (optionally only other coaches' ones) and clear the AI text of accepted ones. */
function clearDraftsFor(ctx: Ctx, where: { memberId: string; exceptCoachId?: string }, error: string, reason: string): number {
  const now = ctx.now();
  const coachClause = where.exceptCoachId ? ' AND coach_id != ?' : '';
  const params = where.exceptCoachId ? [where.memberId, where.exceptCoachId] : [where.memberId];
  const open = ctx.db.run(`UPDATE ai_drafts SET status = 'discarded', output = NULL, final_text = NULL, discarded_at = ?, error = ?, updated_at = ? WHERE member_id = ? AND status IN ('requested','ready','failed')${coachClause}`, [now, error, now, ...params]).changes;
  const accepted = ctx.db.run(`UPDATE ai_drafts SET output = NULL, updated_at = ? WHERE member_id = ? AND status = 'accepted' AND output IS NOT NULL${coachClause}`, [now, ...params]).changes;
  if (open || accepted) audit(ctx, 'ai.drafts_cleared', { type: 'user', id: where.memberId }, reason, { discarded: open, acceptedCleared: accepted, ...(where.exceptCoachId ? { keptCoachId: where.exceptCoachId } : {}) });
  return open + accepted;
}

/* ---------- readiness ---------- */

function retentionDays(ctx: Ctx): number | null {
  const v = getSetting<number | null>(ctx, 'ai_draft_retention_days');
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

/** What the platform still lacks before any draft can be made (not about one member). */
function systemMissing(ctx: Ctx): AiRequirement[] {
  const provider = aiProviderFor(ctx);
  const out: AiRequirement[] = provider.configured ? [] : providerRequirements(ctx.config);
  if (!provider.configured && !out.length) out.push({ key: 'provider', label: `The ${provider.name} provider is not configured` });
  // outside the demo, the consent cannot be recorded until counsel approves its wording
  if (!ctx.config.isDemo) out.push({ key: 'consent_wording', label: AI_CONSENT.missing });
  if (retentionDays(ctx) === null) out.push({ key: 'retention', label: 'An owner decision on how long drafts are kept: Coach AI draft retention on /admin/modules' });
  return out;
}

/** What one client lacks: the 'ai' flag on for them (its audience), and their consent under the current wording. */
function memberMissing(ctx: Ctx, memberId: string, name: string): AiRequirement[] {
  const out: AiRequirement[] = [];
  if (!memberInAudience(ctx, memberId)) out.push({ key: 'member_audience', label: `Coach AI switched on for ${name}: the Coach AI module’s audience on /admin/modules leaves them out` });
  if (!aiConsentGranted(ctx, memberId)) {
    out.push({ key: 'member_consent', label: aiConsentOnRecord(ctx, memberId)
      ? `${name}’s ai_processing consent under the current wording (they agreed to an earlier wording; they agree again on Coach AI and your data, in their portal or app)`
      : `${name}’s ai_processing consent (the client gives it on Coach AI and your data, in their portal or app)` });
  }
  return out;
}

/** Which purposes can be drafted now: check-in, meal and workout drafts need their module registered and switched on. */
export function purposeList(ctx: Ctx) {
  return AI_PURPOSES.map((purpose) => {
    const p = PURPOSES[purpose];
    const available = !p.module || (!!moduleByKey(p.module) && isEnabledFor(ctx, p.module));
    return { purpose, label: p.label, hint: p.hint, needsMember: p.needsMember, available, unavailableReason: available ? null : `Needs the ${p.module === 'progress' ? 'Progress' : p.module === 'nutrition' ? 'Nutrition' : 'Workouts'} module switched on` };
  });
}

/** The integration's state without any member detail (administrators and the member's own page). */
export function systemReadiness(ctx: Ctx) {
  const provider = aiProviderFor(ctx);
  const missing = systemMissing(ctx);
  return { configured: missing.length === 0, provider: provider.name, model: provider.model, missing, retentionDays: retentionDays(ctx), promptVersion: PROMPT_VERSION };
}

/* ---------- the coach's view ---------- */

function assignedMember(ctx: Ctx, coachId: string, memberId: string): { id: string; name: string } {
  if (!coachHasMember(ctx, coachId, memberId)) throw errors.forbidden('You do not have access to this member', 'NO_ACCESS');
  const u = ctx.db.get<{ id: string; name: string }>("SELECT id, name FROM users WHERE id = ? AND role = 'member'", [memberId]);
  if (!u) throw errors.forbidden('You do not have access to this member', 'NO_ACCESS');
  return u;
}

const tableExists = (ctx: Ctx, name: string) => !!ctx.db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [name]);

/** Coach AI for a coach: what is missing, the purposes, and for one assigned client whether Coach AI is on for them,
 *  their consents and the records a draft could start from (titles and dates only; none while Coach AI is off for
 *  them, since no draft about them can be made). */
export function coachStatus(ctx: Ctx, coachId: string, memberId?: string) {
  const sys = systemReadiness(ctx);
  let member: null | Record<string, unknown> = null;
  let missing = sys.missing;
  if (memberId) {
    const m = assignedMember(ctx, coachId, memberId);
    const inAudience = memberInAudience(ctx, memberId);
    const c = latestConsent(ctx, memberId, 'ai_processing');
    const conversation = inAudience ? ctx.db.get<{ id: string; n: number }>('SELECT c.id, (SELECT COUNT(*) FROM messages x WHERE x.conversation_id = c.id) AS n FROM conversations c WHERE c.member_id = ? AND c.coach_id = ? ORDER BY c.created_at DESC LIMIT 1', [memberId, coachId]) : undefined;
    const plans = inAudience ? ctx.db.all<{ id: string; title: string; status: string; updated_at: string }>("SELECT id, title, status, updated_at FROM coaching_plans WHERE member_id = ? AND coach_id = ? AND status IN ('draft','published') ORDER BY updated_at DESC LIMIT 10", [memberId, coachId]) : [];
    const checkins = inAudience && isEnabledFor(ctx, 'progress') && tableExists(ctx, 'checkins')
      ? ctx.db.all<{ id: string; title: string; due_date: string; status: string }>("SELECT id, title, due_date, status FROM checkins WHERE member_id = ? AND coach_id = ? AND status IN ('submitted','reviewed') ORDER BY due_date DESC LIMIT 10", [memberId, coachId])
      : [];
    const granted = !!c?.granted, current = granted && c!.version === AI_CONSENT.version;
    member = {
      id: m.id, name: m.name, inAudience,
      aiConsent: { granted: current, earlierWording: granted && !current, version: c?.version ?? null, at: c?.at ?? null },
      healthShared: healthShared(ctx, memberId),
      sources: {
        conversation: conversation ? { id: conversation.id, messages: conversation.n } : null,
        plans: plans.map((p) => ({ id: p.id, title: p.title, status: p.status, updatedAt: p.updated_at })),
        checkins: checkins.map((x) => ({ id: x.id, title: x.title, dueDate: x.due_date, status: x.status })),
      },
    };
    missing = [...missing, ...memberMissing(ctx, memberId, m.name)];
  }
  return { configured: missing.length === 0, provider: sys.provider, model: sys.model, missing, retentionDays: sys.retentionDays, promptVersion: PROMPT_VERSION, purposes: purposeList(ctx), rules: RULES, member, perHour: DRAFTS_PER_HOUR };
}

/* ---------- drafts ---------- */

type DraftRow = {
  id: string; coach_id: string; member_id: string | null; purpose: AiPurpose; input_refs: string; context_scope: string; prompt_version: string; provider: string; model: string | null;
  status: DraftStatus; output: string | null; final_text: string | null; accepted_at: string | null; discarded_at: string | null; error: string | null; created_at: string; updated_at: string;
};
export type DraftRef = { type: string; id: string };
export type ContextScope = { client: boolean; messages: number; plan: boolean; checkin: boolean; checkinAnswers: boolean; health: boolean; progressValues: number };

export function draftView(ctx: Ctx, r: DraftRow) {
  const member = r.member_id ? ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [r.member_id]) : undefined;
  return {
    id: r.id, purpose: r.purpose, purposeLabel: PURPOSES[r.purpose].label, memberId: r.member_id, memberName: member?.name ?? null, status: r.status,
    output: r.output, finalText: r.final_text, inputRefs: j.out<DraftRef[]>(r.input_refs, []), contextScope: j.out<Partial<ContextScope>>(r.context_scope, {}),
    promptVersion: r.prompt_version, provider: r.provider, model: r.model, error: r.error,
    createdAt: r.created_at, updatedAt: r.updated_at, acceptedAt: r.accepted_at, discardedAt: r.discarded_at,
    label: 'AI draft: read and edit before you use it. Nothing is sent to the client.',
  };
}

function ownDraft(ctx: Ctx, coachId: string, id: string): DraftRow {
  const r = ctx.db.get<DraftRow>('SELECT * FROM ai_drafts WHERE id = ? AND coach_id = ?', [id, coachId]);
  // another coach's draft, or one about a client no longer assigned, is not found (nothing is revealed)
  if (!r || (r.member_id && !coachHasMember(ctx, coachId, r.member_id))) throw errors.notFound('Draft');
  return r;
}

export function getDraft(ctx: Ctx, coachId: string, id: string) { return draftView(ctx, ownDraft(ctx, coachId, id)); }

/** The coach's own drafts, newest first; only about clients still assigned to them (and general ones). */
export function listDrafts(ctx: Ctx, coachId: string, opts: { memberId?: string; status?: DraftStatus; limit?: number } = {}) {
  if (opts.memberId) assignedMember(ctx, coachId, opts.memberId);
  const where = ['d.coach_id = ?', "(d.member_id IS NULL OR EXISTS (SELECT 1 FROM coach_assignments a WHERE a.coach_id = d.coach_id AND a.member_id = d.member_id AND a.status IN ('active','paused')))"];
  const params: string[] = [coachId];
  if (opts.memberId) { where.push('d.member_id = ?'); params.push(opts.memberId); }
  if (opts.status) { where.push('d.status = ?'); params.push(opts.status); }
  const rows = ctx.db.all<DraftRow>(`SELECT d.* FROM ai_drafts d WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC, d.id DESC LIMIT ?`, [...params, Math.min(100, Math.max(1, opts.limit ?? 50))]);
  return { items: rows.map((r) => draftView(ctx, r)), retentionDays: retentionDays(ctx) };
}

export type DraftInput = { purpose: AiPurpose; memberId?: string; checkinId?: string; planId?: string; instructions?: string };

function requestsInLastHour(ctx: Ctx, coachId: string): number {
  return ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM audit_events WHERE action = 'ai.draft_request' AND actor_id = ? AND at > ?", [coachId, addDays(ctx.now(), -1 / 24)])?.n ?? 0;
}

/** Ask for a draft. The checks run in this order: the client is assigned; the fields fit the purpose; the purpose's
 *  module is on; the records named belong to this client and coach; the coach's hourly limit; then what Coach AI
 *  lacks (AI_NOT_CONFIGURED, naming every missing item), the 'ai' flag for the client (FEATURE_DISABLED while its
 *  audience leaves them out) and the client's consent under the current wording (AI_CONSENT_REQUIRED). Only then is
 *  the context built and the provider asked. */
export async function requestDraft(ctx: Ctx, coachId: string, input: DraftInput) {
  const p = PURPOSES[input.purpose];
  const member = input.memberId ? assignedMember(ctx, coachId, input.memberId) : null;
  const fields: Array<{ path: string; message: string }> = [];
  if (p.needsMember && !member) fields.push({ path: 'memberId', message: 'Choose the client this draft is for' });
  if (input.purpose === 'checkin_response' && !input.checkinId) fields.push({ path: 'checkinId', message: 'Choose the check-in to respond to' });
  if (input.checkinId && input.purpose !== 'checkin_response') fields.push({ path: 'checkinId', message: 'A check-in goes with a check-in response only' });
  if (input.planId && !['plan_outline', 'meal_plan_outline', 'workout_outline'].includes(input.purpose)) fields.push({ path: 'planId', message: 'A plan goes with an outline only' });
  if (input.planId && !member) fields.push({ path: 'planId', message: 'Choose the client the plan belongs to' });
  if (fields.length) throw errors.validation(fields, `${fields[0]!.path}: ${fields[0]!.message}`);

  const availability = purposeList(ctx).find((x) => x.purpose === input.purpose)!;
  if (!availability.available) throw new AppError('PURPOSE_UNAVAILABLE', 409, `${p.label} is not available: ${availability.unavailableReason}`, { purpose: input.purpose, module: p.module });

  if (input.checkinId) {
    const ok = tableExists(ctx, 'checkins') && ctx.db.get('SELECT 1 FROM checkins WHERE id = ? AND member_id = ? AND coach_id = ?', [input.checkinId, member!.id, coachId]);
    if (!ok) throw errors.notFound('Check-in');
  }
  if (input.planId && !ctx.db.get('SELECT 1 FROM coaching_plans WHERE id = ? AND member_id = ? AND coach_id = ?', [input.planId, member!.id, coachId])) throw errors.notFound('Plan');

  if (requestsInLastHour(ctx, coachId) >= DRAFTS_PER_HOUR) throw errors.tooMany(`You have asked for ${DRAFTS_PER_HOUR} drafts in the last hour. Try again later.`);

  const refsRequested: DraftRef[] = [...(member ? [{ type: 'user', id: member.id }] : []), ...(input.checkinId ? [{ type: 'checkin', id: input.checkinId }] : []), ...(input.planId ? [{ type: 'coaching_plan', id: input.planId }] : [])];
  const refuse = (e: AppError, missing: AiRequirement[]): never => {
    audit(ctx, 'ai.draft_request', member ? { type: 'user', id: member.id } : null, null, { purpose: input.purpose, memberId: member?.id ?? null, inputRefs: refsRequested, outcome: 'refused', code: e.code, missing: missing.map((m) => m.key) });
    throw e;
  };
  const sys = systemMissing(ctx);
  const mem = member ? memberMissing(ctx, member.id, member.name) : [];
  if (sys.length) refuse(notConfigured([...sys, ...mem]), [...sys, ...mem]);
  // the flag's audience applies to the client too (a package-limited rollout), not only to the coach asking
  const audience = mem.filter((m) => m.key === 'member_audience');
  if (audience.length) refuse(new AppError('FEATURE_DISABLED', 403, `Coach AI is not switched on for ${member!.name}, so no draft can use their details.`, { feature: MODULE_FLAG, missing: audience }), audience);
  if (mem.length) {
    const earlier = aiConsentOnRecord(ctx, member!.id);
    refuse(new AppError('AI_CONSENT_REQUIRED', 409, earlier
      ? `${member!.name} agreed to an earlier Coach AI wording and has not agreed to the current one, so no draft can use their details.`
      : `${member!.name} has not agreed to Coach AI (the ai_processing consent), so no draft can use their details.`, { missing: mem }), mem);
  }

  const provider = aiProviderFor(ctx);
  let built: Built;
  try { built = buildContext(ctx, coachId, input, member); }
  catch (e) {
    // a context that carried a restricted key is refused (and audited as a refusal); nothing reaches the provider
    if (e instanceof AppError && e.code === AI_CONTEXT_RESTRICTED) refuse(e, []);
    throw e;
  }
  const id = draftId();
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.insert('ai_drafts', { id, coach_id: coachId, member_id: member?.id ?? null, purpose: input.purpose, input_refs: j.in(built.refs), context_scope: j.in(built.scope), prompt_version: PROMPT_VERSION, provider: provider.name, model: provider.model, status: 'requested', created_at: now, updated_at: now });
    audit(ctx, 'ai.draft_request', { type: 'ai_draft', id }, null, { purpose: input.purpose, memberId: member?.id ?? null, inputRefs: built.refs, scope: built.scope, outcome: 'requested', provider: provider.name, model: provider.model, promptVersion: PROMPT_VERSION });
    if (member && built.scope.health) audit(ctx, 'health.viewed', { type: 'user', id: member.id }, null, { by: 'coach', what: 'coach-ai-context', draftId: id });
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      provider.draft({ purpose: input.purpose, promptVersion: PROMPT_VERSION, guidance: DRAFT_GUIDANCE, context: built.context, instructions: input.instructions?.trim() || null }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AppError('AI_TIMEOUT', 504, 'The AI provider did not answer in time')), PROVIDER_TIMEOUT_MS); }),
    ]);
    const text = typeof result?.text === 'string' ? result.text.trim().slice(0, OUTPUT_MAX) : '';
    if (!text) throw new AppError('AI_EMPTY', 502, 'The AI provider returned no draft');
    ctx.db.update('ai_drafts', id, { status: 'ready', output: text, model: result.model || provider.model, updated_at: ctx.now() });
  } catch (e) {
    // the provider's own message can carry request detail: only our own codes' wording is kept
    const message = e instanceof AppError ? e.message : 'The AI provider could not make a draft';
    ctx.db.update('ai_drafts', id, { status: 'failed', error: message, updated_at: ctx.now() });
  } finally { if (timer) clearTimeout(timer); }
  return draftView(ctx, ctx.db.get<DraftRow>('SELECT * FROM ai_drafts WHERE id = ?', [id])!);
}

/** The coach accepts a ready draft with their own final text. Nothing is sent: they copy it into Messages or the
 *  plan editor themselves. A draft about a client needs their consent under the current wording at this point too;
 *  the refusal says why it is missing (an earlier wording, a withdrawal, or none on record). */
export function acceptDraft(ctx: Ctx, coachId: string, id: string, finalText: string) {
  const r = ownDraft(ctx, coachId, id);
  if (r.status !== 'ready') throw errors.state(r.status === 'accepted' ? 'This draft is already accepted' : `Only a ready draft can be accepted (this one is ${r.status})`, { code: 'DRAFT_NOT_READY', status: r.status });
  if (r.member_id && !aiConsentGranted(ctx, r.member_id)) {
    const c = latestConsent(ctx, r.member_id, 'ai_processing');
    const why = c?.granted ? 'earlier_wording' : c ? 'withdrawn' : 'none';
    throw new AppError('AI_CONSENT_REQUIRED', 409, why === 'earlier_wording'
      ? 'The client agreed to an earlier Coach AI wording and has not agreed to the current one; this draft can no longer be used'
      : why === 'withdrawn' ? 'The client has withdrawn the ai_processing consent; this draft can no longer be used'
        : 'The client has no ai_processing consent on record; this draft can no longer be used', { consent: why });
  }
  const text = finalText.trim();
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.update('ai_drafts', id, { status: 'accepted', final_text: text, accepted_at: now, updated_at: now });
    audit(ctx, 'ai.draft_accept', { type: 'ai_draft', id }, null, { purpose: r.purpose, memberId: r.member_id, edited: text !== (r.output ?? '').trim(), length: text.length });
  });
  return getDraft(ctx, coachId, id);
}

/** Discard a draft the coach will not use. Its text is cleared at once. */
export function discardDraft(ctx: Ctx, coachId: string, id: string, reason?: string | null) {
  const r = ownDraft(ctx, coachId, id);
  if (r.status === 'discarded') throw errors.state('This draft is already discarded', { code: 'DRAFT_DISCARDED' });
  if (r.status === 'accepted') throw errors.state('An accepted draft stays until the retention period ends', { code: 'DRAFT_ACCEPTED' });
  const now = ctx.now();
  ctx.db.tx(() => {
    ctx.db.update('ai_drafts', id, { status: 'discarded', output: null, final_text: null, discarded_at: now, updated_at: now });
    audit(ctx, 'ai.draft_discard', { type: 'ai_draft', id }, reason?.trim() || null, { purpose: r.purpose, memberId: r.member_id, previousStatus: r.status });
  });
  return getDraft(ctx, coachId, id);
}

/* ---------- the context a provider receives ---------- */

type Built = { context: Record<string, unknown>; refs: DraftRef[]; scope: ContextScope };

/** Built from what the coach may see, for an assigned client only, then checked as built: a restricted key anywhere
 *  refuses the draft (assertProviderContextClean), and so does a field the consent wording does not name.
 *  Health detail (progress values, check-in answers) needs both coach_sharing and ai_processing. */
export function buildContext(ctx: Ctx, coachId: string, input: DraftInput, member: { id: string; name: string } | null): Built {
  const refs: DraftRef[] = [];
  const scope: ContextScope = { client: false, messages: 0, plan: false, checkin: false, checkinAnswers: false, health: false, progressValues: 0 };
  const context: Record<string, unknown> = { purpose: input.purpose, purposeLabel: PURPOSES[input.purpose].label };
  if (member) {
    if (!coachHasMember(ctx, coachId, member.id)) throw errors.forbidden('You do not have access to this member', 'NO_ACCESS');
    const view = coachMemberView(ctx, getProfile(ctx, member.id));
    const programme = activeProgramme(ctx, member.id);
    const health = healthShared(ctx, member.id) && aiConsentGranted(ctx, member.id);
    context.client = {
      firstName: view.name.split(/\s+/)[0] ?? view.name, age: view.profile.age, gender: view.profile.gender, goals: view.profile.goals, preferences: view.profile.preferences,
      programme: programme ? { name: programme.packageName, duration: programme.durationLabel, status: programme.status } : null,
    };
    refs.push({ type: 'user', id: member.id });
    scope.client = true;

    if (input.purpose === 'message_reply') {
      const conv = ctx.db.get<{ id: string }>('SELECT id FROM conversations WHERE member_id = ? AND coach_id = ? ORDER BY created_at DESC LIMIT 1', [member.id, coachId]);
      const rows = conv ? ctx.db.all<{ id: string; sender_id: string; body: string; created_at: string }>('SELECT id, sender_id, body, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?', [conv.id, MESSAGES_IN_CONTEXT]).reverse() : [];
      context.conversation = rows.map((m) => ({ from: m.sender_id === member.id ? 'client' : m.sender_id === coachId ? 'coach' : 'other', at: m.created_at, text: m.body.slice(0, MESSAGE_TEXT_IN_CONTEXT) }));
      for (const m of rows) refs.push({ type: 'message', id: m.id });
      scope.messages = rows.length;
    }

    if (['plan_outline', 'meal_plan_outline', 'workout_outline'].includes(input.purpose)) {
      const plan = input.planId
        ? ctx.db.get<{ id: string; title: string; goals: string }>('SELECT id, title, goals FROM coaching_plans WHERE id = ? AND member_id = ? AND coach_id = ?', [input.planId, member.id, coachId])
        : ctx.db.get<{ id: string; title: string; goals: string }>("SELECT id, title, goals FROM coaching_plans WHERE member_id = ? AND coach_id = ? AND status IN ('draft','published') ORDER BY updated_at DESC LIMIT 1", [member.id, coachId]);
      if (plan) {
        const v = ctx.db.get<{ id: string; summary: string; structure: string }>('SELECT id, summary, structure FROM coaching_plan_versions WHERE plan_id = ? ORDER BY version DESC LIMIT 1', [plan.id]);
        const structure = j.out<{ weeks?: Array<{ week: number; focus?: string; tasks?: Array<{ title: string; kind?: string; day?: number }> }> }>(v?.structure, {});
        const tasks = ctx.db.get<{ total: number; done: number }>("SELECT COUNT(*) total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) done FROM plan_tasks WHERE member_id = ? AND plan_version_id IN (SELECT id FROM coaching_plan_versions WHERE plan_id = ?)", [member.id, plan.id]);
        context.currentPlan = {
          title: plan.title, goals: j.out<string[]>(plan.goals, []), summary: v?.summary ?? '',
          weeks: (structure.weeks ?? []).slice(0, 26).map((w) => ({ week: w.week, focus: w.focus ?? null, tasks: (w.tasks ?? []).slice(0, 30).map((t) => ({ title: t.title, kind: t.kind ?? null, day: t.day ?? null })) })),
          tasksDone: tasks?.done ?? 0, tasksTotal: tasks?.total ?? 0,
        };
        refs.push({ type: 'coaching_plan', id: plan.id });
        scope.plan = true;
      }
    }

    if (input.purpose === 'checkin_response' && input.checkinId && tableExists(ctx, 'checkins')) {
      const c = ctx.db.get<{ id: string; title: string; due_date: string; status: string; questions: string; answers: string | null }>('SELECT id, title, due_date, status, questions, answers FROM checkins WHERE id = ? AND member_id = ? AND coach_id = ?', [input.checkinId, member.id, coachId]);
      if (c) {
        const questions = j.out<Array<{ key: string; label: string; type: string }>>(c.questions, []);
        const answers = health ? j.out<Record<string, unknown> | null>(c.answers, null) : null;
        context.checkin = {
          title: c.title, dueDate: c.due_date, status: c.status,
          questions: questions.map((q) => ({ question: q.label, type: q.type, ...(answers && q.key in answers ? { answer: answers[q.key] } : {}) })),
          ...(health ? {} : { answersWithheld: 'The client does not share health records with their coach, so their answers are not included.' }),
        };
        refs.push({ type: 'checkin', id: c.id });
        scope.checkin = true;
        scope.checkinAnswers = !!answers;
      }
    }

    if (health && input.purpose !== 'message_reply') {
      const values = ctx.db.all<{ id: string; metric: string; value: number; unit: string; at: string; source: string }>('SELECT id, metric, value, unit, at, source FROM progress_entries WHERE member_id = ? ORDER BY at DESC LIMIT ?', [member.id, PROGRESS_IN_CONTEXT]);
      if (values.length) {
        context.recentProgress = values.map((v) => ({ metric: v.metric, value: v.value, unit: v.unit, at: v.at, source: v.source }));
        for (const v of values) refs.push({ type: 'progress_entry', id: v.id });
        scope.progressValues = values.length;
      }
    }
    scope.health = health && (scope.checkinAnswers || scope.progressValues > 0);
  }
  // the field policy's safety net over everything a provider would receive, on the context as built: it fails closed
  assertProviderContextClean(context);
  // only what the consent wording names: a field added here without a line in AI_CONSENT_DATA is never sent
  if (unlistedContextPaths(context).length) throw errors.internal('A Coach AI context field is not named in the consent wording');
  return { context, refs, scope };
}

/** The code of the refusal when a Coach AI context carries a restricted key. */
export const AI_CONTEXT_RESTRICTED = 'AI_CONTEXT_RESTRICTED';

/** The context goes to an external provider, so the field policy fails closed here: the context is checked exactly as
 *  it was built, before anything is removed, and a restricted key anywhere (phone, email, address, PIN code, date of
 *  birth, account or payment data, however it is spelt or nested) refuses the draft with a 500 AI_CONTEXT_RESTRICTED.
 *  A stripped copy is never sent in its place, so a query that starts returning such a field is noticed, not hidden.
 *  The key paths (never the values) go to the field policy's reporter; the refusal carries no paths or values. */
export function assertProviderContextClean(context: Record<string, unknown>): void {
  const found = findRestrictedFields(context, restrictedKeys());
  if (!found.length) return;
  reportRestrictedFields('Coach AI context', found);
  throw new AppError(AI_CONTEXT_RESTRICTED, 500, 'Coach AI refused this draft: the details gathered for it included a contact or identity field that is never sent to an AI provider. Nothing was sent. It has been logged.');
}

/* ---------- administration: usage ---------- */

/** Counts only, from the audit log (drafts themselves are deleted after the retention period): requests, refusals,
 *  acceptances and discards by purpose, coach and day. No draft text, instructions or member detail. */
export function usage(ctx: Ctx, range: { from: string; to: string }) {
  const fromAt = `${range.from}T00:00:00.000Z`;
  const toAt = addDays(`${range.to}T00:00:00.000Z`, 1);
  type Row = { actor_id: string | null; action: string; at: string; purpose: string | null; outcome: string | null };
  const rows = ctx.db.all<Row>("SELECT actor_id, action, at, json_extract(data, '$.purpose') AS purpose, json_extract(data, '$.outcome') AS outcome FROM audit_events WHERE action IN ('ai.draft_request','ai.draft_accept','ai.draft_discard') AND at >= ? AND at < ? ORDER BY at", [fromAt, toAt]);
  const blank = () => ({ requests: 0, refused: 0, drafted: 0, accepted: 0, discarded: 0 });
  const add = (t: ReturnType<typeof blank>, r: Row) => {
    if (r.action === 'ai.draft_request') { t.requests++; if (r.outcome === 'refused') t.refused++; else t.drafted++; }
    else if (r.action === 'ai.draft_accept') t.accepted++;
    else t.discarded++;
  };
  const totals = blank();
  const byPurpose = new Map<string, ReturnType<typeof blank>>();
  const byCoach = new Map<string, ReturnType<typeof blank>>();
  const byDay = new Map<string, ReturnType<typeof blank>>();
  for (const r of rows) {
    add(totals, r);
    const p = r.purpose ?? 'unknown';
    if (!byPurpose.has(p)) byPurpose.set(p, blank());
    add(byPurpose.get(p)!, r);
    const c = r.actor_id ?? 'system';
    if (!byCoach.has(c)) byCoach.set(c, blank());
    add(byCoach.get(c)!, r);
    const d = r.at.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, blank());
    add(byDay.get(d)!, r);
  }
  const names = new Map(ctx.db.all<{ id: string; name: string }>("SELECT id, name FROM users WHERE role = 'coach'").map((u) => [u.id, u.name]));
  const status = Object.fromEntries(DRAFT_STATUSES.map((s) => [s, 0])) as Record<DraftStatus, number>;
  for (const s of ctx.db.all<{ status: DraftStatus; n: number }>('SELECT status, COUNT(*) n FROM ai_drafts GROUP BY status')) status[s.status] = s.n;
  return {
    from: range.from, to: range.to,
    readiness: systemReadiness(ctx),
    totals,
    stored: status,
    byPurpose: AI_PURPOSES.map((p) => ({ purpose: p, label: PURPOSES[p].label, ...(byPurpose.get(p) ?? blank()) })),
    byCoach: [...byCoach].map(([id, t]) => ({ coachId: id, coachName: names.get(id) ?? 'Unknown', ...t })).sort((a, b) => b.requests - a.requests),
    byDay: [...byDay].map(([date, t]) => ({ date, requests: t.requests, refused: t.refused, accepted: t.accepted })),
    note: 'Counts come from the audit log. Draft text, coaches’ instructions and client details are never shown here.',
    demo: ctx.config.isDemo,
  };
}

/* ---------- jobs and events ---------- */

/** Delete drafts older than the owner's retention period. Nothing is deleted while it is undecided (and while it is
 *  undecided no draft can be made). Runs while the module is off: retention is a privacy duty. */
export function applyRetention(ctx: Ctx): { deleted: number; retentionDays: number | null } {
  const days = retentionDays(ctx);
  if (days === null) return { deleted: 0, retentionDays: null };
  const cutoff = addDays(ctx.now(), -days);
  const deleted = ctx.db.run('DELETE FROM ai_drafts WHERE created_at < ?', [cutoff]).changes;
  if (deleted) audit(ctx, 'ai.draft_retention', { type: 'ai_draft', id: 'retention' }, `drafts older than ${days} days`, { deleted, retentionDays: days, cutoff });
  return { deleted, retentionDays: days };
}

/** A client moved to another coach: the previous coach's open drafts about them are discarded. */
export function onCoachAssigned(ctx: Ctx, payload: Record<string, unknown>): number {
  const memberId = String(payload.memberId ?? ''), coachId = String(payload.coachId ?? '');
  if (!memberId || !coachId) return 0;
  return clearDraftsFor(ctx, { memberId, exceptCoachId: coachId }, 'The client was assigned another coach', 'the client was assigned another coach');
}

/* ---------- demo rows (demo mode only) ----------
   No draft is seeded: with no provider configured there is no AI text to show, and none is made up. The first demo
   member records the ai_processing consent under the demo draft wording (its version says so), so the coach page shows
   one client who has agreed and others who have not. */
export function seedDemo(demo: DemoSeedContext): void {
  const memberId = demo.memberIds[0];
  if (!memberId || !demo.owner.config.isDemo) return;
  const u = demo.owner.db.get<{ id: string; email: string; name: string }>("SELECT id, email, name FROM users WHERE id = ? AND role = 'member'", [memberId]);
  if (!u) return;
  const mctx: Ctx = { ...demo.owner, actor: { id: u.id, role: 'member', email: u.email, name: u.name } };
  setAiConsent(mctx, u.id, true, AI_CONSENT.version);
}
