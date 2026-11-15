/* The member tabs: the earlier app's nine slots under the floating glass pill, as a finger-following pager (src/fx/nav).
   Home · Train · Bio · Life · Fuel · Coach · Tests · Store · Profile, icon-only with each name as the accessibility
   label; plan and me stay as hidden routes that redirect (old links and notifications keep working). Built on
   expo-router's headless tabs (expo-router/ui): the triggers below are the tab routes, the pager draws the pages.
   A tab whose route file is not in this build yet (the screen packages add them) is left out of the bar rather than
   pointing at nothing.
   Here too, for every tab: a member who has not finished onboarding is sent to it (GET /me, prefetched under the key
   'me' so Home can take the same answer, and read again whenever a screen invalidates 'me', so the Coach tab's unread
   dot clears once the messages are read), and while the app is open new notifications are polled (src/fx/data
   useUpdates: how coach updates arrive without push).
   On the web a production build ships each tab as its own script, fetched on the tab's first visit: a few seconds after
   the tabs open, the others are fetched one at a time in the background, so a first visit waits only for the page's
   own first render (the pager slides it in once it has drawn). A native build carries every screen already. The same
   goes for the overlays a tab opens most (a check-in, a report, a booking, the player, notifications, the settings
   pages): 4 s after the tabs open, one at a time in idle moments, so an overlay's first open draws its own header at
   once (never a loading header that another then replaces). */
import { Redirect, useIsFocused } from 'expo-router';
import { TabList, Tabs, TabTrigger, useTabTrigger } from 'expo-router/ui';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { onInvalidate, prefetch } from '@/lib/useLoad';
import { fx } from '@/theme';
import { useUpdatesPoller } from '@/fx/data/useUpdates';
import { motionValues } from '@/fx/motion/tokens';
import { forgetSeen } from '@/fx/motion/seen';
import { NavItem, PillTabBar } from '@/fx/nav/PillTabBar';
import { PagerProvider, PagerSlot } from '@/fx/nav/Pager';
import { useTabRoutes } from '@/fx/nav/routes';
import { HIDDEN_TABS, TABS } from '@/fx/nav/tabs';
import { useAssistiveTech } from '@/fx/Sheet';

type Me = { member?: { onboardingCompleted?: boolean; state?: string }; unread?: { messages?: number } };

/** The tab screens' scripts, in the bar's order (the web fetches them ahead of a first visit). */
const TAB_SCRIPTS: Array<() => Promise<unknown>> = [
  () => import('./train'), () => import('./bio'), () => import('./life'), () => import('./fuel'),
  () => import('./coach'), () => import('./tests'), () => import('./store'), () => import('./profile'), () => import('./index'),
];
const PRELOAD_AFTER_MS = 2500;

/** Fetch the other tabs' scripts once the first page has had its moment (web only; each failure is left for the visit). */
function usePreloadTabs(on: boolean) {
  useEffect(() => {
    if (!on || Platform.OS !== 'web') return;
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        for (const load of TAB_SCRIPTS) {
          if (!alive) return;
          try { await load(); } catch { /* offline: the visit fetches it */ }
        }
      })();
    }, PRELOAD_AFTER_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [on]);
}

/** The overlay screens' scripts the tabs open most (fetched after the tabs, web only). */
const OVERLAY_SCRIPTS: Array<() => Promise<unknown>> = [
  () => import('../checkin/[id]'), () => import('../report/[id]'), () => import('../booking/[id]'), () => import('../workout/[id]'),
  () => import('../exercise/[id]'), () => import('../notifications'), () => import('../settings/profile'), () => import('../settings/security'),
  () => import('../settings/consents'), () => import('../settings/data'), () => import('../settings/credits'),
];

