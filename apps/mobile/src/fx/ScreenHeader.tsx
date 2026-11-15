/* The in-page header of a tab (THEME §11.2): pt = top inset + 12, px 24, pb 16; an optional eyebrow, the Bebas 30 title
   (a header), and a light 14 pt subtitle in white. `photo` puts a header photo behind it (Train: the slot at .20,
   scaled 1.1, the Train scrim and a red/5 wash; `band` for Bio, Life, Fuel and Tests: .22 under the band scrim), as
   tall as the header plus 40. It enters with opacity and a 10 pt rise (Store: from 20 pt to the left), and inside a
   TabScreen its big title collapses as the page scrolls (opacity 1 → 0, rising and shrinking to .94 over 56 pt; the
   compact bar that replaces it is the motion kit's CompactBar). `right` holds a header action (the Home mark ring, a
   bell).
   - The entrance starts on the page-active edge (src/fx/nav/pageReady): a pre-mounted neighbour's header waits at its
     start state, with nothing running, until its page is the one in front.
   - The Deck's depth (tier A): while the page moves, the title block lags it by 15 % of the page offset (at most a
     column's width), so it lands with the page.
   - While its page is active, a top toast starts below the header row (never over a header action). */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolate, Extrapolation, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fx } from '@/theme';
import { motionValues, t, timing, useFx } from './effects';
import { useTabScroll } from './FxScreen';
import { Scrim } from './Gradient';
import { COLUMN } from './layout';
import { Photo } from './media/Photo';
import { usePageActive, usePageMotion, usePageSettled } from './nav/pageReady';
import { Eyebrow, T } from './Text';
import { HEADER_BAND_MAX, useTopToastClearance } from './Toast';

/* The title layer's style at its two resting places, one object each for every run: Reanimated compares a style's
   values by identity, so a fresh transform on every scroll frame re-sent an unchanged header (a shadow-tree commit per
   frame on Android) while the page scrolled below the collapse or sat at its top. */
const HD = motionValues.header;
const HEADER_REST = { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }], transformOrigin: 'left' };
const HEADER_GONE = { opacity: 0, transform: [{ translateX: 0 }, { translateY: -HD.titleShift * HD.collapse }, { scale: HD.titleScale }], transformOrigin: 'left' };

export type HeaderPhoto = { slot: string; pick?: string | number; opacity?: number; look?: 'train' | 'band' };

