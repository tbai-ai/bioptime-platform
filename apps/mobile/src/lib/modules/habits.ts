/* M1 Habits and reminders: the app entries of this module. The screen is src/app/habits.tsx (today's habits, check in,
   reminder times); it sets its own title with <Stack.Screen options>. Shown while the 'habits' flag is on. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'habits', title: 'Today’s habits', sub: 'Check in, see this week, set reminder times', route: '/habits', icon: 'checkmark-circle-outline', placement: 'home' },
  { key: 'habits', title: 'Habits', sub: 'The habits from your plan and your own', route: '/habits', icon: 'checkmark-circle-outline', placement: 'plan' },
];
