/* Habits, sleep and goals on Home (THEME §11.6, GAP_MAP §4.4).
   - StreakCard (habits on): seven 32 pt days, Monday to Sunday; a day is lit (the red gradient, its glow and a flame)
     when every habit due that day was checked in. The number is the best current streak of one habit, so it says so
     ("Best habit", and under the days which habit and how long), never reading as a count of the lit days. Opens
     Life › Habits.
     Motion (motion v2 M64, M67): from the card's own entrance (its Reveal's landing clock, the kit's data rule) the
     lit days fill from their centre on the drop spring, one after another (60 ms apart, at most 4 steps), their ring
     and glow fading in with the fill, and each flame rises 4 pt into place. Once per day per launch (a revisit shows
     them lit); tier C: a fade; reduced motion: lit from the first frame.
   - LastNightCard: the latest sleep the member logged, as a total (no stages: Bioptime has no stage data). With a sleep
     goal the bar runs to it; without one there is no bar. Titled "Last night" only when the value is from last night.
   - GoalsCard: active measurable goals against target, thin bars that turn green at 100 %, each row 44 pt (48 dp) to
     touch without growing the card (parts reach): a day's total (steps,
     water) counts today only, as the cards beside it do; any other goal shows its latest value with the day it was
     logged when that was not today. Titled "Today's goals" when every row is about today, else "Goals". No goal:
     "Set a goal", and the focus picked in the quiz ("Your focus"), each a chip that opens Set a goal with its words.
     A row answers a press as the app's cards do (the kit's press, CRT-2), and its value moves under the title when the
     title's longest word would not fit beside it (measured: Beside, SWA-07). */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { AnimatedPressable, Button, FilterChip, fx, GlassCard, Icon, ProgressBar, Scrim, spring, T, useMotion, usePress, type IconName } from '@/fx';
import { useDataStart } from '@/fx/motion/Reveal';
import { markSeen, seenValue } from '@/fx/motion/seen';
import { ease, motionValues, t, timing } from '@/fx/motion/tokens';
import { istDate } from '@/lib/format';
import { Beside } from '../bio/wordFit';
import { CardHead, reach } from './parts';
import { dayMonth, hoursSpoken, hoursText, istDayOf, num, type GoalRow, type StreakDay } from './data';

const DAY_WORD: Record<StreakDay['state'], string> = { done: 'every habit done', missed: 'not every habit done', open: 'today, still open', rest: 'no habit due', future: 'still to come' };

function Day({ day, order }: { day: StreakDay; order: number }) {
  const { still, tier } = useMotion();
  const lit = day.state === 'done';
  const key = `home.streak.${day.date}`;
  // decided once, at mount: an unlit day, reduced motion, or a day already filled in this run is at rest
  const [rest] = useState(() => !lit || still || seenValue(key) === 1);
  const fill = useSharedValue(rest ? 1 : 0);
  const flame = useSharedValue(rest ? 1 : 0);
  const lite = tier === 'C';
  const remember = () => markSeen(key, 1);
  // from the card's own entrance; lit days in order, the kit's data steps apart
  useDataStart(undefined, order, lit && !rest, (wait) => {
    'worklet';
    scheduleOnRN(remember);
    const f = lite ? withTiming(1, timing(motionValues.reveal.C.duration, ease.expo)) : withSpring(1, spring.drop);
    fill.set(wait > 0 ? withDelay(wait, f) : f);
    const rise = withTiming(1, timing(lite ? motionValues.reveal.C.duration : t.base, ease.expo));
    flame.set(wait > 0 ? withDelay(wait, rise) : rise);
  });
  useEffect(() => { if (still) { fill.set(1); flame.set(1); } }, [still, fill, flame]);
  // the red fill grows from the centre (clipped by the round day); the lit ring and glow fade in with it
  const fillStyle = useAnimatedStyle(() => {
    const k = fill.get();
    if (k === 1) return { opacity: 1, transform: [] };
    return lite ? { opacity: k, transform: [] } : { opacity: Math.min(1, k * 2), transform: [{ scale: Math.max(0, k) }] };
  });
  const ringStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, fill.get())) }));
  const flameStyle = useAnimatedStyle(() => {
    const k = flame.get();
    if (k === 1) return { opacity: 1, transform: [] };
    return { opacity: k, transform: [{ translateY: lite ? 0 : (1 - k) * motionValues.screens.m67.streakRise }] };
  });
  return <View style={styles.dayCol} accessible accessibilityLabel={`${day.name}: ${DAY_WORD[day.state]}`}>
    <View style={[styles.day, day.state === 'open' ? styles.dayOpen : null]}>
      {lit ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.round, styles.dayLit, ringStyle]} /> : null}
      {lit ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.round, styles.clip]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.round, fillStyle]}>
          <Scrim kind="streakDay" style={[StyleSheet.absoluteFill, styles.round]} />
        </Animated.View>
      </View> : null}
      {lit ? <Animated.View style={flameStyle}><Icon name="flame" size={12} color={fx.ink.white} /></Animated.View> : null}
    </View>
    <T v="micro" color={day.state === 'open' ? fx.ink.white : fx.ink.a50} style={styles.letter}>{day.letter}</T>
  </View>;
}

