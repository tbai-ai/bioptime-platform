/* Home's top: the hero photo and the greeting (the earlier app's HomeTab header, PREMIUM §1.4 and §1.10).
   - HomeHero (full-bleed, behind the column): the people-free photo for this part of the day (heroForHour), 320 pt
     (280 at ≤ 360, 360 from 768) at .40 under the Home scrim and the red wash, as a StretchyHeader: it settles
     (scale 1.1 → 1, opacity 0 → .4 over 1.5 s from the page-active edge), moves at 0.4× the scroll and fades, and
     stretches on an iOS pull. The red wash is solid over the top 55 % and fades to nothing at the photo's foot (Scrim
     'heroWash'), while below 55 % the photo dissolves into the page's black, so it ends in pure black with no seam
     (motion v2 M65; static, no cost at any tier). The two red orbs drift behind it and move at 0.3×.
   - HomeHeader (in the column): the time-of-day eyebrow (icon 11 + 11/500 .18em at white/60, crossfading at the hour),
     the first name in Bebas 30 with a drop shadow, the package line, then the bell (unread dot) and the 48 pt glass
     ring with the Bioptime mark (24 pt, the brand minimum, 7 pt clear inside the 38 pt disc), which takes the mark
     handed off by the splash or the sign-in (The Thread, MarkHandoff target 'home'): while a hand-off is pending the
     ring is in place at once and only the mark flies in, so nothing around it hides the flight.
   - The first-mount timeline (the earlier app's, motion v2 M63), from the page-active edge: the hero settles from 0, the
     greeting slides in from x −20 at 200 ms, the ring pops from .8 on the pop spring at 300 ms (the score card, first
     on the edge, and the activity at 300 are HomeScreen's). Once per launch; a revisit and reduced motion show it at
     rest. While a mark handed to the ring flies over the greeting, the greeting holds (MarkClear) and fades in once the
     mark has passed.
   - The Deck (tier A): while the page moves, the title block lags it by 15 % of the page offset (at most a column).
   - While the page is in front and its header row on screen, a top toast starts below the row (never over the bell
     or the ring).
   - The bell: when the unread count rises while the page is in front, the dot pops on the pop spring and the bell
     rings once (0 → 12 → −10 → 6 → 0° over 500 ms). Tier C: the dot fades; calm: at once.
   - HomeCompactBar: the compact bar with the first name, once the page has scrolled under it. */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MarkClear, useMarkClear } from '@/flow/MarkClear';
import {
  COLUMN, CompactBar, DepthTile, fx, hasMarkHandoff, Icon, IconButton, MarkHandoff, MarkPaths, Orbs, ParallaxLayer, Photo, Reveal, Scrim, StretchyHeader, T,
  useLayout, useTabScroll,
} from '@/fx';
import { markRevealed, wasRevealed } from '@/fx/motion/seen';
import { calmFade, ease, motionValues, spring, t, timing } from '@/fx/motion/tokens';
import { useMotion } from '@/fx/motion/tier';
import { usePageActive, usePageMotion, usePageSettled } from '@/fx/nav/pageReady';
import { useTopToastClearance } from '@/fx/Toast';
import type { Greeting } from './heroForHour';

const S = motionValues.screens.m63;
const BELL = motionValues.screens.m67;

function useScrollY() {
  const fallback = useSharedValue(0);
  return useTabScroll() ?? fallback;
}

