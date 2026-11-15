/* One of the member's own progress photos (private), shared by the Home gallery and the Progress photos screen. It
   opens through a link that lasts five minutes (POST /files/:id/token) and is kept in memory only, never in the image
   disk cache (the photo is private and the server's no-store does not reach native image caches). While it downloads
   the box shows a quiet placeholder; if it cannot be shown, a short line with Try again, which asks for a new link. A
   link that has run out is renewed once without asking, and a refresh renews a link older than four minutes. It fades
   in over 300 ms and nothing else moves (no tilt, no grade, no parallax: PREMIUM §1.10). */
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { errorText, post } from '@/lib/api';
import { apiBaseSync, remoteImage } from '@/lib/config';
import { fx, RingSpinner, T, useMotion } from '@/fx';

const LINK_RENEW_MS = 4 * 60 * 1000; // a photo link lasts five minutes; one older than four is renewed before use

export function PrivatePhoto({ fileId, refreshed, label = 'Progress photo', style, radius = fx.radius.card }: { fileId: string; refreshed?: unknown; label?: string; style?: StyleProp<ViewStyle>; radius?: number }) {
  const { still } = useMotion();
  const [attempt, setAttempt] = useState(0);
  const [link, setLink] = useState<{ uri: string; at: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const shown = useSharedValue(0);
  useEffect(() => {
    let alive = true;
    setLink(null); setErr(null); shown.set(0);
    post<{ url: string }>(`/files/${fileId}/token`).then((t) => { if (alive) setLink({ uri: `${apiBaseSync()}${t.url}`, at: Date.now() }); }, (e) => { if (alive) setErr(errorText(e)); });
    return () => { alive = false; };
  }, [fileId, attempt, shown]);
  const oldLink = () => !!link && Date.now() - link.at > LINK_RENEW_MS;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (oldLink()) setAttempt((n) => n + 1); }, [refreshed]);
  const retry = () => setAttempt((n) => n + 1);
  const failed = () => { if (oldLink()) retry(); else setErr('This photo could not be loaded.'); };
  const fade = useAnimatedStyle(() => ({ opacity: shown.get() }));
  return <View style={[styles.box, { borderRadius: radius }, style]}>
    {link && !err ? <Animated.View style={[StyleSheet.absoluteFill, fade]}>
      <Image source={remoteImage(link.uri)} cachePolicy="memory" style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={label}
        onLoad={() => { shown.set(still ? 1 : withTiming(1, { duration: 300 })); }} onError={failed} />
    </Animated.View> : null}
    {err ? <View style={styles.center}>
      <T v="caption" color={fx.ink.a60} center>{err}</T>
      <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={retry} hitSlop={8} style={styles.retry}><T v="chip" color={fx.red.vivid}>Try again</T></Pressable>
    </View> : !link ? <View style={styles.center} accessibilityLabel="Loading the photo"><RingSpinner /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: fx.bg.card, borderWidth: 1, borderColor: fx.line.a10 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 },
  retry: { minHeight: 24, justifyContent: 'center' },
});
