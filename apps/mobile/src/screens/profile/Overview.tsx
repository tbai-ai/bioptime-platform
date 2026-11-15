/* Profile › Overview (the earlier app's shots 74-profile-overview): four stat tiles with coloured left rules, this week's
   bars, personal records and, Bioptime's own, the package card with its balances.
   - Workouts logged: GET /me/workouts/records `sessionsDone` (sessions logged in full or in part; workouts module).
   - Meals logged: GET /me/meal-logs (the last 14 days, skipped meals left out; nutrition module).
   - Plan done: GET /me/progress/summary `programmeCompletion` (due plan tasks done; core).
   - Streak: the longest current habit streak from GET /me/habits (habits module).
   - This week: GET /me/workouts (Monday to Sunday): a red bar for a day with a logged session, grey for one still planned.
   - Personal records: GET /me/workouts/records, values in yellow mono as the earlier app showed them.
   - Your package: GET /me/programme (dates, and balances added up by kind: a kind can have two rows).
   A module that is off drops its tile or card; nothing is estimated and nothing is copied from the earlier app's mock values.
   Motion (v2, M80): the tiles count once per session and pop on its first visit (./parts); the week's bars grow from
   the values seen last; the records and the package card are below the fold and mount after the page has settled. */
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, get } from '@/lib/api';
import { fmtDate, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorState, fx, GlassCard, Pill, ProgressBar, Reveal, Skeleton, StaleBanner, statusTone, T } from '@/fx';
import { Deferred } from '@/fx/nav/Deferred';
import { Beside } from '@/fx/wordFit';
import {
  balances, DAY_LETTERS, DAY_NAMES, barValues, kindLabel, recordValue, weekDays,
  type ProgrammeRes, type Records, type Summary, type Week,
} from './data';
import { CardTitle, Pair, RecordRow, SeenWeekBars, shared, StatTile, TilePop } from './parts';

type Meals = { items: Array<{ outcome: string }> };
type Habits = { items: Array<{ status: string; streak: { count: number } | null }> };

