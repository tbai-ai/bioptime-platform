/* Growth constants read while the module registry loads (api/modules/growth.ts builds its descriptor as the registry
   evaluates). This file imports nothing, so the growth domain and route files can each be the first module a process
   loads without meeting a half-initialised binding (see round8-labels.test.ts, 'every domain, route and http file
   imports cleanly as the first module of a fresh process'). */

/** The routes reachable while the module is off: a person can always leave the newsletter. */
export const GROWTH_UNGATED: string[] = ['POST /public/newsletter/unsubscribe'];
