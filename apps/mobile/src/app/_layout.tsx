import '@/fx/workletCycles'; // first: the worklets cycle break, before any screen serializes a worklet (fix-MEM)
import { DarkTheme, Stack, ThemeProvider, router as nav, useRootNavigationState, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { forgetToken } from '@/lib/api';
import { AuthProvider, homeFor, signInFor, useAuth, WORKSPACE_OF_ROLE } from '@/lib/auth';
import { clearCache } from '@/lib/cache';
import { STAFF_APP } from '@/lib/config';
import { clientAppRootLayout, clientAppRootOptions, isStaffRootRoute, STAFF_ROUTES_BUNDLED } from '@/components/staffGate';
import { colors, fx } from '@/theme';
import { Button } from '@/fx/Button';
import { loadDeviceSettings } from '@/fx/device/settings';
import { FlowEnter } from '@/fx/FxScreen';
import { Icon } from '@/fx/Icon';
import { MarkLayer } from '@/fx/brand/MarkLayer';
import { ConfirmHost } from '@/fx/ConfirmHost';
import { SplashHost } from '@/fx/brand/SplashHost';
import { ShimmerProvider } from '@/fx/motion/Skeleton';
import { TiltProvider } from '@/fx/motion/Tilt';
import { wakeOnTouch } from '@/fx/motion/budget';
import { PageSkeleton, whenTabPageDrawn } from '@/fx/nav/Pager';
import { RootRouter } from '@/fx/nav/rootRouter';
import { motionValues } from '@/fx/motion/tokens';
import { KeyboardFit, SheetBackdrop, SheetHost } from '@/fx/Sheet';
import { overlayHeader, renderStackHeader } from '@/fx/StackHeader';
import { T } from '@/fx/Text';
import { ToastHost } from '@/fx/Toast';
import { FONT_FILES } from '@/fx/type';
import { useMotion } from '@/fx/motion/tier';
import { ReduceMotion, ReducedMotionConfig } from 'react-native-reanimated';

SplashScreen.preventAutoHideAsync();
void loadDeviceSettings();
// The client app's canvas is black from the first frame (the native splash is black too); the staff build keeps its own.
if (!STAFF_APP) void SystemUI.setBackgroundColorAsync(fx.bg.deep).catch(() => undefined);

/** The web's focus rule for the client app, once at start-up: a control focused by a pointer shows no outline (no blue
 *  ring after a click or after a sheet closes); one reached from the keyboard shows the Bioptime ring (red/60, 2 pt,
 *  2 pt off its edge, following its own corners). The colour comes from the theme at run time. */
function injectFocusRule(): void {
  if (STAFF_APP || Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById('bp-focus-rule')) return;
  const roles = ['button', 'tab', 'link'];
  const off = roles.map((r) => `[role=${r}]:focus:not(:focus-visible)`).join(', ');
  const on = roles.map((r) => `[role=${r}]:focus-visible`).join(', ');
  const el = document.createElement('style');
  el.id = 'bp-focus-rule';
  el.textContent = `${off} { outline: none; }\n${on} { outline: 2px solid ${fx.tone.focus}; outline-offset: 2px; }`;
  document.head.appendChild(el);
}
injectFocusRule();

/** The client app's navigator theme (dark; never React Navigation's light default, whose #F2F2F2 sat behind every
 *  scene). Its background is the canvas the stack container paints under the screens: black on the web; on Android and
 *  iOS nothing, because the window beneath is already black (app.json backgroundColor, SystemUI above) and every client
 *  screen paints its own ground, so a second full-screen fill there only cost GPU time (the overdraw of every tab). */
const CLIENT_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Platform.OS === 'web' ? fx.bg.deep : fx.premium.transparent,
    card: fx.bg.base, text: fx.ink.white, border: fx.line.a10, primary: fx.red.brand, notification: fx.red.brand,
  },
};

/** Who a route is for. Public: the sign-in chooser and the three sign-ins, registration, email confirmation, password
 *  reset and phone screens, the testers' server address and the not-found screen; the entry route (index) redirects
 *  on its own. Shared: screens every role may open. Coach and admin: their tab groups and the plain screens under
 *  src/app/coach/… and src/app/admin/…. Everything else is a member screen. */
