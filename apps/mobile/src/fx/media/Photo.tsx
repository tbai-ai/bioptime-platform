/* A bundled photograph in its place (PREMIUM §2.4–2.5, AMENDED §6). Screens name a slot ('home.hero.morning',
   'store.package.card.2'), never a file: the media package's slots.ts maps the slot to a photo id and its generated
   photos.generated.ts holds the files (one graded WebP master in 64, 1080 and 1600 px), the focal point, the thumbhash,
   the alt text and the credit (types in ./types). Every file is a real licensed photograph (owner, 30 Oct 2026).
   - The 1600 px file is used when the 1080 one would be drawn more than 1.25× enlarged: the width the image is drawn
     at is the box's width or, for a box taller than the photo's shape (a hero, a full-bleed header: `cover` scales by
     height), its height × the photo's aspect, in physical pixels; else 1080. Tier C keeps 1080 (the 2 GB phones'
     memory budget: a 1600 file decodes to twice the bitmap). `small` takes the 64 px copy (the blur illusion and
     entrance copies). Every photo shows the 1080 file until its box is known, and moves to the 1600 file only once its
     measured box needs it, so a thumbnail never downloads it. The box is always measured (a window that widens after the
     photo was drawn: split screen, a foldable opening, a browser window dragged wider), so the photo never waits on a
     measurement that cannot come.
   - Crops come from one master: expo-image `cover` around the photo's focal point. The box is reserved by the caller's
     style (a height or an aspect ratio), so nothing shifts while it decodes.
   - Tints (runtime, over the graded master): `red` is the hero/banner red overlay (mixBlendMode overlay), `programme`
     the Store duotone in `tintColor` (mixBlendMode color); the light tier and Android before 10 draw them with a
     normal blend at the fallback strength.
   - `kenBurns`: the earlier app's hero settle, scale 1.1 → 1 and opacity over 1.5 s on first show (at rest with reduced
     motion and in pre-rendered HTML).
   - It dissolves in once from its thumbhash over motionValues.media.dissolveMs (tiers A and B; at once at tier C, under
     reduced motion and in pre-rendered HTML), and never again: a file already decoded in this session draws on its
     first frame when the photo mounts again (a tab coming back, a list recycling).
   - Decorative photos (moods) are hidden from screen readers; others carry the manifest's alt text.
   A slot with no photo shows a quiet dark gradient in its box instead: no error, no console. */
import { Image, type ImageContentPosition } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PixelRatio, Platform, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { fx } from '@/theme';
import { t, timing, useFx } from '../effects';
import { motionValues } from '../motion/tokens';
import { PHOTOS } from './photos.generated';
import { slotPhoto } from './slots';
import type { PhotoRecord, PhotoTint } from './types';

/* The picture gate: a copy of a picture that must not show before its pictures are drawn (PhotoMorph's opening copy
   on native, whose opaque ground would otherwise show as a black box over the row for the 100-250 ms a hero-sized
   decode takes: the wave-2 gate's Android film). The copy provides a gate; every picture inside it (Photo,
   RemotePhoto) holds the gate from its first commit until its image is on screen (expo-image's onDisplay) or has
   failed. Outside a gate (every other place a photo is drawn) nothing is held and nothing changes. */
export type PictureGate = {
  /** A picture inside the copy waits to be drawn: returns the call that tells the gate it is (once; idempotent). */
  hold: () => () => void;
};

export const PictureGateContext = createContext<PictureGate | null>(null);

/** Inside a picture gate: holds it from the first commit until the returned call runs (pass it to the image's
 *  onDisplay and onError). `key` names the picture: a new one holds again. Outside a gate: a no-op. */
export function usePictureHold(key: string | null): () => void {
  const gate = useContext(PictureGateContext);
  const release = useRef<(() => void) | null>(null);
  // a layout effect: the copy's own layout effect (after its children's) then knows whether any picture is held
  useLayoutEffect(() => {
    if (!gate || !key) return;
    const r = gate.hold();
    release.current = r;
    return () => { release.current = null; r(); };
  }, [gate, key]);
  return useCallback(() => { const r = release.current; release.current = null; r?.(); }, []);
}

/** The photo id for a slot (or null). `key` picks within a set by a stable hash. */
export function photoIdFor(slot: string, key?: string | number): string | null {
  try { return slotPhoto(slot, key) ?? null; } catch { return null; }
}

/** The manifest record for an id (or null): credits screens and alt texts read it. */
export function photoRecord(id: string | null | undefined): PhotoRecord | null {
  return (id && (PHOTOS as Record<string, PhotoRecord>)[id]) || null;
}

/** Every bundled photo (the Photo credits screen). */
export function allPhotos(): PhotoRecord[] {
  return Object.values(PHOTOS as Record<string, PhotoRecord>);
}

export type PhotoProps = {
  /** The placement (AMENDED §6 slot table). */
  slot?: string;
  /** A stable key to pick within a set slot (a session id). */
  pick?: string | number;
  /** A photo id, for the credits screen only; screens use slots. */
  id?: string;
  opacity?: number;
  tint?: PhotoTint;
  /** The programme duotone colour (its dim colour) for `tint="programme"`. */
  tintColor?: string;
  kenBurns?: boolean;
  /** The 64 px copy. */
  small?: boolean;
  priority?: 'low' | 'normal' | 'high';
  /** Force decorative (hidden from screen readers) whatever the manifest says. */
  decorative?: boolean;
  /** Overrides the manifest's alt text. */
  alt?: string;
  style?: StyleProp<ViewStyle>;
  /** Corner radius of the photo's own box (clips the image). */
  radius?: number;
};

