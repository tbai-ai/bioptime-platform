/* The 3D shelf carousel (PREMIUM §1.4): Home Quick Workouts and live sessions, Train "This week", Store Learn.
   Cards keep the earlier app's size (150 × 128, gap 12) and the list stays left-aligned at the 20 pt gutter; the first slot
   is the focus slot. Snap interval 162, fast deceleration. For each card, p = (cardLeft − scrollX − gutter) / 162,
   held to −1..3:
   - to the right (p > 0) the outer edge turns away by 10°·min(p, 2), scale 1 − .06·min(p, 2), x −10·min(p, 2),
     opacity 1 − .16·min(p, 2), and a depth fog of black at .18·min(p, 2);
   - leaving left (p < 0) the outer edge turns away by 24°·|p|, scale 1 − .08·|p|, opacity 1 − .5·|p|.
   Inside a card, <ShelfPhoto> renders its photo at 1.12 moving −12·p pt (parallax).
   Momentum lean (tier A): while the shelf moves, every card turns a further −vx / 1800 × 6° (at most ±6°) and the photos
   move a further −vx / 400 pt, set on the frame of each scroll event; both spring back (spring.lean) once no scroll
   event has come for leanIdleMs (34 ms), or at once when the scroll ends.
   Tier B: scale and opacity only. Tier C and calm: flat cards that still scroll and snap. A user's snap gives a
   selection haptic (never a programmatic scroll).
   The shelf owns its no-swipe zone (NoSwipeZone): a horizontal drag on it scrolls the shelf and never turns the tab
   pager's page. The web scrolls it natively (overflow-x auto, CSS scroll snap at the gutter) with 12 pt of room above
   and below inside the scroller, so the turned edges are never clipped and the layout around it does not change. */
import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Platform, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withDelay, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import { fx } from '@/theme';
import { haptics } from '@/fx/device/haptics';
import { NoSwipeZone } from '@/fx/nav/Pager';
import { motionValues, spring } from './tokens';
import { useMotion, type MotionTier } from './tier';

type ShelfCtx = { x: SharedValue<number>; lean: SharedValue<number>; index: number; step: number; tier: MotionTier; flat: boolean };
const CardContext = createContext<ShelfCtx | null>(null);

const { cardW, cardH, gap, gutter, leanVx, leanDeg, parallaxVx, leanIdleMs } = motionValues.shelf;
const WEB = Platform.OS === 'web';
/** Room above and below the cards inside the web scroller (the scroller is pulled out by the same amount). */
const ROOM = 12;

export type ShelfCarouselProps<T> = {
  data: readonly T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string;
  cardWidth?: number;
  cardHeight?: number;
  /** Fired after a user's snap lands on a new card. */
  onSnap?: (index: number) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

function ShelfCard({ x, lean, index, width, height, tier, flat, children }: { x: SharedValue<number>; lean: SharedValue<number>; index: number; width: number; height: number; tier: MotionTier; flat: boolean; children: React.ReactNode }) {
  const step = width + gap;
  const card = useAnimatedStyle(() => {
    if (flat) return { opacity: 1, transform: [] };
    const p = Math.max(-1, Math.min(3, (index * step - x.get()) / step));
    const l = tier === 'A' ? lean.get() : 0; // the momentum lean, degrees
    if (Math.abs(p) < 0.001 && Math.abs(l) < 0.01) return { opacity: 1, transform: [] };
    if (p >= 0) {
      const k = Math.min(p, 2);
      const scale = 1 - 0.06 * k;
      const opacity = 1 - 0.16 * k;
      if (tier !== 'A') return { opacity, transform: [{ scale }] };
      return { opacity, transform: [{ perspective: motionValues.perspective.card }, { translateX: -10 * k }, { rotateY: 10 * k + l + 'deg' }, { scale }] };
    }
    const k = -p;
    const scale = 1 - 0.08 * k;
    const opacity = 1 - 0.5 * k;
    if (tier !== 'A') return { opacity, transform: [{ scale }] };
    return { opacity, transform: [{ perspective: motionValues.perspective.card }, { rotateY: -24 * k + l + 'deg' }, { scale }] };
  });
  const fog = useAnimatedStyle(() => {
    if (flat || tier !== 'A') return { opacity: 0 };
    const p = Math.max(0, Math.min(2, (index * step - x.get()) / step));
    return { opacity: 0.18 * p };
  });
  return <Animated.View style={[{ width, height }, WEB ? styles.snap : null, card]}>
    <CardContext.Provider value={{ x, lean, index, step, tier, flat }}>{children}</CardContext.Provider>
    {!flat && tier === 'A' ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fx.bg.deep, borderRadius: fx.radius.card }, fog]} /> : null}
  </Animated.View>;
}

