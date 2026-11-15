/* "Your first week" (a new member's Home, above the Wellness card): what to do next, from real actions only, each row
   ticked (the kit's CheckPop) once its record exists. Shown for the first seven days of the account while something on
   it is still to do when Home opens; a member past their first week, or with every row done, never sees it. Home decides
   the card and its rows once per launch (HomeScreen), so a card on screen keeps its rows and stays to show the last
   tick ("4/4") instead of vanishing from above the Wellness card.
   Rows, each only where it applies (its module on, the package including it):
   - log a glass of water (water on: any water value logged), opens Log a value on water;
   - tick a habit (habits on: any habit checked in on a recent day; without a habit yet, "Add a habit"), opens Life's
     habits;
   - finish your first session (workouts on, sessions planned: one done or partly done this week), opens Train;
   - book your included blood test (a blood test in the package: a booking exists), opens Tests.
   Nothing is invented: a row whose record Home cannot see (a meal, a message) is not offered. A tick pops when the
   record arrives while the card is on screen (a reload after the action); a row already done is drawn ticked at rest.
   The card is a GlassCard with the red rule, Bebas-free (it is a list), black and red, no imagery. */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CheckPop, fx, GlassCard, Icon, T, type IconName } from '@/fx';
import { InsightLabel } from './parts';

export type FirstWeekRow = { key: string; title: string; done: boolean; icon: IconName; onPress: () => void };

/** The account is in its first seven days (`createdAt`, the session's own account). */
export function inFirstWeek(createdAt: string | null | undefined, now = Date.now()): boolean {
  const at = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(at) && now - at < 7 * 86_400_000;
}

export function FirstWeekCard({ rows }: { rows: FirstWeekRow[] }) {
  const done = rows.filter((r) => r.done).length;
  return <GlassCard rule={{ color: fx.red.brand }} label={`Your first week: ${done} of ${rows.length} done`}>
    <View style={styles.head}>
      <InsightLabel icon="flag">Your first week</InsightLabel>
      <T v="mono12" color={fx.ink.a70}>{`${done}/${rows.length}`}</T>
    </View>
    <View style={styles.list}>
      {rows.map((r) => <Pressable key={r.key} accessibilityRole="button" accessibilityState={{ checked: r.done }} accessibilityLabel={`${r.title}${r.done ? ': done' : ''}`}
        onPress={r.onPress} style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
        <View style={styles.tick}><CheckPop checked={r.done} size={20} color={fx.hue.green500} empty /></View>
        <Icon name={r.icon} size={16} color={r.done ? fx.ink.a50 : fx.red.label} />
        <T v="section" color={r.done ? fx.ink.a60 : fx.ink.white} numberOfLines={2} style={styles.title}>{r.title}</T>
        <Icon name="chevron-right" size={16} color={fx.ink.a40} />
      </Pressable>)}
    </View>
  </GlassCard>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  list: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 6, borderRadius: fx.radius.lg },
  pressed: { backgroundColor: fx.fill.a05 },
  tick: { width: 20, height: 20 },
  title: { flex: 1, minWidth: 0 },
});
