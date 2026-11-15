/* The kit gallery's motion-core part (/__fx, development builds only): the motion core's primitives in the states the
   v2 motion work changed, each with the control that shows the change. The numbers are illustrations for the gallery,
   never a member's data.
   - Entrances: a Reveal entering while its parent re-renders ("Re-render" during the entrance must never jump it), and
     a scrolling frame whose cards enter as they cross the line (no mount-index wait for a late crossing).
   - Loaders (they spin at every tier, still under reduced motion), sparklines (never a flash), the Living Score (ring
     and digits on one clock), the rest timer (one clock per rest), data on arrival (honest, seenKey, delta), today's
     brief (a line rise), the tilt card's sheen, the trend chart's three clocks, the shelf lean, the following tile,
     skeletons, and the page-active loops (orbs, live dot). */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSharedValue, useScrollOffset, useAnimatedRef, withTiming } from 'react-native-reanimated';
import type Animated from 'react-native-reanimated';
import { fx } from '@/theme';
import { FONTS } from '@/fx/type';
import { Button } from '@/fx/Button';
import { GlassCard } from '@/fx/GlassCard';
import { Eyebrow, P, T } from '@/fx/Text';
import { Photo } from '@/fx/media/Photo';
import { ease, motionValues } from '@/fx/motion/tokens';
import { useMotion } from '@/fx/motion/tier';
import { Reveal, RevealScope } from '@/fx/motion/Reveal';
import { CountUp } from '@/fx/motion/CountUp';
import { MetricRing, ScoreRing, TimerRing } from '@/fx/motion/Ring';
import { AreaSpark, Sparkline } from '@/fx/motion/Sparkline';
import { TrendChart } from '@/fx/motion/Chart';
import { ShelfCarousel, ShelfPhoto } from '@/fx/motion/ShelfCarousel';
import { Skeleton, SkeletonRing } from '@/fx/motion/Skeleton';
import { Spinner } from '@/fx/motion/Spinner';
import { TypingDots } from '@/fx/motion/TypingDots';
import { Typewriter } from '@/fx/motion/Typewriter';
import { TiltCard } from '@/fx/motion/Tilt';
import { DepthTile } from '@/fx/motion/DepthTile';
import { Orbs } from '@/fx/motion/Orbs';
import { LiveDot } from '@/fx/motion/LiveDot';
import { ProgressBar } from '@/fx/motion/Bars';

