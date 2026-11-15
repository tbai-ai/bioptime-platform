/* Sub-tabs that scroll sideways (Profile sections, Life sections): the neutral segmented look (white/5 track, white/10
   pill that glides, 12/500 labels, px 14), and the chosen tab scrolled into view. At an end where more tabs hide, the
   row dissolves into the black canvas over 44 pt (clear at the fade's inner side, easing in to opaque over the outer
   18 pt) under a chevron at the edge (the floating tab pill's cue, standing still): a member sees there is more
   to scroll to (UX-06: Profile's Settings sat wholly past the right edge at 390 pt behind a bare 24 pt fade). The cue
   is decoration: hidden from screen readers, and a tap goes through it to the tab under it. It reaches 1 pt past the
   row's edge, so no sliver of a tab shows beside it where the scroller's clip rounds the other way.
   The row is a scroller, so the pill moves on the press itself (onPress: a release that was not a scroll), never on
   press-in; it glides on the critically damped segment spring and each label's colour follows it.
   Each tab answers the finger on touch-down with the tile press (scale .96, PRESS.tile), springing back on release or
   when a scroll takes the touch; the pill itself still moves only on the press (M17).
   The row owns its gesture zone (a sideways drag scrolls the row, never the tab pager), starts at the chosen tab without
   a sideways scroll and animates only a real change. Each tab keeps its 32 pt visual and reaches 44 pt (48 dp on
   Android) to touch: the row's scroller is that much taller inside a matching negative margin (a scroll view takes no
   touch outside its bounds), and the tabs reach into it (hitSlop on native, padding with a negative margin on the web).
   SwitchView is the content under them: the old panel stays (absolute, behind, inert from its first exit frame) and
   leaves the other way in 160 ms (ease.exit) while the new one enters from ±20 in the direction of the change (300 ms expo, from
   40 ms in). Native animates the height; the web holds the old height until the old panel has faded, then snaps (the
   web's layout transition scales every child). Tier C: opacity only, 200 ms; reduced motion: a 150 ms crossfade. */
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { LinearTransition, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fx } from '@/theme';
import { haptics } from './device/haptics';
import { ease, motionValues, t, timing, useFx } from './effects';
import { Icon } from './Icon';
import { calmFade } from './motion/tokens';
import { doneOnce } from './motion/once';
import { NoSwipeZone } from './nav/Pager';
import { PRESS_PROPS, touchSlopY, usePress } from './press';
import { GlideLabel, usableFrame, useGlide, type Frame } from './Segmented';
import { withAlpha } from './StatusPill';

export type PillTab<V extends string> = { value: V; label: string };

/** The row's last scroll offset per set of tabs: a remount (a revisit, a detached page coming back) starts there. */
const lastOffset = new Map<string, number>();

