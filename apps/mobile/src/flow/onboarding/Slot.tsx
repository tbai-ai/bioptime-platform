/* A slot that never changes height under a fixed control (motion v2 M54, A33): it is as tall as the tallest thing it
   may ever hold, measured from hidden copies (`sizers`) laid out at the slot's width and the current font scale (they
   lay out again when the font scale changes), and it crossfades what it shows over m54.swapMs. Reduced motion: the
   content changes in place. A size of 0 (a detached page) is ignored. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useMotion } from '@/fx/motion/tier';
import { doneOnce } from '@/fx/motion/once';
import { ease, motionValues, timing } from '@/fx/motion/tokens';

const MS = motionValues.screens.m54.swapMs;

export type SlotContent = { key: string; node: React.ReactNode } | null;

type State = { cur: SlotContent; prev: SlotContent; n: number };

/** `align`: where what it shows sits when it is shorter than the slot ('bottom': against a button below it). */
export function MeasuredSlot({ show, sizers, align = 'top', style }: { show: SlotContent; sizers: React.ReactNode[]; align?: 'top' | 'bottom'; style?: StyleProp<ViewStyle> }) {
  const { calm, inHtml } = useMotion();
  const still = calm || inHtml;
  const [heights, setHeights] = useState<Record<number, number>>({});
  const [s, setS] = useState<State>({ cur: show, prev: null, n: 0 });
  const curKey = s.cur?.key ?? null;
  if ((show?.key ?? null) !== curKey) setS({ cur: show, prev: still ? null : s.cur, n: s.n + 1 });
  else if (show && s.cur && show.node !== s.cur.node) setS({ ...s, cur: show }); // same content, new props
  const height = Object.values(heights).reduce((m, h) => Math.max(m, h), 0);
  const measure = useCallback((i: number) => (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h > 0) setHeights((m) => (m[i] === h ? m : { ...m, [i]: h }));
  }, []);
  const prevKey = s.prev?.key ?? null;
  const gone = useCallback(() => setS((x) => (x.prev && x.prev.key === prevKey ? { ...x, prev: null } : x)), [prevKey]);
  return <View style={[height ? { height } : null, style]}>
    <View style={styles.sizers} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      {sizers.map((node, i) => <View key={i} style={styles.sizer} onLayout={measure(i)}>{node}</View>)}
    </View>
    {s.prev ? <Layer key={'p' + s.prev.key} out onGone={gone} bottom={align === 'bottom'}>{s.prev.node}</Layer> : null}
    {s.cur ? <Layer key={'c' + s.cur.key} enter={s.n > 0 && !still} fill={height > 0} bottom={align === 'bottom'}>{s.cur.node}</Layer> : null}
  </View>;
}

function Layer({ children, out, enter, fill, bottom, onGone }: { children: React.ReactNode; out?: boolean; enter?: boolean; fill?: boolean; bottom?: boolean; onGone?: () => void }) {
  const o = useSharedValue(out || !enter ? 1 : 0);
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  useEffect(() => {
    if (out) {
      const once = doneOnce(() => goneRef.current?.(), MS + motionValues.overlay.fallbackExtra);
      const done = once.done;
      o.value = withTiming(0, timing(MS, ease.css), (f) => { 'worklet'; if (f) scheduleOnRN(done); });
      return () => once.cancel();
    }
    if (enter) o.value = withTiming(1, timing(MS, ease.css));
    return undefined;
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  const inert = out ? { pointerEvents: 'none' as const, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true } : null;
  return <Animated.View style={[out || fill ? (bottom ? styles.layerBottom : styles.layer) : null, a]} {...inert}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  sizers: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  sizer: { position: 'absolute', left: 0, right: 0, top: 0 },
  layer: { position: 'absolute', left: 0, right: 0, top: 0 },
  layerBottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