function Part({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <View style={styles.part}>
    <Eyebrow kind="brand">{title}</Eyebrow>
    {note ? <P small muted>{note}</P> : null}
    {children}
  </View>;
}

/** M01: an entrance whose parent re-renders while it plays ("Re-render" ticks the parent's state). */
function RevealRerender() {
  const [round, setRound] = useState(0);
  const [ticks, setTicks] = useState(0);
  return <View style={styles.gap}>
    <View style={styles.row}>
      <Button title="Replay" variant="soft" full={false} onPress={() => setRound((r) => r + 1)} testID="core-reveal-replay" />
      <Button title="Re-render" variant="soft" full={false} onPress={() => setTicks((n) => n + 1)} testID="core-reveal-rerender" />
    </View>
    <Reveal key={round} spring="soft" distance={30} delay={200} id={`gallery.core.reveal.${round}`}>
      <GlassCard><View testID="core-reveal-box"><P>{`An entrance with an id, renders while entering: ${ticks}`}</P></View></GlassCard>
    </Reveal>
  </View>;
}

/** M01: cards in a scrolling frame enter as they cross the line; one that crosses late waits only for its slot. */
function ScrollReveals() {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const y = useScrollOffset(ref);
  const [round, setRound] = useState(0);
  return <View style={styles.gap}>
    <Button title="Mount again" variant="soft" full={false} onPress={() => setRound((r) => r + 1)} />
    <View style={styles.scrollFrame}>
      <ScrollViewA key={round} innerRef={ref}>
        <RevealScope scrollY={y}>
          <View style={styles.scrollCards}>
            {Array.from({ length: 12 }, (_, i) => <Reveal key={i} index={i}>
              <GlassCard><View testID={`core-scroll-card-${i}`}><P>{`Card ${i + 1}`}</P></View></GlassCard>
            </Reveal>)}
          </View>
        </RevealScope>
      </ScrollViewA>
    </View>
  </View>;
}

function ScrollViewA({ innerRef, children }: { innerRef: ReturnType<typeof useAnimatedRef<Animated.ScrollView>>; children: React.ReactNode }) {
  return <ScrollView ref={innerRef as never} nestedScrollEnabled testID="core-scroll-frame">{children}</ScrollView>;
}

/** M05: loaders. */
function Loaders() {
  return <View style={styles.rowWrap}>
    <View testID="core-spinner-inline"><Spinner /></View>
    <View testID="core-spinner-splash"><Spinner variant="splash" /></View>
    <TypingDots />
  </View>;
}

/** M06: sparklines drawing in (never a flash), again on "Replay". */
function Lines() {
  const [round, setRound] = useState(0);
  return <View style={styles.gap}>
    <Button title="Replay" variant="soft" full={false} onPress={() => setRound((r) => r + 1)} testID="core-lines-replay" />
    <View key={round} style={styles.row}>
      <Sparkline values={[60, 62, 65, 64, 68]} index={0} />
      <Sparkline values={[62, 61, 59, 59, 58]} color={fx.hue.green500} index={1} />
      <AreaSpark values={[64, 70, 68, 75, 72, 80, 77]} width={160} />
    </View>
  </View>;
}

/** M07: the Living Score: the ring and its digits on one clock ("Sweep" runs it 0 → 1). */
function LivingScore() {
  const progress = useSharedValue(0);
  const { tier, still } = useMotion();
  const sweep = () => {
    progress.set(0);
    const ms = tier === 'C' ? motionValues.count.wellnessC : motionValues.screens.m61.sweepMs;
    progress.set(still ? 1 : withTiming(1, { duration: ms, easing: ease.expo }));
  };
  useEffect(() => { if (still) progress.set(1); }, [still, progress]);
  return <View style={styles.gap}>
    <Button title="Sweep" variant="soft" full={false} onPress={sweep} testID="core-score-sweep" />
    <View style={styles.center} testID="core-score">
      <ScoreRing value={78} progress={progress} accessibilityLabel="Score ring at 78">
        <CountUp value={78} progress={progress} pop style={styles.score} testID="core-score-number" />
      </ScoreRing>
    </View>
  </View>;
}

/** M08: one linear clock per rest; pause freezes it, resume arms it once. */
function RestTimer() {
  const total = 20;
  const [endAt, setEndAt] = useState<number | null>(null);
  const [left, setLeft] = useState(total);
  const [paused, setPaused] = useState<number | null>(null); // ms left while paused
  useEffect(() => {
    if (endAt == null) return;
    const tick = setInterval(() => setLeft(Math.max(0, Math.ceil((endAt - Date.now()) / 1000))), 250);
    return () => clearInterval(tick);
  }, [endAt]);
  const start = () => { setPaused(null); setEndAt(Date.now() + total * 1000); setLeft(total); };
  const pause = () => {
    if (endAt != null) { setPaused(Math.max(0, endAt - Date.now())); setEndAt(null); return; }
    if (paused != null) { setEndAt(Date.now() + paused); setPaused(null); }
  };
  return <View style={styles.rowWrap}>
    <View testID="core-timer">
      <TimerRing remaining={left} total={total} running={endAt != null} endAt={endAt} accessibilityLabel={`Rest, ${left} seconds left`}>
        <T v="metric24">{String(left)}</T>
      </TimerRing>
    </View>
    <View style={styles.gap}>
      <Button title="Start rest" variant="soft" full={false} onPress={start} testID="core-timer-start" />
      <Button title={paused != null ? 'Resume' : 'Pause'} variant="soft" full={false} onPress={pause} />
    </View>
  </View>;
}

/** M09: data on arrival. `honest` appears final with a pop; `seenKey` shows at rest when mounted again, and a changed
 *  value moves from the last one with its delta chip. */
function DataOnArrival() {
  const [round, setRound] = useState(0);
  const [value, setValue] = useState(72.4);
  return <View style={styles.gap}>
    <View style={styles.row}>
      <Button title="Mount again" variant="soft" full={false} onPress={() => setRound((r) => r + 1)} testID="core-data-remount" />
      <Button title="Change" variant="soft" full={false} onPress={() => { setValue((v) => (v === 72.4 ? 71.9 : 72.4)); setRound((r) => r + 1); }} testID="core-data-change" />
    </View>
    <Reveal key={round}>
      <GlassCard>
        <View style={styles.between}>
          <View style={styles.cell} testID="core-honest">
            <CountUp value={7.4} decimals={1} honest style={styles.big} />
            <T v="micro" color={fx.ink.a50}>Honest (hours)</T>
          </View>
          <View style={styles.cell} testID="core-seen">
            <CountUp value={value} decimals={1} seenKey="gallery.core.weight" delta={{ lowerIsBetter: true, unit: 'kg' }} style={styles.big} />
            <T v="micro" color={fx.ink.a50}>seenKey + delta (kg)</T>
          </View>
          <MetricRing value={64} color={fx.status.good} index={1} seenKey="gallery.core.ring" accessibilityLabel="Metric ring at 64">
            <CountUp value={64} seenKey="gallery.core.ringCount" style={styles.small} />
          </MetricRing>
        </View>
        <ProgressBar value={0.62} style={styles.bar} />
      </GlassCard>
    </Reveal>
  </View>;
}

/** M10: today's brief, a line rise with the caret ("Replay" mounts it again). */
function Brief() {
  const [round, setRound] = useState(0);
  return <View style={styles.gap}>
    <Button title="Replay" variant="soft" full={false} onPress={() => setRound((r) => r + 1)} testID="core-brief-replay" />
    <Reveal key={round} from="scale">
      <GlassCard rule={{ color: fx.red.brand }}>
        <T v="micro" color={fx.red.label}>{"Today's brief"}</T>
        <View testID="core-brief">
          <Typewriter text="Your coach has set this week's plan. Two sessions are left, and your blood test is on Thursday at 8:30." style={styles.typed} maxFontSizeMultiplier={1.6} />
        </View>
      </GlassCard>
    </Reveal>
  </View>;
}

/** M11 and N02: the tilt card (press it: the sheen is a gradient view now). */
function Tilt() {
  return <View testID="core-tilt">
    <TiltCard intensity={motionValues.tilt.score} hero radius={fx.radius.hero}>
      <View style={styles.tiltCard}><T v="card24">Press and drag</T><P small muted>The light band follows the finger; the card stands down while the tab pager pans.</P></View>
    </TiltCard>
  </View>;
}

/** M12: the trend chart's line, dots and latest point on their own clocks. */
function Chart() {
  const [round, setRound] = useState(0);
  return <View style={styles.gap}>
    <Button title="Replay" variant="soft" full={false} onPress={() => setRound((r) => r + 1)} testID="core-chart-replay" />
    <View key={round} testID="core-chart">
      <TrendChart values={[62, 61, 63, 60, 59, 58]} range={{ low: 55, high: 65 }} accessibilityLabel="Trend chart: 6 values from 62 to 58" />
    </View>
  </View>;
}

/** M13: fling the shelf: the cards lean with the speed and come back when it rests. */
function Shelf() {
  return <View testID="core-shelf">
    <ShelfCarousel data={['strength', 'conditioning', 'mobility', 'recovery', 'strength2']} keyExtractor={(k) => k} renderItem={(k, i) =>
      <View style={styles.shelfCard}>
        <ShelfPhoto><Photo slot={`train.header.${k.replace(/\d+$/, '')}`} style={StyleSheet.absoluteFill} decorative /></ShelfPhoto>
        <T v="card24" style={styles.shelfTitle}>{`Card ${i + 1}`}</T>
      </View>} />
  </View>;
}

/** M15: a following tile and the skeletons (the band's width is layout; the ring's track is a view). */
function Depth() {
  return <View style={styles.rowWrap}>
    <View testID="core-follow"><DepthTile size={80} radius={28} follow sheen glow={fx.shadow.tile} accessibilityLabel="A tile that follows the finger" /></View>
    <View style={styles.flex}><Skeleton height={14} /><Skeleton height={14} width="60%" style={styles.skel} /></View>
    <SkeletonRing size={56} />
  </View>;
}

/** C03: loops that stop when their page is not active (and resume from where they were). */
function Loops() {
  return <View style={styles.orbFrame} testID="core-loops">
    <Orbs preset="home" />
    <View style={styles.liveRow}><LiveDot /><T v="micro">Counting steps on this phone</T></View>
  </View>;
}

export function CoreGallery(): React.JSX.Element | null {
  const { tier, calm } = useMotion();
  if (!__DEV__) return null;
  return <View style={styles.wrap}>
    <T v="heading">Motion core</T>
    <P small muted>{`Tier ${tier}${calm ? ' · reduced motion: every part shows its rest state' : ''}`}</P>
    <Part title="Reveal and re-render" note="Re-render during the entrance: it keeps moving."><RevealRerender /></Part>
    <Part title="Scroll reveals" note="Scroll inside the frame: a late crossing enters at once."><ScrollReveals /></Part>
    <Part title="Loaders" note="They turn at every tier; still under reduced motion."><Loaders /></Part>
    <Part title="Sparklines"><Lines /></Part>
    <Part title="The Living Score" note="The ring and the digits share one clock."><LivingScore /></Part>
    <Part title="Rest timer" note="One clock per rest; pause freezes it."><RestTimer /></Part>
    <Part title="Data on arrival"><DataOnArrival /></Part>
    <Part title="Today's brief"><Brief /></Part>
    <Part title="Tilt card"><Tilt /></Part>
    <Part title="Trend chart"><Chart /></Part>
    <Part title="Shelf lean"><Shelf /></Part>
    <Part title="Following tile and skeletons"><Depth /></Part>
    <Part title="Page-active loops"><Loops /></Part>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  part: { gap: 12, paddingTop: 12, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: fx.line.a05 },
  gap: { gap: 12 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 20 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  center: { alignSelf: 'center' },
  flex: { flex: 1, minWidth: 120 },
  cell: { gap: 4, minWidth: 90 },
  big: { fontFamily: FONTS.mono700, fontSize: 24, lineHeight: 30, color: fx.ink.white },
  small: { fontFamily: FONTS.mono500, fontSize: 14, color: fx.ink.white },
  score: { fontFamily: FONTS.display, fontSize: 54, color: fx.ink.white },
  bar: { marginTop: 16 },
  skel: { marginTop: 8 },
  typed: { color: fx.ink.a90, fontFamily: FONTS.sans300, fontSize: 15, lineHeight: 24 },
  tiltCard: { padding: 24, borderRadius: fx.radius.hero, backgroundColor: fx.bg.card, borderWidth: 1, borderColor: fx.red.a30, gap: 8 },
  scrollFrame: { height: 300, borderRadius: fx.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.deep },
  scrollCards: { padding: 16, gap: 12 },
  shelfCard: { flex: 1, borderRadius: fx.radius.card, overflow: 'hidden', backgroundColor: fx.bg.card, borderWidth: 1, borderColor: fx.line.a10, justifyContent: 'flex-end' },
  shelfTitle: { margin: 12 },
  orbFrame: { height: 180, borderRadius: fx.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: fx.line.a10, justifyContent: 'flex-end', padding: 16 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
