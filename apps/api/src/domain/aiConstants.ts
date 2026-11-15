/* M11 Coach AI: the constants its route file reads while it loads. This file imports nothing, on purpose.

   api/domain/ai.ts imports the module registry (directly, and through api/domain/features.ts), the registry imports
   the ai module, and the module imports api/http/routes/ai.ts. When api/domain/ai.ts is the first module a process
   imports, the route file therefore loads before api/domain/ai.ts has run, and reading one of its constants at the top
   of the route file failed with "Cannot access 'MODULE_FLAG' before initialization". The route file reads these from
   here instead (and the purposes from api/adapters/ai.ts); api/domain/ai.ts re-exports them, so its importers are
   unchanged. tests/integration/round7-privacy.test.ts imports api/domain/ai.ts first in a fresh process to keep it so. */

export const MODULE_FLAG = 'ai';
/** The longest instructions a coach may give with a draft request. */
export const INSTRUCTIONS_MAX = 2000;
/** The longest final text a coach may accept a draft with. */
export const FINAL_TEXT_MAX = 10000;
export const DRAFT_STATUSES = ['requested', 'ready', 'failed', 'accepted', 'discarded'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
