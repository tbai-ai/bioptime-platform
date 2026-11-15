/* Small pieces Home's cards share, in the earlier app's Home measures (THEME §11.4): the card header (a 15 pt red-400
   icon and a 14/600 title, something on the right), the section title above a strip ("Live sessions" with "See all"),
   the insight label (11/700 red with its glow) and the small tile of the activity card. Colours are kit tokens only. */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { fx, Icon, T, type IconName } from '@/fx';
import { touchSlopY } from '@/fx/press';

/** Card gutter (THEME §7: cards 20, titles 24). */
export const GUTTER = fx.space.cardX;

/** The touch box of a small control drawn `h` tall: padded above and below up to the platform's minimum target (44 pt,
 *  48 dp on Android) with a matching negative margin, so the row around it keeps its height. RN-web ignores hitSlop, and
 *  a parent clips a native hitSlop, so the box itself is made that tall. */
export function reach(h: number): ViewStyle {
  const k = touchSlopY(h);
  // minHeight counts the padding (border box), so the box is h + 2k even when its text line is shorter than h
  return { minHeight: h + 2 * k, paddingVertical: k, marginVertical: -k };
}
/** The small controls' drawn heights (their text line, their glyph). */
export const LINK_H = 24;

export function CardHead({ icon, title, right, iconColor = fx.red.label, strong = true, style }: { icon: IconName; title: string; right?: React.ReactNode; iconColor?: string; strong?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.head, style]}>
    <View style={styles.headLeft}>
      <Icon name={icon} size={16} color={iconColor} />
      <T v={strong ? 'sectionStrong' : 'section'} accessibilityRole="header" numberOfLines={1} style={styles.shrink}>{title}</T>
    </View>
    {right}
  </View>;
}

/** A section title with an optional "See all ›" link (Montserrat 14/500, the earlier app's `text-sm` Home titles). */
export function SectionTitle({ title, action, onAction, actionLabel, right, style }: { title: string; action?: string; onAction?: () => void; actionLabel?: string; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.section, style]}>
    <T v="section" accessibilityRole="header" style={styles.sectionTitle}>{title}</T>
    {right}
    {action && onAction ? <Pressable accessibilityRole="link" accessibilityLabel={actionLabel ?? action} onPress={onAction} hitSlop={{ left: 8, right: 8 }} style={({ pressed }) => [styles.link, LINK_REACH, pressed ? styles.pressed : null]}>
      <T v="chip" color={fx.red.vivid}>{action}</T>
      <Icon name="chevron-right" size={14} color={fx.red.vivid} />
    </Pressable> : null}
  </View>;
}

/** The red uppercase label of an insight card ("TODAY'S BRIEF", "FROM YOUR COACH") with its soft red glow. */
export function InsightLabel({ icon, children }: { icon: IconName; children: string }) {
  return <View style={styles.insight}>
    <Icon name={icon} size={15} color={fx.red.vivid} />
    <T v="overline" color={fx.red.vivid} style={styles.glow}>{children}</T>
  </View>;
}

/** A mini tile of the activity card: icon 13, mono 16 value, 9 pt uppercase label. */
export function MiniStat({ icon, value, label, a11y }: { icon: IconName; value: string; label: string; a11y: string }) {
  return <View style={styles.mini} accessible accessibilityLabel={a11y}>
    <Icon name={icon} size={13} color={fx.ink.a50} />
    <T v="mono14" style={styles.miniValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{value}</T>
    <T v="micro" color={fx.ink.a50} numberOfLines={2} center style={styles.miniLabel}>{label}</T>
  </View>;
}

/** "See all": 24 drawn, 44 (48 dp) to touch. */
const LINK_REACH = reach(LINK_H);

const styles = StyleSheet.create({
  // at a large text size the right-hand part moves under the title instead of squeezing it (flexWrap)
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, rowGap: 6, marginBottom: 16 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  section: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, rowGap: 4, marginBottom: 12, paddingHorizontal: GUTTER },
  sectionTitle: { flexShrink: 1, fontSize: 16, lineHeight: 22 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 24, paddingVertical: 2 },
  pressed: { opacity: 0.7 },
  insight: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  glow: { textShadowColor: fx.red.a50, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
  mini: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 10, borderRadius: fx.radius.xl, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.fill.a03 },
  miniValue: { fontSize: 16, lineHeight: 20 },
  // the label spans the tile (centred text) instead of its own measured width: on Android at font scale 1.0 the
  // uppercase, letter-spaced "This week" measured a hair narrower than it draws, wrapped "WEEK" to a clipped second line
  miniLabel: { alignSelf: 'stretch', letterSpacing: 0.6 },
});
