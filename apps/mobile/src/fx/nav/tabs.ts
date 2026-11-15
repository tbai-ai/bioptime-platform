/* The client app's nine tabs, in order (the earlier app's slots; BUILD_PLAN §2.7): the bar is icon-only, so each label is the
   tab's accessibility label. `plan` and `me` are hidden redirect routes (old links keep working). */
import type { IconName } from '../Icon';

export type TabName = 'index' | 'train' | 'bio' | 'life' | 'fuel' | 'coach' | 'tests' | 'store' | 'profile';
export type TabDef = { name: TabName; href: string; label: string; icon: IconName };

export const TABS: readonly TabDef[] = [
  { name: 'index', href: '/(tabs)', label: 'Home', icon: 'house' },
  { name: 'train', href: '/(tabs)/train', label: 'Train', icon: 'dumbbell' },
  { name: 'bio', href: '/(tabs)/bio', label: 'Bio', icon: 'dna' },
  { name: 'life', href: '/(tabs)/life', label: 'Life', icon: 'clock' },
  { name: 'fuel', href: '/(tabs)/fuel', label: 'Fuel', icon: 'leaf' },
  { name: 'coach', href: '/(tabs)/coach', label: 'Coach', icon: 'messages-square' },
  { name: 'tests', href: '/(tabs)/tests', label: 'Tests', icon: 'microscope' },
  { name: 'store', href: '/(tabs)/store', label: 'Store', icon: 'shopping-bag' },
  { name: 'profile', href: '/(tabs)/profile', label: 'Profile', icon: 'user' },
];

export const HIDDEN_TABS = [
  { name: 'plan', href: '/(tabs)/plan' },
  { name: 'me', href: '/(tabs)/me' },
] as const;
