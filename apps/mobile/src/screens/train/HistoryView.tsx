/* Train › History (the old Workout history, GAP_MAP §4.5) and the personal records (GAP_MAP §4.12, need 6):
   - totals (completed, partly done, skipped) counting up, then every session the member logged or skipped, newest
     first: date, programme, sets done of prescribed, effort, coach feedback; a page at a time; tap: the session;
   - "Personal records" from GET /me/workouts/records, built only from the sets the member marked done: per exercise the
     heaviest load with its reps, the most reps, the longest timed set, with the day; the busiest week, the sessions
     done and the longest current habit streak; and the API's own note on how they are counted. No photos here: these
     are the member's own logged values.
   Motion v2 (M75, M69): Train asks for the history and the records when it gains focus and this view takes those
   answers (or draws the copies it showed last while it refreshes); a spinner shows only for a load that lasts over
   S.m75.spinnerAfter. The totals count once per launch and the tiles cascade once (Reveal ids 'train.history.*'). A
   row opens the player on the picture the session opens on (its first clip's poster, decoding from the press-in). */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, CountUp, EmptyState, FONTS, ErrorState, GlassCard, H, Icon, P, Pill, Reveal, RingSpinner, RowDivider, StaleBanner, T, fx, motionValues, type IconName } from '@/fx';
import { errorText, get, qs } from '@/lib/api';
import { onClearCache } from '@/lib/cache';
import { useLoad } from '@/lib/useLoad';
import { Beside, keepShort } from '@/fx/wordFit';
import { useDelayed } from './motion';
import { categoryColor, dayMonth, fmtNumber, kgTo, rememberSession, secs, sessionState, useWeightUnit, warmSession, type SessionRow } from './shared';
import { streakUnit } from '../life/data';

type History = { items: SessionRow[]; nextCursor: string | null; totals: { completed: number; partial: number; skipped: number } };
type RecordRow = { exerciseId: string | null; name: string; category: string; bestLoadKg: { value: number; reps: number | null; date: string } | null; bestReps: { value: number; date: string } | null; longestDurationSeconds: { value: number; date: string } | null };
type Records = { exercises: RecordRow[]; mostSessionsInAWeek?: { count: number; weekOf: string } | null; sessionsDone?: number; bestHabitStreak?: { count: number; unit: string; title: string } | null; note?: string };

/** The load keys Train prefetches when it gains focus, and their loaders. */
export const HISTORY_KEY = 'workouts.history';
export const RECORDS_KEY = 'workouts.records';
export const loadHistory = () => get<History>('/me/workouts/history');
export const loadRecords = () => get<Records>('/me/workouts/records');
/** What this view showed last (memory only; dropped with the member's other data on sign-in and sign-out). */
let lastHistory: History | null = null;
let lastRecords: Records | null = null;
onClearCache(() => { lastHistory = null; lastRecords = null; });

