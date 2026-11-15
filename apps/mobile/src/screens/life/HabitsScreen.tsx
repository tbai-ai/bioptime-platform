/* Habits (overlay "Manage" from Life, Home and old links): everything the old Habits screen did, in the kit's chrome.
   Today's check-in (done or skipped, with an optional note, and undo), this week and the streak, the last days, the
   reminder times (up to four, 24-hour, in the member's time zone), pause, resume and archive for the member's own
   habits, and adding one. On a habit the coach set, only the reminders are the member's to change; the server
   enforces the same. Push to the phone is not connected yet: reminders arrive in Notifications. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Alert } from '@/lib/alert';
import { errorText, get, patch } from '@/lib/api';
import { invalidate, useLoad } from '@/lib/useLoad';
import {
  Button, EmptyState, ErrorState, Field, FilterChip, fx, GlassCard, haptics, Input, Overlay, Pill, Reveal, Sheet, Skeleton, StaleBanner, T, toast, Toggle,
  useFocusRefresh,
} from '@/fx';
import { checkHabit, HabitForm, Week } from './Habits';
import { streakText, type Habit, type HabitList } from './data';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Who sees what (under the list rather than in the header, which keeps to one line). */
const SHARING = 'Your coach sees the habits a coach set for you and what you complete on them. Habits you add yourself, and your notes, reach your coach only while health sharing is on.';

export default function HabitsScreen() {
  const list = useLoad<HabitList>('habits', () => get('/me/habits'), []);
  useFocusRefresh(list.reload);
  const [adding, setAdding] = useState(false);
  const d = list.data;
  const items = (d?.items ?? []).filter((h) => h.status !== 'archived');
  const changed = () => { void list.reload(); invalidate(['habits']); };
  return <View style={styles.fill}>
    <Overlay title="Habits" subtitle="Check in on the days you do them."
      kind="back" fallback="/(tabs)/life" footer={<Button title="Add a habit" icon="plus" shape="flow" onPress={() => setAdding(true)} />}>
      <StaleBanner at={list.stale} />
      <ErrorState error={list.error} onRetry={list.reload} />
      {list.loading && !d ? <View style={styles.gap}><Skeleton height={240} radius={fx.radius.card} /><Skeleton height={240} radius={fx.radius.card} /></View> : null}
      {d && !items.length ? <EmptyState icon="list-checks" title="No habits yet" body="Add one of your own, or your coach sets them from your plan." /> : null}
      {items.map((h, i) => <Reveal key={h.id} index={i}><HabitCard h={h} onChanged={changed} /></Reveal>)}
      {d ? <T v="caption" color={fx.ink.a55}>{SHARING}</T> : null}
      {d ? <T v="caption" color={fx.ink.a55}>{`${d.delivery.detail} Times are in ${d.timezone}. ${d.note}`}</T> : null}
    </Overlay>
    <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a habit">
      {adding ? <HabitForm onDone={() => { setAdding(false); changed(); }} /> : null}
    </Sheet>
  </View>;
}

