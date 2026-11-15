/* Tab 9, Profile (the earlier app's ProfileTab, shots 74–79, 84, 85; the old Me tab's features moved here).
   1. Header over a faint people-free still life (slot profile.header.backdrop, .12) with the red orb top right: the
      64 pt avatar ring (initials on the name's hue; the Bioptime mark when there is no name), the name in Bebas 24,
      "{package} · {city}", a status dot with "{plan} · Week {n}" (the week of the latest plan task already due), and the
      account line `email · state` (it reads "Deletion requested" while a deletion request is open). The header moves
      at half the scroll speed and fades (still under reduced motion).
   2. Sub-tabs Overview · Achievements · Reports · Orders · Settings (`?tab=`; /milestones → achievements, Store's
      "Your orders" → orders), pinned under the compact bar while the page scrolls; the panel slides ±20 with them.
   3. The panels (src/screens/profile): each loads its own data; pull to refresh, refocus and returning to the app reload
      the header and the open panel.
   4. Settings ends with the disclaimer below, word for word. */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { APP_VERSION } from '@/lib/config';
import { useFeatures } from '@/lib/features';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import {
  Avatar, CompactBar, fx, MarkPaths, Orbs, P, Photo, PillTabs, readKeyed, Scrim, SwitchView, T, TabScreen, useFocusRefresh,
  useMotion, useTabScroll, writeKeyed, RevealScope,
} from '@/fx';
import { AddressText } from '@/fx/wordFit';
import { Achievements } from '@/screens/profile/Achievements';
import { isSub, planWeek, SUBS, type Me, type ProfileRec, type ProgrammeRes, type Sub } from '@/screens/profile/data';
import { Orders } from '@/screens/profile/Orders';
import { Overview } from '@/screens/profile/Overview';
import { StickyRow } from '@/screens/profile/parts';
import { Reports } from '@/screens/profile/Reports';
import { SettingsPanel } from '@/screens/profile/Settings';

