/* M11 Coach AI: the provider seam.

   AiProvider.draft({purpose, context, instructions}) turns a permission-checked context (api/domain/ai.ts builds it
   from the coach's own views) into draft text for the coach to edit. Nothing a provider returns is ever sent to a
   member: the coach reads, edits and accepts a draft, then sends it through the existing routes.

   AiProvider.answer({promptVersion, guidance, messages}) is the member assistant's seam (api/domain/assistant.ts, behind
   an off switch): it receives only the member's own conversation with the assistant and the rules it follows. It is
   optional, so a provider that does not answer members is simply not offered to them.

   AI_PROVIDER accepts only "none" today, so the only implementation is NoneAiProvider: it is not configured and refuses
   every request (drafts and answers) with AI_NOT_CONFIGURED, naming what is missing. No answer is ever made up.

   When a provider is chosen, its adapter goes here (a new AI_PROVIDER value in api/config.ts, the API key read from the
   server environment and never echoed, the model name), and `requirements` stops listing what it satisfies. */
import type { Config } from '../config.js';
import type { Ctx } from '../context.js';
import type { Db } from '../db/db.js';
import { AppError } from '../lib/errors.js';

export const AI_PURPOSES = ['message_reply', 'plan_outline', 'checkin_response', 'meal_plan_outline', 'workout_outline'] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

/** What a provider receives: the purpose, the prompt version, the context built from the coach's own views (never a
 *  restricted key; health detail only with both consents; only the fields api/domain/ai.ts CONTEXT_SHAPE lists, which
 *  the consent wording names) and the coach's own instructions. */
export type AiDraftRequest = {
  purpose: AiPurpose;
  promptVersion: string;
  /** The rules every draft follows (api/domain/ai.ts DRAFT_GUIDANCE): a draft for a coach to edit, no medical advice. */
  guidance: string[];
  context: Record<string, unknown>;
  instructions: string | null;
};
export type AiDraftResult = { text: string; model: string };

/** What a provider receives for the member assistant: the prompt version, the rules it is asked to follow
 *  (api/domain/assistant.ts ASSISTANT_GUIDANCE) and the member's own conversation with the assistant, oldest first,
 *  ending with the new message. Nothing else about the member is sent; the consent wording says so. */
export type AssistantRequest = {
  promptVersion: string;
  guidance: string[];
  messages: Array<{ role: 'member' | 'assistant'; text: string }>;
};
export type AssistantResult = { text: string; model: string };

export interface AiProvider {
  /** The AI_PROVIDER value. */
  readonly name: string;
  /** The model in use, or null while none is configured. */
  readonly model: string | null;
  /** Whether the provider can take a request at all (credentials present, model chosen). */
  readonly configured: boolean;
  draft(request: AiDraftRequest): Promise<AiDraftResult>;
  /** Answers a member through the assistant; a provider without it is not offered to members. */
  answer?(request: AssistantRequest): Promise<AssistantResult>;
}

/** One missing requirement, named exactly (shown to coaches and administrators; never a value). */
export type AiRequirement = { key: 'provider' | 'api_key' | 'dpa' | 'consent_wording' | 'retention' | 'member_audience' | 'member_consent' | 'assistant_switch'; label: string };

export const NOT_CONFIGURED_MESSAGE = 'Coach AI is not configured';

/** The provider-level requirements still missing for this configuration (the domain adds the retention decision and the
 *  member's consent). */
export function providerRequirements(config: Config): AiRequirement[] {
  if (config.AI_PROVIDER === 'none') {
    return [
      { key: 'provider', label: 'An AI provider and model, chosen by the owner: AI_PROVIDER accepts only "none"' },
      { key: 'api_key', label: 'The provider’s API key, set in the server environment (never in code, settings or a response)' },
      { key: 'dpa', label: 'A signed data-processing agreement with the provider, and the sub-processor listing' },
    ];
  }
  return [];
}

export function notConfigured(missing: AiRequirement[]): AppError {
  const list = missing.map((m) => m.label.charAt(0).toLowerCase() + m.label.slice(1)).join('; ');
  return new AppError('AI_NOT_CONFIGURED', 409, `${NOT_CONFIGURED_MESSAGE}. Missing: ${list}.`, { missing });
}

/** AI_PROVIDER=none: no provider. Every request is refused; nothing is generated. */
export class NoneAiProvider implements AiProvider {
  readonly name = 'none';
  readonly model = null;
  readonly configured = false;
  constructor(private readonly config: Config) {}
  async draft(): Promise<AiDraftResult> {
    throw notConfigured(providerRequirements(this.config));
  }
  async answer(): Promise<AssistantResult> {
    throw notConfigured(providerRequirements(this.config));
  }
}

export function createAiProvider(config: Config): AiProvider {
  switch (config.AI_PROVIDER) {
    case 'none': return new NoneAiProvider(config);
  }
  return new NoneAiProvider(config);
}

/* ---------- a seam for the integration tests ----------
   The tests check what a provider would receive (no restricted key, no health detail without both consents, no other
   member's data) with a recording provider registered against their own in-memory database. Production refuses it,
   and no route or setting reaches it. */
const overrides = new WeakMap<Db, AiProvider>();

export function overrideAiProviderForTests(ctx: Ctx, provider: AiProvider | null): void {
  if (ctx.config.isProduction) throw new Error('overrideAiProviderForTests is for tests only');
  if (provider) overrides.set(ctx.db, provider); else overrides.delete(ctx.db);
}

/** The provider for this request: the configured one (a test may register its own against its database). */
export function aiProviderFor(ctx: Ctx): AiProvider {
  return (!ctx.config.isProduction && overrides.get(ctx.db)) || createAiProvider(ctx.config);
}
