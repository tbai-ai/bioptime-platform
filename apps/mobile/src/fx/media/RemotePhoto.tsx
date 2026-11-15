/* An image the Bioptime server holds (recipe images, course covers, exercise posters, package and test images):
   fetched through lib/config remoteImage(), which adds the preview gate's header for the shared link (an exercise
   poster bundled in the phone apps, ./bundledMedia, is drawn from the app itself). Its box comes
   from the caller (or the payload's width and height as an aspect ratio), so nothing shifts. While it loads the box
   shows the shimmer's dark ground (fx.premium.shimmer[0]); the image dissolves in over motionValues.media.dissolveMs
   (tiers A and B; at once at tier C, under reduced motion and in pre-rendered HTML), once: an image already decoded in
   this session draws on its first frame when it mounts again (a poster under Play, a photo landing after a morph).
   No image, or one that fails, shows the caller's `fallback` when it gives one (Train's category tile for an exercise
   poster, where a stock photo would read as someone showing the exercise), else the bundled photo of `fallbackSlot`
   (or a quiet gradient). The member's private progress photos use this too, but never with a stock fallback beside
   them: pass no fallbackSlot there.
   `onLoad` is called once the image has loaded (at once, after the first commit, for one already decoded in this
   session); a caller that starts something over the picture waits for it instead of a fixed time. */
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { remoteImage } from '@/lib/config';
import { fx } from '@/theme';
import { useFx } from '../effects';
import { motionValues } from '../motion/tokens';
import { bundledMedia } from './bundledMedia';
import { Photo, usePictureHold } from './Photo';

/** Addresses decoded in this session: they mount again without the dissolve or the ground. */
const decoded = new Set<string>();

export function RemotePhoto({ uri, width, height, alt, fallback, fallbackSlot, fallbackPick, opacity = 1, radius, contentFit = 'cover', style, decorative, onLoad }: {
  uri?: string | null; width?: number | null; height?: number | null; alt?: string;
  /** Drawn in the box instead of the picture when there is none or it fails (before fallbackSlot), at its own strength. */
  fallback?: React.ReactNode;
  fallbackSlot?: string; fallbackPick?: string | number;
  opacity?: number; radius?: number; contentFit?: 'cover' | 'contain'; style?: StyleProp<ViewStyle>; decorative?: boolean;
  /** Called once the image has loaded (at once for one already decoded in this session). */
  onLoad?: () => void;
}) {
  const { calm, inHtml, tier } = useFx();
  const [failed, setFailed] = useState(false);
  // inside a copy that waits for its pictures (PhotoMorph's opening copy on native): drawn once the image is displayed
  // (a failed one hands over to its fallback photo, which holds the copy itself)
  const shown = usePictureHold(uri && !failed ? uri : null);
  const warm = !!uri && decoded.has(uri);
  // the caller's onLoad: once per address (a decoded one is told after the first commit)
  const loadRef = useRef(onLoad);
  loadRef.current = onLoad;
  const told = useRef<string | null>(null);
  const tell = (u: string) => { if (told.current === u) return; told.current = u; loadRef.current?.(); };
  useEffect(() => { if (uri && decoded.has(uri)) tell(uri); }, [uri]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ground, setGround] = useState(!warm);
  const dissolve = warm || calm || inHtml || tier === 'C' ? 0 : motionValues.media.dissolveMs;
  // the ground goes once the image has dissolved over it
  const [loaded, setLoaded] = useState(warm);
  useEffect(() => {
    if (!loaded || !ground) return;
    const timer = setTimeout(() => setGround(false), dissolve);
    return () => clearTimeout(timer);
  }, [loaded, ground, dissolve]);
  const aspect = width && height ? { aspectRatio: width / height } : null;
  if ((!uri || failed) && fallback != null) {
    return <View accessible={false} importantForAccessibility="no-hide-descendants" style={[{ overflow: 'hidden' }, radius != null ? { borderRadius: radius } : null, aspect, style]}>{fallback}</View>;
  }
  if (!uri || failed) return <Photo slot={fallbackSlot} pick={fallbackPick} opacity={opacity} radius={radius} decorative style={[aspect, style]} />;
  const a11y = decorative || !alt
    ? { accessible: false, importantForAccessibility: 'no-hide-descendants' as const }
    : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: alt };
  return <View {...a11y} style={[{ overflow: 'hidden' }, radius != null ? { borderRadius: radius } : null, aspect, style]}>
    {ground ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ground]} /> : null}
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>{/* no image drag on the web (see Photo) */}
      <Image
        source={bundledMedia(uri) ?? remoteImage(uri)}
        contentFit={contentFit}
        transition={dissolve}
        recyclingKey={uri}
        onLoad={() => { decoded.add(uri); setLoaded(true); tell(uri); }}
        onDisplay={shown}
        onError={() => setFailed(true)}
        accessible={false}
        style={[StyleSheet.absoluteFill, { opacity }]}
      />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  ground: { backgroundColor: fx.premium.shimmer[0] },
});
