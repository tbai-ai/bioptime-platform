/* M1 Habits and reminders in the portal (flag 'habits'):
   - client: the Habits page (/client/habits, in the main navigation before Progress) and a "Today's habits" card on Home;
   - coach: a Habits tab on the client record; slipping habits reach the Today page as follow-ups (server side);
   - admin: the same tab, read only, behind members.manage; the follow-up threshold on /admin/modules (settings.manage).
   Pages load lazily so the module's code arrives only when one of them opens. */
import React from 'react';
import { Skeleton } from '../../ui';
import type { ClientRecordTabContext, PortalModule } from '../types';

const ClientHabits = React.lazy(() => import('./ClientHabits').then((m) => ({ default: m.ClientHabits })));
const HabitsHomeCard = React.lazy(() => import('./HabitsHomeCard').then((m) => ({ default: m.HabitsHomeCard })));
const HabitsTab = React.lazy(() => import('./HabitsTab').then((m) => ({ default: m.HabitsTab })));

const wait = (rows: number, child: React.ReactNode) => React.createElement(React.Suspense, { fallback: React.createElement(Skeleton, { rows }) }, child);
const tab = (ctx: ClientRecordTabContext) => wait(6, React.createElement(HabitsTab, { ctx }));

export const habits: PortalModule = {
  key: 'habits',
  title: 'Habits',
  routes: [{ workspace: 'client', path: 'habits', element: wait(6, React.createElement(ClientHabits)) }],
  nav: [{ workspace: 'client', to: '/habits', label: 'Habits', before: '/progress' }],
  clientTabs: [
    { id: 'habits', label: 'Habits', workspaces: ['coach'], render: tab },
    { id: 'habits', label: 'Habits', workspaces: ['admin'], permission: 'members.manage', render: tab },
  ],
  cards: [{ id: 'habits-today', placement: 'clientHome', span: 6, render: () => wait(3, React.createElement(HabitsHomeCard)) }],
  settings: [{ key: 'habit_followup_missed_days', label: 'Coach follow-up after missed habit days', hint: 'Due days without any check-in before the assigned coach gets one follow-up for that habit. A habit the member added themselves gets one only while they share health information with their coach. Empty: no follow-ups. An owner decision; nothing is assumed.' }],
};