function HabitCard({ h, onChanged }: { h: Habit; onChanged: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [times, setTimes] = useState<string[] | null>(null);
  const [newTime, setNewTime] = useState('');
  const c = h.today.checkin;
  const run = async (fn: () => Promise<unknown>, done?: string, after?: () => void) => {
    setBusy(true);
    try { await fn(); after?.(); if (done) toast.logged(done); onChanged(); } catch (e) { haptics.error(); toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const saveReminders = (body: { reminderTimes?: string[]; remindersOn?: boolean }) => run(() => patch(`/me/habits/${h.id}`, body), 'Reminders saved', () => setTimes(null));
  const addTime = () => { if (!times || !TIME_RE.test(newTime) || times.includes(newTime) || times.length >= 4) return; setTimes([...times, newTime].sort()); setNewTime(''); };
  const archive = () => Alert.alert(`Archive “${h.title}”?`, 'It stops running and leaves your list. Your check-ins stay in your record.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Archive', style: 'destructive', onPress: () => void run(() => patch(`/me/habits/${h.id}`, { status: 'archived' }), 'Habit archived') },
  ]);
  const weekText = h.week.target ? `${h.week.done} of ${h.week.target} this week` : 'Nothing due this week';
  return <GlassCard style={styles.card} rule={h.today.due && !c && h.status === 'active' ? { color: fx.red.brand, width: 4 } : undefined}>
    <T v="label">{`${h.scheduleLabel}${h.targetLabel ? ` · ${h.targetLabel}` : ''}`}</T>
    <T v="cardTitle">{h.title}</T>
    {h.setBy === 'coach' || h.status === 'paused' ? <View style={styles.pills}>{h.setBy === 'coach' ? <Pill>From your coach</Pill> : null}{h.status === 'paused' ? <Pill tone="warning">Paused</Pill> : null}</View> : null}
    {h.detail ? <T v="bodySm" color={fx.ink.a70}>{h.detail}</T> : null}

    {h.status === 'paused' ? <T v="body" color={fx.ink.a60}>Paused. Paused days are not counted.</T>
      : c ? <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Pill tone={c.status === 'done' ? 'success' : 'info'}>{c.status === 'done' ? 'Done today' : 'Skipped today'}</Pill>
          {c.note ? <T v="bodySm" color={fx.ink.a60} style={styles.noteText}>{c.note}</T> : null}
        </View>
        <Button title="Undo" variant="soft" small full={false} busy={busy} label={`Undo today's check-in of ${h.title}`} onPress={() => run(() => checkHabit(h, 'undo'), 'Check-in taken back')} />
      </View>
        : h.today.due ? <View style={styles.gapSm}>
          <Field label="Note (optional)"><Input size="sheet" value={note} onChangeText={setNote} maxLength={500} multiline placeholder="Anything worth remembering about today" style={styles.note} /></Field>
          <View style={styles.dueActions}>
            <Button title="Done" icon="check" small full={false} commit busy={busy} label={`${h.title}: done today`} onPress={() => { haptics.light(); void run(() => checkHabit(h, 'done', note), `${h.title}: done today`, () => setNote('')); }} style={styles.grow} />
            <Button title="Skip today" variant="soft" small full={false} disabled={busy} label={`Skip ${h.title} today`} onPress={() => run(() => checkHabit(h, 'skipped', note), 'Skipped today', () => setNote(''))} />
          </View>
        </View>
        : <T v="body" color={fx.ink.a60}>Not due today.</T>}

    <View style={styles.weekRow}>
      <T v="bodySm" style={styles.weekText}>{weekText}</T>
      <T v="caption" color={h.streak.count ? fx.red.label : fx.ink.a50} style={styles.streakText}>{streakText(h)}</T>
    </View>
    <Week cells={h.recent} />

    <View style={styles.reminders}>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <T v="section">{h.reminderTimes.length ? `Reminders at ${h.reminderTimes.join(', ')}` : 'Reminders'}</T>
          {!h.reminderTimes.length ? <T v="caption" color={fx.ink.a50}>Choose a time first.</T> : null}
        </View>
        <Toggle value={h.remindersOn} label={`Reminders for ${h.title}`} disabled={busy} onChange={(v) => { if (!h.reminderTimes.length && v) { setTimes([]); return; } void saveReminders({ remindersOn: v }); }} />
      </View>
      {times === null ? <Button title={h.reminderTimes.length ? 'Change reminder times' : 'Set reminder times'} variant="link" style={styles.link44} small icon="clock" iconRight={null} onPress={() => setTimes(h.reminderTimes)} />
        : <View style={styles.gapSm}>
          <View style={styles.pills}>{times.length ? times.map((t) => <FilterChip key={t} label={`${t} ✕`} onPress={() => setTimes(times.filter((x) => x !== t))} />) : <T v="caption" color={fx.ink.a50}>No times yet.</T>}</View>
          <View style={styles.actions}>
            <View style={styles.flex}><Input size="sheet" value={newTime} onChangeText={setNewTime} placeholder="HH:MM, 24-hour" maxLength={5} keyboardType="numbers-and-punctuation" label="New reminder time" mono /></View>
            <Button title="Add" variant="soft" small full={false} onPress={addTime} disabled={!TIME_RE.test(newTime) || times.length >= 4} />
          </View>
          <View style={styles.actions}>
            <Button title="Save reminders" small full={false} busy={busy} onPress={() => saveReminders({ reminderTimes: times, remindersOn: times.length > 0 })} style={styles.flex} />
            <Button title="Cancel" variant="link" style={styles.link44} small iconRight={null} onPress={() => setTimes(null)} />
          </View>
        </View>}
    </View>

    {h.setBy === 'member' ? <View style={styles.actions}>
      <Button title={h.status === 'paused' ? 'Resume' : 'Pause'} variant="soft" small full={false} disabled={busy} label={`${h.status === 'paused' ? 'Resume' : 'Pause'} ${h.title}`} onPress={() => run(() => patch(`/me/habits/${h.id}`, { status: h.status === 'paused' ? 'active' : 'paused' }), h.status === 'paused' ? 'Habit resumed' : 'Habit paused')} />
      <Button title="Archive" variant="link" style={styles.link44} small iconRight={null} disabled={busy} label={`Archive ${h.title}`} onPress={() => { haptics.warning(); archive(); }} />
    </View> : <T v="caption" color={fx.ink.a50}>Set by your coach. Its reminders are yours to change; ask your coach about the rest.</T>}
  </GlassCard>;
}

const styles = StyleSheet.create({
  link44: { minHeight: 44, minWidth: 44, paddingHorizontal: 4 },
  // the note is a text area (its placeholder wraps instead of ending in an ellipsis at the default size: INV-03)
  note: { minHeight: 72, textAlignVertical: 'top' },
  fill: { flex: 1 },
  gap: { gap: 16 },
  gapSm: { gap: 10 },
  card: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // Done takes the line's free width at its own width at least, and Skip today moves under it when both do not fit (a
  // narrow phone, a large text size) instead of squeezing Done to a letter (SWA-01)
  dueActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  grow: { flexGrow: 1 },
  // the week count and the streak: the streak moves under the count when both do not fit one line, and wraps inside
  // the card rather than running past its edge. Each takes the line's free width (the streak drawn at its end): a label
  // whose box hugs its text lost its last word on Android, laid out a hair under the width it measured ('3 of 4 this',
  // '2 weeks in a' at the default size: VA-1; as H's title)
  weekRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: 2 },
  weekText: { flexGrow: 1, flexShrink: 1 },
  streakText: { flexGrow: 1, flexShrink: 1, textAlign: 'right' },
  noteText: { marginTop: 6 },
  reminders: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: fx.line.a05 },
});
