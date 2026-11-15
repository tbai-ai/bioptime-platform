/* M7 Lab follow-ups and preparation reminders: the app entries of this module. The screen is src/app/lab-follow-ups.tsx
   (the next steps from released reports and the next collection's preparation); it sets its own title with
   <Stack.Screen options>. The report screen (src/app/report/[id].tsx) also shows "Next steps" and the marker trend.
   Shown while the 'labFollowups' flag is on. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'labFollowups', title: 'Next steps from your reports', sub: 'What your coach set after a review, and how to prepare for a collection', route: '/lab-follow-ups', icon: 'flask-outline', placement: 'plan' },
];