/** Fetch the overlays' scripts once the tabs have been idle a while, one at a time in idle moments (web only). */
function usePreloadOverlays(on: boolean) {
  useEffect(() => {
    if (!on || Platform.OS !== 'web') return;
    let alive = true;
    const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const idle = () => new Promise<void>((resolve) => { if (g.requestIdleCallback) g.requestIdleCallback(() => resolve(), { timeout: motionValues.overlay.preloadAfter }); else setTimeout(resolve, 0); });
    const timer = setTimeout(() => {
      void (async () => {
        for (const load of OVERLAY_SCRIPTS) {
          if (!alive) return;
          await idle();
          if (!alive) return;
          try { await load(); } catch { /* offline: the first open fetches it */ }
        }
      })();
    }, motionValues.overlay.preloadAfter);
    return () => { alive = false; clearTimeout(timer); };
  }, [on]);
}

/** Native: while a screen is over the tabs (the player, an exercise guide, a sheet route: they are transparent, so the
 *  tabs stay attached beneath) and a screen reader or another accessibility service runs, the tabs are hidden from it,
 *  so focus never moves behind the screen on top. Only this wrapper re-renders when the tabs lose or regain the focus
 *  (its children are the same elements), and without assistive technology no prop changes at all. */
function CoveredHide({ children }: { children: React.ReactNode }) {
  const focused = useIsFocused();
  const assistive = useAssistiveTech();
  const hide = Platform.OS !== 'web' && assistive && !focused;
  return <View collapsable={false} style={styles.fill} accessibilityElementsHidden={hide} importantForAccessibility={hide ? 'no-hide-descendants' : 'auto'}>{children}</View>;
}

/** The pages, with the router's tab switch for the swipe. */
function Pages({ first }: { first: string }) {
  const { switchTab } = useTabTrigger({ name: first });
  return <PagerSlot navigate={(name) => switchTab(name, {})} />;
}

export default function TabsLayout() {
  const { user } = useAuth();
  const member = user?.role === 'member';
  const routes = useTabRoutes();
  const tabs = useMemo(() => TABS.filter((t) => !routes || routes.has(t.name)), [routes]);
  const hidden = HIDDEN_TABS.filter((t) => !routes || routes.has(t.name));
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    if (!member) return;
    let alive = true;
    let asked = 0; // the newest request wins
    const load = (fresh: boolean) => {
      const n = ++asked;
      (fresh ? get<Me>('/me') : prefetch<Me>('me', () => get<Me>('/me'))).then((d) => { if (alive && n === asked) setMe(d); }, () => undefined);
    };
    load(false);
    const off = onInvalidate('me', () => load(true));
    return () => { alive = false; off(); forgetSeen(); }; // another member: no number shows at rest from this one's visit
  }, [member, user?.id]);
  useUpdatesPoller(member);
  usePreloadTabs(member);
  usePreloadOverlays(member);

  if (me?.member && !me.member.onboardingCompleted && me.member.state !== 'pending_verification') return <Redirect href="/onboarding" />;
  const unread = (me?.unread?.messages ?? 0) > 0;
  return <PagerProvider tabs={tabs}><CoveredHide>
    <Tabs options={{ backBehavior: 'history' }} style={styles.root}>
      <Pages first={tabs[0]?.name ?? 'index'} />
      <TabList asChild>
        <PillTabBar count={tabs.length}>
          {tabs.map((tab, i) => <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
            <NavItem tab={tab} order={i} badge={tab.name === 'coach' && unread} badgeLabel="new messages" />
          </TabTrigger>)}
        </PillTabBar>
      </TabList>
      <TabList style={styles.hidden}>
        {hidden.map((tab) => <TabTrigger key={tab.name} name={tab.name} href={tab.href} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />)}
      </TabList>
    </Tabs>
  </CoveredHide></PagerProvider>;
}

const styles = StyleSheet.create({
  // Android: no ground of its own (each pager page paints one; a fill here was drawn under every page on every frame)
  root: { flex: 1, backgroundColor: Platform.OS === 'android' ? fx.premium.transparent : fx.bg.deep },
  hidden: { display: 'none' },
  fill: { flex: 1 },
});
