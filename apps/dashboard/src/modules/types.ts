/* The portal module descriptor. A module lists, for the three workspaces, the pages it adds, its navigation items, the
   tabs it adds to the client record, the cards it adds to the member Home, the coach Today page or the admin Overview,
   and the settings it reads. The portal renders each of these only while the module's flag is on for the signed-in
   person (GET /public/config → features), or, for a page or link that names `whileOff`, while that check says so, and
   they hold the permission named; an empty module renders nothing.

   Conventions for builders:
   - Load pages with React.lazy(() => import('./Page')) so a module's code arrives only when one of its pages opens.
   - Use the existing components (src/ui/index.tsx) and classes; new CSS only under new class names.
   - Links are workspace-relative ('/habits' becomes /client/habits in the member portal): src/lib/nav.tsx.
   - The server enforces everything again (def() with auth, permission and feature); hiding is a courtesy. */
import type React from 'react';

export type Workspace = 'client' | 'coach' | 'admin';
export type ModuleKey = 'habits' | 'progress' | 'billing' | 'support' | 'nutrition' | 'workouts' | 'labFollowups' | 'sessions' | 'messaging' | 'learning' | 'ai' | 'labstackOps' | 'growth' | 'referrals';

/** Every item may name a sub-flag (`feature`) that must be on as well as the module's own flag. */
type Gated = {
  feature?: string; permission?: string | string[]; any?: boolean;
  /** Shown while the module's flag (or sub-flag) is off when this resolves true, for example a member's granted consent
   *  on record so it can be withdrawn. Read for pages and navigation links (runtime.tsx, rules in ./whileOff.ts), asked
   *  once per signed-in person and minute; LabStack and permission rules still apply, and a client-record tab or a home
   *  card never shows while its flag is off. The server still enforces everything. */
  whileOff?: () => Promise<boolean>;
};

/** A page. `path` is relative to the workspace ('habits', 'habits/:id'). */
export type ModuleRoute = Gated & { workspace: Workspace; path: string; element: React.ReactNode };

/** A side-navigation link. `to` is workspace-relative ('/habits'). Without a group it joins the main list (before the
 *  core item named by `before`, or at the end); with a group it goes under that small heading after the main list. */
export type ModuleNavItem = Gated & { workspace: Workspace; to: string; label: string; group?: string; before?: string; badge?: (home: unknown) => number | undefined };

/** What a client-record tab receives. `healthShared` is false while the member does not share health data with the
 *  coach: health detail must not be requested then (the server refuses it with NOT_SHARED). */
export type ClientRecordTabContext = { memberId: string; detail: unknown; isPrivileged: boolean; healthShared: boolean; reload: () => void };
/** A tab on the client record (/coach/clients/:id, /admin/clients/:id). `id` appears in the URL (?tab=id). */
export type ModuleClientTab = Gated & { id: string; label: string; workspaces?: Array<'coach' | 'admin'>; count?: (detail: unknown) => number | undefined; render: (ctx: ClientRecordTabContext) => React.ReactNode };

/** A card on a home page, placed in that page's grid (span of 12 columns, default 6). */
export type ModuleCard = Gated & { id: string; placement: 'clientHome' | 'coachToday' | 'adminOverview'; span?: 3 | 4 | 6 | 8 | 12; render: () => React.ReactNode };

/** A setting the module reads (one of GET /admin/module-settings); label and hint replace the server's wording on /admin/modules. */
export type ModuleSettingDecl = { key: string; label?: string; hint?: string };

export type PortalModule = {
  key: ModuleKey;
  /** The module's flag (its key unless it says otherwise). */
  feature?: string;
  title: string;
  routes?: ModuleRoute[];
  nav?: ModuleNavItem[];
  clientTabs?: ModuleClientTab[];
  cards?: ModuleCard[];
  settings?: ModuleSettingDecl[];
};
