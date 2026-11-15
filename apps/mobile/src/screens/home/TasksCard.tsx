/* Today's tasks (the Bioptime Today card in the earlier app's coach-plan row look, THEME §11.4, GAP_MAP §4.4): the plan
   tasks due today and the overdue ones (the API sends six at most, today's first), each a glass row with its kind's
   icon tile, the title and when it is due, and a MARK column on the right: tapping it marks the task done (the badge
   pops, the title is struck through, a success haptic) and tapping again puts it back. "Skip" marks it skipped and
   "Undo" brings it back (PATCH /me/tasks/:id). Check-ins waiting for an answer sit under the tasks with "Answer".
   The count line under the title ("1 task", "Nothing due") counts every open task due by today. A task's title shrinks
   just enough for its longest word to fit the row whole at a large text size on a narrow phone (FitText, measured
   against the row's room: the title's own box hugs its words for the strike line). A check-in's "Answer" sits beside
   its title while the title's longest word fits whole beside it, else under it (measured: Beside, SWA-03). */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, CheckPop, fx, GlassCard, haptics, Icon, motionValues, Strike, T, type IconName } from '@/fx';
import { fmtDate, istDate, label } from '@/lib/format';
import { Beside, FitText } from '../bio/wordFit';
import { CardHead, LINK_H, reach } from './parts';
import { dayMonth, istDayOf, plural, type Checkin, type Task } from './data';

const KIND_ICON: Record<string, IconName> = {
  sleep: 'moon', nutrition: 'salad', movement: 'footprints', training: 'dumbbell', mindset: 'heart', recovery: 'wind',
  hydration: 'glass-water', habit: 'list-checks', check_in: 'clipboard-check', lab: 'flask-conical',
};

export function TasksCard({ tasks, open, emptyText, hasPlan, checkins, onSet, onOpenPlan, onCheckin }: {
  tasks: Task[]; open: number; emptyText: string; hasPlan: boolean; checkins: Checkin[];
  onSet: (t: Task, status: Task['status']) => void; onOpenPlan: () => void; onCheckin: (c: Checkin) => void;
}) {
  return <GlassCard>
    <CardHead icon="clipboard-list" title="Today's tasks" right={<T v="caption" color={fx.ink.a60}>{open ? plural(open, 'task') : 'Nothing due'}</T>} />
    {tasks.length ? <View style={styles.list}>{tasks.map((t) => <TaskRow key={t.id} task={t} onSet={onSet} />)}</View>
      : <T v="body" color={fx.ink.a60}>{emptyText}</T>}
    {checkins.length ? <View style={[styles.list, styles.checkins]}>{checkins.map((c) => <View key={c.id} style={styles.checkin}>
      <View style={styles.tile}><Icon name="clipboard-check" size={18} color={fx.hue.amber400} /></View>
      <Beside words={[{ text: c.title, v: 'sectionStrong' }]} gap={4} underGap={0} lines={1} style={styles.flex} columnStyle={styles.checkinText}
        side={<Button title="Answer" variant="link" onPress={() => onCheckin(c)} label={`Answer ${c.title}`} />}>
        <T v="sectionStrong" numberOfLines={2}>{c.title}</T>
        <T v="caption" color={fx.ink.a55}>{[c.coachName ? `From ${c.coachName}` : null, c.dueDate ? `due ${dayMonth(c.dueDate)}` : null].filter(Boolean).join(' · ')}</T>
      </Beside>
    </View>)}</View> : null}
    {hasPlan ? <Button title="Open the plan" variant="link" onPress={onOpenPlan} style={styles.open} /> : null}
  </GlassCard>;
}

