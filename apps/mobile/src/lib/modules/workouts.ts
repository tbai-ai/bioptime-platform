/* M6 Workouts: the app entries of this module. The screens are src/app/workouts.tsx (this week), src/app/workout/[id].tsx
   (log a session set by set, with a rest timer) and src/app/workout-history.tsx; each sets its own title with
   <Stack.Screen options>. Shown while the 'workouts' flag is on. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'workouts', title: 'This week’s workouts', sub: 'The sessions your coach planned', route: '/workouts', icon: 'barbell-outline', placement: 'home' },
  { key: 'workouts', title: 'Workouts', sub: 'Sessions from your coach’s workout programme', route: '/workouts', icon: 'barbell-outline', placement: 'plan' },
  { key: 'workouts', title: 'Workout history', sub: 'Sessions you logged or skipped', route: '/workout-history', icon: 'time-outline', placement: 'me' },
];
