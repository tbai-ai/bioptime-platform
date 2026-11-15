/* The module tabs of the coach's client record (the web's ClientDetail tab strip: apps/dashboard/src/modules/<key>/index.ts
   `tabs` with workspace 'coach'). The record screen (src/app/coach/clients/[id].tsx) shows the core tabs and then these,
   each only while its module flag is on (lib/features) and, when the entry names one, its `feature` sub-flag. The
   module builders fill MODULE_RECORD_TABS; the record screen never knows which modules exist. Health detail follows the
   client's coach sharing: a tab that needs it renders the web's "not shared" wording when `sharing` is false. */
import React from 'react';
import type { ModuleKey } from '@/lib/modules';
import { HabitsTab } from './modules/habits';
import { GoalsTab } from './modules/progress';
import { NutritionTab } from './modules/nutrition';
import { WorkoutsTab } from './modules/workouts';
import { LabFollowupsTab } from './modules/labFollowups';
import { SessionsTab } from './modules/sessions';
import { LearningTab } from './modules/learning';
import { CoachAiTab } from './modules/ai';

export type RecordTabContext = {
  /** The client's user id (GET /coach/clients/:id). */
  memberId: string;
  /** The record payload the screen already loaded (GET /coach/clients/:id), for tabs that read from it. */
  record: unknown;
  /** The client shares health records with this coach (coach_sharing on the record). */
  sharing: boolean;
  /** Ask the record screen to reload its payload (after a tab changes something it shows). */
  reload: () => void;
};

export type RecordTab = {
  /** Stable id, the web's tab id ('habits', 'goals', 'nutrition', 'workouts', 'lab-follow-ups', 'sessions', 'learning', 'ai'). */
  id: string;
  label: string;
  module: ModuleKey;
  feature?: string;
  render: (ctx: RecordTabContext) => React.ReactElement;
};

/** Filled by the module builders (src/lib/coach/modules/*), in the web's order (apps/dashboard/src/modules/index.ts):
 *  habits → progress → nutrition → workouts → labFollowups → sessions → learning → ai. */
export const MODULE_RECORD_TABS: RecordTab[] = [
  { id: 'habits', label: 'Habits', module: 'habits', render: (ctx) => <HabitsTab ctx={ctx} /> },
  { id: 'goals', label: 'Goals and check-ins', module: 'progress', render: (ctx) => <GoalsTab ctx={ctx} /> },
  { id: 'nutrition', label: 'Nutrition', module: 'nutrition', render: (ctx) => <NutritionTab ctx={ctx} /> },
  { id: 'workouts', label: 'Workouts', module: 'workouts', render: (ctx) => <WorkoutsTab ctx={ctx} /> },
  { id: 'lab-follow-ups', label: 'Lab next steps', module: 'labFollowups', render: (ctx) => <LabFollowupsTab ctx={ctx} /> },
  { id: 'sessions', label: 'Sessions', module: 'sessions', render: (ctx) => <SessionsTab ctx={ctx} /> },
  { id: 'learning', label: 'Learning', module: 'learning', render: (ctx) => <LearningTab ctx={ctx} /> },
  { id: 'ai', label: 'Coach AI', module: 'ai', render: (ctx) => <CoachAiTab ctx={ctx} /> },
];
