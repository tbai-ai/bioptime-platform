/* One tab bar icon as one react-native-svg view (N01): the lucide glyph's own elements (src/fx/Icon iconNode) in a
   single Svg, under one animated group whose stroke colour (zinc-500 → Bioptime red) and stroke width (1.5 → 2.5)
   follow the tab's activation `on` (0 idle … 1 active) on the UI thread. The bar used to draw two lucide icons per
   tab (an idle and an active one, crossfaded): two SVG views and two bitmaps each. Decorative: the tab itself carries
   the name. On the web the colour rides the icon's CSS colour (the group strokes with currentColor), because an
   animated colour prop does not reach react-native-svg's web elements; the width stays an animated prop. */
import React, { useMemo } from 'react';
import { Platform, StyleSheet, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedProps, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import { fx } from '@/theme';
import { iconNode, type IconName } from '../Icon';

const AnimatedG = Animated.createAnimatedComponent(G);

const ELEMENTS: Record<string, React.ComponentType<Record<string, unknown>>> = {
  path: Path as unknown as React.ComponentType<Record<string, unknown>>,
  circle: Circle as unknown as React.ComponentType<Record<string, unknown>>,
  rect: Rect as unknown as React.ComponentType<Record<string, unknown>>,
  line: Line as unknown as React.ComponentType<Record<string, unknown>>,
  polyline: Polyline as unknown as React.ComponentType<Record<string, unknown>>,
  polygon: Polygon as unknown as React.ComponentType<Record<string, unknown>>,
  ellipse: Ellipse as unknown as React.ComponentType<Record<string, unknown>>,
};

const toProp = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** The glyph's elements with react-native-svg prop names (lucide's own `key` dropped). */
function glyph(name: IconName): Array<{ C: React.ComponentType<Record<string, unknown>>; props: Record<string, unknown> }> {
  const node = iconNode(name) ?? iconNode('circle') ?? [];
  const out: Array<{ C: React.ComponentType<Record<string, unknown>>; props: Record<string, unknown> }> = [];
  for (const [tag, attrs] of node) {
    const C = ELEMENTS[tag];
    if (!C) continue;
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attrs)) if (k !== 'key') props[toProp(k)] = v;
    out.push({ C, props });
  }
  return out;
}

const WEB = Platform.OS === 'web';
// plain strings for the UI-thread closures (never the whole theme object)
const IDLE = fx.ink.ink3;
const ACTIVE = fx.red.brand;
const A11Y = WEB
  ? ({ 'aria-hidden': true } as object)
  : ({ accessible: false, importantForAccessibility: 'no-hide-descendants' } as object);

export function TabIcon({ name, size, on }: { name: IconName; size: number; on: SharedValue<number> /* 0 idle … 1 active */ }): React.JSX.Element {
  const parts = useMemo(() => glyph(name), [name]);
  const stroke = useAnimatedProps((): { stroke?: string; strokeWidth: number } => (WEB ? { strokeWidth: 1.5 + on.value } : {
    stroke: interpolateColor(on.value, [0, 1], [IDLE, ACTIVE]),
    strokeWidth: 1.5 + on.value,
  }));
  const colour = useAnimatedStyle(() => ({ color: interpolateColor(on.value, [0, 1], [IDLE, ACTIVE]) }) as ViewStyle);
  const svg = <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...A11Y}>
    <AnimatedG animatedProps={stroke} stroke={WEB ? 'currentColor' : IDLE} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {parts.map(({ C, props }, i) => <C key={i} {...props} />)}
    </AnimatedG>
  </Svg>;
  return WEB ? <Animated.View pointerEvents="none" style={[styles.box, { width: size, height: size }, colour]}>{svg}</Animated.View> : svg;
}

const styles = StyleSheet.create({ box: { alignItems: 'center', justifyContent: 'center' } });
