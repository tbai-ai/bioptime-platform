/* Bio's cards below the rings:
   - TrendCard: the earlier app's "Recovery Trend (7 days)" card for any metric: metric chips, the line of its last
     values with their days (one a day: a day logged twice shows its latest value, so no weekday repeats), and EXPAND
     for the chart sheet. Weekday names label the line only while its last value is from the past seven days (a
     weekday then names one day); an older line names its first and last dates instead (lib/today: an old week never
     reads as this one).
   - Checkins: waiting ones first on an amber rule ("Answer"), then the last few with the coach's reply.
   - GoalsCard: the first three goals as thin bars (green when reached) and "All goals". By the shared rule (lib/today,
     the same as Home's goals card): a goal on a day's total (steps, water) shows today's value, or "—" when nothing is
     logged today, never an earlier day's total as today's progress; any other goal shows its latest value, with
     "Latest, <date>" under it when that value is not from today.
   - DueAndDone: GET /me/adherence, one thin red bar per kind (habits, plan actions, meals, workouts), each with the
     API's own note and none combined into a score.
   - LatestEntries: the four newest values with their source (Home's former "Logged recently").
   A row's value (or figure) sits beside its label while the label's longest word fits whole beside it, else under it
   (measured as drawn: Beside), so a label never breaks in a word on a narrow phone or at a large text size (SWA-07). */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, FilterChip, fx, GlassCard, Icon, Pill, ProgressBar, Reveal, RowDivider, Sheet, T, TrendChart } from '@/fx';
import { CHECKIN_STATUS, dayLabel } from '@/lib/modules/progress';
import { goalFigure, istDayOf } from '@/lib/today';
import { istDate } from '@/lib/format';
import { onePerDay } from '../home/data';
import { ChipButton, ChipRow, ReachedPop, SectionHead } from './parts';
import { Beside } from './wordFit';
import {
  dayOf, fmtValue, goalProgress, iconOf, latestEntries, shortLabel, sourceOf, unitText, weekdayOf, whenText,
  type Adherence, type Checkin, type Goal, type SummaryMetric,
} from './data';

const LINE = fx.status.good;

