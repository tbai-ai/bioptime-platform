/* The honest empty state (THEME §11.10): a centred column (py 64, gap 12) with a 56 pt white/5 tile holding a 24 pt
   icon at white/25, the title at white/60 (raised from the earlier app's white/40 for contrast) and a short line at white/50,
   at most 240 wide, then the next real action. `dashed`: the meals/saved variant, a dashed white/20 card with pill
   actions. `photo`: a calm photo band above it (PREMIUM §2.4, the `empty.*` slots, opacity .15, fading to black).
   It arrives when it is seen: through a Reveal (inside a scroll scope, when it crosses the reveal line; on a page
   nobody sees, when the page comes in front), the tile grows from .92 with a fade (320 ms expo), the title and the line
   rise 8 pt at 60 ms steps and the action comes last (at most three steps). Reduced motion and the pre-rendered HTML:
   at rest. */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { fx } from '@/theme';
import { Button } from './Button';
import { motionValues, timing, useFx } from './effects';
import { Icon, type IconName } from './Icon';
import { Photo } from './media/Photo';
import { Reveal, useRevealLanding } from './motion/Reveal';
import { Scrim } from './Gradient';
import { T } from './Text';

export type EmptyAction = { title: string; onPress: () => void; icon?: IconName };

export function EmptyState({ icon = 'circle-dot', title, body, action, secondary, dashed, photo, style }: {
  icon?: IconName; title: string; body?: string; action?: EmptyAction | React.ReactNode; secondary?: EmptyAction;
  dashed?: boolean; photo?: 'workouts' | 'report' | 'meals' | 'messages' | 'default'; style?: StyleProp<ViewStyle>;
}) {
  const act = action && typeof action === 'object' && 'title' in (action as object) && 'onPress' in (action as object)
    ? <Button title={(action as EmptyAction).title} icon={(action as EmptyAction).icon} variant={dashed ? 'white' : 'redTint'} iconRight={null} onPress={(action as EmptyAction).onPress} />
    : (action as React.ReactNode);
  return <View style={style}>
    {photo ? <View style={styles.band} pointerEvents="none">
      <Photo slot={`empty.${photo}`} opacity={0.15} style={StyleSheet.absoluteFill} decorative />
      <Scrim kind="emptyBand" style={StyleSheet.absoluteFill} />
    </View> : null}
    <Reveal from="fade" duration={motionValues.states.tileMs}>
      <Steps dashed={!!dashed} icon={icon} title={title} body={body} act={act || secondary ? <View style={styles.actions}>
        {act}
        {secondary ? <Button title={secondary.title} icon={secondary.icon} variant="ghost" onPress={secondary.onPress} /> : null}
      </View> : null} />
    </Reveal>
  </View>;
}

/** The column, its parts entering in steps from the Reveal's start (at rest when the Reveal is). */
function Steps({ dashed, icon, title, body, act }: { dashed: boolean; icon: IconName; title: string; body?: string; act: React.ReactNode }) {
  const { calm, inHtml } = useFx();
  const s = motionValues.states;
  const landing = useRevealLanding();
  const rest = calm || inHtml || !landing;
  const tile = useSharedValue(rest ? 1 : 0);
  const head = useSharedValue(rest ? 1 : 0);
  const line = useSharedValue(rest ? 1 : 0);
  const last = useSharedValue(rest ? 1 : 0);
  const fired = useSharedValue(rest ? 1 : 0);
  const startedAt = landing?.startedAt;
  const landed = landing?.landed;
  useAnimatedReaction(() => (startedAt ? startedAt.value : -1), (at) => {
    if (at < 0 || fired.value === 1) return;
    fired.value = 1;
    const parts = [tile, head, line, last];
    if (landed && landed.value === 1) { for (const p of parts) p.value = 1; return; }
    const now = Date.now();
    for (let i = 0; i < parts.length; i += 1) {
      const wait = Math.max(0, at + s.step * Math.min(i, s.maxSteps) - now);
      parts[i]!.value = withDelay(wait, withTiming(1, timing(s.tileMs)));
    }
  });
  const content = <>
    <Part p={tile} kind="tile"><View style={styles.tile}><Icon name={icon} size={24} color={fx.ink.a25} /></View></Part>
    <Part p={head} kind="rise"><T v="section" color={fx.ink.a60} center>{title}</T></Part>
    {body ? <Part p={line} kind="rise"><T v="bodySm" color={fx.ink.a50} center style={styles.body}>{body}</T></Part> : null}
    {act ? <Part p={last} kind="rise">{act}</Part> : null}
  </>;
  return dashed ? <View style={styles.dashed}>{content}</View> : <View style={styles.plain}>{content}</View>;
}

function Part({ p, kind, children }: { p: SharedValue<number>; kind: 'tile' | 'rise'; children: React.ReactNode }) {
  const s = motionValues.states;
  const a = useAnimatedStyle(() => {
    const v = p.value;
    if (v === 1) return { opacity: 1, transform: [] };
    return kind === 'tile'
      ? { opacity: v, transform: [{ scale: s.tileFrom + (1 - s.tileFrom) * v }] }
      : { opacity: v, transform: [{ translateY: s.rise * (1 - v) }] };
  }, [kind]);
  return <Animated.View style={[styles.part, a]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  band: { height: 160, marginBottom: -96, overflow: 'hidden' },
  plain: { alignItems: 'center', paddingVertical: 64, gap: 12 },
  dashed: { alignItems: 'center', gap: 12, padding: 24, borderRadius: fx.radius.card, borderWidth: 1, borderStyle: 'dashed', borderColor: fx.line.a20, backgroundColor: fx.bg.panelSolid },
  part: { alignItems: 'center', alignSelf: 'stretch' },
  tile: { width: 56, height: 56, borderRadius: fx.radius.card, backgroundColor: fx.fill.a05, borderWidth: 1, borderColor: fx.line.a10, alignItems: 'center', justifyContent: 'center' },
  body: { maxWidth: 240 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 },
});
