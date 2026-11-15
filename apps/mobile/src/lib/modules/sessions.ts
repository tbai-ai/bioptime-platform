/* M8 Live sessions, webinars and consultation follow-through: the app entries of this module. The screens are
   src/app/sessions.tsx (sessions open to the member, their places and the ones they joined) and src/app/session/[id].tsx
   (one session: register, the waitlist, how to join); each sets its own title with <Stack.Screen options>. Join details
   for consultations are on src/app/book-appointment.tsx. Shown while the 'sessions' flag is on. */
import type { ModuleEntry } from '../modules';

export const entries: ModuleEntry[] = [
  { key: 'sessions', title: 'Live sessions', sub: 'Group classes, webinars and workshops you can join', route: '/sessions', icon: 'people-outline', placement: 'home' },
  { key: 'sessions', title: 'Live sessions', sub: 'Your places and the sessions open to you', route: '/sessions', icon: 'people-outline', placement: 'plan' },
];

/** "Registered", "Waitlist #2", "Full", "4 places left". */
export function placeLabel(s: any): { text: string; tone: 'info' | 'success' | 'warning' | 'error' | 'sample' } {
  const r = s.myRegistration;
  if (s.status === 'cancelled') return { text: 'Cancelled', tone: 'error' };
  if (r?.status === 'registered') return { text: 'Registered', tone: 'success' };
  if (r?.status === 'waitlisted') return { text: r.waitlistPosition ? `Waitlist #${r.waitlistPosition}` : 'Waitlist', tone: 'warning' };
  if (r?.status === 'attended') return { text: 'Attended', tone: 'success' };
  if (r?.status === 'no_show') return { text: 'No-show', tone: 'error' };
  if (s.capacity === null) return { text: 'Open', tone: 'info' };
  return s.full ? { text: 'Full', tone: 'warning' } : { text: `${s.spotsLeft} left`, tone: 'info' };
}