export function PillTabs<V extends string>({ items, value, onChange, style }: { items: PillTab<V>[]; value: V; onChange: (v: V) => void; style?: StyleProp<ViewStyle> }) {
  const { calm } = useFx();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const memoKey = items.map((i) => i.value).join('|');
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const [box, setBox] = useState(() => ({ w: 0, content: 0, x: lastOffset.get(memoKey) ?? 0 }));
  const { x, w, ready, aimed, glide } = useGlide();
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const scrolledFor = useRef<string | null>(null);
  const f = frames[value];
  // the web has no contentOffset prop: put the row back where it was before the first paint
  useLayoutEffect(() => {
    const at = lastOffset.get(memoKey);
    if (Platform.OS === 'web' && at) scroll.current?.scrollTo({ x: at, animated: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the pill: placed the first time, glided on a change from outside (a press has already started it)
  useEffect(() => {
    if (!f) return;
    const a = aimed.current;
    if (a && Math.abs(a.x - f.x) < 0.5 && Math.abs(a.w - f.w) < 0.5) return;
    glide(f, !!a);
  }, [f?.x, f?.w]); // eslint-disable-line react-hooks/exhaustive-deps
  // the row: the chosen tab in view, without animation the first time, animated only when the choice changes
  useEffect(() => {
    if (!f || box.w <= 0) return;
    const to = Math.max(0, f.x - (box.w - f.w) / 2);
    const first = scrolledFor.current === null;
    if (!first && scrolledFor.current === value) return;
    scrolledFor.current = value;
    if (first && Math.abs(to - box.x) < 1) return;
    scroll.current?.scrollTo({ x: to, animated: !first && !calm });
  }, [f?.x, f?.w, box.w, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const pill = useAnimatedStyle(() => ({ opacity: ready.value, width: w.value, transform: [{ translateX: x.value }] }));
  const onItem = (v: string) => (e: LayoutChangeEvent) => {
    const fr = usableFrame(e);
    if (!fr) return;
    setFrames((p) => (p[v]?.x === fr.x && p[v]?.w === fr.w ? p : { ...p, [v]: fr }));
  };
  // the offset as the row can hold it now: a row that no longer overflows (a wider window, a smaller text size) is put
  // back at its start by the scroller without a scroll event, so a remembered offset would keep a cue over the first
  // tab with nothing to scroll to (TAB-05)
  const sx = Math.min(box.x, Math.max(0, box.content - box.w));
  const showLeft = sx > 4;
  const showRight = box.content - sx - box.w > 4;
  return <View style={style} onLayout={(e) => { const lw = e.nativeEvent.layout.width; if (lw > 0) setBox((b) => (b.w === lw ? b : { ...b, w: lw })); }}>
    <NoSwipeZone>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: lastOffset.get(memoKey) ?? 0, y: 0 }}
        onContentSizeChange={(cw) => { if (cw > 0) setBox((b) => (b.content === cw ? b : { ...b, content: cw })); }}
        onScroll={(e) => { const sx = e.nativeEvent.contentOffset.x; lastOffset.set(memoKey, sx); setBox((b) => (Math.abs(b.x - sx) < 2 ? b : { ...b, x: sx })); }}
        scrollEventThrottle={32}
        style={TAB_TOUCH.scroller}
        contentContainerStyle={[styles.content, TAB_TOUCH.content]}>
        <View accessibilityRole="tablist" style={styles.track}>
          <Animated.View pointerEvents="none" style={[styles.pill, pill]} />
          {items.map((it) => {
            const on = it.value === value;
            return <PillTabItem key={it.value} label={it.label} on={on} onLayout={onItem(it.value)}
              onPress={() => {
                const fr = framesRef.current[it.value];
                if (fr) glide(fr);
                if (!on) { haptics.select(); onChange(it.value); }
              }}>
              <GlideLabel v="chip" frame={frames[it.value]} x={x} w={w} on={on} idle={fx.ink.a70} active={fx.ink.white}>{it.label}</GlideLabel>
            </PillTabItem>;
          })}
        </View>
      </ScrollView>
    </NoSwipeZone>
    {showLeft ? <EdgeCue side="left" /> : null}
    {showRight ? <EdgeCue side="right" /> : null}
  </View>;
}

/** The cue's fade, from its inner side (clear) to the row's edge (the black canvas): it eases in, so no edge of it shows
 *  on the canvas or on the pinned glass, and it is opaque over its outer 40 % (18 pt), where the chevron sits, so no
 *  label shows beside the chevron. */
const CUE_AT = [0, 0.2, 0.4, 0.52, 0.6, 1] as const;
const CUE_COLOURS = [0, 0.15, 0.5, 0.85, 1, 1].map((a) => withAlpha(fx.bg.deep, a)) as unknown as readonly [string, string, ...string[]];

/** The cue at an end where tabs hide: the fade above and the chevron (13 pt, white/55, stroke 2.5, as the floating tab
 *  pill draws it) in its outer 19 pt. Decoration only. Exported for the other sideways strips of tabs (the exercise
 *  guide's colour tabs, CRT-N8); `style` places it on a strip of another height. */
export function EdgeCue({ side, style }: { side: 'left' | 'right'; style?: StyleProp<ViewStyle> }) {
  const left = side === 'left';
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
    style={[styles.cue, left ? styles.cueLeft : styles.cueRight, style]}>
    <LinearGradient pointerEvents="none" colors={CUE_COLOURS} locations={CUE_AT} start={{ x: left ? 1 : 0, y: 0 }} end={{ x: left ? 0 : 1, y: 0 }} style={StyleSheet.absoluteFill} />
    <View style={styles.cueIcon}><Icon name={left ? 'chevron-left' : 'chevron-right'} size={13} color={fx.ink.a55} stroke={2.5} /></View>
  </View>;
}

/** One sub-tab: a tab that dips on touch-down (the tile rung of the press ladder) and springs back on release. */
function PillTabItem({ label, on, onLayout, onPress, children }: { label: string; on: boolean; onLayout: (e: LayoutChangeEvent) => void; onPress: () => void; children: React.ReactNode }) {
  const press = usePress('tile');
  return <Pressable {...PRESS_PROPS} onLayout={onLayout} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }} aria-selected={on}
    onPressIn={press.onPressIn} onPressOut={press.onPressOut} onPress={onPress} hitSlop={TAB_TOUCH.slop} style={[styles.item, TAB_TOUCH.web]}>
    <Animated.View style={press.style}>{children}</Animated.View>
  </Pressable>;
}

type Layer = { uid: number; id: string; dir: 1 | -1; node: React.ReactNode; leaving: boolean; enter: boolean };
type Mode = 'full' | 'c' | 'calm';

/** The panel under a set of tabs: keyed by `id`, entering from the side of `direction` (+1: from the right). */
export function SwitchView({ id, direction, children, style }: { id: string; direction: 1 | -1; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { calm, tier } = useFx();
  const mode: Mode = calm ? 'calm' : tier === 'C' ? 'c' : 'full';
  const seq = useRef(0);
  const [state, setState] = useState<{ id: string; layers: Layer[] }>(() => ({ id, layers: [{ uid: 0, id, dir: direction, node: null, leaving: false, enter: false }] }));
  // the web: the old panel's height, held until it has faded (then the height snaps under the faded exit)
  const [hold, setHold] = useState(0);
  const height = useRef(0);
  const shown = useRef<React.ReactNode>(children);
  let layers = state.layers;
  if (state.id !== id) {
    // derived during render: the current panel leaves with what it last showed, the new one enters
    seq.current += 1;
    layers = [...state.layers.map((l) => (l.leaving ? l : { ...l, leaving: true, dir: direction, node: shown.current })),
      { uid: seq.current, id, dir: direction, node: null, leaving: false, enter: true }];
    setState({ id, layers });
    if (Platform.OS === 'web' && height.current > 0) setHold(height.current);
  }
  // what the current panel showed at the last commit: the content it leaves with when the id changes
  useLayoutEffect(() => { shown.current = children; });
  useEffect(() => { if (hold > 0 && !layers.some((l) => l.leaving)) setHold(0); }, [hold, layers]);
  const gone = (uid: number) => setState((s) => ({ ...s, layers: s.layers.filter((l) => l.uid !== uid) }));
  const faded = () => setHold(0);
  // native animates the wrapper's height (300 ms expo); the web takes no layout transition (it scales every child)
  const layout = Platform.OS === 'web' || mode === 'calm' ? undefined : LinearTransition.duration(t.base).easing(ease.expo);
  return <Animated.View testID="fx-switch-view" layout={layout} style={[style, hold > 0 ? { minHeight: hold } : null]}>
    {layers.map((l) => <Panel key={l.uid} mode={mode} dir={l.dir} enter={l.enter} leaving={l.leaving}
      onGone={() => gone(l.uid)} onFaded={faded}
      onHeight={l.leaving ? undefined : (h) => { height.current = h; }}>
      {l.leaving ? l.node : children}
    </Panel>)}
  </Animated.View>;
}

function Panel({ mode, dir, enter, leaving, onGone, onFaded, onHeight, children }: {
  mode: Mode; dir: 1 | -1; enter: boolean; leaving: boolean; onGone: () => void; onFaded: () => void; onHeight?: (h: number) => void; children: React.ReactNode;
}) {
  const sv = motionValues.switchView;
  const x = useSharedValue(enter && mode === 'full' ? sv.enterX * dir : 0);
  const o = useSharedValue(enter ? 0 : 1);
  const out = useSharedValue(0);
  useEffect(() => {
    if (!enter) return;
    if (mode === 'calm') { o.value = withTiming(1, calmFade()); return; }
    const ms = mode === 'c' ? sv.cMs : sv.enterMs;
    o.value = withDelay(sv.enterAt, withTiming(1, timing(ms)));
    if (mode === 'full') x.value = withDelay(sv.enterAt, withTiming(0, timing(ms)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!leaving) return;
    out.value = 1;
    const ms = mode === 'calm' ? t.calm : mode === 'c' ? sv.cMs : t.swapOut;
    const end = doneOnce(onGone, ms + motionValues.overlay.fallbackExtra);
    const done = end.done;
    const finish = (finished?: boolean) => { 'worklet'; if (finished) scheduleOnRN(done); };
    // tap-started travel leaves on ease.exit (the expo curve had the old panel nearly gone in one frame, so the two
    // overlapped for only a couple of frames)
    o.value = withTiming(0, mode === 'calm' ? calmFade() : timing(ms, ease.exit), finish);
    if (mode === 'full') x.value = withTiming(-sv.exitX * dir, timing(ms, ease.exit));
    return () => end.cancel();
  }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps
  // the web's height snap: in the frame the old panel's opacity reaches .2
  useAnimatedReaction(() => out.value === 1 && o.value <= 0.2, (now, was) => { if (now && !was) scheduleOnRN(onFaded); });
  const a = useAnimatedStyle(() => (x.value === 0 ? { opacity: o.value, transform: [] } : { opacity: o.value, transform: [{ translateX: x.value }] }));
  const onLayout = onHeight ? (e: LayoutChangeEvent) => { const h = e.nativeEvent.layout.height; if (h > 0) onHeight(h); } : undefined;
  // the old panel is inert from its first exit frame: no touches, hidden from assistive technology
  return <Animated.View onLayout={onLayout} style={[leaving ? styles.leaving : null, a]}
    pointerEvents={leaving ? 'none' : 'auto'}
    accessibilityElementsHidden={leaving}
    importantForAccessibility={leaving ? 'no-hide-descendants' : 'auto'}
    aria-hidden={leaving || undefined}>
    {children}
  </Animated.View>;
}

/** A tab's touch reach (press touchSlopY on its 32 pt minimum), and the scroller's room for it. */
const TAB_K = touchSlopY(32);
const TAB_TOUCH = {
  scroller: TAB_K ? { marginVertical: -TAB_K } : null,
  content: TAB_K ? { paddingVertical: TAB_K } : null,
  slop: Platform.OS === 'web' || !TAB_K ? undefined : { top: TAB_K, bottom: TAB_K },
  web: Platform.OS === 'web' && TAB_K ? { paddingVertical: 8 + TAB_K, marginVertical: -TAB_K, minHeight: 32 + 2 * TAB_K } : null,
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: 0 },
  track: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a05 },
  pill: { position: 'absolute', top: 4, bottom: 4, left: -1, borderRadius: fx.radius.pill, backgroundColor: fx.fill.a10 },
  item: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: fx.radius.pill, minHeight: 32, justifyContent: 'center' },
  // the end cue: 43 pt inside the row plus the 1 pt it reaches past the edge (at 443 dpi a cue at the edge itself rounded
  // 1 px short of the scroller's clip); the chevron centred in its outer 19 pt
  cue: { position: 'absolute', top: 0, bottom: 0, width: 44, justifyContent: 'center' },
  cueLeft: { left: -1, alignItems: 'flex-start' },
  cueRight: { right: -1, alignItems: 'flex-end' },
  cueIcon: { width: 19, alignItems: 'center' },
  leaving: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 0 },
});