type Audience = 'public' | 'shared' | 'member' | 'coach' | 'admin';
function routeAudience(segments: string[]): Audience {
  const [first, second] = segments;
  if (!first) return 'public';
  if (first === '(auth)' || first === '+not-found' || first === '_sitemap') return 'public';
  if (first === 'settings' && second === 'server') return 'public';
  if (first === '(coach)' || first === 'coach') return 'coach';
  if (first === '(admin)' || first === 'admin') return 'admin';
  if (first === 'notifications' || (first === 'settings' && second === 'security')) return 'shared';
  return 'member';
}

/** Every other screen needs a signed-in person of the right role. Signed out (the session ended: expired, revoked, or
 *  this device was signed out from another one; or a deep link opened while signed out): go to the sign-in chosen last
 *  time on this device, else to the chooser, instead of leaving the screen on an error it cannot recover from. When the
 *  session ended, the sign-in screen says so (useAuth().sessionEnded); after a sign-out the person chose, the screen
 *  that asked for it picks the next one (useAuth().chosenSignOut). Signed in as another role: a member screen or a
 *  plain coach/admin screen sends them to their own workspace; the (coach) and (admin) groups show the refusal
 *  themselves (components/workspaceShell RoleGate), as the web does.
 *  The client app (STAFF_APP off): signed out always means the client sign-in (signInFor), and the coach and admin
 *  screens never draw: the stack's screenLayout (components/staffGate) replaces them with a redirect, so this guard
 *  leaves those routes to it. */
function useRouteGuard() {
  const { ready, user, lastWorkspace, chosenSignOut } = useAuth();
  const segments = useSegments() as string[];
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;
  const audience = routeAudience(segments);
  const first = segments[0];
  useEffect(() => {
    if (!ready || !navReady) return;
    if (!STAFF_APP && (audience === 'coach' || audience === 'admin')) return; // components/staffGate redirects these
    if (!user) { if (audience !== 'public' && !chosenSignOut) router.replace(signInFor(lastWorkspace)); return; }
    if (audience === 'public' || audience === 'shared' || audience === WORKSPACE_OF_ROLE[user.role]) return;
    if (audience === 'member' || first === 'coach' || first === 'admin') router.replace(homeFor(user.role));
  }, [ready, navReady, user, audience, first, lastWorkspace, chosenSignOut, router]);
}

/** The stack's look, as before, for the staff screens; in the client app a coach or admin route also gets no header
 *  (components/staffGate). */
const LEGACY = { headerStyle: { backgroundColor: colors.canvas }, headerTintColor: colors.text, headerTitleStyle: { fontWeight: '700' as const }, headerShadowVisible: false, contentStyle: { backgroundColor: colors.canvas } };
const LEGACY_OPTIONS = clientAppRootOptions(LEGACY);
const legacyFor = (name: string) => (typeof LEGACY_OPTIONS === 'function' ? LEGACY_OPTIONS({ route: { name } }) : LEGACY_OPTIONS);

/** Routes presented as bottom sheets (the sheet chrome is drawn by the route, src/fx/Sheet SheetScreen). */
const SHEET_ROUTES = ['progress-entry', 'meal-log', 'book-appointment', 'move-appointment/[id]'];
/** The tab each sheet route belongs to: opened first in history (a link), the tab is put underneath it first. */
const SHEET_OWNER: Record<string, string> = { 'meal-log': '/(tabs)/fuel', 'book-appointment': '/(tabs)/coach', 'move-appointment/[id]': '/(tabs)/coach', 'progress-entry': '/(tabs)/bio' };
/** Routes whose screen is the kit's Overlay (src/fx/Overlay), with the button its header carries: they enter and
 *  leave with the overlay's stage; on the web the screen beneath stays drawn. */