export function ScreenHeader({ title, subtitle, eyebrow, eyebrowKind = 'store', right, photo, backdrop, from = 'up', inset = true, children, style }: {
  title: string; subtitle?: React.ReactNode; eyebrow?: string; eyebrowKind?: 'brand' | 'greeting' | 'store'; right?: React.ReactNode;
  photo?: HeaderPhoto; backdrop?: React.ReactNode; from?: 'up' | 'left'; inset?: boolean; children?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const { calm, inHtml, tier } = useFx();
  const still = calm || inHtml;
  const p = useSharedValue(still ? 1 : 0);
  // the 400 ms rise starts on the page-active edge (once)
  const active = usePageActive();
  const started = useSharedValue(still ? 1 : 0);
  useEffect(() => { if (still) { started.value = 1; p.value = 1; } }, [still, p, started]);
  useAnimatedReaction(() => active.value, (a, prev) => {
    if (still || started.value || a !== 1 || prev === 1) return;
    started.value = 1;
    p.value = withTiming(1, timing(t.flow));
  }, [still]);
  const scrollY = useTabScroll();
  const h = motionValues.header;
  // the title layer lags the page while it moves (tier A only; off under reduced motion)
  const deck = usePageMotion();
  const offset = deck?.offset;
  const lagW = tier === 'A' && !still && deck ? motionValues.pager.headerLag * Math.min(deck.width, COLUMN) : 0;
  const enter = useAnimatedStyle(() => {
    const y = scrollY ? scrollY.value : 0;
    const collapse = still ? 0 : interpolate(y, [0, h.collapse], [0, 1], Extrapolation.CLAMP);
    const d = offset && lagW ? offset.value : 0;
    const lag = Math.abs(d) < 1 ? -lagW * d : 0;
    const dx = (from === 'left' ? -20 * (1 - p.value) : 0) + lag;
    const dy = from === 'up' ? 10 * (1 - p.value) : 0;
    if (dx === 0 && dy === 0 && p.value === 1) {
      if (y <= 0) return HEADER_REST;
      if (!still && collapse === 1) return HEADER_GONE;
    }
    return {
      opacity: p.value * (1 - collapse),
      transform: [{ translateX: dx }, { translateY: dy - h.titleShift * Math.max(0, Math.min(y, h.collapse)) }, { scale: 1 - (1 - h.titleScale) * collapse }],
      transformOrigin: 'left',
    };
  });
  // a top toast starts below the header row while this page is the one in front (measured in window points; read
  // once the pages are at rest, so nothing re-renders during a switch)
  const row = useRef<React.ComponentRef<typeof View>>(null);
  const [bottom, setBottom] = useState(0);
  const inFront = usePageSettled();
  // only a header row at the top of the window counts (a sample header far down a scroll never moves the lane)
  const { height: winH, width: winW } = useWindowDimensions();
  // a header in the centred column of a wide screen draws its photo out to the window's edges, as the other tabs' hero
  // photos do (TAB-03: Bio, Longevity and Clinic ended in hard edges at the column with black beside them)
  const [ownW, setOwnW] = useState(0);
  const bleed = ownW > 0 && winW > COLUMN && Math.abs(ownW - COLUMN) < 1 ? (winW - COLUMN) / 2 : 0;
  useTopToastClearance(bottom, inFront && bottom > 0 && bottom <= winH * HEADER_BAND_MAX);
  const measureRow = () => { row.current?.measureInWindow((_x: number, wy: number, w: number, hh: number) => { if (w && hh) setBottom(Math.round(wy + hh)); }); };
  const top = (inset ? insets.top : 0) + 12;
  const look = photo?.look ?? 'train';
  return <View style={[styles.wrap, { paddingTop: top }, style]} onLayout={photo || backdrop ? (e) => { const w = Math.round(e.nativeEvent.layout.width); setOwnW((o) => (o === w ? o : w)); } : undefined}>
    {photo || backdrop ? <View pointerEvents="none" style={[styles.photo, { bottom: -40, left: -bleed, right: -bleed }]}>
      {backdrop ?? <>
        <Photo slot={photo!.slot} pick={photo!.pick} opacity={photo!.opacity ?? (look === 'train' ? 0.2 : 0.22)} style={[StyleSheet.absoluteFill, look === 'train' ? styles.zoom : null]} decorative />
        <Scrim kind={look === 'train' ? 'trainHeader' : 'headerBand'} style={StyleSheet.absoluteFill} />
        {look === 'train' ? <View style={[StyleSheet.absoluteFill, { backgroundColor: fx.premium.headerOverlay }]} /> : null}
      </>}
    </View> : null}
    <View ref={row} style={styles.row} onLayout={(e) => { const l = e.nativeEvent.layout; if (l.width && l.height) measureRow(); }}>
      <Animated.View style={[styles.text, enter]}>
        {eyebrow ? <Eyebrow kind={eyebrowKind} style={styles.eyebrow}>{eyebrow}</Eyebrow> : null}
        <T v="h1">{title}</T>
        {subtitle ? typeof subtitle === 'string' ? <T v="body" style={styles.sub}>{subtitle}</T> : subtitle : null}
      </Animated.View>
      {right}
    </View>
    {children}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: fx.space.titleX, paddingBottom: 16 },
  photo: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
  zoom: { top: '-5%', bottom: '-5%', left: '-5%', right: '-5%' }, // the earlier app's scale 1.1, as overscan (no transform at rest)
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  text: { flex: 1 },
  eyebrow: { marginBottom: 4 },
  sub: { marginTop: 4 },
});
