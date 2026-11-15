/* The coach workspace navigation, pointing at Bioptime's own coach routes: a top-level
   Dashboard, the COACH WORK and BUSINESS groups with collapsible sections, then Coach AI and Settings. Paths are
   workspace-relative ('/clients' is /coach/clients).

   What gates an item (all that it names must hold):
   - `moduleNav`: the item is a module's own navigation link (src/modules/<key>), shown only while useModuleNav('coach')
     lists it, i.e. while the module flag is on and its permission rules pass (the existing module nav gates);
   - `module`: the module flag must be on (for a page a module backs but that has no nav entry of its own);
   - `route`: a coach workspace page must be registered at that path in pages/coach/wz/routesA.tsx or routesB.tsx.
   Module navigation links this tree does not place are listed under "More" by the shell, so every coach page stays
   reachable whatever a module adds later. */
import type { ModuleKey } from '../../modules/types';
import type { IconName } from './icons';

/** The parts of GET /coach/home the badges read. */
export type CoachHome = {
  coach?: { displayName?: string | null; coachCode?: string | null } | null;
  clientsWithoutPlan?: unknown[]; requestedAppointments?: unknown[]; reportsToReview?: unknown[]; unreadConversations?: unknown[];
} | null;

export type CoachLeaf = {
  to: string; label: string;
  /** The small icon of a sub-item (a section's own icon is required on CoachSection). */
  icon?: IconName;
  /** Words the command palette also matches (the old name of a page, what it holds). */
  keywords?: string;
  /** Other paths that belong to this item (a record opened from it), so it shows as current there. */
  also?: string[];
  badge?: (home: CoachHome) => number | undefined;
  moduleNav?: boolean; module?: ModuleKey; route?: string;
};
export type CoachSection = Omit<CoachLeaf, 'icon'> & { id: string; icon: IconName; items?: CoachLeaf[] };
export type CoachGroup = { id: string; label?: string; sections: CoachSection[] };

const count = (list?: unknown[]) => list?.length || undefined;

export const COACH_NAV: CoachGroup[] = [
  { id: 'top', sections: [
    { id: 'dashboard', icon: 'dashboard', to: '/', label: 'Dashboard', keywords: 'today home overview' },
  ] },
  { id: 'work', label: 'Coach work', sections: [
    { id: 'clients', icon: 'clients', to: '/clients', label: 'Clients', items: [
      { to: '/clients', label: 'All clients', icon: 'clients', keywords: 'clients caseload members', also: ['/plans'], badge: (h) => count(h?.clientsWithoutPlan) },
      { to: '/messages', label: 'Messages', icon: 'messages', keywords: 'chats conversations inbox', badge: (h) => count(h?.unreadConversations) },
      { to: '/bloodwork', label: 'Reports', icon: 'report', keywords: 'bloodwork lab reports results bookings', also: ['/reports'], badge: (h) => count(h?.reportsToReview) },
    ] },
    { id: 'plans', icon: 'plans', to: '/meals', label: 'Plans & Meals', items: [
      { to: '/meals', label: 'Meal plans', icon: 'meal', keywords: 'meals nutrition diet', module: 'nutrition', route: 'meals', also: ['/meal-plans'] },
      { to: '/nutrition-library', label: 'Recipes and foods', icon: 'recipe', keywords: 'nutrition library recipes foods', moduleNav: true },
      { to: '/workouts', label: 'Workouts', icon: 'workout', keywords: 'workout plans templates programmes training plans', module: 'workouts', route: 'workouts', also: ['/workout-templates', '/workout-programs'] },
      { to: '/exercise-library', label: 'Exercise library', icon: 'library', keywords: 'exercises', moduleNav: true },
      { to: '/workouts/sessions', label: 'Sessions', icon: 'video', keywords: 'training sessions classes', module: 'sessions', route: 'workouts/sessions' },
      { to: '/checkin-templates', label: 'Check-in templates', icon: 'checklist', keywords: 'check-ins questionnaires forms', moduleNav: true },
    ] },
    { id: 'appointments', icon: 'calendar', to: '/appointments', label: 'Appointments', items: [
      { to: '/appointments', label: 'Overview', icon: 'clock', keywords: 'appointments consultations bookings requests', badge: (h) => count(h?.requestedAppointments) },
      { to: '/calendar', label: 'Calendar', icon: 'calendar', keywords: 'schedule availability' },
      { to: '/sessions', label: 'Live sessions', icon: 'video', keywords: 'live sessions webinars group', moduleNav: true },
    ] },
  ] },
  { id: 'business', label: 'Business', sections: [
    { id: 'courses', icon: 'courses', to: '/courses', label: 'Courses', keywords: 'learning courses lessons', moduleNav: true },
    { id: 'engage', icon: 'engage', to: '/announcements', label: 'Engage', items: [
      { to: '/announcements', label: 'Announcements', icon: 'engage', keywords: 'broadcast news', moduleNav: true },
      { to: '/discovery-calls', label: 'Discovery calls', icon: 'target', keywords: 'leads enquiries growth', moduleNav: true },
    ] },
    { id: 'training', icon: 'training', to: '/training', label: 'Training', keywords: 'coach training learning', moduleNav: true },
  ] },
  { id: 'more', sections: [
    { id: 'ai', icon: 'ai', to: '/ai', label: 'Coach AI', keywords: 'assistant drafts ai', moduleNav: true },
    { id: 'settings', icon: 'settings', to: '/settings', label: 'Settings', items: [
      { to: '/profile', label: 'My profile', icon: 'client', keywords: 'profile coach id account' },
      { to: '/settings', label: 'Settings', icon: 'settings', keywords: 'availability working hours preferences password' },
      { to: '/help', label: 'Help', icon: 'help', keywords: 'help support articles requests', moduleNav: true },
    ] },
  ] },
];

/** The label of the group that collects module navigation links the tree does not place. */
export const MORE_LABEL = 'More';
