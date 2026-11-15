/* The scroll of the Learn overlays (course and lesson): a cover photo that stretches on pull and moves at 0.4× as the page
   scrolls (the motion kit's StretchyHeader), the content in the 520 pt column rising over the cover's faded bottom, and,
   for a lesson, a 2 pt red reading bar under the header that fills with how far the text has been read (scaleX from
   the left; at rest it simply shows the share). Lives inside <Overlay scroll={false}> (FILL_OVERLAY resets the
   overlay's own column so the cover can run full width). */
import React from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedRef, useAnimatedStyle, useScrollOffset, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLUMN, fx, haptics, Photo, RemotePhoto, Scrim, StretchyHeader } from '@/fx';
import type { Cover } from '../data';

/** Overlay contentStyle that hands the whole area to ReadingScroll. */
export const FILL_OVERLAY = { flex: 1, maxWidth: '100%', paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, gap: 0 } as const;

export function CoverPhoto({ cover }: { cover?: Cover }) {
  return cover?.url ? <RemotePhoto uri={cover.url} fallbackSlot="learn.cover.fallback" decorative style={StyleSheet.absoluteFill} />
    : <Photo slot="learn.cover.fallback" decorative style={StyleSheet.absoluteFill} />;
}

export function ReadingScroll({ cover, coverHeight, reading, refreshing, onRefresh, children }: {
  cover: React.ReactNode; coverHeight?: number; reading?: boolean; refreshing?: boolean; onRefresh?: () => void; children: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const h = coverHeight ?? (width >= 768 ? 300 : width <= 360 ? 200 : 240);
  const ref = useAnimatedRef<Animated.ScrollView>();
  const y = useScrollOffset(ref);
  const content = useSharedValue(1);
  const frame = useSharedValue(1);
  const bar = useAnimatedStyle(() => {
    const room = content.get() - frame.get();
    const k = room > 4 ? Math.max(0, Math.min(1, y.get() / room)) : 1;
    return { transform: [{ scaleX: k }] };
  });
  return <View style={styles.fill}>
    <Animated.ScrollView
      ref={ref}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onLayout={(e) => frame.set(e.nativeEvent.layout.height)}
      onContentSizeChange={(_, ch) => content.set(ch)}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={() => { haptics.refresh(); onRefresh(); }} tintColor={fx.red.brand} colors={[fx.red.brand]} progressBackgroundColor={fx.bg.card} /> : undefined}
      contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}>
      <StretchyHeader scrollY={y} height={h} base={0.55} photo={cover}>
        <Scrim kind="programme" style={StyleSheet.absoluteFill} />
      </StretchyHeader>
      <View style={[styles.column, { paddingTop: h - 72 }]}>{children}</View>
    </Animated.ScrollView>
    {reading ? <View style={styles.track} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.bar, bar]} />
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: { width: '100%', maxWidth: COLUMN, alignSelf: 'center', paddingHorizontal: 20, gap: 16 },
  track: { position: 'absolute', left: 0, right: 0, top: 0, height: 2, backgroundColor: fx.fill.a05 },
  bar: { height: 2, backgroundColor: fx.red.brand, transformOrigin: 'left', boxShadow: fx.shadow.dot },
});
