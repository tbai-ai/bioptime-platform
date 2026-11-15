/* The Exercise Guide (the earlier app's player, shots 36–41): "EXERCISE GUIDE" between two hairlines, then colour
   tabs, each in its own colour (Purpose red, Muscles gold, Form blue, Safety amber, Recs green), and one panel
   (`{c}0C` fill, `{c}25` border, radius 16, padding 16) that crossfades in with a 6 pt rise when the tab changes.
   Muscle chips pop in from .85 one after another; form cues and safety notes slide in from the left. Built only from
   what Bioptime holds for the exercise (the session keeps its own frozen copy of the library text): a tab with nothing
   behind it is not shown. Recs is the coach's prescription, so the library screen has no Recs.
   Motion v2 (M76), the earlier app's guide timings: the new panel rises 6 pt as it fades in over 180 ms expo while the
   old one fades over 100 ms in its place (absolute, inert); muscle chips grow from .85 with their opacity over 160 ms,
   40 ms apart, without a rise; cues slide in from 8 pt to the left over 180 ms, 60 ms apart. Tier C: opacity only;
   reduced motion: at rest. */
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { ColorTab, EdgeCue, Icon, NoSwipeZone, T, TitledDivider, ease, fx, motionValues, t, timing, useMotion, withAlpha, type IconName } from '@/fx';
import { colorTabLabel } from '@/fx/Chip';
import { usePageActive } from '@/fx/nav/pageReady';
import { Swap } from '../motion';
import { cap, lines } from '../shared';

const M = motionValues.screens.m76;
/** Staggered pieces start at most this many steps apart (the motion language's four). */
const MAX_STEPS = motionValues.reveal.A.maxSteps;

export type GuideTab = 'purpose' | 'muscles' | 'form' | 'safety' | 'recs';

export type GuideContent = {
  description?: string | null;
  equipment?: string[] | null;
  muscleGroups?: string[] | null;
  instructions?: string | null;
  safetyNotes?: string | null;
  /** The coach's prescription lines (sets and reps, rest, load, note); absent in the library. */
  recs?: string[] | null;
};

const TABS: Record<GuideTab, { label: string; icon: IconName; heading: string; color: string }> = {
  purpose: { label: 'Purpose', icon: 'target', heading: 'Why this exercise', color: fx.map.guide.purpose },
  muscles: { label: 'Muscles', icon: 'users', heading: 'Target muscles', color: fx.map.guide.muscles },
  form: { label: 'Form', icon: 'list-checks', heading: 'Form cues', color: fx.map.guide.form },
  safety: { label: 'Safety', icon: 'shield', heading: 'Safety notes', color: fx.map.guide.safety },
  recs: { label: 'Recs', icon: 'timer', heading: 'Sets and rest', color: fx.map.guide.recs },
};

/** The tabs with something behind them, in order. */
function tabsOf(content: GuideContent): GuideTab[] {
  const out: GuideTab[] = [];
  if (content.description?.trim() || content.equipment?.length) out.push('purpose');
  if (content.muscleGroups?.length) out.push('muscles');
  if (lines(content.instructions).length) out.push('form');
  if (lines(content.safetyNotes).length) out.push('safety');
  if (content.recs?.length) out.push('recs');
  return out;
}