/** A module that is off answers FEATURE_DISABLED: treat it as nothing to show. */
const offIsNull = <T,>(p: Promise<T>) => p.catch((e) => { if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') return null; throw e; });

export function Overview({ features, programme, register }: {
  features: Set<string> | null; programme: { data: ProgrammeRes | null; loading: boolean; error: ApiError | null; reload: () => Promise<void> };
  register: (fn: (() => Promise<unknown>) | null) => void;
}) {
  const known = !!features;
  const workoutsOn = !!features?.has('workouts');
  const nutritionOn = !!features?.has('nutrition');
  const habitsOn = !!features?.has('habits');
  const summary = useLoad<Summary>('progress', () => get('/me/progress/summary'), []);
  const week = useLoad<Week | null>(known && workoutsOn ? 'profile.week' : null, () => (known && workoutsOn ? offIsNull(get<Week>('/me/workouts')) : Promise.resolve(null)), [known, workoutsOn]);
  const records = useLoad<Records | null>(known && workoutsOn ? 'workouts.records' : null, () => (known && workoutsOn ? offIsNull(get<Records>('/me/workouts/records')) : Promise.resolve(null)), [known, workoutsOn]);
  const meals = useLoad<Meals | null>(known && nutritionOn ? 'profile.meals14' : null, () => (known && nutritionOn ? offIsNull(get<Meals>('/me/meal-logs')) : Promise.resolve(null)), [known, nutritionOn]);
  const habits = useLoad<Habits | null>(known && habitsOn ? 'habits' : null, () => (known && habitsOn ? offIsNull(get<Habits>('/me/habits')) : Promise.resolve(null)), [known, habitsOn]);

  const reloadAll = useCallback(() => Promise.all([summary.reload(), week.reload(), records.reload(), meals.reload(), habits.reload()]),
    [summary.reload, week.reload, records.reload, meals.reload, habits.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { register(reloadAll); return () => register(null); }, [register, reloadAll]);

  const mealCount = meals.data ? meals.data.items.filter((m) => m.outcome !== 'skipped').length : null;
  const activeHabits = habits.data ? habits.data.items.filter((h) => h.status === 'active') : [];
  const streak = activeHabits.length ? activeHabits.reduce((m, h) => Math.max(m, h.streak?.count ?? 0), 0) : null;
  const tasks = summary.data?.tasks;

  const tiles = [
    workoutsOn ? <StatTile key="w" seenKey="workouts" value={records.data ? records.data.sessionsDone : null} label="Workouts logged" sub="sessions you logged" color={fx.red.brand}
      onPress={() => router.push('/(tabs)/train?view=history')} hint="Opens your workout history" /> : null,
    nutritionOn ? <StatTile key="m" seenKey="meals" value={mealCount} label="Meals logged" sub="last 14 days" color={fx.gold.base}
      onPress={() => router.push('/(tabs)/fuel')} hint="Opens Fuel" /> : null,
    <StatTile key="p" seenKey="plan" value={summary.data?.programmeCompletion ?? null} suffix="%" label="Plan done" sub={tasks?.total ? `${tasks.done} of ${tasks.total} due tasks` : 'of due tasks'} color={fx.status.optimal}
      onPress={() => router.push('/(tabs)/train?view=plan')} hint="Opens your plan" />,
    habitsOn ? <StatTile key="s" seenKey="streak" value={streak} label="Streak" sub={habits.data && !activeHabits.length ? 'no habits yet' : 'days, longest current'} color={fx.status.caution}
      onPress={() => router.push('/habits')} hint="Opens your habits" /> : null,
  ].filter(Boolean).map((tile, i) => <TilePop key={(tile as React.ReactElement).key} index={i}>{tile}</TilePop>);
  const pairs: React.ReactElement[][] = [];
  for (let i = 0; i < tiles.length; i += 2) pairs.push(tiles.slice(i, i + 2));

  const first = summary.loading && !summary.data;
  return <View style={shared.gap16}>
    <StaleBanner at={summary.stale} />
    <ErrorState error={summary.error} onRetry={summary.reload} />
    {first ? <View style={shared.gap12}>
      {[0, 1].map((r) => <View key={r} style={shared.row}><Skeleton height={112} radius={fx.radius.card} style={shared.flex} /><Skeleton height={112} radius={fx.radius.card} style={shared.flex} /></View>)}
    </View> : <View style={shared.gap12}>
      {pairs.map((p, i) => <Reveal key={i} index={i} id={`profile.tiles.${i}`}>
        <Pair>{p}</Pair>
      </Reveal>)}
    </View>}

    {workoutsOn && week.data ? <Reveal index={2} id="profile.week"><WeekCard week={week.data} /></Reveal> : null}
    {workoutsOn ? <ErrorState error={week.error ?? records.error} onRetry={() => { void week.reload(); void records.reload(); }} /> : null}
    <Deferred id="profile.overview.below">
      <View style={shared.gap16}>
        {workoutsOn && records.data ? <Reveal index={3} id="profile.records"><RecordsCard r={records.data} /></Reveal> : null}

        <ErrorState error={programme.error} onRetry={programme.reload} />
        {programme.data ? <Reveal index={4} id="profile.package"><PackageCard data={programme.data} /></Reveal>
          : programme.loading ? <Skeleton height={180} radius={fx.radius.card} /> : null}
      </View>
    </Deferred>
  </View>;
}

function WeekCard({ week }: { week: Week }) {
  const days = useMemo(() => weekDays(week), [week]);
  const values = useMemo(() => barValues(days), [days]);
  const spoken = days.map((d, i) => `${DAY_NAMES[i]}: ${d.done ? `${d.done} logged` : d.planned ? `${d.planned} planned` : 'none'}`).join('; ');
  const s = week.summary;
  return <GlassCard>
    <CardTitle title="This week’s activity" right={s?.due ? <T v="caption" color={fx.ink.a55}>{`${s.done} of ${s.due} done`}</T> : null} style={week.items.length ? styles.weekTitle : null} />
    {week.items.length ? <>
      <SeenWeekBars values={values} accessibilityLabel={`This week’s sessions. ${spoken}`} />
      <View style={styles.days} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {DAY_LETTERS.map((l, i) => <T key={i} v="caption" color={days[i].day === week.today ? fx.ink.white : fx.ink.a60} style={styles.day}>{l}</T>)}
      </View>
      <View style={styles.legend}>
        <View style={[styles.swatch, { backgroundColor: fx.red.vivid }]} /><T v="caption" color={fx.ink.a55}>Logged</T>
        <View style={[styles.swatch, { backgroundColor: fx.fill.a10 }]} /><T v="caption" color={fx.ink.a55}>Planned or rest</T>
      </View>
    </> : <T v="bodySm" color={fx.ink.a60}>No sessions planned for this week. Your coach's workout programme shows here, day by day, once there is one.</T>}
  </GlassCard>;
}

function RecordsCard({ r }: { r: Records }) {
  const [all, setAll] = useState(false);
  const exercises = useMemo(() => [...r.exercises]
    .map((e) => ({ e, v: recordValue(e) }))
    .filter((x): x is { e: Records['exercises'][number]; v: { value: string; date: string } } => !!x.v)
    .sort((a, b) => (b.e.bestLoadKg?.value ?? 0) - (a.e.bestLoadKg?.value ?? 0) || b.v.date.localeCompare(a.v.date)), [r.exercises]);
  const rows: Array<{ key: string; title: string; sub?: string; value: string }> = [];
  if (r.mostSessionsInAWeek) rows.push({ key: 'week', title: 'Most sessions in a week', sub: `Week of ${fmtDate(r.mostSessionsInAWeek.weekOf)}`, value: String(r.mostSessionsInAWeek.count) });
  if (r.bestHabitStreak?.count) rows.push({ key: 'streak', title: 'Longest current streak', sub: r.bestHabitStreak.title, value: `${r.bestHabitStreak.count} ${r.bestHabitStreak.unit}` });
  const shown = all ? exercises : exercises.slice(0, 3);
  for (const x of shown) rows.push({ key: x.e.exerciseId, title: x.e.name, sub: fmtDate(x.v.date), value: x.v.value });
  return <GlassCard>
    <CardTitle icon="trophy" iconColor={fx.hue.yellow} title="Personal records" />
    {rows.length ? rows.map((x, i) => <RecordRow key={x.key} title={x.title} sub={x.sub} value={x.value} last={i === rows.length - 1} />)
      : <T v="bodySm" color={fx.ink.a60}>No records yet. They come from the sets you mark done in the sessions you log.</T>}
    {exercises.length > 3 ? <Button title={all ? 'Show fewer' : `Show all ${exercises.length} exercises`} variant="link" iconRight={null} onPress={() => setAll((a) => !a)} style={styles.more} /> : null}
    {r.note && rows.length ? <T v="caption" color={fx.ink.a50} style={styles.note}>{r.note}</T> : null}
  </GlassCard>;
}

function PackageCard({ data }: { data: ProgrammeRes }) {
  const p = data.programme;
  if (!p) return <GlassCard>
    <T v="overline" style={styles.overline}>Your package</T>
    <T v="card24">No package yet</T>
    <T v="bodySm" color={fx.ink.a60} style={styles.emptyBody}>A plan comes with a package and a coach. Your balances of consultations and blood tests show here once you have one.</T>
    <Button title="See the packages" icon="shopping-bag" small onPress={() => router.push('/(tabs)/store')} />
  </GlassCard>;
  const rows = balances(data.entitlements);
  return <GlassCard>
    <T v="overline" style={styles.overline}>Your package</T>
    <View style={styles.pkgHead}>
      <T v="card24" style={shared.flex} numberOfLines={2}>{p.packageName}</T>
      <Pill tone={statusTone(p.status)}>{label(p.status)}</Pill>
    </View>
    <T v="bodySm" color={fx.ink.a60}>{`Runs ${fmtDate(p.startAt)} to ${fmtDate(p.endAt)}${p.durationLabel ? ` · ${p.durationLabel}` : ''}`}</T>
    {rows.length ? <View style={styles.balances}>
      {rows.map((b) => <View key={b.kind} style={shared.gap8}>
        {/* the count sits beside the balance's name while the name's longest word fits whole beside it, else on its
            own line (measured: Beside; 'Consultat/ions' beside '1 of 4 left (1 booked)', SB-2, SWB-04) */}
        <Beside words={[{ text: kindLabel(b.kind), v: 'section' }]} gap={8} under="end" underGap={2}
          side={<T v="mono12" color={fx.ink.a80}>{`${b.left} of ${b.total} left${b.booked ? ` (${b.booked} booked)` : ''}`}</T>}>
          <T v="section">{kindLabel(b.kind)}</T>
        </Beside>
        <ProgressBar value={b.total ? b.left / b.total : 0} completeGreen={false} accessibilityLabel={`${kindLabel(b.kind)}: ${b.left} of ${b.total} left`} />
      </View>)}
    </View> : null}
    {data.plan ? <T v="caption" color={fx.ink.a55} style={styles.note}>{`Plan: ${data.plan.title}${data.plan.coach_name ? `, by ${data.plan.coach_name}` : ''}`}</T> : null}
  </GlassCard>;
}

const styles = StyleSheet.create({
  weekTitle: { marginBottom: 16 },
  days: { flexDirection: 'row', gap: 8, marginTop: 8 },
  day: { flex: 1, textAlign: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' },
  swatch: { width: 8, height: 8, borderRadius: 2, marginLeft: 4 },
  note: { marginTop: 10 },
  more: { alignSelf: 'flex-start', marginTop: 4 },
  overline: { marginBottom: 6 },
  pkgHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  balances: { gap: 14, marginTop: 16 },
  emptyBody: { marginTop: 6, marginBottom: 16 },
});
