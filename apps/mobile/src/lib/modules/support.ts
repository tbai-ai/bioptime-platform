/* M4 Support requests, help centre, data export: the app entries of this module. The screens are src/app/help.tsx (help
   articles, my requests, my data export) and src/app/support/[id].tsx (one request's thread); each sets its own title
   with <Stack.Screen options>. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'support', title: 'Help and support', sub: 'Help articles, questions to the team, your data export', route: '/help', icon: 'help-circle-outline', placement: 'me' },
];