export function ShelfCarousel<T>({ data, renderItem, keyExtractor, cardWidth = cardW, cardHeight = cardH, onSnap, accessibilityLabel, style }: ShelfCarouselProps<T>) {
  const { tier, still } = useMotion();
  const flat = still || tier === 'C';
  const leans = tier === 'A' && !flat;
  const x = useSharedValue(0);
  const lean = useSharedValue(0); // degrees; the photos' extra shift is lean × leanVx / leanDeg / parallaxVx
  const last = useSharedValue({ x: 0, at: 0 });
  const step = cardWidth + gap;
  const dragging = useSharedValue(0);
  const ref = useAnimatedRef<Animated.ScrollView>();

  const settleLean = () => {
    'worklet';
    if (lean.get() !== 0) lean.set(withSpring(0, spring.lean));
  };

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const nx = e.contentOffset.x;
      x.set(nx);
      if (!leans) return;
      const now = Date.now();
      const l = last.get();
      const dt = now - l.at;
      last.set({ x: nx, at: now });
      if (dt <= 0 || dt > 100) return;
      const vx = ((nx - l.x) / dt) * 1000; // px/s, > 0 while the cards move left
      const deg = Math.max(-leanDeg, Math.min(leanDeg, (-vx / leanVx) * leanDeg));
      // a near-still event (the web's late scroll after it ended) settles instead of leaving a residue
      if (Math.abs(deg) < leanDeg / 12) { settleLean(); return; }
      // follow the speed on this very frame (half way from the lean shown, to smooth the per-event speed), then hold
      // and spring back unless another event comes first: an animation restarted on every event would never move
      const cur = lean.get();
      lean.set(cur + (deg - cur) / 2);
      lean.set(withDelay(leanIdleMs, withSpring(0, spring.lean)));
    },
    onMomentumEnd: () => { settleLean(); },
    onEndDrag: (e) => { if (Math.abs(e.velocity?.x ?? 0) < 0.01) settleLean(); },
  });

  // the web has no momentum events: the browser's own scrollend ends the lean
  useEffect(() => {
    if (!WEB || !leans) return;
    const el = (ref as unknown as () => unknown)() as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    const end = () => { scheduleOnUI(settleLean); };
    el.addEventListener('scrollend', end);
    return () => el.removeEventListener('scrollend', end);
    // set up once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leans]);

  // a selection haptic when a user's drag comes to rest on another card
  const snapped = useRef(0);
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (dragging.get() !== 1) return;
    dragging.set(0);
    const i = Math.round(e.nativeEvent.contentOffset.x / step);
    if (i !== snapped.current) {
      snapped.current = i;
      haptics.select();
      onSnap?.(i);
    }
  };

  return <NoSwipeZone>
    <Animated.ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={step}
      decelerationRate="fast"
      disableIntervalMomentum
      contentContainerStyle={[{ paddingHorizontal: gutter, gap }, WEB ? styles.room : null]}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onScrollBeginDrag={() => dragging.set(1)}
      onMomentumScrollEnd={settle}
      accessibilityLabel={accessibilityLabel}
      style={[WEB ? styles.web : styles.native, style]}
    >
      {data.map((item, i) => <ShelfCard key={keyExtractor(item, i)} x={x} lean={lean} index={i} width={cardWidth} height={cardHeight} tier={tier} flat={flat}>
        {renderItem(item, i)}
      </ShelfCard>)}
    </Animated.ScrollView>
  </NoSwipeZone>;
}

/** A card's photo layer: drawn at 1.12 and moving −12·p pt with the shelf (tier A), plus the momentum lean's extra
 *  shift; a plain fill elsewhere. Put the photo inside, filling it; the card clips it (overflow hidden on the card). */
export function ShelfPhoto({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const ctx = useContext(CardContext);
  const zero = useSharedValue(0);
  const x = ctx?.x ?? zero;
  const lean = ctx?.lean ?? zero;
  const index = ctx?.index ?? 0;
  const step = ctx?.step ?? cardW + gap;
  const on = !!ctx && !ctx.flat && ctx.tier === 'A';
  const animated = useAnimatedStyle(() => {
    if (!on) return { transform: [] };
    const p = Math.max(-1, Math.min(3, (index * step - x.get()) / step));
    // lean° = −vx / leanVx × leanDeg, so −vx / parallaxVx = lean° × leanVx / (leanDeg × parallaxVx)
    const extra = (lean.get() * leanVx) / (leanDeg * parallaxVx);
    return { transform: [{ translateX: -12 * p + extra }, { scale: 1.12 }] };
  });
  return <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]} pointerEvents="none">
    <Animated.View style={[StyleSheet.absoluteFill, animated]}>{children}</Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  native: { overflow: 'visible' },
  // the web: a real horizontal scroller with CSS snap at the gutter, 12 pt of room inside above and below
  web: { overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory', scrollPaddingLeft: gutter, marginVertical: -ROOM } as unknown as ViewStyle,
  room: { paddingVertical: ROOM },
  snap: { scrollSnapAlign: 'start' } as unknown as ViewStyle,
});
