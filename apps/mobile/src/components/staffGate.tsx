/* The client app (the default build, STAFF_APP off in lib/config): no staff screen renders. The root stack and the
   sign-in stack hand their screens to these layouts (the navigators' screenLayout), which put a redirect in place of
   a staff screen before it draws or asks the server for anything:
   - the staff sign-ins (the chooser, the coach and administrator sign-ins) lead to the client sign-in;
   - the coach and administrator workspaces (the (coach) and (admin) tab groups, and every screen under
     src/app/coach/… and src/app/admin/…) lead a signed-in client back to the tabs, and anyone else to the client sign-in.
   The stack draws no header for a gated route either (clientAppRootOptions), so not even its title shows. The staff
   screens stay in the code; a staff build (EXPO_PUBLIC_STAFF_APP=1) passes no layout and its own options unchanged, so
   it behaves as before. */
import { Redirect } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { CLIENT_SIGN_IN, homeFor, useAuth } from '@/lib/auth';
import { STAFF_APP } from '@/lib/config';

type ScreenLayoutArgs = { route: { name: string }; children: React.ReactElement };

/** Whether the staff screens' route files are in this bundle. The client app's phone release bundles leave them out
 *  (metro.config.js: the coach and admin folders, the (coach) and (admin) groups and the staff sign-ins), so the root and
 *  sign-in stacks declare those screens only where they are bundled: a staff build, the web (it keeps every file) and a
 *  development server (it bundles the folder as it is). A screen declared with no route behind it is logged by the
 *  router as a missing route; one bundled but not declared takes the stack's default options and the gate below. */
export const STAFF_ROUTES_BUNDLED = STAFF_APP || Platform.OS === 'web' || __DEV__;

const STAFF_SIGN_INS = ['choose', 'coach-sign-in', 'admin-sign-in'];

/** A route of the root stack that belongs to the coach workspace or the administrative portal. 'coach-ai' (a client
 *  screen) is not one: only the groups and the folders coach/ and admin/ are. */
export function isStaffRootRoute(name: string): boolean {
  return name === '(coach)' || name === '(admin)' || /^(coach|admin)(\/|$)/.test(name);
}

/** A route of the (auth) stack that signs in a coach or an administrator, or chooses between the three sign-ins. */
export function isStaffSignInRoute(name: string): boolean { return STAFF_SIGN_INS.includes(name); }

function ToClientApp({ workspace }: { workspace: boolean }) {
  const { ready, user } = useAuth();
  if (!ready) return null; // nothing, not the staff screen, until the session on this device is known
  return <Redirect href={workspace && user?.role === 'member' ? homeFor('member') : CLIENT_SIGN_IN} />;
}

function rootScreenLayout({ route, children }: ScreenLayoutArgs): React.ReactElement {
  return isStaffRootRoute(route.name) ? <ToClientApp workspace /> : children;
}

function authScreenLayout({ route, children }: ScreenLayoutArgs): React.ReactElement {
  return isStaffSignInRoute(route.name) ? <ToClientApp workspace={false} /> : children;
}

/** The root stack's screenLayout: the gate in the client app, none in a staff build. */
export const clientAppRootLayout = STAFF_APP ? undefined : rootScreenLayout;
/** The root stack's screenOptions: as given in a staff build; in the client app a gated route also has no header (the
 *  stack would otherwise draw its title, the route name, for the moment before the redirect). */
export function clientAppRootOptions<T extends object>(options: T): T | ((args: { route: { name: string } }) => T) {
  if (STAFF_APP) return options;
  return ({ route }) => (isStaffRootRoute(route.name) ? { ...options, headerShown: false, title: '' } : options);
}
/** The (auth) stack's screenLayout: the gate in the client app, none in a staff build. */
export const clientAppAuthLayout = STAFF_APP ? undefined : authScreenLayout;
