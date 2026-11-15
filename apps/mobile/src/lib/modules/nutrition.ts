/* M5 Nutrition: the app entries of this module. The screens are new files under src/app/ (nutrition.tsx and
   meal-log.tsx); each sets its own title with <Stack.Screen options>. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'nutrition', title: 'Nutrition', sub: 'Your meal plan, today’s meals and your coach’s feedback', route: '/nutrition', icon: 'nutrition-outline', placement: 'plan' },
];