/** The 1600 file: worth it once the 1080 file (`file` px) would be enlarged more than `max`× (in physical pixels); at
 *  tier C only on a screen wider than `wide` physical pixels (a tablet, as before). */
const UPSCALE = { file: 1080, max: 1.25, wide: 1300 };

const FLAT_BLEND = Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version < 29;

/** Files decoded in this session (by id and size): they mount again without the dissolve (the thumbhash still covers
 *  the frame or two the browser takes to draw the cached file). */
const decoded = new Set<string>();

export function Photo({ slot, pick, id, opacity = 1, tint = 'none', tintColor, kenBurns, small, priority = 'normal', decorative, alt, style, radius }: PhotoProps) {
  const { calm, inHtml, tier } = useFx();
  const { width } = useWindowDimensions();
  // whether the measured box needs the 1600 file (a re-render only when that answer changes: a thumbnail never makes one)
  const [needBig, setNeedBig] = useState(false);
  const lastW = useRef(0); // the width the image is drawn at (cover), kept without a re-render
  const record = photoRecord(id ?? (slot ? photoIdFor(slot, pick) : null));
  // inside a copy that waits for its pictures (PhotoMorph's opening copy on native): drawn once the image is displayed
  const shown = usePictureHold(record?.id ?? null);
  const still = calm || inHtml || !kenBurns;
  const p = useSharedValue(still ? 1 : 0);
  useEffect(() => { if (!still) p.value = withTiming(1, timing(t.settle)); }, [still, p]);
  const settle = useAnimatedStyle(() => (p.value === 1 ? { opacity, transform: [] } : { opacity: opacity * p.value, transform: [{ scale: 1.1 - 0.1 * p.value }] }));
  const hidden = decorative ?? record?.decorative ?? true;
  const a11y = hidden
    ? { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true as const }
    : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: alt ?? record?.alt };
  const box: ViewStyle = { overflow: 'hidden', ...(radius != null ? { borderRadius: radius } : null) };
  if (!record) {
    return <View {...a11y} style={[box, style]}>
      <LinearGradient colors={[fx.bg.card, fx.bg.panel]} start={{ x: 0.213, y: 0.09 }} end={{ x: 0.787, y: 0.91 }} style={[StyleSheet.absoluteFill, { opacity: Math.min(1, opacity * 2 + 0.2) }]} />
      <TintLayer tint={tint} color={tintColor} flat={FLAT_BLEND || tier === 'C'} />
    </View>;
  }
  const dpr = PixelRatio.get();
  // the 1080 file's own width, and how far it may be enlarged before the 1600 file is worth its decode
  const fileW = Math.min(record.width || UPSCALE.file, UPSCALE.file);
  const aspect = record.width && record.height ? record.width / record.height : 1;
  const measure = !(small && record.x64) && !!record.x1600 && (tier !== 'C' || width * dpr > UPSCALE.wide);
  const limit = fileW * UPSCALE.max;
  const big = measure && (needBig || lastW.current * dpr > limit);
  const source = small && record.x64 ? record.x64 : big ? record.x1600! : record.x1080;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: lw, height: lh } = e.nativeEvent.layout;
    if (!lw) return;
    // cover draws the image at the larger of the box's width and its height × the photo's aspect
    const drawn = Math.round(Math.max(lw, (lh || 0) * aspect));
    lastW.current = drawn;
    const need = drawn * dpr > limit;
    if (measure && need !== needBig) setNeedBig(need);
  };
  const position: ImageContentPosition = { left: `${Math.round(record.focal.x * 100)}%`, top: `${Math.round(record.focal.y * 100)}%` };
  const fileKey = `${record.id}:${source === record.x64 ? 64 : source === record.x1080 ? 1080 : 1600}`;
  const dissolve = calm || inHtml || tier === 'C' || decoded.has(fileKey) ? 0 : motionValues.media.dissolveMs;
  return <View {...a11y} style={[box, style]} onLayout={onLayout}>
    {/* the image takes no touches: a mouse drag on the web would otherwise start the browser's own image drag and
        cancel the tab swipe (taps reach the card around the photo either way) */}
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, settle]}>
      <Image
        source={source}
        placeholder={record.thumbhash ? { thumbhash: record.thumbhash } : undefined}
        contentFit="cover"
        contentPosition={position}
        transition={dissolve}
        priority={priority}
        recyclingKey={record.id}
        cachePolicy="memory-disk"
        onLoad={() => { decoded.add(fileKey); }}
        onDisplay={shown}
        onError={shown}
        accessible={false}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
    <TintLayer tint={tint} color={tintColor} flat={FLAT_BLEND || tier === 'C'} />
  </View>;
}

function TintLayer({ tint, color, flat }: { tint: PhotoTint; color?: string; flat: boolean }) {
  if (tint === 'none') return null;
  if (tint === 'red') return <View pointerEvents="none" style={[StyleSheet.absoluteFill, flat ? { backgroundColor: fx.premium.heroOverlayFlat } : { backgroundColor: fx.premium.heroOverlay, mixBlendMode: 'overlay' }]} />;
  const c = color ?? fx.map.programme[0].dim;
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, flat ? { backgroundColor: c, opacity: 0.85 } : { backgroundColor: c, mixBlendMode: 'color' }]} />;
}