export function StreakCard({ days, best, unit, bestTitle, onPress }: { days: StreakDay[]; best: number | null; unit: string; bestTitle: string | null; onPress: () => void }) {
  const run = best ? `${num(best)} ${unit === 'weeks' ? (best === 1 ? 'week' : 'weeks') : best === 1 ? 'check-in' : 'check-ins'} in a row` : '';
  return <GlassCard onPress={onPress} label={`Daily streak: a lit day is one with every habit done${best ? `. Best habit streak: ${bestTitle ? `${bestTitle}, ` : ''}${run}` : ''}. Opens your habits`}>
    <CardHead icon="flame" title="Daily streak" strong={false} right={best ? <View style={styles.best}>
      <T v="micro" color={fx.ink.a60}>Best habit</T>
      <Icon name="flame" size={16} color={fx.red.vivid} />
      <T v="mono14" color={fx.red.vivid} style={styles.bestText}>{num(best)}</T>
    </View> : null} />
    <View style={styles.week}>{days.map((d, i) => <Day key={d.date} day={d} order={days.slice(0, i).filter((x) => x.state === 'done').length} />)}</View>
    {best && bestTitle ? <T v="caption" color={fx.ink.a60} numberOfLines={2} style={styles.bestLine}>{`${bestTitle} · ${run}`}</T> : null}
  </GlassCard>;
}

export function LastNightCard({ hours, at, source, target, onPress }: { hours: number; at: string; source: string | null; target: number | null; onPress: () => void }) {
  const day = istDayOf(at);
  const lastNight = day === istDate() || day === istDate(-1);
  const title = lastNight ? 'Last night' : 'Latest sleep';
  return <GlassCard onPress={onPress} label={`${title}: ${hoursSpoken(hours)} of sleep${target ? `, goal ${num(target, 1)} hours` : ''}. Opens sleep in Bio`}>
    <CardHead icon="moon" title={title} strong={false} right={<T v="mono14" style={styles.sleepTotal}>{hoursText(hours)}</T>} />
    {target ? <>
      <ProgressBar value={hours / target} size="medium" completeGreen duration={800} />
      <View style={styles.sleepFoot}>
        <T v="caption" color={fx.ink.a60}>{[source ?? 'Logged', lastNight ? null : dayMonth(at)].filter(Boolean).join(' · ')}</T>
        <T v="caption" color={fx.ink.a60}>{`Goal ${num(target, 1)} h`}</T>
      </View>
    </> : <T v="caption" color={fx.ink.a60}>{[source ?? 'Logged', dayMonth(at)].join(' · ')}</T>}
  </GlassCard>;
}

