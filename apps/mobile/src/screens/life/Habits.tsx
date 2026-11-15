/* Habits in the kit (the habits module; GET /me/habits): the pieces Life's "Daily habits" and the Habits overlay share.
   - HabitRow: the earlier app's option row for a habit due today: a tap on the check records it done (the check pops,
     spring 400/20, with a light haptic) and a second tap takes it back; "Skip today" records a skip. The flame chip
     shows the streak the API counts and beats once when it grows; the seven dots are the last days as the API reports
     them (done, skipped, missed, not due).
   - HabitForm: add the member's own habit (every day, chosen days, or a number of times a week; an optional target).
   Check-ins are what the member records; streaks and weekly counts describe them, they are not a health measure. */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { api, errorText, post } from '@/lib/api';
import { Button, CheckPop, Field, FilterChip, fx, GlassCard, haptics, Icon, Input, Pill, T, timing, toast, useMotion } from '@/fx';
import { FitText } from '@/fx/wordFit';
import { LETTER, streakText, type DayCell, type Habit, type Schedule } from './data';

/** Record today's check-in (done or skipped) or take it back; the list reloads after. */
export async function checkHabit(h: Habit, to: 'done' | 'skipped' | 'undo', note?: string): Promise<void> {
  if (to === 'undo') await api('DELETE', `/me/habits/${h.id}/checkins/${h.today.date}`);
  else await post(`/me/habits/${h.id}/checkins`, { status: to, ...(note?.trim() ? { note: note.trim() } : {}) });
}

export function HabitRow({ h, onChanged }: { h: Habit; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<'done' | 'skipped' | null | undefined>(undefined);
  const state = local !== undefined ? local : h.today.checkin?.status ?? null;
  useEffect(() => { setLocal(undefined); }, [h.today.checkin?.status]);
  const due = h.status === 'active' && h.today.due;
  const run = async (to: 'done' | 'skipped' | 'undo') => {
    if (busy) return;
    setBusy(true);
    setLocal(to === 'undo' ? null : to);
    if (to === 'done') haptics.light(); else haptics.select();
    try { await checkHabit(h, to); if (to === 'done') toast.logged(`${h.title}: done today`); onChanged(); }
    catch (e) { setLocal(undefined); haptics.error(); toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const done = state === 'done';
  return <GlassCard padding={16} borderColor={done ? fx.red.a40 : undefined} style={[styles.row, done ? styles.rowDone : null]}>
    <View style={styles.top}>
      <View style={styles.flex}>
        {/* the habit and its schedule take more lines beside the streak and the check before an ellipsis, and a long
            word shrinks to stay whole ('Ten minutes / of reading b…' at 320 dp and text 1.0, and in four lines
            '… before b…' at text 2.0: RV2-2) */}
        <FitText v="cardTitle" numberOfLines={6} color={done ? fx.ink.white : fx.ink.a90}>{h.title}</FitText>
        <T v="caption" color={fx.ink.a60} numberOfLines={3}>{[h.scheduleLabel, h.targetLabel, h.setBy === 'coach' ? 'From your coach' : null].filter(Boolean).join(' · ')}</T>
      </View>
      <Streak h={h} />
      {due ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done, busy }} aria-checked={done}
        accessibilityLabel={`${h.title}: ${done ? 'done today' : state === 'skipped' ? 'skipped today' : 'not checked in'}`}
        accessibilityHint={done || state === 'skipped' ? 'Takes today’s check-in back' : 'Records it done today'}
        onPress={() => run(state ? 'undo' : 'done')} hitSlop={6} style={styles.check}>
        {state === 'skipped' ? <View style={[styles.empty, styles.skipped]}><Icon name="minus" size={14} color={fx.ink.a60} /></View>
          : <View>{!done ? <View style={styles.empty} /> : null}<CheckPop checked={done} size={28} style={done ? undefined : styles.overlay} /></View>}
      </Pressable> : null}
    </View>
    <View style={styles.bottom}>
      <Week cells={h.recent} />
      {h.status === 'paused' ? <Pill tone="warning">Paused</Pill>
        : !h.today.due ? <T v="caption" color={fx.ink.a50}>Not due today</T>
        : state === 'skipped' ? <T v="caption" color={fx.ink.a60}>Skipped today</T>
        : !state ? <Button title="Skip today" variant="link" style={styles.link44} small iconRight={null} disabled={busy} onPress={() => run('skipped')} label={`Skip ${h.title} today`} /> : <T v="caption" color={fx.red.label}>Done today</T>}
    </View>
  </GlassCard>;
}

/** The flame chip with the API's streak; it beats once (1 → 1.15 → 1, 400 ms) when the streak grows. */
function Streak({ h }: { h: Habit }) {
  const { still } = useMotion();
  const s = useSharedValue(1);
  const last = useRef(h.streak.count);
  useEffect(() => {
    if (h.streak.count > last.current && !still) s.set(withSequence(withTiming(1.15, timing(200)), withTiming(1, timing(200))));
    last.current = h.streak.count;
  }, [h.streak.count, still, s]);
  const a = useAnimatedStyle(() => ({ transform: s.get() === 1 ? [] : [{ scale: s.get() }] }));
  if (h.streak.count <= 0) return null;
  return <Animated.View style={[styles.streak, a]} accessible accessibilityLabel={streakText(h)}>
    <Icon name="flame" size={12} color={fx.red.brand} />
    <T v="mono12" color={fx.ink.white}>{`${h.streak.count}${h.streak.unit === 'weeks' ? 'w' : ''}`}</T>
  </Animated.View>;
}

/** The last days as the API reports them: done (red), skipped, missed (amber ring), not due (faint ring), today open.
 *  The letters are 10 pt and readable on each (white on the deep red fill, white/60 or more on the rest: AA 4.5:1). */
export function Week({ cells }: { cells: DayCell[] }) {
  return <View style={styles.week} accessible accessibilityLabel={`Recent days: ${cells.map((c) => `${c.date.slice(5)} ${c.status === 'off' ? 'not due' : c.status === 'missed' ? 'no check-in' : c.status}`).join(', ')}`}>
    {cells.map((c) => <View key={c.date} style={[styles.day, c.status === 'done' ? styles.dayDone : c.status === 'missed' ? styles.dayMissed : c.status === 'skipped' ? styles.daySkipped : c.status === 'off' ? styles.dayOff : styles.dayOpen]}>
      <T v="micro" color={c.status === 'done' ? fx.ink.white : c.status === 'off' ? fx.ink.a60 : fx.ink.a80} style={styles.dayText}>{LETTER[c.weekday]}</T>
    </View>)}
  </View>;
}

const WEEKDAYS: Array<[number, string]> = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];

