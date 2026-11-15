/* M4 Help centre: the constants the support route file reads while it loads. This file imports nothing, on purpose.

   api/domain/help.ts imports the module registry (through api/domain/features.ts), the registry imports
   api/modules/support.ts, and that imports api/http/routes/support.ts, which builds its request schemas from
   HELP_AUDIENCES and SLUG_RE at the top of the file. When api/domain/help.ts was the first file a process loaded, the
   route file read them before api/domain/help.ts had set them ("Cannot access 'HELP_AUDIENCES' before
   initialization"). api/domain/help.ts re-exports both from here as its first import, so the namespace import the route
   file uses resolves to this file, which is always evaluated first. tests/integration/round7-privacy.test.ts loads
   api/domain/help.ts first in a fresh process to keep it so. */

export const HELP_AUDIENCES = ['member', 'coach', 'all'] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