function TaskRow({ task: t, onSet }: { task: Task; onSet: (t: Task, status: Task['status']) => void }) {
  const done = t.status === 'done';
  const skipped = t.status === 'skipped';
  const due = t.overdue ? `overdue since ${dayMonth(t.due_at)}` : !t.due_at || istDayOf(t.due_at) === istDate() ? 'due today' : `due ${fmtDate(t.due_at)}`;
  const toggle = () => { if (!done) haptics.success(); else haptics.light(); onSet(t, done ? 'pending' : 'done'); };
  const [room, setRoom] = useState(0);
  return <View style={[styles.row, done ? styles.rowDone : null]}>
    <View style={styles.tile}><Icon name={KIND_ICON[t.kind] ?? 'list-checks'} size={18} color={done ? fx.hue.green400 : fx.red.label} /></View>
    <View style={styles.body} onLayout={(e) => { const w = Math.floor(e.nativeEvent.layout.width); if (w !== room) setRoom(w); }}>
      <View style={styles.titleBox}>
        <FitText v="sectionStrong" color={done || skipped ? fx.ink.a50 : fx.ink.white} numberOfLines={3} width={room}>{t.title}</FitText>
        <Strike on={done || skipped} />
      </View>
      <View style={styles.metaRow}>
        <T v="caption" color={t.overdue && !done ? fx.hue.amber400 : fx.ink.a55} style={styles.flexShrink}>{`${label(t.kind)} · ${skipped ? 'skipped' : due}`}</T>
        {t.status === 'pending' ? <Pressable accessibilityRole="button" accessibilityLabel={`Skip ${t.title}`} onPress={() => { haptics.light(); onSet(t, 'skipped'); }} hitSlop={{ left: 8, right: 8 }} style={styles.small}>
          <T v="caption" color={fx.ink.a60}>Skip</T>
        </Pressable> : null}
        {skipped ? <Pressable accessibilityRole="button" accessibilityLabel={`Undo skipping ${t.title}`} onPress={() => onSet(t, 'pending')} hitSlop={{ left: 8, right: 8 }} style={styles.small}>
          <T v="caption" color={fx.red.vivid}>Undo</T>
        </Pressable> : null}
      </View>
    </View>
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${t.title}: done`}
      accessibilityState={{ checked: done, disabled: skipped }}
      aria-checked={done}
      disabled={skipped}
      onPress={toggle}
      style={({ pressed }) => [styles.mark, done ? styles.markDone : null, pressed ? styles.markPressed : null, skipped ? styles.markOff : null]}>
      <View style={styles.badge}>
        <View style={[styles.ringIdle, { borderColor: done ? fx.premium.transparent : fx.red.a60 }]} />
        <CheckPop checked={done} size={20} color={fx.hue.green500} />
      </View>
      <T v="micro" color={done ? fx.hue.green400 : fx.red.label} style={styles.markText}>{done ? 'Done' : 'Mark'}</T>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  checkins: { marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'stretch', borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.fill.a03, overflow: 'hidden' },
  rowDone: { borderColor: fx.tone.greenLine },
  tile: { width: 44, height: 44, margin: 10, borderRadius: fx.radius.xl, backgroundColor: fx.fill.a05, borderWidth: 1, borderColor: fx.line.a05, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  body: { flex: 1, minWidth: 0, justifyContent: 'center', paddingVertical: 10, gap: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12 },
  flexShrink: { flexShrink: 1 },
  // "Skip" and "Undo": 24 drawn, 44 (48 dp) to touch above and below, and 44 wide (padding with a matching negative
  // margin: the meta line keeps its height and place)
  small: { minHeight: LINK_H, minWidth: motionValues.touch.min, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6, marginHorizontal: -6, ...reach(LINK_H) },
  mark: { width: 64, alignItems: 'center', justifyContent: 'center', gap: 4, borderLeftWidth: 1, borderLeftColor: fx.line.a05, paddingVertical: 10 },
  markDone: { backgroundColor: fx.tone.greenBg, borderLeftColor: fx.tone.greenLine },
  markPressed: { backgroundColor: fx.fill.a05 },
  markOff: { opacity: 0.4 },
  badge: { width: 20, height: 20 },
  ringIdle: { ...StyleSheet.absoluteFill, borderRadius: 10, borderWidth: 1.5 },
  markText: { fontSize: 8, letterSpacing: 1 },
  // "Answer" moves under the title when the title's longest word would not fit beside it (Beside)
  checkin: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 14, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.tone.warningLine, backgroundColor: fx.fill.a03 },
  flex: { flex: 1, minWidth: 0 },
  checkinText: { paddingVertical: 10 },
  open: { alignSelf: 'flex-start', marginTop: 8 },
  titleBox: { alignSelf: 'flex-start', maxWidth: '100%' },
});
