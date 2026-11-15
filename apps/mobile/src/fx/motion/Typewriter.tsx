/* Today's brief (Home "Today's brief", THEME §12.4 made calmer): the sentence rises in line by line with the red caret,
   instead of typing a character at a time.
   - One Text carries the sentence's layout and its accessibility from the first frame (screen readers and E2E read one
     element with the whole sentence; the block has its final height at any font size, so nothing reflows). While the
     lines rise it takes the clear colour; the frame the rise ends it takes its own colour and the line copies go.
   - Each line (at most 4; later lines go with the 4th) is a hidden mask at the line's box holding a copy of the same
     Text moved up by the line's top: its content rises 6 pt and fades in over 420 ms ease.expo, 60 ms after the line
     before, all on one shared clock (no React render per frame). Lines come from onTextLayout (native) or from the
     text node's line boxes (the web).
   - The red caret (2 × 14) rides the end of the latest line that has started, blinks once and fades.
   - It starts `delay` (default 120 ms) after its card lands (the nearest Reveal; at once outside one), and only while the
     page is active. `play` is false after the first showing of a day's brief (the caller keeps bp.fx.briefSeen.<date>):
     the sentence is then complete at once, as it is under calm and in the pre-rendered HTML. Tier C: one 200 ms fade
     of the sentence. `onDone` fires when the sentence is complete after a rise. Keep its label line a sibling, not a
     parent (E2E reads lines). */
import React, { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type TextLayoutEvent, type TextStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { fx } from '@/theme';
import { usePageActive } from '@/fx/nav/pageReady';
import { ease, motionValues, t } from './tokens';
import { useMotion } from './tier';
import { useRevealLanding } from './Reveal';

export type TypewriterProps = {
  text: string;
  play?: boolean;
  /** Wait after the card lands (ms, default t.typeDelay). */
  delay?: number;
  style?: StyleProp<TextStyle>;
  maxFontSizeMultiplier?: number;
  onDone?: () => void;
};

/** A line box in the Text's own coordinates. */
type LineBox = { x: number; y: number; width: number; height: number };

const B = motionValues.brief;

/** The web's line boxes of a Text: the client rects of its text, grouped by line, in layout (unscaled) coordinates. */
function webLines(el: HTMLElement): LineBox[] {
  const box = el.getBoundingClientRect();
  const k = box.width > 0 && el.offsetWidth > 0 ? el.offsetWidth / box.width : 1; // undo a parent's scale
  const range = document.createRange();
  range.selectNodeContents(el);
  const out: LineBox[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width === 0 && r.height === 0) continue;
    const y = (r.top - box.top) * k;
    const h = r.height * k;
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - y) < h / 2) {
      const right = Math.max(last.x + last.width, (r.right - box.left) * k);
      last.x = Math.min(last.x, (r.left - box.left) * k);
      last.width = right - last.x;
      last.height = Math.max(last.height, h);
      continue;
    }
    out.push({ x: (r.left - box.left) * k, y, width: r.width * k, height: h });
  }
  return out;
}

/** Up to maxLines masks: the 4th takes every line after it too. */
function masksOf(lines: LineBox[], fullHeight: number): LineBox[] {
  if (!lines.length) return [{ x: 0, y: 0, width: 0, height: fullHeight }];
  const n = Math.min(lines.length, B.maxLines);
  const out = lines.slice(0, n).map((l) => ({ ...l }));
  if (lines.length > n) {
    const tail = lines[lines.length - 1];
    const m = out[n - 1];
    m.height = tail.y + tail.height - m.y;
    m.x = tail.x;
    m.width = tail.width;
  }
  return out;
}

function Mask({ index, line, width, clock, text, style, maxFontSizeMultiplier }: {
  index: number; line: LineBox; width: number; clock: SharedValue<number>; text: string; style: StyleProp<TextStyle>; maxFontSizeMultiplier?: number;
}) {
  const rise = useAnimatedStyle(() => {
    const k = Math.max(0, Math.min(1, (clock.get() - index * B.lineStep) / B.lineMs));
    const e = ease.expo(k);
    return { opacity: e, transform: [{ translateY: B.lineRise * (1 - e) }] };
  });
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
    style={[styles.mask, { top: line.y, height: line.height, width }]}>
    <Animated.View style={[StyleSheet.absoluteFill, rise]}>
      <Text style={[style, styles.copy, { top: -line.y, width }]} maxFontSizeMultiplier={maxFontSizeMultiplier}>{text}</Text>
    </Animated.View>
  </View>;
}