function GoalLine({ g, today, onOpen }: { g: GoalRow; today: string; onOpen: () => void }) {
  const press = usePress('card', 0, { scroll: true });
  const when = g.at && istDayOf(g.at) !== today ? dayMonth(g.at) : null; // a value not from today says when it was logged
  const value = g.latest == null ? (g.daily ? 'nothing logged today' : 'nothing logged yet') : `${num(g.latest, g.decimals)} of ${num(g.target, g.decimals)} ${g.unit}${g.daily ? ' today' : when ? `, logged ${when}` : ''}`;
  return <AnimatedPressable {...press.scrollProps} accessibilityRole="button" accessibilityLabel={`${g.title}: ${value}`} onPress={onOpen}
    onPressIn={press.onPressIn} onPressOut={press.onPressOut} style={[styles.goal, GOAL_REACH, press.style]}>
    <View style={styles.goalTop}>
      <Icon name={GOAL_ICON[g.metric] ?? 'target'} size={16} color={fx.red.vivid} />
      <Beside words={[{ text: g.title, v: 'body' }]} gap={10} underGap={2} lines={3} style={styles.goalTitle}
        side={<T v="mono12" color={fx.ink.a80}>{`${g.latest == null ? '—' : num(g.latest, g.decimals)} / ${num(g.target, g.decimals)}`}</T>}>
        <T v="body" numberOfLines={3}>{g.title}</T>
      </Beside>
    </View>
    {when ? <T v="caption" color={fx.ink.a55} style={styles.when}>{`Latest, ${when}`}</T> : null}
    <ProgressBar value={g.share} size="thin" />
  </AnimatedPressable>;
}

const GOAL_ICON: Record<string, IconName> = { steps: 'zap', sleep_hours: 'moon', water_ml: 'droplets', weight_kg: 'scale', workout_minutes: 'dumbbell', resting_hr_bpm: 'heart-pulse', waist_cm: 'ruler' };

export function GoalsCard({ rows, focus = [], onOpen, onSet, onFocus }: { rows: GoalRow[]; focus?: string[]; onOpen: () => void; onSet: () => void; onFocus?: (focus: string) => void }) {
  const today = istDate();
  const allToday = rows.every((g) => g.daily);
  return <GlassCard>
    <CardHead icon="target" title={allToday ? "Today's goals" : 'Goals'} strong={false} />
    {rows.length ? <View style={styles.goals}>
      {rows.map((g) => <GoalLine key={g.id} g={g} today={today} onOpen={onOpen} />)}
    </View> : <View style={styles.noGoals}>
      <T v="body" color={fx.ink.a60}>No measurable goal yet.</T>
      {focus.length && onFocus ? <>
        <T v="bodySm" color={fx.ink.a70}>{`Your focus: ${focus.join(' · ')}. Make one measurable:`}</T>
        <View style={styles.focus}>{focus.map((f) => <FilterChip key={f} label={f} icon="target" onPress={() => onFocus(f)} />)}</View>
      </> : null}
      <Button title="Set a goal" variant="redTint" icon="plus" onPress={onSet} />
    </View>}
  </GlassCard>;
}

/** A goal row's drawn height on one title line (the line and its bar); it reaches 44 pt (48 dp) to touch, and the 16 pt
 *  between rows keeps neighbouring rows' touch boxes apart. */
const GOAL_ROW_H = 34;
const GOAL_REACH = reach(GOAL_ROW_H);

const styles = StyleSheet.create({
  best: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bestLine: { marginTop: 14 },
  bestText: { fontSize: 18, lineHeight: 22 },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  dayCol: { alignItems: 'center', gap: 8, minWidth: 32 },
  day: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.fill.a05, borderWidth: 1, borderColor: fx.line.a10 },
  // the lit ring and its glow: a layer over the day's own ring, faded in (the glow is never animated itself)
  dayLit: { margin: -1, borderWidth: 1, borderColor: fx.red.label, boxShadow: `0px 0px 12px ${fx.red.a50}` },
  clip: { overflow: 'hidden' },
  dayOpen: { borderColor: fx.red.a50 },
  round: { borderRadius: 16 },
  letter: { fontSize: 10 },
  sleepTotal: { fontSize: 16 },
  sleepFoot: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 8 },
  goals: { gap: 16 },
  goal: { gap: 8 },
  goalTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  goalTitle: { flex: 1, minWidth: 0 },
  when: { marginTop: -4, marginLeft: 26 },
  noGoals: { gap: 12, alignItems: 'flex-start' },
  focus: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