const OVERLAY_ROUTES: Record<string, 'close' | 'back'> = {
  announcements: 'back', bespoke: 'close', billing: 'back', 'booking/[id]': 'close', 'checkin/[id]': 'back', 'coach-ai': 'close',
  goals: 'back', habits: 'close', help: 'back', 'learn/index': 'close', 'learn/[lessonId]': 'close', notifications: 'back',
  packages: 'close', photos: 'back', recommendations: 'close', refer: 'close', 'report/[id]': 'close', 'session/[id]': 'close',
  'settings/consents': 'back', 'settings/credits': 'back', 'settings/data': 'back', 'settings/profile': 'back',
  'settings/security': 'back', 'support/[id]': 'back',
};
/** Routes the motion kit's PhotoMorph opens into: the screen draws its own backdrop and entrance (FX MorphStage). */
const MORPH_ROUTES = ['workout/[id]', 'exercise/[id]'];
/** Old routes that only redirect to their new home (BUILD §7.1): no header and no transition before the redirect. */
const REDIRECT_ROUTES = ['workouts', 'workout-history', 'sessions', 'progress', 'lab-follow-ups', 'nutrition', 'messages'];
/** Android draws edge to edge, so the keyboard no longer resizes the window: every client screen gets the keyboard's
 *  room back (src/fx/Sheet KeyboardFit), the tab pages in one step; not the sheet routes (their panel follows the
 *  keyboard itself), the photo overlays or the entry and redirect routes (no field). */
const NO_KEYBOARD_FIT = new Set(['index', ...SHEET_ROUTES, ...MORPH_ROUTES, ...REDIRECT_ROUTES]);
const clientScreenLayout = clientAppRootLayout
  ? (args: { route: { name: string }; children: React.ReactElement }): React.ReactElement => {
    const screen = clientAppRootLayout!(args);
    if (Platform.OS !== 'android' || NO_KEYBOARD_FIT.has(args.route.name) || isStaffRootRoute(args.route.name)) return screen;
    return <KeyboardFit snap={args.route.name === '(tabs)'}>{screen}</KeyboardFit>;
  }
  : undefined;
/** Shared with staff roles: a coach or an administrator gets today's native header and the legacy body. */
const SHARED_ROUTES = ['notifications', 'settings/security'];
/** Screens that keep their legacy body in the staff build. */
const STAFF_LEGACY_ROUTES = ['+not-found', 'settings/server'];

/** Options by route: the staff screens keep theirs; the client screens are on black and move as the earlier app moved
 *  (flows fade, overlays fade up from the bottom, sheets are transparent). An overlay gets the earlier app's header
 *  (src/fx/StackHeader: no bar of its own, the round glass back button, the title in Bebas) unless it draws its own
 *  chrome: the kit's Overlay, FlowScreen and SheetScreen, and any screen calling useOwnChrome(), hide it. */
function optionsFor(name: string, role: string | null): object {
  if (isStaffRootRoute(name)) return legacyFor(name);
  if (SHARED_ROUTES.includes(name) && role && role !== 'member') return legacyFor(name);
  if (STAFF_APP && STAFF_LEGACY_ROUTES.includes(name)) return legacyFor(name);
  const base = { headerShown: false, contentStyle: { backgroundColor: fx.bg.deep } };
  // Android: the tabs are the bottom of the stack, over the black window, and each tab page paints its own ground (the
  // pager's page), so the tabs' screen paints none (one full-screen fill fewer on every frame of every tab)
  if (name === '(tabs)' && Platform.OS === 'android') return { ...base, animation: 'none', contentStyle: { backgroundColor: fx.premium.transparent } };
  if (name === 'index' || name === '(tabs)') return { ...base, animation: 'none' };
  // Android: the sign-in stack's own screens paint their ground (the (auth) layout's contentStyle), so its screen here
  // paints none. The replace that takes a sign-in to Home removed the sign-in a frame before this screen's container
  // went, and that frame showed its #080808 ground with only the flying mark (release T4-02); without it, that frame
  // shows what is beneath the navigator (ArrivalVeil: the page skeleton Home opens on)
  if (name === '(auth)' && Platform.OS === 'android') return { ...base, contentStyle: { backgroundColor: fx.premium.transparent }, animation: 'fade', animationDuration: 280 };
  if (name === '(auth)' || name === 'onboarding') return { ...base, contentStyle: { backgroundColor: fx.bg.base }, animation: 'fade', animationDuration: 280 };
  if (SHEET_ROUTES.includes(name)) return { ...base, presentation: 'transparentModal', animation: 'fade', detachPreviousScreen: false, contentStyle: { backgroundColor: fx.premium.transparent } };
  if (MORPH_ROUTES.includes(name)) return { ...base, presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: fx.premium.transparent } };
  if (REDIRECT_ROUTES.includes(name)) return { ...base, animation: 'none' };
  const overlay = OVERLAY_ROUTES[name];
  if (overlay && Platform.OS === 'web') {
    // the web: the screen beneath stays drawn and the Overlay draws its own canvas and entrance; while the route's code
    // loads, the stack's header draws the overlay's header over its skeleton
    return { ...base, headerShown: true, header: overlayHeader(overlay), headerTransparent: true, presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: fx.premium.transparent } };
  }
  if (overlay && Platform.OS === 'android') {
    // Android: opaque (the tabs would stay attached under every overlay); the screen fades, the Overlay's content waits
    return { ...base, headerShown: true, header: renderStackHeader, contentStyle: { backgroundColor: fx.bg.base }, animation: 'fade', gestureEnabled: true };
  }
  return { ...base, headerShown: true, header: renderStackHeader, contentStyle: { backgroundColor: fx.bg.base }, animation: 'fade_from_bottom', animationDuration: 260, gestureEnabled: true };
}