export default function Profile() {
  const { user } = useAuth();
  const features = useFeatures(true);
  const params = useLocalSearchParams<{ tab?: string }>();
  const me = useLoad<Me>('me', () => get<Me>('/me'), [], { shared: true });
  const profile = useLoad<ProfileRec>('profile', () => get('/me/profile'), []);
  const programme = useLoad<ProgrammeRes>('programme', () => get<ProgrammeRes>('/me/programme'), []);

  // the sub-tab: a link's ?tab= wins for that visit, else the one last used on this device
  const [tab, setTab] = useState<Sub | null>(isSub(params.tab) ? params.tab : null);
  const prev = useRef(0);
  useFocusEffect(useCallback(() => {
    if (isSub(params.tab)) setTab(params.tab);
    // the module router (src/fx/nav/rootRouter): when Android recreates the activity, the old root's teardown runs this
    // cleanup after its navigator is gone; the hook's router threw there ("navigate before mounting the Root Layout")
    return () => { if (params.tab) router.setParams({ tab: undefined }); };
  }, [params.tab])); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isSub(params.tab)) return;
    void readKeyed('segment', 'profile').then((v) => { if (isSub(v)) setTab((t) => t ?? v); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const current: Sub = tab ?? 'overview';
  const index = SUBS.findIndex((s) => s.value === current);
  const choose = (v: Sub) => { prev.current = index; setTab(v); void writeKeyed('segment', 'profile', v); };
  const dir: 1 | -1 = index >= prev.current ? 1 : -1;

  // refresh: the header and whatever the open panel registered
  const panel = useRef<(() => Promise<unknown>) | null>(null);
  const register = useCallback((fn: (() => Promise<unknown>) | null) => { panel.current = fn; }, []);
  const reloadAll = useCallback(() => Promise.all([me.reload(), profile.reload(), programme.reload(), panel.current?.()]),
    [me.reload, profile.reload, programme.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const { refreshing, onRefresh } = useFocusRefresh(reloadAll);

  const [headerH, setHeaderH] = useState(176);
  const name = user?.name ?? me.data?.member?.name ?? '';
  const prog = programme.data?.programme ?? me.data?.programme ?? null;
  const city = profile.data?.profile?.city;
  const plan = programme.data?.plan ?? me.data?.plan ?? null;
  const week = planWeek(programme.data?.tasks);
  const dot = prog?.status === 'active' ? fx.hue.green500 : prog?.status === 'paused' ? fx.hue.amber400 : fx.ink.ink3;
  const firstLine = [prog?.packageName ?? (programme.data || me.data ? 'No package yet' : null), city].filter(Boolean).join(' · ');

  const header = <View onLayout={(e) => setHeaderH(Math.round(e.nativeEvent.layout.height))}>
    <Parallax>
      <View style={styles.headRow}>
        {name ? <Avatar name={name} size={64} ring /> : <View style={styles.markRing}><MarkPaths width={40} accessibilityLabel="Bioptime" /></View>}
        <View style={styles.headText}>
          <T v="card24" accessibilityRole="header" numberOfLines={2}>{name || 'Your profile'}</T>
          {firstLine ? <T v="body" color={fx.ink.a80} style={styles.line1} numberOfLines={2}>{firstLine}</T> : null}
          {plan ? <View style={styles.planRow}>
            <View style={[styles.dot, { backgroundColor: dot, boxShadow: prog?.status === 'active' ? fx.shadow.green : undefined }]} />
            <T v="section" color={fx.ink.a90} style={styles.planText} numberOfLines={3}>{`${plan.title}${week ? ` · Week\u00a0${week}` : ''}`}</T>
          </View> : null}
          {/* the address may break after its '@' and its dots, never inside a word, on up to three lines (EMAIL) */}
          <AddressText v="caption" color={fx.ink.a50} style={styles.account} numberOfLines={3}>{user?.email} · {label(user?.state)}</AddressText>
        </View>
      </View>
    </Parallax>
  </View>;

  return <TabScreen refreshing={refreshing} onRefresh={onRefresh} sticky={<Bar />} testID="profile"
    bleedTop={<View style={styles.zero}><Backdrop height={headerH + 40} /></View>}>
    {header}
    <StickyRow top={headerH}>
      <PillTabs items={SUBS} value={current} onChange={choose} />
    </StickyRow>
    <Panels>
      <SwitchView id={current} direction={dir}>
        {current === 'overview' ? <Overview features={features} programme={programme} register={register} />
          : current === 'achievements' ? <Achievements register={register} />
            : current === 'reports' ? <Reports register={register} />
              : current === 'orders' ? <Orders features={features} register={register} />
                : <SettingsPanel unread={me.data?.unread?.notifications ?? null} footer={
                  <P muted small>Bioptime app {APP_VERSION}. Bioptime offers general wellbeing guidance and coaching. It is not medical advice and does not diagnose, treat or prevent disease. If you are unwell, talk to a doctor; in an emergency call 112.</P>
                } />}
      </SwitchView>
    </Panels>
  </TabScreen>;
}

/** The compact bar that replaces the header once the page scrolls. */
function Bar() {
  const y = useTabScroll();
  return y ? <CompactBar scrollY={y} title="Profile" /> : null;
}

/** The header's content at half the scroll speed, fading as it goes (clipped, so it never slides under the tabs). */
function Parallax({ children }: { children: React.ReactNode }) {
  const y = useTabScroll();
  const { still } = useMotion();
  const insets = useSafeAreaInsets();
  const a = useAnimatedStyle(() => {
    const s = y ? Math.max(0, y.value) : 0;
    if (still || s <= 0) return { opacity: 1, transform: [] };
    return { opacity: Math.max(0, 1 - s / 140), transform: [{ translateY: Math.min(s, 200) * 0.5 }] };
  });
  return <View style={[styles.clip, { paddingTop: insets.top + 28 }]}>
    <Animated.View style={a}>{children}</Animated.View>
  </View>;
}

/** The faint still life and the red orb behind the header (full width, behind the column). */
function Backdrop({ height }: { height: number }) {
  return <View pointerEvents="none" style={[styles.backdrop, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Photo slot="profile.header.backdrop" opacity={0.12} decorative priority="high" style={StyleSheet.absoluteFill} />
    <Scrim kind="profileBand" style={StyleSheet.absoluteFill} />
    <Orbs orbs={[{ color: fx.premium.orbRed, size: 256, place: { right: -64, top: -110 } }]} />
  </View>;
}

/** The panels, revealing as they scroll in. */
function Panels({ children }: { children: React.ReactNode }) {
  const y = useTabScroll();
  const inner = <View style={styles.panels}>{children}</View>;
  return y ? <RevealScope scrollY={y}>{inner}</RevealScope> : inner;
}

const styles = StyleSheet.create({
  zero: { height: 0 },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
  clip: { overflow: 'hidden', paddingHorizontal: fx.space.titleX, paddingBottom: 20 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  markRing: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: fx.red.a30, boxShadow: fx.shadow.avatarRing, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.bg.panelSolid },
  headText: { flex: 1, minWidth: 0 },
  line1: { marginTop: 2 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  planText: { flex: 1, textTransform: 'uppercase', fontSize: 12, lineHeight: 16, letterSpacing: 0.6 },
  account: { marginTop: 6 },
  panels: { paddingHorizontal: fx.space.cardX, paddingTop: 12 },
});
