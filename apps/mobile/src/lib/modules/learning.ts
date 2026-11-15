/* M10 Learning: the app entries of this module. The screens are src/app/learn/index.tsx (my courses and the ones I may
   start; with ?course=<id> one course's lessons) and src/app/learn/[lessonId].tsx (read a lesson, mark it complete);
   each sets its own title with <Stack.Screen options>. Shown while the 'learning' flag is on. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'learning', title: 'Learn', sub: 'Your courses and progress', route: '/learn', icon: 'school-outline', placement: 'home' },
  { key: 'learning', title: 'Learn', sub: 'Courses from the Bioptime team and your coach', route: '/learn', icon: 'school-outline', placement: 'plan' },
];
