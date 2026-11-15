/* Tilt on pages of cards (motion v2, wave-2 fix r1 and r2: tier-A scroll on Tests, Fuel and Store).
   - RowTilt, a list row: on the web the row keeps its TiltCard (the pointer drives it there; no sensor). On native the
     device tilt belongs to the page's hero card, so a row renders without a TiltCard and answers a touch with its own
     press (the GlassCard ladder, or the caller's). A device-driven TiltCard re-aims its springs on every gravity
     reading, and each of its animated layers is a UI-thread shadow-tree commit on every frame: a page of a dozen rows
     spent about 5 ms of every frame on them while scrolling (and while the phone moved), against under 2 ms on a page
     without rows that tilt.
   - HeroTilt, the page's hero card: a TiltCard whose device tilt (and press tilt) runs only while the card is on screen
     (native). The card's box is measured once laid out (the zero-layout rule holds); a UI-thread reaction on the page's
     scroll offset (RevealScope) tells React only when the card crosses the viewport's edge, so a scrolled-away hero
     stops re-aiming its springs and the sensor stops once nothing in view wants it. Outside a RevealScope, and on the
     web, it is a plain TiltCard.
   - Android, tiers A and B (fix r2): the hero's content is drawn into a texture of its own (a hardware layer, FLAT_DRAW),
     and the TiltCard's lift shadow and light band are left out. Under the tilt's perspective Skia cannot draw a blurred
     shadow or a rounded clip analytically: it rasterised a mask for each on the CPU and uploaded it on every frame of the
     tilt (three card-sized masks plus two screen-wide ones, about 20 MB a frame on Tests and Fuel; the band's rounded clip
     alone was a card-sized mask a frame), so every swipe that began on the hero stalled the GPU queue for a quarter of a
     second, and a phone moving in the hand would have done the same for the whole motion budget. With the layer the tilt
     moves one finished image; the layer is re-drawn only when the card's content changes. The card's own outset shadow
     and the lift shadow are black on the black page, so nothing visible changes there; the band is a 3 % white wash at
     rest. `layer={false}` for a card that already draws itself into a texture (the Store's package card). Tier C presses
     by scale only (no perspective) and calm draws no transform at all, so neither needs any of this.
   `style` is kept on native (a plain View carries it) so a caller's layout passthrough still applies. */
import React, { useState } from 'react';
import { Platform, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedRef, useSharedValue } from 'react-native-reanimated';
import { measureView } from '@/fx/motion/measured';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { TiltCard, useMotion, useRevealScope, type TiltCardProps } from '@/fx';

/** Native draws the rows flat; the web keeps the pointer tilt. */
export const ROW_TILT = Platform.OS === 'web';

/** Android: a tilting hero is drawn into a hardware layer, without the lift shadow (see the header). */
const FLAT_DRAW = Platform.OS === 'android';

export function RowTilt(props: TiltCardProps) {
  if (ROW_TILT) return <TiltCard {...props} />;
  return props.style ? <View style={props.style}>{props.children}</View> : <>{props.children}</>;
}

/** Whether a hero tilts in 3D here and so is drawn flat into its own texture (Android, tiers A and B, not calm). */
export function useHeroLayer(): boolean {
  const { tier, still } = useMotion();
  return FLAT_DRAW && tier !== 'C' && !still;
}

export type HeroTiltProps = TiltCardProps & {
  /** Draw the content into a hardware layer while it tilts (Android, tiers A and B). Off for a card that caches itself. */
  layer?: boolean;
};

export function HeroTilt({ layer = true, ...rest }: HeroTiltProps) {
  const scope = useRevealScope();
  const flat = useHeroLayer();
  const props: TiltCardProps = flat
    ? { ...rest, lift: false, sheen: false, children: layer ? <View collapsable={false} renderToHardwareTextureAndroid>{rest.children}</View> : rest.children }
    : rest;
  if (ROW_TILT || !scope) return <TiltCard {...props} />;
  return <GatedTilt {...props} />;
}

function GatedTilt({ style, disabled, ...props }: TiltCardProps) {
  const scope = useRevealScope()!;
  const { scrollY, viewport } = scope;
  const [inView, setInView] = useState(true);
  const ref = useAnimatedRef<Animated.View>();
  // the card's top and bottom in scroll-content points (−1 until measured)
  const top = useSharedValue(-1);
  const bottom = useSharedValue(-1);
  useAnimatedReaction(() => {
    const b = bottom.get();
    if (b < 0) return 1;
    const y = scrollY.get();
    return b - y > 0 && top.get() - y < viewport.get() ? 1 : 0;
  }, (now, was) => {
    if (was !== null && now !== was) scheduleOnRN(setInView, now === 1);
  });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width === 0 && height === 0) return; // a detached page reports 0 × 0
    scheduleOnUI(() => {
      'worklet';
      const m = measureView(ref);
      if (!m || m.height <= 0) return;
      const y = scrollY.get();
      top.set(m.pageY + y);
      bottom.set(m.pageY + m.height + y);
    });
  };
  return <Animated.View ref={ref} onLayout={onLayout} style={style}>
    <TiltCard {...props} disabled={disabled || !inView} />
  </Animated.View>;
}