function Root() {
  const { ready, user } = useAuth();
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const [late, setLate] = useState(false); // after 6 s draw with the system fonts rather than keep the splash up
  useEffect(() => { const timer = setTimeout(() => setLate(true), 6000); return () => clearTimeout(timer); }, []);
  const fonts = fontsLoaded || !!fontError || late || Platform.OS === 'web';
  // The client app's entry route plays the Bioptime sting (SplashHost, drawn above the navigator below) and hides the
  // native splash on its first frame; anywhere else (a deep link, the staff build) the splash goes once the session is
  // known and the fonts are in.
  const segments = useSegments() as string[];
  const onEntry = !STAFF_APP && !segments[0];
  useEffect(() => { if (ready && fonts && !onEntry) void SplashScreen.hideAsync(); }, [ready, fonts, onEntry]);
  useRouteGuard();
  useSheetUnderlay();
  if (!fonts) return null;
  const role = user?.role ?? null;
  const stack = <Stack screenLayout={clientScreenLayout} screenOptions={({ route }) => optionsFor(route.name, role)}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      {/* the staff workspaces, only where their files are bundled (not the client app's phone release: metro.config.js);
          an empty list adds no child (a null one is logged by the router as a child that is not a screen) */}
      {STAFF_ROUTES_BUNDLED ? [<Stack.Screen key="(coach)" name="(coach)" options={{ headerShown: false }} />, <Stack.Screen key="(admin)" name="(admin)" options={{ headerShown: false }} />] : []}
      <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
      <Stack.Screen name="onboarding" options={{ title: 'Set up your account', headerBackVisible: false }} />
      <Stack.Screen name="messages" options={{ title: 'Messages' }} />
      <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
      <Stack.Screen name="photos" options={{ title: 'Progress photos' }} />
      <Stack.Screen name="workout/[id]" options={{ title: 'Workout' }} />
      <Stack.Screen name="exercise/[id]" options={{ title: 'Exercise' }} />
      <Stack.Screen name="session/[id]" options={{ title: 'Live session' }} />
      <Stack.Screen name="goals" options={{ title: 'Goals' }} />
      <Stack.Screen name="checkin/[id]" options={{ title: 'Check-in' }} />
      <Stack.Screen name="habits" options={{ title: 'Habits' }} />
      <Stack.Screen name="meal-log" options={{ title: 'Log a meal' }} />
      <Stack.Screen name="coach-ai" options={{ title: 'Coach AI and your data' }} />
      <Stack.Screen name="book-appointment" options={{ title: 'Book a consultation' }} />
      <Stack.Screen name="move-appointment/[id]" options={{ title: 'Move a consultation' }} />
      <Stack.Screen name="book-test" options={{ title: 'Book a blood test' }} />
      <Stack.Screen name="booking/[id]" options={{ title: 'Booking' }} />
      <Stack.Screen name="report/[id]" options={{ title: 'Report' }} />
      <Stack.Screen name="packages" options={{ title: 'Packages' }} />
      <Stack.Screen name="bespoke" options={{ title: 'Bespoke' }} />
      <Stack.Screen name="learn/index" options={{ title: 'Learn' }} />
      <Stack.Screen name="learn/[lessonId]" options={{ title: 'Lesson' }} />
      <Stack.Screen name="refer" options={{ title: 'Refer a friend' }} />
      <Stack.Screen name="billing" options={{ title: 'Billing' }} />
      <Stack.Screen name="help" options={{ title: 'Help and support' }} />
      <Stack.Screen name="support/[id]" options={{ title: 'Support request' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="progress-entry" options={{ title: 'Log a value' }} />
      <Stack.Screen name="milestones" options={{ title: 'Milestones' }} />
      <Stack.Screen name="recommendations" options={{ title: 'Recommendations' }} />
      <Stack.Screen name="settings/profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="settings/security" options={{ title: 'Password and devices' }} />
      <Stack.Screen name="settings/consents" options={{ title: 'Privacy and sharing' }} />
      <Stack.Screen name="settings/data" options={{ title: 'Your data' }} />
      <Stack.Screen name="settings/credits" options={{ title: 'Photo credits' }} />
      <Stack.Screen name="settings/server" options={{ title: 'Server' }} />
      <Stack.Screen name="__fx" options={{ title: 'Kit' }} />
    </Stack>;
  return <>
    {STAFF_APP ? null : <MotionSync />}
    {!STAFF_APP && Platform.OS === 'android' ? <ArrivalVeil signedIn={!!user} inAuth={segments[0] === '(auth)'} /> : null}
    <SheetBackdrop>
      {STAFF_APP ? stack : <ThemeProvider value={CLIENT_THEME}>{stack}</ThemeProvider>}
    </SheetBackdrop>
    <SheetHost />
    {Platform.OS === 'web' ? null : <ConfirmHost />}
    <ToastHost />
    {STAFF_APP ? null : <MarkLayer />}
    {STAFF_APP ? null : <SplashHost ready={ready} target={user ? 'home' : 'signin'} onFirstFrame={() => { void SplashScreen.hideAsync(); }} />}
  </>;
}

/** Reanimated reads the OS reduced-motion setting once, when the app starts (every ReduceMotion.System timing in
 *  src/fx/motion/tokens keeps that reading), while the kit's calm follows the setting as it changes. This keeps the two
 *  the same: turned on mid-session, every System timing lands at once with the kit's rest states; turned off again, the
 *  motion the kit chooses plays instead of landing on its first frame (release G3-1: an app started with animations
 *  off and turned back on closed the player in one frame). The kit's calm paths (calmFade, ReduceMotion.Never) are
 *  unchanged. */
function MotionSync() {
  const { calm } = useMotion();
  return <ReducedMotionConfig mode={calm ? ReduceMotion.Always : ReduceMotion.Never} />;
}

/** Android (release T4-02): the way from a sign-in screen to Home. The sign-in stack is replaced by the tabs at once
 *  (animation 'none'), and the tabs paint nothing of their own (their pages do), so on the 2 GB emulator the frame or
 *  three before Home's page had drawn showed the black window with only the flying mark (48-65 ms, 2 of 4 tier-A runs).
 *  From the moment a session opens on a sign-in screen, this draws the pager's own page skeleton under the navigator,
 *  in the place the page draws it: hidden by the opaque sign-in screen, it shows only through that gap, and the page's
 *  first frame (the same skeleton, Home's own over it) covers it. It goes once a tab page reports its first draw, or
 *  after motionValues.mark.cap (a sign-in that leads elsewhere: the setup, which covers it too). Reduced motion and tier
 *  C draw it still (the skeleton's own rule). */
function ArrivalVeil({ signedIn, inAuth }: { signedIn: boolean; inAuth: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => { if (signedIn && inAuth) setOn(true); }, [signedIn, inAuth]);
  useEffect(() => {
    if (!on) return;
    const off = whenTabPageDrawn(() => requestAnimationFrame(() => setOn(false)));
    const cap = setTimeout(() => setOn(false), motionValues.mark.cap);
    return () => { off(); clearTimeout(cap); };
  }, [on]);
  if (!on) return null;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, styles.veil]}>
    <PageSkeleton />
  </View>;
}

