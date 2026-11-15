/* A dish from the library (the earlier app's dish card, 52-fuel-search / 58-fuel-saved): the 120 pt picture header, the
   name with its serving in italics on the right, its tags, the coloured mono macro line (kcal · P · C · F · Fib) with
   only the values someone entered, and a footer with the "Source" chip (where the values come from) and the heart that
   saves it. The earlier app's "Health Score" is not shown: nothing computes one. A tap opens the dish sheet.
   Motion (v2): the card tilts at tier A only (tiers B and C keep the .98 press), on the web; on native it is a list card
   drawn flat like every other row (RowTilt, fix r2: a card tilting in 3D had its rounded clip and shadows rasterised on
   the CPU on every frame, and at tier A each card followed the phone's tilt) and keeps the .98 press; the heart pops when it saves (1.22 in
   90 ms, back on the pop spring, with a red ring bursting out at tier A) and gives a small .9 → 1 when it unsaves.
   Reduced motion: colour only. */
import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { AnimatedPressable, GlassCard, Icon, T, ease, fx, haptics, spring, timing, useFx, usePress } from '@/fx';
import { RowTilt } from '@/screens/tests/RowTilt';
import { motionValues } from '@/fx/motion/tokens';
import { pressTransform } from '@/fx/press';

const S82 = motionValues.screens.m82;
const BURST = motionValues.screens.m81.burstStroke; // the ring's stroke (pt), shared with the confirmations' burst
import { DishThumb } from './DishThumb';
import { MACRO, anyValue, dishIcon, dishName, has, kcal, num, servingText, spokenValues } from './format';
import type { Dish, NutrientKey, Nutrients } from './types';

export function DishCard({ dish, saved, onOpen, onToggleSave, onSource }: {
  dish: Dish; saved: boolean; onOpen: () => void; onToggleSave: () => void; onSource: () => void;
}) {
  const name = dishName(dish);
  const tags = dish.tags.slice(0, 3).map(cap).join(' · ');
  const press = usePress('card');
  const { tier } = useFx();
  // the card body opens the dish; the footer's Source and heart are buttons of their own beside it (never inside it)
  const card = <GlassCard padding={0} clip borderColor={press.pressed ? fx.red.a30 : undefined}>
      <AnimatedPressable accessibilityRole="button" accessibilityLabel={`${name}. ${servingText(dish)}. ${spokenValues(dish.perServing)}`} accessibilityHint="Opens the dish to log it"
        onPress={onOpen} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={press.style}>
        <DishThumb seed={dish.id} imageUrl={dish.imageUrl} icon={dishIcon(dish)} radius={0} style={styles.image} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            {/* a line more for each beside the other at a large text size on a narrow phone ('with berr…', '200…') */}
            <T v="cardTitle" numberOfLines={4} style={styles.name}>{name}</T>
            <T v="caption" color={fx.ink.a60} style={styles.serving} numberOfLines={3}>{servingText(dish)}</T>
          </View>
          <T v="bodySm" color={fx.ink.a80} numberOfLines={1}>{tags ? `${dish.kind === 'recipe' ? 'Recipe' : 'Food'} · ${tags}` : dish.kind === 'recipe' ? 'Recipe' : 'Food'}</T>
          <MacroLine values={dish.perServing} style={styles.macros} />
        </View>
      </AnimatedPressable>
      <View style={styles.foot}>
        {dish.sources.length ? <SourceChip onPress={onSource} /> : <View />}
        <Heart saved={saved} name={name} onPress={onToggleSave} />
      </View>
    </GlassCard>;
  return tier === 'A' ? <RowTilt intensity={4} radius={fx.radius.card}>{card}</RowTilt> : card;
}

/** "198 kcal · P 11.2 g · C 28.4 g · F 4.8 g · Fib 7.1 g": entered values only; none at all says so. */
export function MacroLine({ values, style, size = 'mono11' }: { values: Partial<Nutrients> | null; style?: object; size?: 'mono12' | 'mono11' }) {
  if (!anyValue(values)) return <T v="caption" color={fx.ink.a50} style={style}>No nutrient values entered yet</T>;
  const parts: React.ReactNode[] = [];
  if (has(values!.kcal)) parts.push(<T key="kcal" v={size} color={MACRO.kcal.color}>{`${kcal(values!.kcal)} kcal`}</T>);
  for (const k of ['protein_g', 'carbs_g', 'fat_g', 'fibre_g'] as NutrientKey[]) {
    const v = values![k];
    if (!has(v)) continue;
    parts.push(<T key={k} v={size} color={fx.ink.white}>{`${MACRO[k].short} `}<T v={size} color={MACRO[k].color}>{`${num(v)} g`}</T></T>);
  }
  return <View style={[styles.line, style]} accessible={false} importantForAccessibility="no-hide-descendants">
    {parts.map((p, i) => <React.Fragment key={i}>{i ? <T v={size} color={fx.ink.a20}>·</T> : null}{p}</React.Fragment>)}
  </View>;
}