export const HomeHero = React.memo(function HomeHero({ greeting }: { greeting: Greeting }) {
  const scrollY = useScrollY();
  const { heroHeight } = useLayout();
  return <View pointerEvents="none" style={[styles.heroBox, { height: heroHeight + 120 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <ParallaxLayer scrollY={scrollY} speed={0.3} style={StyleSheet.absoluteFill}><Orbs preset="home" /></ParallaxLayer>
    <StretchyHeader
      scrollY={scrollY}
      height={heroHeight}
      base={S.heroOpacity}
      settle
      photo={<Photo key={greeting.slot} slot={greeting.slot} style={StyleSheet.absoluteFill} priority="high" decorative />}
      blurCopy={<Photo slot={greeting.slot} small style={StyleSheet.absoluteFill} decorative />}>
      <Scrim kind="heroHome" style={StyleSheet.absoluteFill} />
      <Scrim kind="heroWash" style={StyleSheet.absoluteFill} />
      {/* below the wash's solid part the photo dissolves into the page's own black, so it ends with no seam */}
      <Scrim kind="emptyBand" style={styles.heroFoot} />
    </StretchyHeader>
  </View>;
});

/** The ring's pop (the earlier app's .8 → 1 on the pop spring, at 300 ms), from the page-active edge, once per launch.
 *  Tier C: a fade; calm and a revisit: at rest. */
function RingPop({ children }: { children: React.ReactNode }) {
  const { tier, still } = useMotion();
  const active = usePageActive();
  const [rest] = useState(() => still || wasRevealed('home.ring'));
  const p = useSharedValue(rest ? 1 : 0);
  const o = useSharedValue(rest ? 1 : 0);
  const begun = useSharedValue(rest ? 1 : 0);
  const lite = tier === 'C';
  const fadeMs = motionValues.reveal.C.duration;
  const remember = () => markRevealed('home.ring');
  useAnimatedReaction(() => (begun.get() === 0 && active.get() === 1 ? 1 : 0), (go) => {
    if (go !== 1 || begun.get() === 1) return;
    begun.set(1);
    o.set(withDelay(S.ringAt, withTiming(1, timing(lite ? fadeMs : t.pop, ease.expo))));
    if (!lite) p.set(withDelay(S.ringAt, withSpring(1, spring.pop)));
    else p.set(1);
    scheduleOnRN(remember);
  });
  useEffect(() => { if (still) { begun.set(1); p.set(1); o.set(1); } }, [still, begun, p, o]);
  const style = useAnimatedStyle(() => {
    const k = p.get();
    if (k === 1 && o.get() === 1) return { opacity: 1, transform: [] };
    return { opacity: o.get(), transform: [{ scale: S.ringFrom + (1 - S.ringFrom) * k }] };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** The bell and its unread dot: a rise in the unread count pops the dot and rings the bell once (page in front only). */
function Bell({ count, dot, label, onPress }: { count: number; dot: boolean; label: string; onPress: () => void }) {
  const { tier, still } = useMotion();
  const active = usePageActive();
  const swing = useSharedValue(0);
  const pop = useSharedValue(dot ? 1 : 0);
  const shownDot = useRef(dot);
  const last = useRef<number | null>(null);
  useEffect(() => {
    const was = last.current;
    last.current = count;
    const rose = was != null && count > was && active.get() === 1;
    if (dot && !shownDot.current) {
      // the dot appears: a pop (tier C: a fade; calm: a short crossfade)
      pop.set(0);
      pop.set(still ? withTiming(1, calmFade()) : tier === 'C' ? withTiming(1, timing(motionValues.reveal.C.duration, ease.expo)) : withSpring(1, spring.pop));
    } else if (!dot) pop.set(still ? withTiming(0, calmFade()) : withTiming(0, timing(t.fast, ease.expo)));
    else if (rose && !still && tier !== 'C') { pop.set(0.6); pop.set(withSpring(1, spring.pop)); }
    shownDot.current = dot;
    if (!rose || still || tier === 'C') return;
    const step = BELL.bellMs / (BELL.bell.length - 1);
    const seq = BELL.bell.slice(1).map((deg) => withTiming(deg, timing(step, ease.inOut)));
    swing.set(0);
    swing.set(withSequence(...seq));
  }, [count, dot, still, tier, active, pop, swing]);
  const bellStyle = useAnimatedStyle(() => (swing.get() === 0 ? { transform: [] } : { transform: [{ rotate: swing.get() + 'deg' }] }));
  const dotStyle = useAnimatedStyle(() => {
    const k = pop.get();
    if (tier === 'C' || still) return { opacity: k, transform: [] };
    return { opacity: Math.min(1, k * 2), transform: [{ scale: k }] };
  });
  return <View>
    <Animated.View style={[styles.bellSwing, bellStyle]}>
      <IconButton icon="bell" kind="glass" size={40} iconSize={18} label={label} onPress={onPress} testID="home-bell" />
    </Animated.View>
    <Animated.View pointerEvents="none" style={[styles.dot, dotStyle]} />
  </View>;
}

export const HomeHeader = React.memo(function HomeHeader({ greeting, name, packageLine, unreadNotes, unreadNews, onBell }: {
  greeting: Greeting; name: string; packageLine: string; unreadNotes: number | null; unreadNews: number | null; onBell: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { tier, still } = useMotion();
  const [flight] = useState(() => hasMarkHandoff('home')); // a mark is on its way to the ring (splash or sign-in)
  // the greeting holds while that mark flies over it, then fades in (MarkClear; off at tier C and under reduced motion)
  const greetClear = useMarkClear('home', true);
  const n = unreadNotes ?? 0;
  const dot = unreadNotes != null && (n > 0 || (unreadNews ?? 0) > 0);
  const bellLabel = n ? `Notifications, ${n} unread` : dot ? 'Notifications, news unread' : 'Notifications';

  // the title block lags the page while it moves (tier A, like ScreenHeader)
  const deck = usePageMotion();
  const offset = deck?.offset;
  const lagW = tier === 'A' && !still && deck ? motionValues.pager.headerLag * Math.min(deck.width, COLUMN) : 0;
  const lagStyle = useAnimatedStyle(() => {
    const d = offset && lagW ? offset.get() : 0;
    const lag = Math.abs(d) < 1 ? -lagW * d : 0;
    return lag === 0 ? { transform: [] } : { transform: [{ translateX: lag }] };
  });

  // the top toast lane starts below the bell and the ring while the page is in front and the row is on screen
  const row = useRef<React.ComponentRef<typeof View>>(null);
  const [bottom, setBottom] = useState(0);
  const inFront = usePageSettled();
  const scrollY = useScrollY();
  const [onScreen, setOnScreen] = useState(true);
  useAnimatedReaction(() => bottom > 0 && scrollY.get() < bottom, (on, was) => { if (on !== was) scheduleOnRN(setOnScreen, on); }, [bottom]);
  useTopToastClearance(bottom, inFront && onScreen && bottom > 0);
  const measureRow = () => { row.current?.measureInWindow((_x: number, wy: number, w: number, h: number) => { if (w && h) setBottom(Math.round(wy + h)); }); };

  const ring = <View style={styles.ring}>
    <DepthTile size={38} radius={19} color={fx.bg.panelSolid} accessibilityLabel="Bioptime">
      <View style={styles.markBox}>
        <MarkHandoff target="home"><MarkPaths width={24} /></MarkHandoff>
      </View>
    </DepthTile>
  </View>;

  return <View ref={row} collapsable={false} onLayout={(e) => { const l = e.nativeEvent.layout; if (l.width && l.height) measureRow(); }} style={[styles.header, { paddingTop: Math.max(insets.top + 12, 44) }]}>
    <Animated.View style={[styles.left, lagStyle]}>
      <MarkClear state={greetClear} rise={false}>
        <Reveal mount from="left" distance={-S.greetingX} delay={S.greetingAt} id="home.greeting">
          <Reveal key={greeting.part} mount from="up" distance={-4}>
            <View style={styles.eyebrow}>
              <Icon name={greeting.icon} size={11} color={greeting.color} stroke={2} />
              <T v="eyebrowGreeting" numberOfLines={2} style={styles.shrink}>{greeting.text}</T>
            </View>
          </Reveal>
          {name ? <T v="h1" numberOfLines={1} style={styles.name}>{name}</T> : null}
          <T v="caption" color={fx.ink.a60} numberOfLines={2} style={styles.pkg}>{packageLine}</T>
        </Reveal>
      </MarkClear>
    </Animated.View>
    <View style={styles.right}>
      <Bell count={n + (unreadNews ?? 0)} dot={dot} label={bellLabel} onPress={onBell} />
      {flight ? ring : <RingPop>{ring}</RingPop>}
    </View>
  </View>;
});

/** The compact bar (first name, Bebas 20), drawn only once the page has scrolled near it. */
export function HomeCompactBar({ title }: { title: string }) {
  const scrollY = useScrollY();
  const [show, setShow] = useState(false);
  useAnimatedReaction(() => scrollY.get() > 36, (on, was) => { if (on !== was) scheduleOnRN(setShow, on); });
  if (!show || !title) return null;
  return <CompactBar scrollY={scrollY} title={title} />;
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  heroBox: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
  heroFoot: { position: 'absolute', left: 0, right: 0, bottom: 0, top: `${motionValues.screens.m65.washSolidTo * 100}%` },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: fx.space.titleX, paddingBottom: 8 },
  left: { flex: 1, minWidth: 0 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  name: { textShadowColor: fx.premium.fog, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
  pkg: { marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bellSwing: { transformOrigin: 'top' },
  dot: { position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderRadius: 5, backgroundColor: fx.red.brand, borderWidth: 1.5, borderColor: fx.bg.deep, boxShadow: fx.shadow.dot },
  ring: { width: 48, height: 48, borderRadius: 24, padding: 4, borderWidth: 1, borderColor: fx.line.a20, backgroundColor: fx.fill.a10, alignItems: 'center', justifyContent: 'center', boxShadow: fx.shadow.avatarRing },
  markBox: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