/** The web: a sheet route opened first in history (a link, a typed address) gets its tab underneath before it shows,
 *  so the sheet opens over that tab and closing it returns there without drawing the tab from scratch. */
function useSheetUnderlay() {
  const state = useRootNavigationState();
  // the root layout's stack (the navigation root holds the layout itself as its one route)
  const stack = (state?.routes?.[0] as { state?: { routes?: Array<{ name: string }> } } | undefined)?.state;
  const routes = stack?.routes;
  const only = routes?.length === 1 ? routes[0]?.name : undefined;
  useEffect(() => {
    if (STAFF_APP || Platform.OS !== 'web' || !only || typeof window === 'undefined') return;
    const owner = SHEET_OWNER[only];
    if (!owner) return;
    const here = window.location.pathname + window.location.search;
    nav.replace(owner as never);
    // the sheet goes on top once the tab is in place
    requestAnimationFrame(() => { nav.push(here as never); });
  }, [only]);
}

/** The client app adds two providers around everything: device tilt for the TiltCards and one shimmer clock, so every
 *  skeleton on a screen shares a single sweep of light (src/fx/motion). RootRouter comes first: it keeps Expo Router's
 *  module-wide router on this root when Android swaps activities (a font size, display size, bold text or language
 *  change) and holds a navigation asked for while no root is mounted (src/fx/nav/rootRouter). */