export function Heart({ saved, name, onPress, size = 20 }: { saved: boolean; name: string; onPress: () => void; size?: number }) {
  const press = usePress('icon');
  const { calm, tier } = useFx();
  const pop = useSharedValue(1);
  const ring = useSharedValue(0); // 0 hidden … 1 the burst played out
  const was = useRef(saved);
  useEffect(() => {
    if (was.current === saved) return;
    was.current = saved;
    if (calm) return; // colour only
    if (saved) {
      pop.value = withSequence(withTiming(S82.heartPeak, timing(S82.heartInMs, ease.expo)), withSpring(1, spring.pop));
      if (tier === 'A') { ring.value = 0; ring.value = withTiming(1, timing(S82.heartBurstMs, ease.expo)); }
    } else {
      pop.value = S82.unsaveFrom;
      pop.value = withTiming(1, timing(S82.unsaveMs, ease.expo));
    }
  }, [saved, calm, tier, pop, ring]);
  const { progress, to } = press;
  const glyph = useAnimatedStyle(() => ({ transform: [...pressTransform(progress.value, to, 0, calm), { scale: pop.value }] }));
  const burst = useAnimatedStyle(() => {
    const r = ring.value;
    if (r <= 0 || r >= 1) return { opacity: 0, transform: [{ scale: motionValues.screens.m81.burstFrom }] };
    return { opacity: S82.heartBurstOpacity * (1 - r), transform: [{ scale: motionValues.screens.m81.burstFrom + (S82.heartBurstTo - motionValues.screens.m81.burstFrom) * r }] };
  });
  return <AnimatedPressable
    accessibilityRole="togglebutton"
    accessibilityLabel={saved ? `Remove ${name} from saved` : `Save ${name}`}
    accessibilityState={{ checked: saved }}
    {...(Platform.OS === 'web' ? { 'aria-pressed': saved } as object : null)}
    onPress={() => { haptics.light(); onPress(); }}
    onPressIn={press.onPressIn}
    onPressOut={press.onPressOut}
    hitSlop={6}
    style={styles.heart}>
    <Animated.View pointerEvents="none" style={[styles.burst, { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2 }, burst]} />
    <Animated.View style={glyph}>
      <Icon name="heart" size={size} color={saved ? fx.red.vivid : fx.ink.white} fill={saved ? fx.red.vivid : undefined} />
    </Animated.View>
  </AnimatedPressable>;
}

/** The "Source" chip: a 28 pt pill to see, inside a 44 pt box to touch (the footer row is already 44 pt tall for the
 *  heart, so the larger box moves nothing). */
export function SourceChip({ onPress }: { onPress: () => void }) {
  const press = usePress('chip');
  return <AnimatedPressable accessibilityRole="button" accessibilityLabel="Source of these values" onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.sourceTouch, press.style]}>
    <View style={styles.source}>
      <Icon name="info" size={12} color={fx.ink.a70} />
      <T v="caption" color={fx.ink.a70}>Source</T>
    </View>
  </AnimatedPressable>;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const styles = StyleSheet.create({
  image: { height: 120, borderWidth: 0, borderTopLeftRadius: fx.radius.toast, borderTopRightRadius: fx.radius.toast },
  body: { paddingHorizontal: 16, paddingTop: 16, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  name: { flexShrink: 1 },
  serving: { fontStyle: 'italic', flexShrink: 0, maxWidth: '45%', textAlign: 'right' },
  macros: { marginTop: 6 },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  heart: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  burst: { position: 'absolute', borderWidth: BURST, borderColor: fx.red.brand },
  sourceTouch: { minHeight: 44, justifyContent: 'center' },
  source: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, minHeight: 28, borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a05 },
});
