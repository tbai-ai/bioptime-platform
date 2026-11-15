/* Train's header photo (THEME §11.2, PREMIUM §1.10 Train): the slot's photo at .20, overscanned as the earlier app's
   scale 1.1, under the Train scrim (to #080808) and a red/5 wash; full-bleed above the content column. A change of
   category chip (or the Plan segment) crossfades to the next photo over 450 ms; under reduced motion it switches. The
   band is fully faded at its bottom edge, before the first data card. Motion v2 (M71): the crossfade runs
   S.m71.photoMs on ease.inOut (tier C: S.m71.cMs).
   The band is a strip (the header plus 40 pt: about 46 % of a 3:2 photo's height at 390 wide, 22 % at 820 and 14 % at
   1280), and the scrim darkens it from the top down, so a photo framed around its manifest focal (the middle of the
   body, for the full-frame crops elsewhere) showed only torsos in the dark half at 820 (T3-21). Each header photo is
   drawn at its own shape, 1.1 × the band's width, with the line of the photo that holds its subject (a face and
   shoulders, the body in a plank or a stretch: STRIP_LINE) set at STRIP_AT of the band's height, where the scrim is
   lightest; the photo never leaves a gap at an edge. A photo without a line keeps its manifest focal, as before. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Photo, Scrim, ease, fx, motionValues, photoIdFor, photoRecord, timing, useFx } from '@/fx';

const M71 = motionValues.screens.m71;

/** The earlier app's scale 1.1, as overscan (no transform at rest). */
const OVERSCAN = 1.1;
/** Where a header photo's subject line sits in the band (fraction of the band's height from its top). */
const STRIP_AT = 0.4;
/** The line of each header photo (fraction of its height from the top) that holds its subject in a strip crop. */
const STRIP_LINE: Record<string, number> = {
  'ph-home-night': 0.5, // All: the racks under the lights
  'ph-train-strength': 0.44, // his face and shoulders over the bar
  'ph-train-cardio': 0.41, // her face, her arms and the rower's handle
  'ph-train-hiit': 0.51, // her head and back in the plank
  'ph-train-mobility': 0.42, // her face and clasped hands in the squat
  'ph-train-flexibility': 0.58, // his back and head in the stretch
  'ph-train-yoga': 0.58, // the arched body
  'ph-programme-start': 0.32, // Plan: his face and shoulders
};

/** The photo's box in a band `w` × `h` (null: the slot has no photo, so the overscanned box as before). */
function stripBox(slot: string, w: number, h: number): ViewStyle | null {
  const rec = photoRecord(photoIdFor(slot));
  if (!rec || !rec.width || !rec.height || w <= 0 || h <= 0) return null;
  const aspect = rec.width / rec.height;
  let pw = w * OVERSCAN;
  let ph = pw / aspect;
  // a band taller than the photo's shape (a very narrow window): the photo fills its height, placed by its focal
  const tall = ph < h * OVERSCAN;
  if (tall) { ph = h * OVERSCAN; pw = ph * aspect; }
  const line = STRIP_LINE[rec.id];
  const y = line ?? rec.focal.y;
  const at = line == null ? rec.focal.y : STRIP_AT;
  const top = Math.max(h - ph, Math.min(0, at * h - y * ph));
  const left = tall ? Math.max(w - pw, Math.min(0, (w - pw) * rec.focal.x)) : (w - pw) / 2;
  return { position: 'absolute', left, top, width: pw, height: ph };
}

export function HeaderBackdrop({ slot, height }: { slot: string; height: number }) {
  const { calm, tier } = useFx();
  const fade = tier === 'C' ? M71.cMs : M71.photoMs;
  // the band spans the page: the window's width until it is laid out (a re-render only if it differs)
  const { width: winW } = useWindowDimensions();
  const [bandW, setBandW] = useState<number | null>(null);
  const w = bandW ?? winW;
  const onLayout = (e: LayoutChangeEvent) => {
    const lw = Math.round(e.nativeEvent.layout.width);
    if (lw > 0 && Math.abs(lw - w) > 0.5) setBandW(lw);
  };
  const [layers, setLayers] = useState<Array<{ slot: string; n: number }>>([{ slot, n: 0 }]);
  useEffect(() => {
    setLayers((l) => (l[l.length - 1].slot === slot ? l : [...l.slice(-1), { slot, n: l[l.length - 1].n + 1 }]));
  }, [slot]);
  useEffect(() => {
    if (layers.length < 2) return;
    // the photo under it goes once the new one is in (a frame after its fade)
    const timer = setTimeout(() => setLayers((l) => l.slice(-1)), calm ? 0 : fade + motionValues.overlay.fallbackExtra);
    return () => clearTimeout(timer);
  }, [layers, calm, fade]);
  return <View pointerEvents="none" onLayout={onLayout} style={[styles.band, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {layers.map((l) => <FadeIn key={l.n} still={l.n === 0 || calm} ms={fade}>
      <Photo slot={l.slot} opacity={0.2} decorative priority="high" style={stripBox(l.slot, w, height) ?? styles.zoom} />
    </FadeIn>)}
    <Scrim kind="trainHeader" style={StyleSheet.absoluteFill} />
    <View style={[StyleSheet.absoluteFill, styles.wash]} />
  </View>;
}

function FadeIn({ still, ms, children }: { still: boolean; ms: number; children: React.ReactNode }) {
  const o = useSharedValue(still ? 1 : 0);
  useEffect(() => { if (!still) o.value = withTiming(1, timing(ms, ease.inOut)); }, [still, o]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[StyleSheet.absoluteFill, a]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  band: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
  zoom: { position: 'absolute', top: '-5%', bottom: '-5%', left: '-5%', right: '-5%' },
  wash: { backgroundColor: fx.premium.headerOverlay },
});
