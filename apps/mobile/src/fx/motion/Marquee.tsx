/* The Store marquee (THEME §12.3, PREMIUM §1.8): the real package names in one line, 10 pt bold capitals spaced .25em
   at white/20 with white/10 "·" separators between white/5 hairlines, sliding x 0 → −⅓ of three copies every 18 s,
   linear, for the motion budget (5 s after the Store comes into focus or the last touch: ./budget), then it rests where
   it is until the next touch. It pauses while the Store's page is not active (on the UI thread); it is still on tier C
   and under calm. Screen
   readers read the first copy only. */
import React, { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { fx } from '@/theme';
import { FONTS } from '@/fx/type';
import { t } from './tokens';
import { useLoopClock, useLoopGate } from './loop';
import { useMotionBudget } from './budget';
import { useMotion } from './tier';

function Row({ items, hidden, onLayout }: { items: readonly string[]; hidden?: boolean; onLayout?: (e: LayoutChangeEvent) => void }) {
  return <View style={styles.row} onLayout={onLayout} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
    {items.map((name, i) => <React.Fragment key={i}>
      <Text style={styles.name} maxFontSizeMultiplier={1.3}>{name}</Text>
      <Text style={styles.sep} maxFontSizeMultiplier={1.3}>·</Text>
    </React.Fragment>)}
  </View>;
}

export function Marquee({ items, style }: { items: readonly string[]; style?: StyleProp<ViewStyle> }) {
  const { tier, still } = useMotion();
  const { active, visible } = useLoopGate();
  const [width, setWidth] = useState(0);
  const run = useMotionBudget(!still && tier !== 'C' && visible && width > 0, undefined, active);
  const clock = useLoopClock(t.marquee, run, active, true);
  // at rest the band stays where the budget left it (a pause keeps its place)
  const moved = !still && tier !== 'C';
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: moved ? -clock.get() * width : 0 }] }));
  if (!items.length) return null;
  return <View style={[styles.band, style]}>
    <Animated.View style={[styles.track, slide]}>
      <Row items={items} onLayout={(e) => { const w = e.nativeEvent.layout.width; if (w > 0) setWidth(w); }} />
      <Row items={items} hidden />
      <Row items={items} hidden />
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  band: { overflow: 'hidden', borderTopWidth: 1, borderBottomWidth: 1, borderColor: fx.line.a05, paddingVertical: 12 },
  track: { flexDirection: 'row', alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { fontFamily: FONTS.sans700, fontSize: 10, lineHeight: 15, letterSpacing: 2.5, textTransform: 'uppercase', color: fx.ink.a20, paddingHorizontal: 12 },
  sep: { fontFamily: FONTS.sans700, fontSize: 10, lineHeight: 15, color: fx.line.a10 },
});
