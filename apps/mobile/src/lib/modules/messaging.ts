/* M9 Message attachments and announcements: the app entries of this module. The screen is src/app/announcements.tsx
   (news from the Bioptime team and the member's own coach); it sets its own title with <Stack.Screen options>. Files on
   messages are shown in src/app/messages.tsx while the 'messaging' flag is on. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'messaging', title: 'Announcements', sub: 'News from the Bioptime team and your coach', route: '/announcements', icon: 'megaphone-outline', placement: 'home' },
];
