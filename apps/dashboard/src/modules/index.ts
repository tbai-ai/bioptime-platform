/* The portal module registry: one entry per module, each an empty stub until its builder fills in
   src/modules/<key>/index.ts. App.tsx (routes), shell/Shell.tsx (navigation), pages/ClientDetail.tsx (client-record
   tabs), pages/client/ClientHome.tsx and pages/Home.tsx (cards) and pages/admin/Modules.tsx (flags and settings) read
   it through src/modules/runtime.tsx. Reserved migrations: see apps/api/src/modules/index.ts. */
import type { PortalModule } from './types';
import { habits } from './habits';
import { progress } from './progress';
import { billing } from './billing';
import { support } from './support';
import { nutrition } from './nutrition';
import { workouts } from './workouts';
import { labFollowups } from './labFollowups';
import { sessions } from './sessions';
import { messaging } from './messaging';
import { learning } from './learning';
import { ai } from './ai';
import { labstackOps } from './labstackOps';
import { growth } from './growth';
import { referrals } from './referrals';

export const PORTAL_MODULES: PortalModule[] = [habits, progress, billing, support, nutrition, workouts, labFollowups, sessions, messaging, learning, ai, labstackOps, growth, referrals];
