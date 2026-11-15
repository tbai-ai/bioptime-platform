/* Referrals: the app entries of this module. The screen is src/app/refer.tsx (the member's personal link, the share
   sheet, who joined with it by first name); it sets its own title with <Stack.Screen options>. Shown under Me while the
   'referrals' flag is on. Rewards are an owner decision: the screen promises none. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'referrals', title: 'Refer a friend', sub: 'Your personal link, and who joined with it', route: '/refer', icon: 'share-social-outline', placement: 'me' },
];