export const ExerciseGuide = memo(function ExerciseGuide({ content, resetKey }: { content: GuideContent; resetKey?: string }) {
  const available = useMemo(() => tabsOf(content), [content]);
  const [tab, setTab] = useState<GuideTab | null>(available[0] ?? null);
  // a new exercise opens on its first tab
  useEffect(() => { setTab(available[0] ?? null); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = tab && available.includes(tab) ? tab : available[0] ?? null;
  // the chosen tab scrolls into view (the strip is wider than a phone)
  const strip = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const frames = useRef<Record<string, { x: number; w: number }>>({});
  const [stripW, setStripW] = useState(0);
  // the strip's ends: a cue where tabs hide past an edge (CRT-N8: 'SAFET' was cut with nothing to say it scrolls), as
  // the kit's sideways tabs draw it (PillTabs' EdgeCue), from the strip's content width and its scroll
  const [edge, setEdge] = useState({ content: 0, x: 0 });
  const edgeX = Math.min(edge.x, Math.max(0, edge.content - stripW));
  useEffect(() => {
    const f = current ? frames.current[current] : null;
    if (!f || !stripW) return;
    strip.current?.scrollTo({ x: Math.max(0, f.x + f.w / 2 - stripW / 2), animated: true });
  }, [current, stripW]);
  if (!current) return null;
  const look = TABS[current];

  return <View style={styles.wrap}>
    <TitledDivider text="Exercise guide" strong />
    <NoSwipeZone>
      <View>
        <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" contentContainerStyle={styles.tabs} onLayout={(e) => setStripW(e.nativeEvent.layout.width)}
          onContentSizeChange={(cw) => setEdge((o) => (o.content === cw ? o : { ...o, content: cw }))}
          onScroll={(e) => { const x = e.nativeEvent.contentOffset.x; setEdge((o) => (Math.abs(o.x - x) < 2 ? o : { ...o, x })); }} scrollEventThrottle={32}>
          {available.map((k) => <View key={k} onLayout={(e) => { frames.current[k] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; }}>
            <ColorTab label={TABS[k].label} icon={TABS[k].icon} color={TABS[k].color} selected={k === current} onPress={() => setTab(k)} />
          </View>)}
        </ScrollView>
        {stripW > 0 && edgeX > 4 ? <EdgeCue side="left" /> : null}
        {stripW > 0 && edge.content - edgeX - stripW > 4 ? <EdgeCue side="right" /> : null}
      </View>
    </NoSwipeZone>
    <Swap id={`${resetKey}-${current}`} axis="y" timing={PANEL}>
      <View accessibilityRole="summary" style={[styles.panel, { backgroundColor: withAlpha(look.color, 0.047), borderColor: withAlpha(look.color, 0.145) }]}>
        <View style={styles.head}>
          <Icon name={look.icon} size={16} color={look.color} />
          <T v="eyebrowBrand" color={look.color} style={styles.headText}>{look.heading}</T>
        </View>
        {current === 'purpose' ? <Purpose content={content} color={look.color} /> : null}
        {current === 'muscles' ? <Muscles list={content.muscleGroups ?? []} color={look.color} /> : null}
        {current === 'form' ? <Numbered list={lines(content.instructions)} color={look.color} /> : null}
        {current === 'safety' ? <Chevrons list={lines(content.safetyNotes)} color={look.color} /> : null}
        {current === 'recs' ? <View style={styles.gap8}>{(content.recs ?? []).map((r, i) => <T key={i} v="body" color={fx.ink.a80}>{r}</T>)}</View> : null}
      </View>
    </Swap>
  </View>;
});

/** The guide's frame for the player's first frames (M69 fix round): the same layout drawn with plain views (the
 *  divider, the tabs' outlines, icons and words, the first tab's panel with its icon and words), so the guide replaces
 *  it in place once the photo has landed with nothing changing (CRT-3: the icons popped in at the swap); what enters in
 *  the guide (muscle chips, cues) is left to it. Not touchable, not announced. */
export const ExerciseGuideFrame = memo(function ExerciseGuideFrame({ content }: { content: GuideContent }) {
  const available = useMemo(() => tabsOf(content), [content]);
  // the strip's right-end cue where its tabs run past it, as the guide draws it (CRT-N8: nothing changes at the swap)
  const [row, setRow] = useState({ w: 0, right: 0 });
  const first = available[0];
  if (!first) return null;
  const look = TABS[first];
  const last = available[available.length - 1];
  return <View style={styles.wrap} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
    <TitledDivider text="Exercise guide" strong />
    <View>
    <View style={[styles.tabs, styles.tabsFrame]} onLayout={(e) => { const w = e.nativeEvent.layout.width; setRow((o) => (o.w === w ? o : { ...o, w })); }}>
      {available.map((k) => {
        const on = k === first;
        const c = TABS[k].color;
        return <View key={k} onLayout={k === last ? (e) => { const r = e.nativeEvent.layout.x + e.nativeEvent.layout.width + FRAME_PAD; setRow((o) => (o.right === r ? o : { ...o, right: r })); } : undefined}
          style={[styles.tabFrame, on ? { backgroundColor: withAlpha(c, 0.094), borderColor: withAlpha(c, 0.314) } : null]}>
          {/* the kit's MixIcon at rest: the idle glyph, and the selected tab's own colour drawn over it */}
          <View style={styles.icon12}>
            <Icon name={TABS[k].icon} size={12} color={fx.ink.a60} />
            {on ? <View style={StyleSheet.absoluteFill}><Icon name={TABS[k].icon} size={12} color={c} /></View> : null}
          </View>
          {/* the live tab's idle colour (the kit's ColorTab), so the frame gives way to the guide without a change */}
          <T v="micro" color={on ? c : fx.ink.a60} numberOfLines={1} ellipsizeMode="clip" style={styles.tabText}>{colorTabLabel(TABS[k].label)}</T>
        </View>;
      })}
    </View>
    {row.w > 0 && row.right - row.w > 4 ? <EdgeCue side="right" /> : null}
    </View>
    <View style={[styles.panel, { backgroundColor: withAlpha(look.color, 0.047), borderColor: withAlpha(look.color, 0.145) }]}>
      <View style={styles.head}>
        <Icon name={look.icon} size={16} color={look.color} />
        <T v="eyebrowBrand" color={look.color} style={styles.headText}>{look.heading}</T>
      </View>
      {first === 'purpose' ? <Purpose content={content} color={look.color} /> : null}
      {first === 'recs' ? <View style={styles.gap8}>{(content.recs ?? []).map((r, i) => <T key={i} v="body" color={fx.ink.a80}>{r}</T>)}</View> : null}
    </View>
  </View>;
});

/** The panel swap: out over S.m76.panelOutMs in place, in rising S.m76.guideY over S.m76.guideMs. */
const PANEL = { outD: 0, outMs: M.panelOutMs, inD: M.guideY, inMs: M.guideMs };

/** A piece of a panel entering after `delay`: 'scale' grows from S.m76.chipFrom (no rise), 'left' slides in from
 *  S.m76.cueX. It starts on the page-active edge; tier C fades only; reduced motion draws it at rest. */
function Enter({ from, delay, ms, children, style }: { from: 'scale' | 'left'; delay: number; ms: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { tier, still } = useMotion();
  const active = usePageActive();
  const p = useSharedValue(still ? 1 : 0);
  const armed = useSharedValue(still ? 1 : 0);
  const c = tier === 'C';
  useAnimatedReaction(() => (armed.get() === 0 && active.get() === 1 ? 1 : 0), (go) => {
    if (go !== 1 || armed.get() === 1) return;
    armed.set(1);
    const anim = withTiming(1, c ? timing(t.fast, ease.linear) : timing(ms));
    p.set(delay > 0 ? withDelay(delay, anim) : anim);
  });
  const k0 = M.chipFrom, dx = M.cueX;
  const a = useAnimatedStyle(() => {
    const v = p.get();
    if (v >= 1) return { opacity: 1, transform: [] };
    if (c) return { opacity: v, transform: [] };
    return from === 'scale'
      ? { opacity: v, transform: [{ scale: k0 + (1 - k0) * v }] }
      : { opacity: v, transform: [{ translateX: dx * (1 - v) }] };
  });
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

function Purpose({ content, color }: { content: GuideContent; color: string }) {
  return <View style={styles.gap12}>
    {content.description?.trim() ? <T v="body" color={fx.ink.a80} style={styles.para}>{content.description.trim()}</T> : null}
    {content.equipment?.length ? <View style={styles.gap8}>
      <T v="label" color={fx.ink.a50}>Equipment</T>
      <View style={styles.chips}>{content.equipment.map((e) => <View key={e} style={[styles.chip, { borderColor: withAlpha(color, 0.25) }]}><T v="chip" color={fx.ink.a80}>{cap(e)}</T></View>)}</View>
    </View> : null}
  </View>;
}

function Muscles({ list, color }: { list: string[]; color: string }) {
  return <View style={styles.chips}>
    {list.map((m, i) => <Enter key={m} from="scale" delay={Math.min(i, MAX_STEPS) * M.chipStep} ms={M.chipMs}>
      <View style={[styles.chip, { borderColor: withAlpha(color, 0.4), backgroundColor: withAlpha(color, 0.06) }]}><T v="chip" color={color}>{cap(m)}</T></View>
    </Enter>)}
  </View>;
}

function Numbered({ list, color }: { list: string[]; color: string }) {
  return <View style={styles.gap12}>
    {list.map((l, i) => <Enter key={i} from="left" delay={Math.min(i, MAX_STEPS) * M.cueStep} ms={M.cueMs}>
      <View style={styles.cue}>
        <View style={[styles.dot, { backgroundColor: withAlpha(color, 0.125) }]}><T v="mono10" color={color}>{String(i + 1)}</T></View>
        <T v="body" color={fx.ink.a80} style={styles.cueText}>{l}</T>
      </View>
    </Enter>)}
  </View>;
}

function Chevrons({ list, color }: { list: string[]; color: string }) {
  return <View style={styles.gap12}>
    {list.map((l, i) => <Enter key={i} from="left" delay={Math.min(i, MAX_STEPS) * M.cueStep} ms={M.cueMs}>
      <View style={styles.cue}>
        <View style={styles.chev}><Icon name="chevron-right" size={14} color={color} /></View>
        <T v="body" color={fx.ink.a80} style={styles.cueText}>{l}</T>
      </View>
    </Enter>)}
  </View>;
}

/** The strip's padding after its last tab. */
const FRAME_PAD = 4;

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  tabs: { gap: 8, paddingRight: FRAME_PAD },
  panel: { borderRadius: fx.radius.card, borderWidth: 1, padding: 16, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headText: { fontSize: 11, letterSpacing: 1.6 },
  para: { lineHeight: 24 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: fx.radius.pill, borderWidth: 1, minHeight: 28, justifyContent: 'center' },
  cue: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  chev: { width: 20, alignItems: 'center', paddingTop: 3 },
  cueText: { flex: 1 },
  // the frame's stand-ins for ColorTab (its layout) and the glyphs
  tabsFrame: { flexDirection: 'row', overflow: 'hidden' },
  tabFrame: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: fx.radius.xl, borderWidth: 1, minHeight: 32, backgroundColor: fx.fill.a04, borderColor: fx.line.a08 },
  tabText: { fontSize: 10, letterSpacing: 0.5, textTransform: 'none' }, // the ColorTab's own words (colorTabLabel, L-02)
  icon12: { width: 12, height: 12 },
});