/** "Last 4 weeks", or "3 Oct – 30 Oct". */
function rangeText(from: string, to: string): string {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1;
  if (days % 7 === 0 && days <= 56) return `Last ${days / 7} weeks`;
  const d = (x: string) => new Date(`${x}T06:30:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  return `${d(from)} – ${d(to)}`;
}

export function TrendCard({ metrics, chosen, onChoose, onExpand }: { metrics: SummaryMetric[]; chosen: SummaryMetric; onChoose: (metric: string) => void; onExpand: () => void }) {
  const pts = onePerDay(chosen.series).slice(-7);
  const recent = pts.length > 0 && (pts[pts.length - 1].day ?? istDayOf(pts[pts.length - 1].at)) > istDate(-7);
  const weekly = recent && (pts.every((p) => !!p.day) || (pts.length > 1 && Date.parse(pts[pts.length - 1].at) - Date.parse(pts[0].at) < 8 * 86400_000));
  return <GlassCard variant="three" padding={22} style={styles.gap}>
    <View style={styles.trendHead}>
      <T v="cardTitle" style={styles.flex} numberOfLines={3}>{`${shortLabel(chosen.label)} trend (${pts.length} ${pts.length === 1 ? 'value' : 'values'})`}</T>
      <ChipButton title="Expand" onPress={onExpand} label={`Expand the ${shortLabel(chosen.label)} trend`} />
    </View>
    <ChipRow>{metrics.map((m) => <FilterChip key={m.metric} label={shortLabel(m.label)} icon={iconOf(m.metric)} selected={m.metric === chosen.metric} onPress={() => onChoose(m.metric)} />)}</ChipRow>
    {pts.length >= 2 ? <>
      <TrendChart values={pts.map((p) => p.value)} height={72} color={LINE} grid={0} dots={false}
        accessibilityLabel={`${chosen.label}: ${pts.length} values from ${fmtValue(pts[0].value)} to ${fmtValue(pts[pts.length - 1].value)} ${unitText(chosen.unit)}`} />
      <View style={styles.axis}>
        {weekly ? pts.map((p, i) => <T key={i} v="caption" color={fx.ink.a70} style={styles.upper}>{weekdayOf(p)}</T>)
          : <><T v="caption" color={fx.ink.a70}>{dayOf(pts[0])}</T><T v="caption" color={fx.ink.a70}>{dayOf(pts[pts.length - 1])}</T></>}
      </View>
    </> : <T v="bodySm" color={fx.ink.a50}>{pts.length ? 'One value so far. The line starts with the second.' : 'Nothing logged yet.'}</T>}
  </GlassCard>;
}

export function Checkins({ items }: { items: Checkin[] }) {
  const waiting = items.filter((c) => c.status === 'requested');
  const earlier = items.filter((c) => c.status !== 'requested').slice(0, 3);
  if (!waiting.length && !earlier.length) return null;
  return <View>
    <SectionHead title="Check-ins" icon="clipboard-list" />
    <View style={styles.gapSm}>
      {waiting.map((c) => <GlassCard key={c.id} rule={{ color: fx.status.caution }} onPress={() => router.push({ pathname: '/checkin/[id]', params: { id: c.id } })} label={`${c.title}, due ${dayLabel(c.dueDate)}, from ${c.coachName}. Answer`}>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <T v="cardTitle" numberOfLines={2}>{c.title}</T>
            <T v="caption" color={fx.ink.a60}>{`Due ${dayLabel(c.dueDate)} · from ${c.coachName}`}</T>
          </View>
          <Pill tone="warning">Answer</Pill>
        </View>
      </GlassCard>)}
      {earlier.length ? <GlassCard padding={8}>
        {earlier.map((c, i) => <View key={c.id}>
          {i ? <RowDivider inset={12} /> : null}
          <GlassCardRow onPress={() => router.push({ pathname: '/checkin/[id]', params: { id: c.id } })} label={`${c.title}, ${dayLabel(c.dueDate)}, ${CHECKIN_STATUS[c.status][0]}`}>
            <View style={styles.flex}>
              <T v="section" numberOfLines={2}>{c.title}</T>
              <T v="caption" color={fx.ink.a60} numberOfLines={2}>{c.status === 'reviewed' && c.response ? `“${c.response}”` : `${dayLabel(c.dueDate)} · ${CHECKIN_STATUS[c.status][0]}`}</T>
            </View>
            {c.status === 'reviewed' ? <Pill tone="success">Reply</Pill> : <Pill>{CHECKIN_STATUS[c.status][0]}</Pill>}
          </GlassCardRow>
        </View>)}
      </GlassCard> : null}
    </View>
  </View>;
}

/** A pressable row inside a list card (no card chrome of its own). */
function GlassCardRow({ children, onPress, label }: { children: React.ReactNode; onPress: () => void; label: string }) {
  return <GlassCard padding={12} onPress={onPress} label={label} borderColor={fx.premium.transparent} style={styles.innerRow}>
    <View style={styles.rowBetween}>{children}</View>
  </GlassCard>;
}

/** `today`: today's totals of the daily metrics (steps, water) as Bio has them (this phone's live count, the server's
 *  total for today; null when there is none yet). */
export function GoalsCard({ goals, today = {} }: { goals: Goal[]; today?: Partial<Record<string, number | null>> }) {
  const open = goals.filter((g) => g.status === 'active' || g.status === 'paused');
  const shown = (open.length ? open : goals).slice(0, 3);
  return <View>
    <SectionHead title="Goals" icon="target" right={<Button title={goals.length ? 'All goals' : 'Set a goal'} variant="link" style={styles.link44} onPress={() => router.push('/goals')} />} />
    <GlassCard style={styles.gap}>
      {shown.length ? shown.map((g, i) => {
        // the shared rule (lib/today): a daily goal counts today's value only; any other goal its latest, dated when old
        const fig = goalFigure(g, g.metric && g.metric in today ? today[g.metric] ?? null : undefined);
        const v = fig.value;
        const measured = g.metric != null && g.targetValue != null;
        const p = g.status === 'achieved' ? 1 : measured ? (v != null ? goalProgress(g, v) : fig.daily ? 0 : null) : null;
        const unit = g.unit ? ` ${unitText(g.unit)}` : '';
        const older = g.status === 'active' && fig.olderAt ? dayOf({ at: fig.olderAt, value: v ?? 0, source: 'member' }) : null;
        const figure = g.status === 'achieved' ? 'Achieved' : g.status === 'paused' ? 'Paused'
          : measured && (v != null || fig.daily) ? `${v != null ? fmtValue(v) : '—'} / ${fmtValue(g.targetValue as number)}${unit}`
            : g.createdByRole === 'coach' ? 'From your coach' : 'You mark it';
        return <Reveal key={g.id} index={i} id={`bio.goal.${g.id}`}>
          <View style={styles.goal}>
            <Beside words={[{ text: g.title, v: 'section' }]} underGap={2} lines={2} side={<View style={styles.sideRow}>
              <ReachedPop id={g.id} achieved={g.status === 'achieved'} />
              <T v="mono12" color={g.status === 'achieved' ? fx.hue.green400 : fx.ink.a60}>{figure}</T>
            </View>}>
              <T v="section" numberOfLines={2}>{g.title}</T>
            </Beside>
            {older ? <T v="caption" color={fx.ink.a55} style={styles.when}>{`Latest, ${older}`}</T> : null}
            {p != null ? <ProgressBar value={p} delay={i * 80} accessibilityLabel={`${g.title}: ${Math.round(p * 100)} percent`} /> : null}
          </View>
        </Reveal>;
      }) : <T v="bodySm" color={fx.ink.a60}>No goals yet. Set one in your own words, or agree one with your coach.</T>}
    </GlassCard>
  </View>;
}

/** What was due and what was done, per kind. The API's explanations of how each is counted (several lines each) are
 *  one tap away ("How these are counted", a sheet) rather than under every bar. */
export function DueAndDone({ data }: { data: Adherence }) {
  const [about, setAbout] = useState(false);
  const notes = [...data.items.filter((a) => a.note).map((a) => ({ key: a.key, title: a.label, text: a.note as string })), ...(data.note ? [{ key: 'all', title: null, text: data.note }] : [])];
  return <View>
    <SectionHead title="Due and done" icon="list-checks" right={<T v="caption" color={fx.ink.a50}>{rangeText(data.from, data.to)}</T>} />
    <GlassCard style={styles.gap}>
      {data.items.length ? data.items.map((a, i) => <View key={a.key} style={styles.adh}>
        <Beside words={[{ text: a.label, v: 'section' }]} underGap={2}
          side={<T v="mono12" color={fx.ink.a70}>{a.pct === null ? 'Nothing was due' : `${a.done} of ${a.due} · ${a.pct}%`}</T>}>
          <T v="section">{a.label}</T>
        </Beside>
        {a.pct !== null ? <ProgressBar value={a.pct / 100} completeGreen={false} delay={i * 80} accessibilityLabel={`${a.label}: ${a.done} of ${a.due} done`} /> : null}
      </View>) : <T v="bodySm" color={fx.ink.a60}>Nothing to count yet.</T>}
      {notes.length ? <Button title="How these are counted" variant="link" icon="info" iconRight={null} style={styles.link44} onPress={() => setAbout(true)} /> : null}
    </GlassCard>
    <Sheet visible={about} onClose={() => setAbout(false)} title="How these are counted">
      <View style={styles.gap}>
        {notes.map((x) => <View key={x.key} style={styles.adh}>
          {x.title ? <T v="section">{x.title}</T> : null}
          <T v="bodySm" color={fx.ink.a70}>{x.text}</T>
        </View>)}
      </View>
    </Sheet>
  </View>;
}

export function LatestEntries({ metrics }: { metrics: SummaryMetric[] }) {
  const rows = latestEntries(metrics, 4);
  if (!rows.length) return null;
  return <View>
    <SectionHead title="Latest entries" icon="clipboard-check" right={<Button title="Log a value" variant="link" style={styles.link44} onPress={() => router.push('/progress-entry')} />} />
    <GlassCard padding={8}>
      {rows.map(({ m, p }, i) => <View key={`${m.metric}-${p.at}`}>
        {i ? <RowDivider inset={12} /> : null}
        <View style={styles.entry} accessible accessibilityLabel={`${m.label}: ${fmtValue(p.value)} ${unitText(m.unit)}, ${sourceOf(p)}, ${whenText(p)}`}>
          <View style={styles.entryIcon}><Icon name={iconOf(m.metric)} size={16} color={fx.ink.a80} /></View>
          {/* the value moves under the entry when its source and day would need more than two lines beside it ('From /
              the / phone…' beside a five-figure count at 360 dp and text 2.0) */}
          <Beside words={[{ text: `${sourceOf(p)} · ${whenText(p)}`, v: 'caption' }, { text: shortLabel(m.label), v: 'section' }]} lines={2} underGap={2} under="end" style={styles.flex}
            side={<T v="mono14">{`${fmtValue(p.value)} ${unitText(m.unit)}`}</T>}>
            <T v="section" numberOfLines={2}>{shortLabel(m.label)}</T>
            <T v="caption" color={fx.ink.a50} numberOfLines={3}>{`${sourceOf(p)} · ${whenText(p)}`}</T>
          </Beside>
        </View>
      </View>)}
    </GlassCard>
  </View>;
}

const styles = StyleSheet.create({
  link44: { minHeight: 44, minWidth: 44, paddingHorizontal: 4 },
  gap: { gap: 16 },
  gapSm: { gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  upper: { textTransform: 'uppercase' },
  trendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  innerRow: { boxShadow: 'none', backgroundColor: fx.premium.transparent },
  goal: { gap: 10 },
  when: { marginTop: -6 },
  adh: { gap: 8 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12 },
  entryIcon: { width: 36, height: 36, borderRadius: fx.radius.xl, alignItems: 'center', justifyContent: 'center', backgroundColor: fx.fill.a05 },
});