export default function Layout() {
  // a touch anywhere wakes the client kit's decorative loops for their motion budget (src/fx/motion/budget)
  // Android: the window under the root is black already (app.json backgroundColor), so the client root paints nothing
  return <GestureHandlerRootView {...(STAFF_APP ? null : wakeOnTouch)} style={[styles.root, { backgroundColor: STAFF_APP ? colors.canvas : Platform.OS === 'android' ? fx.premium.transparent : fx.bg.deep }]}>
    <RootRouter />
    <AuthProvider>
      <StatusBar style="light" />
      {STAFF_APP ? <Root /> : <TiltProvider><ShimmerProvider><Root /></ShimmerProvider></TiltProvider>}
    </AuthProvider>
  </GestureHandlerRootView>;
}

/** What the client app shows when a screen fails to draw (the earlier app's error screen): the reason in plain words, "Try
 *  again" (draws the screen again) and "Sign out" (ends the session on this device and clears its saved copies; nothing
 *  on the server changes). The staff build keeps expo-router's own. */
function FxErrorBoundary({ retry }: ErrorBoundaryProps) {
  const signOut = async () => { await forgetToken(); await clearCache(); await retry(); };
  // it enters like a flow (opacity, y 10 → 0, 400 ms expo; at rest with reduced motion)
  return <View style={styles.errorScreen}><FlowEnter style={styles.error}>
    <Icon name="triangle-alert" size={44} color={fx.red.brand} />
    <T v="heading" center style={styles.errorTitle}>Something went wrong</T>
    <T v="body" color={fx.ink.a60} center>This screen could not be drawn. Nothing you entered was sent or lost.</T>
    <View style={styles.errorActions}>
      <Button title="Try again" icon="rotate-ccw" onPress={() => { void retry(); }} />
      <Button title="Sign out" variant="link" iconRight={null} onPress={() => { void signOut(); }} />
    </View>
  </FlowEnter></View>;
}

export const ErrorBoundary = STAFF_APP ? undefined : FxErrorBoundary;

const styles = StyleSheet.create({
  root: { flex: 1 },
  veil: { backgroundColor: fx.bg.deep },
  errorScreen: { flex: 1, backgroundColor: fx.bg.base },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  errorTitle: { fontSize: 22, lineHeight: 30 },
  errorActions: { alignSelf: 'stretch', maxWidth: 384, width: '100%', gap: 8, marginTop: 12, alignItems: 'center' },
});
