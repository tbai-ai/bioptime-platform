/* The Coach tab's sticky header (THEME §11.2 "AI"): #0A0A0A/80 with a blur where the device allows, a white/5 rule
   under it, pt = top inset + 12, px 20, pb 12. The coach is the 40 pt monogram medallion of their initials (there is
   no coach photo in the API, and a stock face never stands for a coach): it has the brand mark's stacked depth and
   follows a finger. The status dot on it is static (green active, amber away, grey none) and its word is in the line
   under the name ("Your coach · Active"), so the colour never carries the meaning alone; there is no "online" claim.
   The name sits on its own line. The name and the info button open the coach's profile sheet; the unread count is
   part of what a screen reader hears. While the Coach page is in front, the top toast lane starts 8 pt below this
   header (M19: a toast such as "Breathing started" never covers the name or the info button). */
import { BlurView } from 'expo-blur';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLUMN, FONTS, IconButton, Medallion, T, fx, useFx } from '@/fx';
import { usePageSettled } from '@/fx/nav/pageReady';
import { useTopToastClearance } from '@/fx/Toast';
import { STATUS_WORD, StatusDot, type CoachStatus } from './parts';

export function CoachHeader({ name, status, unread, onOpen, children }: { name: string; status: CoachStatus; unread: number; onOpen: () => void; children?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { blur } = useFx();
  // the header's bottom edge in window points, measured at rest (it is sticky: it never scrolls away)
  const wrap = useRef<React.ComponentRef<typeof View>>(null);
  const [bottom, setBottom] = useState(0);
  const inFront = usePageSettled();
  useTopToastClearance(bottom, inFront && bottom > 0);
  const measure = () => { wrap.current?.measureInWindow((_x: number, y: number, w: number, h: number) => { if (w && h) setBottom(Math.round(y + h)); }); };
  const heard = `${name}, your coach, ${STATUS_WORD[status].toLowerCase()}${unread ? `. ${unread} unread message${unread === 1 ? '' : 's'}` : ''}`;
  return <View ref={wrap} onLayout={measure} collapsable={false} style={[styles.wrap, { paddingTop: insets.top + 12, backgroundColor: blur ? fx.glass.header : fx.glass.headerLite }]}>
    {blur ? <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} /> : null}
    <View style={styles.row}>
      <View style={styles.medal}>
        <Medallion name={name} size={40} follow />
        <StatusDot status={status} style={styles.dot} />
      </View>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={heard} accessibilityHint="Opens your coach's profile" style={({ pressed }) => [styles.who, pressed ? styles.pressed : null]}>
        {/* the name and the status shrink to fit their line whole at a large text size ('Asha Meno…') */}
        <T style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{name}</T>
        <T v="caption" color={fx.ink.a70} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.sub}>{`Your coach · ${STATUS_WORD[status]}`}</T>
      </Pressable>
      <IconButton icon="info" label={`About ${name}`} onPress={onOpen} iconSize={17} color={fx.ink.a80} />
    </View>
    {children}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: fx.line.a05, overflow: 'hidden', zIndex: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, width: '100%', maxWidth: COLUMN + 40, alignSelf: 'center' },
  medal: { width: 40, height: 40 },
  dot: { position: 'absolute', right: -3, bottom: -3 },
  who: { flex: 1, minWidth: 0, paddingVertical: 2, borderRadius: fx.radius.lg },
  pressed: { opacity: 0.8 },
  name: { fontFamily: FONTS.sans500, fontSize: 18, lineHeight: 24, color: fx.ink.white },
  sub: { fontSize: 12, lineHeight: 17 },
});
