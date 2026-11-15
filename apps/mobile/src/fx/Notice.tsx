/* A notice (same props as the staff kit's, so the verbatim notices read the same): the earlier app's coach-note card, black/40
   glass with a 4 pt left rail in the kind's colour (info white/30, warning and sample amber, error red, success
   green), radius 16, padding 16, a 14/600 title and 13 pt body at white/70. An error is announced as an alert.
   It arrives on mount, never through a scroll reveal: the rail draws down from the top (260 ms) while the content
   fades in (200 ms), so it is readable within 200 ms wherever it sits. It follows the page-active rule: on a page
   nobody sees (pre-mounted, parked) it holds at its start and plays when the page comes in front. Reduced motion: a
   150 ms fade, no rail draw; the web's pre-rendered HTML: at rest. It blurs what is behind it only over a photograph
   (`overPhoto`). */
import { BlurView } from 'expo-blur';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { motionValues, timing, useFx } from './effects';
import { calmFade } from './motion/tokens';
import { usePageActive } from './nav/pageReady';
import { T } from './Text';
import { FONTS } from './type';

export type NoticeKind = 'info' | 'warning' | 'error' | 'success' | 'sample';

const RAIL: Record<NoticeKind, string> = { info: fx.ink.a30, warning: fx.status.caution, sample: fx.status.caution, error: fx.red.brand, success: fx.status.optimal };

export function Notice({ kind = 'info', title, children, style, overPhoto }: { kind?: NoticeKind; title?: string; children?: React.ReactNode; style?: StyleProp<ViewStyle>; overPhoto?: boolean }) {
  const { calm, inHtml, blur } = useFx();
  const still = calm || inHtml;
  const active = usePageActive();
  const rail = useSharedValue(still ? 1 : 0);
  const o = useSharedValue(inHtml ? 1 : 0);
  const started = useSharedValue(inHtml ? 1 : 0);
  const s = motionValues.states;
  // the entrance starts on the page-active edge (at once outside the pager, where the page is always active)
  useAnimatedReaction(() => active.value, (a) => {
    if (a !== 1 || started.value === 1) return;
    started.value = 1;
    if (calm) { o.value = withTiming(1, calmFade()); return; }
    o.value = withTiming(1, timing(s.fadeMs));
    rail.value = withTiming(1, timing(s.railMs));
  }, [calm]);
  const content = useAnimatedStyle(() => ({ opacity: o.value }));
  const railStyle = useAnimatedStyle(() => (rail.value === 1 ? { transform: [] } : { transform: [{ scaleY: rail.value }] }));
  const glass = !!overPhoto && blur;
  return <View accessibilityRole={kind === 'error' ? 'alert' : undefined} style={[styles.box, { backgroundColor: glass ? fx.glass.note : fx.bg.panelSolid }, style]}>
    {glass ? <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} /> : null}
    <Animated.View pointerEvents="none" style={[styles.rail, { backgroundColor: RAIL[kind] }, railStyle]} />
    <View pointerEvents="none" style={styles.edge} />
    <Animated.View style={[styles.content, content]}>
      {title ? <T v="sectionStrong">{title}</T> : null}
      {typeof children === 'string' ? <T v="body" style={styles.body}>{children}</T> : children}
    </Animated.View>
  </View>;
}

/** Body text inside a Notice built from parts (a sentence with a link). */
export function NoticeText({ children }: { children: React.ReactNode }) {
  return <T v="body" style={styles.body}>{children}</T>;
}

const styles = StyleSheet.create({
  // the box clips the rail to its rounded corners; its 1 pt hairline is drawn over the top, right and bottom edges
  box: { borderRadius: fx.radius.card, overflow: 'hidden' },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, transformOrigin: 'top' },
  edge: { ...StyleSheet.absoluteFill, borderRadius: fx.radius.card, borderWidth: 1, borderLeftWidth: 0, borderColor: fx.line.a05 },
  // 4 + 16 at the left (the rail and the padding), 1 + 16 elsewhere (the hairline and the padding), as before
  content: { paddingLeft: 20, paddingTop: 17, paddingRight: 17, paddingBottom: 17, gap: 4 },
  body: { fontFamily: FONTS.sans400, fontSize: 13, lineHeight: 19, color: fx.ink.a70 },
});