export function HistoryView({ register }: { register: (reload: (() => Promise<unknown>) | null) => void }) {
  const router = useRouter();
  const unit = useWeightUnit();
  const h = useLoad<History>(HISTORY_KEY, loadHistory, [], { shared: true });
  const rec = useLoad<Records>(RECORDS_KEY, loadRecords, [], { shared: true });
  useEffect(() => { if (h.data) lastHistory = h.data; }, [h.data]);
  useEffect(() => { if (rec.data) lastRecords = rec.data; }, [rec.data]);
  const [more, setMore] = useState<SessionRow[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reloadH = h.reload, reloadR = rec.reload;
  useEffect(() => {
    register(() => { setMore([]); setCursor(undefined); return Promise.all([reloadH(), reloadR()]); });
    return () => register(null);
  }, [register, reloadH, reloadR]);

  const d = h.data ?? lastHistory;
  const late = useDelayed(h.loading && !d, motionValues.screens.m75.spinnerAfter);
  const lateRecords = useDelayed(rec.loading && !(rec.data ?? lastRecords), motionValues.screens.m75.spinnerAfter);
  const next = cursor === undefined ? d?.nextCursor : cursor;
  const loadMore = async () => {
    setBusy(true); setErr(null);
    try { const r = await get<History>(`/me/workouts/history${qs({ before: next })}`); setMore((m) => [...m, ...r.items]); setCursor(r.nextCursor); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  if (h.loading && !d) return <View style={styles.loading}>{late ? <RingSpinner label="Loading your history" /> : null}</View>;
  const items = d ? [...d.items, ...more] : [];
  const r = rec.data ?? lastRecords;
  // the player opens on the session's own first poster (no stock photo first), decoding from the press-in
  const openSession = (s: SessionRow) => { rememberSession(s); router.push(`/workout/${s.id}${s.coverPosterUrl ? '?cover=clip' : ''}`); };

  return <View style={styles.wrap}>
    <StaleBanner at={h.stale} />
    <ErrorState error={h.error} onRetry={h.reload} />
    {d ? <>
      <GlassCard padding={0} style={styles.totals}>
        <Total value={d.totals.completed} label="Completed" color={fx.hue.green500} seenKey="train.history.completed" />
        <View style={styles.vline} />
        <Total value={d.totals.partial} label="Partly done" color={fx.hue.amber400} seenKey="train.history.partial" />
        <View style={styles.vline} />
        <Total value={d.totals.skipped} label="Skipped" color={fx.ink.a60} seenKey="train.history.skipped" />
      </GlassCard>
      {items.length ? <GlassCard padding={0}>
        {items.map((s, i) => <View key={s.id}>
          {i ? <RowDivider inset={16} /> : null}
          <HistoryRow s={s} onPress={() => openSession(s)} onPressIn={() => warmSession(s.id, s.coverPosterUrl)} />
        </View>)}
      </GlassCard> : <EmptyState photo="workouts" icon="dumbbell" title="Nothing logged yet" body="Sessions you complete or skip appear here." />}
      {err ? <P small color={fx.red.label}>{err}</P> : null}
      {next ? <Button title="Show earlier sessions" variant="soft" busy={busy} onPress={loadMore} /> : null}
      <P muted small>Logs are what you record, never a measurement.</P>
    </> : null}

    <View style={styles.gap12}>
      <H strong icon={<Icon name="trophy" size={15} color={fx.red.label} />}>Personal records</H>
      <ErrorState error={rec.error} onRetry={rec.reload} />
      {r ? <>
        <View style={styles.tiles}>
          {r.sessionsDone != null ? <Tile id="sessions" icon="dumbbell" color={fx.red.brand} value={String(r.sessionsDone)} label="Sessions done" /> : null}
          {r.mostSessionsInAWeek ? <Tile id="week" icon="calendar-check" color={fx.gold.base} value={String(r.mostSessionsInAWeek.count)} label={`Most in a week · ${dayMonth(r.mostSessionsInAWeek.weekOf)}`} /> : null}
          {r.bestHabitStreak ? <Tile id="streak" icon="flame" color={fx.hue.green500} value={String(r.bestHabitStreak.count)} label={`${streakUnit(r.bestHabitStreak.count, r.bestHabitStreak.unit)} in a row · ${r.bestHabitStreak.title}`} /> : null}
        </View>
        {r.exercises.length ? <GlassCard padding={0}>
          {r.exercises.map((x, i) => <View key={x.exerciseId ?? x.name}>
            {i ? <RowDivider inset={16} /> : null}
            <RecordLine x={x} unit={unit} onPress={x.exerciseId ? () => router.push(`/exercise/${x.exerciseId}`) : undefined} />
          </View>)}
        </GlassCard> : <EmptyState icon="trophy" title="No records yet" body={r.note} />}
        {r.exercises.length && r.note ? <P muted small>{r.note}</P> : null}
      </> : rec.loading ? <View style={styles.loading}>{lateRecords ? <RingSpinner label="Loading your records" /> : null}</View> : null}
    </View>
  </View>;
}

function Total({ value, label, color, seenKey }: { value: number; label: string; color: string; seenKey: string }) {
  return <View style={styles.total} accessible accessibilityLabel={`${label}: ${value}`}>
    <CountUp value={value} seenKey={seenKey} style={[styles.totalValue, { color }]} />
    <T v="micro" style={styles.totalLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</T>
  </View>;
}

function HistoryRow({ s, onPress, onPressIn }: { s: SessionRow; onPress: () => void; onPressIn: () => void }) {
  const st = sessionState(s);
  const parts = [`${dayMonth(s.scheduledDate)}`, s.programTitle];
  if (s.status !== 'skipped' && s.setsPrescribed) parts.push(`${s.setsDone} of ${s.setsPrescribed} sets`);
  if (s.rpe) parts.push(`effort ${s.rpe}/10`);
  if (s.durationMinutes) parts.push(`${s.durationMinutes} min`);
  if (s.feedbackCount) parts.push('feedback');
  return <Pressable accessibilityRole="button" accessibilityLabel={`${s.title}, ${st.text}, ${parts.join(', ')}`} onPress={onPress} onPressIn={onPressIn} style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
    {/* the status sits beside the title while the longest word of the title and its line fits whole beside it, else
        under them (measured: Beside; 'Mobili/ty an…' beside PARTLY DONE at 320 dp and text 2.0, SWB-17) */}
    {/* and under them when the title would need more than its two lines beside it, its short words kept with a
        neighbour ('Upper body / A' beside DONE, 'Mobility / and reco…' at 360 dp and text 2.0: VWR2-4c) */}
    <Beside words={[{ text: keepShort(s.title), v: 'sectionStrong', pairs: true }, { text: parts.join(' · '), v: 'caption' }]} lines={2} align="flex-start" underGap={6} style={styles.fill} columnStyle={styles.gap2}
      side={<Pill tone={st.tone}>{st.text}</Pill>}>
      <T v="sectionStrong" numberOfLines={2}>{keepShort(s.title)}</T>
      <T v="caption" color={fx.ink.a55}>{parts.join(' · ')}</T>
    </Beside>
    <Icon name="chevron-right" size={16} color={fx.ink.a40} />
  </Pressable>;
}

function RecordLine({ x, unit, onPress }: { x: RecordRow; unit: 'kg' | 'lb'; onPress?: () => void }) {
  const values: Array<{ v: string; when: string }> = [];
  if (x.bestLoadKg) values.push({ v: `${fmtNumber(kgTo(x.bestLoadKg.value, unit))} ${unit}${x.bestLoadKg.reps ? ` × ${x.bestLoadKg.reps}` : ''}`, when: x.bestLoadKg.date });
  if (x.bestReps) values.push({ v: `${x.bestReps.value} reps`, when: x.bestReps.date });
  if (x.longestDurationSeconds) values.push({ v: secs(x.longestDurationSeconds.value), when: x.longestDurationSeconds.date });
  // the values move under the name when its widest word, or its two lines, would not fit beside them ('Bar/bell',
  // 'Dumb/bell' at 320 dp and text 2.0: VA-6a), at the row's end
  const name = keepShort(x.name);
  const body = <>
    <View style={[styles.dot, { backgroundColor: categoryColor(x.category) }]} />
    <Beside words={[{ text: name, v: 'section', pairs: true }]} lines={2} under="end" underGap={6} style={styles.fill}
      side={<View style={styles.values}>{values.map((v) => <View key={v.v} style={styles.value}>
        <T v="mono14" color={fx.ink.white} style={styles.end}>{v.v}</T>
        <T v="caption" color={fx.ink.a50} style={styles.end}>{dayMonth(v.when)}</T>
      </View>)}</View>}>
      <T v="section" numberOfLines={2}>{name}</T>
    </Beside>
  </>;
  const a11y = `${x.name}: ${values.map((v) => `${v.v} on ${dayMonth(v.when)}`).join(', ')}`;
  if (!onPress) return <View style={styles.row} accessible accessibilityLabel={a11y}>{body}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>{body}</Pressable>;
}

function Tile({ id, icon, color, value, label }: { id: string; icon: IconName; color: string; value: string; label: string }) {
  return <Reveal mount id={`train.history.tile.${id}`} style={styles.tileWrap}>
    <GlassCard variant="tile" rule={{ color, width: 2 }} style={styles.tile}>
      <Icon name={icon} size={14} color={color} />
      <T v="metric24">{value}</T>
      <T v="caption" color={fx.ink.a60} numberOfLines={2}>{label}</T>
    </GlassCard>
  </Reveal>;
}

const styles = StyleSheet.create({
  wrap: { gap: 16, paddingHorizontal: fx.space.cardX },
  loading: { paddingVertical: 40, alignItems: 'center', minHeight: 120 },
  flex: { flex: 1, gap: 2 },
  fill: { flex: 1, minWidth: 0 },
  gap2: { gap: 2 },
  gap12: { gap: 12, marginTop: 8 },
  totals: { flexDirection: 'row', paddingVertical: 18, paddingHorizontal: 8 },
  total: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  totalValue: { fontSize: 20, lineHeight: 26, fontFamily: FONTS.mono700 },
  totalLabel: { color: fx.ink.white, letterSpacing: 2, textAlign: 'center' },
  vline: { width: 1, alignSelf: 'stretch', backgroundColor: fx.line.a05 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 56 },
  pressed: { backgroundColor: fx.fill.a05 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  values: { alignItems: 'flex-end', gap: 6 },
  // a record's value and its date take the column's width, drawn at its end: a date whose box hugged its text lost its
  // month on Android ('11 Nov' drawn '11' at text 1.3: VA-3)
  value: { alignItems: 'stretch' },
  end: { textAlign: 'right' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tileWrap: { flexGrow: 1, flexBasis: 140 },
  tile: { gap: 4 },
});
