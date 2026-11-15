/* M11 Coach AI drafting: the app entries of this module. Coaches use Coach AI in the coach workspace of the portal;
   the member app never shows a draft. The one screen here, src/app/coach-ai.tsx (title set with <Stack.Screen options>),
   is the member's own ai_processing consent: what it covers, giving it (demo draft wording, pending counsel) and
   withdrawing it. Shown on the Me tab while the 'ai' flag is on.

   Withdrawing must stay reachable while the flag is off (or the member is outside its audience) for a member with a
   granted consent on record. The screen's route is always mounted (expo-router file route) and the API leaves
   /me/ai/consent ungated; the registry shows an entry only while its flag is on, so the entry carries
   `whileOff: aiConsentOnRecord`: it also shows while the flag is off whenever that resolves true (lib/modules.ts, asked
   once per member and minute). Me › Privacy and sharing links to the screen too while a consent is on record. */
import { get } from '../api';
import type { ModuleEntry } from '../modules';

/** Whether the signed-in member has a granted Coach AI consent on record (under any wording). GET /me/ai/consent works
 *  while the module is off; any failure counts as no. */
export function aiConsentOnRecord(): Promise<boolean> {
  return get<{ granted?: boolean }>('/me/ai/consent').then((s) => !!s?.granted, () => false);
}

export const entries: ModuleEntry[] = [
  { key: 'ai', title: 'Coach AI and your data', sub: 'Whether your coach may use Coach AI for drafts about you', route: '/coach-ai', icon: 'shield-checkmark-outline', placement: 'me', whileOff: aiConsentOnRecord },
];