/** Add the member's own habit. */
export function HabitForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<Schedule['type']>('daily');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [perWeek, setPerWeek] = useState(3);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schedule: Schedule = type === 'weekdays' ? { type, weekdays: [...weekdays].sort() } : type === 'times_per_week' ? { type, timesPerWeek: perWeek } : { type: 'daily' };
  const save = async () => {
    setBusy(true); setError(null);
    try { await post('/me/habits', { title: title.trim(), schedule, ...(target.trim() ? { targetLabel: target.trim() } : {}) }); haptics.success(); toast.logged('Habit added'); onDone(); }
    catch (e) { haptics.error(); setError(errorText(e)); } finally { setBusy(false); }
  };
  return <View style={styles.form}>
    <Field label="Habit" hint="A short, concrete action."><Input size="sheet" value={title} onChangeText={setTitle} maxLength={120} placeholder="For example, a glass of water on waking" /></Field>
    <Field label="When">
      <View style={styles.chips}>{([['daily', 'Every day'], ['weekdays', 'Chosen days'], ['times_per_week', 'Times a week']] as Array<[Schedule['type'], string]>).map(([t, l]) => <FilterChip key={t} label={l} selected={type === t} onPress={() => setType(t)} />)}</View>
    </Field>
    {type === 'weekdays' ? <Field label="Days"><View style={styles.chips}>{WEEKDAYS.map(([n, l]) => <FilterChip key={n} label={l} selected={weekdays.includes(n)} onPress={() => setWeekdays(weekdays.includes(n) ? weekdays.filter((x) => x !== n) : [...weekdays, n])} />)}</View></Field> : null}
    {type === 'times_per_week' ? <Field label="Times a week"><View style={styles.chips}>{[1, 2, 3, 4, 5, 6, 7].map((n) => <FilterChip key={n} label={String(n)} selected={perWeek === n} onPress={() => setPerWeek(n)} />)}</View></Field> : null}
    <Field label="Target (optional)" hint="As you would say it, for example 25 minutes."><Input size="sheet" value={target} onChangeText={setTarget} maxLength={80} /></Field>
    {error ? <T v="bodySm" color={fx.red.error} accessibilityRole="alert">{error}</T> : null}
    <Button title="Add habit" shape="flow" commit busy={busy} disabled={title.trim().length < 2 || (type === 'weekdays' && !weekdays.length)} onPress={save} />
  </View>;
}

const styles = StyleSheet.create({
  link44: { minHeight: 44, minWidth: 44, paddingHorizontal: 4 },
  row: { gap: 12 },
  rowDone: { backgroundColor: fx.red.a06 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  check: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: fx.line.a20, alignItems: 'center', justifyContent: 'center' },
  skipped: { borderStyle: 'dashed' },
  overlay: { position: 'absolute', left: 0, top: 0 },
  // the caption, Skip today or the Paused pill moves under the week's dots when both do not fit one line ('Not due
  // today' ran past the card's edge at 320 dp and text 2.0: N4)
  bottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, rowGap: 6, minHeight: 28 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: fx.radius.pill, backgroundColor: fx.red.a10, borderWidth: 1, borderColor: fx.red.a30 },
  week: { flexDirection: 'row', gap: 5 },
  day: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  dayDone: { backgroundColor: fx.red.fill, borderColor: fx.red.label, boxShadow: fx.shadow.dot },
  dayMissed: { borderColor: fx.status.caution, backgroundColor: fx.premium.transparent },
  daySkipped: { borderColor: fx.line.a20, borderStyle: 'dashed' },
  dayOff: { borderColor: fx.line.a05, backgroundColor: fx.premium.transparent },
  dayOpen: { borderColor: fx.line.a20, backgroundColor: fx.fill.a05 },
  dayText: { fontSize: 10, lineHeight: 12, letterSpacing: 0 },
  form: { gap: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