function Rise({ text, play, delay, style, maxFontSizeMultiplier, onDone }: Required<Pick<TypewriterProps, 'text' | 'play' | 'delay'>> & Omit<TypewriterProps, 'text' | 'play' | 'delay'>) {
  const { tier, still } = useMotion();
  const rising = play && !still;
  const lite = tier === 'C';
  const reveal = useRevealLanding();
  const landed = reveal?.landed;
  const active = usePageActive();
  const [phase, setPhase] = useState<'wait' | 'rise' | 'done'>(rising ? 'wait' : 'done');
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [lines, setLines] = useState<LineBox[] | null>(null);
  const ref = useRef<React.ComponentRef<typeof Text>>(null);
  const clock = useSharedValue(0);
  const started = useSharedValue(0);

  const masks = box ? masksOf(lines ?? [], box.h) : [];
  const riseEnd = lite ? B.cFadeMs : (Math.max(1, masks.length) - 1) * B.lineStep + B.lineMs;
  const total = lite ? B.cFadeMs : riseEnd + t.caret + B.cFadeMs;
  const ready = rising && phase !== 'done' && !!box && (lite || lines !== null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width === 0 || height === 0) return; // a detached page reports 0 × 0
    setBox((b) => (b && Math.abs(b.w - width) < 0.5 && Math.abs(b.h - height) < 0.5 ? b : { w: width, h: height }));
    if (Platform.OS === 'web' && rising && phase !== 'done') {
      const el = ref.current as unknown as HTMLElement | null;
      if (el && typeof document !== 'undefined') {
        try { setLines(webLines(el)); } catch { setLines([]); }
      }
    }
  };
  const onTextLayout = (e: TextLayoutEvent) => {
    if (!rising || phase === 'done') return;
    setLines(e.nativeEvent.lines.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height })));
  };

  const finish = useCallback(() => {
    setPhase('done');
    onDone?.();
  }, [onDone]);
  const begin = () => { setPhase('rise'); };

  // start: `delay` after the card has landed, while the page is active
  useAnimatedReaction(() => (ready && started.get() === 0 && active.get() === 1 && (!landed || landed.get() === 1) ? 1 : 0), (go) => {
    if (go !== 1 || started.get() === 1) return;
    started.set(1);
    const run = withTiming(total, { duration: total, easing: ease.linear });
    clock.set(delay > 0 ? withDelay(delay, run) : run);
    scheduleOnRN(begin);
  });
  // the frame the rise ends, the sentence takes its own colour and the copies go
  useAnimatedReaction(() => (started.get() === 1 && clock.get() >= riseEnd ? 1 : 0), (end, was) => {
    if (end === 1 && was !== 1) scheduleOnRN(finish);
  });

  // the caret: at the end of the latest line that has started; one blink after the rise, then it fades
  const lastLineH = lines?.length ? lines[lines.length - 1].height : 0;
  const caretAt = masks.map((m, i) => {
    const merged = i === masks.length - 1 && lines && lines.length > masks.length;
    const h = merged ? lastLineH : m.height;
    const y = merged ? m.y + m.height - lastLineH : m.y;
    return { x: m.x + m.width + 2, y: y + (h - B.caretH) / 2 };
  });
  const caret = useAnimatedStyle(() => {
    const c = clock.get();
    if (started.get() === 0 || c <= 0 || !caretAt.length) return { opacity: 0, transform: [] }; // hidden until the first line moves
    const k = Math.max(0, Math.min(caretAt.length - 1, Math.floor(c / B.lineStep)));
    const p = caretAt[k];
    let o = 1;
    if (c >= riseEnd + t.caret) o = Math.max(0, 1 - (c - riseEnd - t.caret) / B.cFadeMs);
    else if (c >= riseEnd) o = c - riseEnd < t.caret / 2 ? 0 : 1;
    return { opacity: o, transform: [{ translateX: p.x }, { translateY: p.y }] };
  });

  const fade = useAnimatedStyle(() => {
    if (!lite || !rising) return { opacity: 1 };
    return { opacity: Math.max(0, Math.min(1, clock.get() / B.cFadeMs)) };
  });

  const hideBase = rising && !lite && phase !== 'done';
  return <Animated.View style={lite ? fade : null}>
    <Text ref={ref} style={[style, hideBase ? styles.clear : null]} maxFontSizeMultiplier={maxFontSizeMultiplier} accessibilityLabel={text}
      onLayout={onLayout} onTextLayout={onTextLayout}>{text}</Text>
    {hideBase && box && phase === 'rise' ? masks.map((m, i) => <Mask key={i} index={i} line={m} width={box.w} clock={clock} text={text} style={style} maxFontSizeMultiplier={maxFontSizeMultiplier} />) : null}
    {rising && !lite && box ? <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden
      style={[styles.caret, caret]} /> : null}
  </Animated.View>;
}

export function Typewriter({ text, play = true, delay = t.typeDelay, style, maxFontSizeMultiplier, onDone }: TypewriterProps) {
  // a new sentence starts again
  return <Rise key={text} text={text} play={play} delay={delay} style={style} maxFontSizeMultiplier={maxFontSizeMultiplier} onDone={onDone} />;
}

const styles = StyleSheet.create({
  clear: { color: fx.premium.transparent },
  mask: { position: 'absolute', left: 0, overflow: 'hidden' },
  copy: { position: 'absolute', left: 0 },
  caret: { position: 'absolute', left: 0, top: 0, width: B.caretW, height: B.caretH, backgroundColor: fx.red.brand },
});
