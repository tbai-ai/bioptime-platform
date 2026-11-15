/* Goals (overlay from Bio "All goals", Home and old links): the member's goals and milestones in the kit's chrome.
   A measured goal (a metric, a start and a target) marks itself achieved when a value logged after it was set reaches
   the target; any other goal is marked by a person. On a goal the coach set, the member changes its status and marks
   its milestones reached, nothing else (the server enforces the same). Bioptime never suggests a target.
   - Open goals: title, progress bar (start → latest → target, green when reached), start / latest (with its source) /
     target / by, the auto-achieve sentence (a goal on a day's total, steps or water, measures today: its bar and its
     "Today" row show today's value or that nothing is logged today, beside the dated latest; lib/today, the same rule as
     Bio's and Home's goal cards: today's steps are the phone's live count while a counter runs, never below the
     server's total for today, read from the step counter's last live count rather than a counter of its own),
     milestones (pop checks), the status pill that turns over when it changes,
     and the actions (Achieved, Pause, Drop, Resume, Set active again; Edit and Milestone on the member's own goals).
   - A goal the coach set says so under its title ("Set by your coach": its status and milestones are the member's to
     mark, the goal itself the coach's to edit), as a coach's habit does.
   - "Your focus": what the member picked in the onboarding quiz (the profile's goals), each a chip that opens "Set a
     goal" with its words as the title, to make it measurable; a focus already written as an open goal is not offered
     again. `?focus=` (Home's goals card) opens that sheet at once.
   - "Set a goal" and "Edit" open a sheet: title, measured by (optional), start, target, and by when: tapped, never
     typed ("In 2 weeks", "In a month", "In 3 months", "Package end"), then a day earlier or later with the steppers.
   - A goal a logged value has just reached (LogValue) shows the done check popping beside its status once.
   - Achieved and dropped goals follow. */
import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorText, get, patch, post } from '@/lib/api';
import { fmtDate, istDate } from '@/lib/format';
import { invalidate, useLoad } from '@/lib/useLoad';
import { GOAL_STATUS, dayLabel, type Goal, type Metric } from '@/lib/modules/progress';
import {
  Button, CheckPop, EmptyState, ErrorState, Field, FilterChip, fx, GlassCard, haptics, IconButton, Input, KVRow, NumberInput, Overlay, ProgressBar, Reveal,
  Sheet, Skeleton, StaleBanner, T, toast, useFocusRefresh, useLiveStepsToday,
} from '@/fx';
import { openFocus, peekHome, type Me } from '../home/data';
import { FlipPill, ReachedPop, SectionHead } from './parts';
import { goalFigure, isTodayAt, todaySteps } from '@/lib/today';
import { fmtValue, goalProgress, iconOf, phoneLabel, shortLabel, unitText } from './data';

/** `title`: a new goal's words to start from (a focus from the quiz). */
type Editing = { goal: Goal | null; title?: string } | null;

/** The member's profile (GET /me/profile → profile.goals: the focus areas picked in the onboarding quiz). */
type ProfileAnswer = { profile?: { goals?: unknown } };

export default function GoalsScreen() {
  const goals = useLoad<{ items: Goal[] }>('progress-goals', () => get('/me/goals'), []);
  const summary = useLoad<{ metrics: Metric[] }>('progress', () => get('/me/progress/summary'), []);
  const profile = useLoad<ProfileAnswer>('me.profile', () => get('/me/profile'), []);
  useFocusRefresh(goals.reload);
  const params = useLocalSearchParams<{ focus?: string }>();
  const [editing, setEditing] = useState<Editing>(() => (typeof params.focus === 'string' && params.focus.trim() ? { goal: null, title: params.focus.trim() } : null));
  const items = goals.data?.items ?? [];
  const open = items.filter((g) => g.status === 'active' || g.status === 'paused');
  const closed = items.filter((g) => g.status === 'achieved' || g.status === 'dropped');
  const changed = () => { void goals.reload(); invalidate(['progress-goals', 'home.goals']); };
  // a focus already written as an open goal is not offered again (the same rule as Home's goals card: openFocus)
  const focus = openFocus(profile.data?.profile?.goals, items);
  const endAt = peekHome<Me>('me')?.programme?.endAt ?? null;
  const liveSteps = useLiveStepsToday(); // this phone's count today, from the counter Home or Bio runs (null on the web)
  return <View style={styles.fill}>
    <Overlay title="Goals" subtitle="In your own words. Measured goals mark themselves achieved when a value you log reaches the target." kind="back" fallback="/(tabs)/bio"
      footer={<Button title="Set a goal" icon="plus" shape="flow" onPress={() => setEditing({ goal: null })} />}>
      <StaleBanner at={goals.stale} />
      <ErrorState error={goals.error} onRetry={goals.reload} />
      {goals.loading && !goals.data ? <View style={styles.gap}><Skeleton height={220} radius={fx.radius.card} /><Skeleton height={180} radius={fx.radius.card} /></View> : null}
      {goals.data && !open.length ? <EmptyState icon="target" title="No open goals" body="Set one in your own words, or agree one with your coach." /> : null}
      {goals.data && focus.length ? <GlassCard style={styles.card}>
        <T v="label" color={fx.red.label}>Your focus</T>
        <T v="bodySm" color={fx.ink.a70}>{`What you picked when you joined: ${focus.join(' · ')}. Tap one to make it a goal you can measure.`}</T>
        <View style={styles.chips}>{focus.map((f) => <FilterChip key={f} label={f} icon="target" onPress={() => setEditing({ goal: null, title: f })} />)}</View>
      </GlassCard> : null}
      {open.map((g, i) => <Reveal key={g.id} index={i}><GoalCard g={g} liveSteps={liveSteps} onChanged={changed} onEdit={() => setEditing({ goal: g })} /></Reveal>)}
      {closed.length ? <View style={styles.gap}>
        <SectionHead title="Achieved and dropped" icon="trophy" style={styles.closedHead} />
        {closed.map((g) => <GoalCard key={g.id} g={g} liveSteps={liveSteps} onChanged={changed} onEdit={() => setEditing({ goal: g })} />)}
      </View> : null}
    </Overlay>
    <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.goal ? 'Edit the goal' : 'Set a goal'}>
      {editing ? <GoalForm key={editing.goal?.id ?? `new.${editing.title ?? ''}`} goal={editing.goal} title0={editing.title} endAt={endAt} metrics={summary.data?.metrics ?? []} onDone={() => { setEditing(null); changed(); }} /> : null}
    </Sheet>
  </View>;
}

/** `liveSteps`: this phone's live count today (null when it does not count): a steps goal shows it as today's value,
 *  never below the server's total for today (lib/today todaySteps, the figure Home and Bio show). */
function GoalCard({ g, liveSteps, onChanged, onEdit }: { g: Goal; liveSteps: number | null; onChanged: () => void; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [milestone, setMilestone] = useState<string | null>(null);
  const unit = g.unit ? ` ${unitText(g.unit)}` : '';
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); if (done) { haptics.success(); toast.logged(done); } onChanged(); } catch (e) { haptics.error(); toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const status = (s: Goal['status'], done: string) => run(() => patch(`/me/goals/${g.id}`, { status: s }), done);
  const [statusText, tone] = GOAL_STATUS[g.status];
  // the shared rule (lib/today): a goal on a day's total counts today's value only (steps: the live count with the
  // server's total for today, as on Home and Bio)
  const fig = goalFigure(g, g.metric === 'steps' && liveSteps != null ? todaySteps(liveSteps, g.latest && isTodayAt(g.latest.at) ? g.latest.value : null) : undefined);
  const v = fig.value;
  const p = g.status === 'achieved' ? 1 : g.targetValue != null && g.metric ? (v != null ? goalProgress(g, v) : fig.daily ? 0 : null) : null;
  const own = g.createdByRole === 'member';
  return <GlassCard style={styles.card} borderColor={g.status === 'achieved' ? fx.tone.greenLine : undefined}>
    <View style={styles.rowBetween}>
      <T v="label" color={g.metric ? fx.red.label : fx.ink.ink2} style={styles.flex} numberOfLines={1}>{g.metricLabel ?? (own ? 'Goal' : 'Set by your coach')}</T>
      <ReachedPop id={g.id} achieved={g.status === 'achieved'} />
      <FlipPill tone={tone}>{statusText}</FlipPill>
    </View>
    <T v="cardTitle">{g.title}</T>
    {!own ? <T v="caption" color={fx.ink.a60}>Set by your coach. Its status and milestones are yours to mark; your coach edits the goal itself.</T> : null}
    {p != null ? <ProgressBar value={p} accessibilityLabel={`${g.title}: ${Math.round(p * 100)} percent of the way`} /> : null}
    <View>
      {g.baselineValue != null ? <KVRow label="Start" value={`${fmtValue(g.baselineValue)}${unit}`} /> : null}
      {fig.daily && g.status === 'active' ? <KVRow label="Today" value={v != null ? `${fmtValue(v)}${unit}` : 'Nothing logged today'} /> : null}
      {g.latest && !(fig.daily && g.status === 'active' && isTodayAt(g.latest.at)) ? <KVRow label="Latest" value={<View style={styles.kvValue}><T v="mono14">{`${fmtValue(g.latest.value)}${unit}`}</T><T v="caption" color={fx.ink.a50}>{`${phoneLabel(g.latest.sourceLabel ?? 'Logged')} · ${fmtDate(g.latest.at)}`}</T></View>} /> : null}
      {g.targetValue != null ? <KVRow label="Target" value={`${fmtValue(g.targetValue)}${unit}`} /> : null}
      {g.targetDate ? <KVRow label="By" value={dayLabel(g.targetDate)} divider={false} /> : null}
    </View>
    <T v="bodySm" color={fx.ink.a60}>{g.status === 'achieved' ? (g.achievedHow === 'target_reached' ? `Reached ${fmtDate(g.achievedAt)}: a logged value met the target.` : `Marked achieved ${fmtDate(g.achievedAt)}.`) : g.autoAchieve ? 'Marks itself achieved when a value you log reaches the target.' : 'You mark it achieved.'}</T>

    {g.milestones.length ? <View style={styles.milestones}>
      <T v="label">Milestones</T>
      {g.milestones.map((m) => {
        const canMark = (m.targetValue == null || !g.autoAchieve) && g.status !== 'dropped';
        const reached = !!m.achievedAt;
        const target = m.targetValue != null ? `${fmtValue(m.targetValue)}${unit}` : null;
        const text = `${m.title}${target && !m.title.includes(fmtValue(m.targetValue as number)) ? ` · ${target}` : ''}${m.dueDate ? ` · by ${dayLabel(m.dueDate)}` : ''}`;
        return <View key={m.id} style={styles.milestone}>
          <View style={styles.check}>{!reached ? <View style={styles.checkEmpty} /> : null}<CheckPop checked={reached} size={22} color={fx.hue.green500} style={reached ? undefined : styles.checkOver} /></View>
          <View style={styles.flex}>
            <T v="section" color={reached ? fx.ink.white : fx.ink.a80}>{text}</T>
            {reached ? <T v="caption" color={fx.ink.a50}>{`Reached ${fmtDate(m.achievedAt)}`}</T> : null}
          </View>
          {canMark ? <Button title={reached ? 'Not yet' : 'Reached'} variant={reached ? 'link' : 'redTint'} small full={false} iconRight={null} busy={busy}
            label={`${m.title}: ${reached ? 'mark not reached' : 'mark reached'}`}
            onPress={() => run(() => patch(`/me/goals/${g.id}/milestones/${m.id}`, { achieved: !reached }), reached ? undefined : 'Milestone reached')} /> : null}
        </View>;
      })}
    </View> : null}

    {milestone !== null ? <View style={styles.gapSm}>
      <Field label="New milestone"><Input size="sheet" value={milestone} onChangeText={setMilestone} maxLength={160} placeholder="For example, halfway" autoFocus /></Field>
      <View style={styles.actions}>
        <Button title="Add" small full={false} busy={busy} disabled={milestone.trim().length < 2} onPress={() => run(async () => { await post(`/me/goals/${g.id}/milestones`, { title: milestone.trim() }); setMilestone(null); }, 'Milestone added')} />
        <Button title="Cancel" variant="soft" small full={false} onPress={() => setMilestone(null)} />
      </View>
    </View> : null}

    <View style={styles.actions}>
      {g.status === 'active' ? <>
        <Button title="Achieved" small full={false} busy={busy} onPress={() => status('achieved', 'Goal achieved')} />
        <Button title="Pause" variant="soft" small full={false} disabled={busy} onPress={() => status('paused', 'Goal paused')} />
        <Button title="Drop" variant="link" style={styles.link44} small iconRight={null} disabled={busy} onPress={() => status('dropped', 'Goal dropped')} />
      </> : g.status === 'paused' ? <>
        <Button title="Resume" small full={false} busy={busy} onPress={() => status('active', 'Goal resumed')} />
        <Button title="Drop" variant="link" style={styles.link44} small iconRight={null} disabled={busy} onPress={() => status('dropped', 'Goal dropped')} />
      </> : <Button title="Set active again" variant="soft" small full={false} disabled={busy} onPress={() => status('active', 'Goal active again')} />}
      {own && g.status !== 'dropped' && milestone === null ? <Button title="Milestone" variant="link" style={styles.link44} icon="plus" iconRight={null} small onPress={() => setMilestone('')} /> : null}
      {own && g.status !== 'dropped' ? <Button title="Edit" variant="link" icon="pencil" iconRight={null} small onPress={onEdit} label={`Edit ${g.title}`} style={styles.link44} /> : null}
    </View>
  </GlassCard>;
}

/** The ISO day `n` days after `iso`. */
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The ISO day `n` calendar months after `iso` (the last day of a shorter month). */
function plusMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
/** The India day of a moment. */
const istDayOf = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);

/** By when, tapped: the quick choices and, once a day is chosen, a day earlier or later (never before today). */
function DatePick({ value, onChange, endAt }: { value: string; onChange: (v: string) => void; endAt: string | null }) {
  const today = istDate(0);
  const end = endAt ? istDayOf(endAt) : null;
  const quick = [
    { key: '2w', label: 'In 2 weeks', date: plusDays(today, 14) },
    { key: '1m', label: 'In a month', date: plusMonths(today, 1) },
    { key: '3m', label: 'In 3 months', date: plusMonths(today, 3) },
    ...(end && end > today ? [{ key: 'end', label: 'Package end', date: end }] : []),
  ];
  return <View style={styles.gapSm}>
    <View style={styles.chips}>{quick.map((q) => <FilterChip key={q.key} label={q.label} selected={value === q.date} onPress={() => onChange(value === q.date ? '' : q.date)} />)}</View>
    {value ? <View style={styles.dateRow}>
      <IconButton kind="stepperMinus" size={44} iconSize={18} icon="minus" label="A day earlier" disabled={value <= today} onPress={() => onChange(plusDays(value, -1) < today ? today : plusDays(value, -1))} />
      <T v="section" center style={styles.dateText} accessibilityLiveRegion="polite">{dayLabel(value)}</T>
      <IconButton kind="stepperPlus" size={44} iconSize={18} icon="plus" label="A day later" onPress={() => onChange(plusDays(value, 1))} />
      <Button title="Clear" variant="link" style={styles.link44} small iconRight={null} onPress={() => onChange('')} label="Clear the date" />
    </View> : null}
  </View>;
}

/** Add or edit a goal (the member's own). A measured goal needs a target; its start defaults to the latest value. */
function GoalForm({ goal, title0, endAt, metrics, onDone }: { goal: Goal | null; title0?: string; endAt: string | null; metrics: Metric[]; onDone: () => void }) {
  const [title, setTitle] = useState(goal?.title ?? title0 ?? '');
  const [metric, setMetric] = useState<string | null>(goal?.metric ?? null);
  const [start, setStart] = useState(goal?.baselineValue != null ? String(goal.baselineValue) : '');
  const [target, setTarget] = useState(goal?.targetValue != null ? String(goal.targetValue) : '');
  const [date, setDate] = useState(goal?.targetDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = metrics.find((x) => x.metric === metric) ?? null;
  const bad = (s: string) => s.trim() !== '' && Number.isNaN(Number(s));
  const dateOk = date === '' || (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= istDate(0));
  const ok = title.trim().length >= 2 && dateOk && !bad(start) && !bad(target) && (!m || target.trim() !== '');
  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (goal) {
        await patch(`/me/goals/${goal.id}`, { title: title.trim(), ...(goal.metric ? { targetValue: target.trim() ? Number(target) : null, baselineValue: start.trim() ? Number(start) : null } : {}), targetDate: date || null });
      } else {
        await post('/me/goals', { title: title.trim(), ...(m ? { metric: m.metric, targetValue: Number(target), ...(start.trim() ? { baselineValue: Number(start) } : {}) } : {}), ...(date ? { targetDate: date } : {}) });
      }
      haptics.success(); toast.logged(goal ? 'Goal saved' : 'Goal set');
      onDone();
    } catch (e) { haptics.error(); setError(errorText(e)); } finally { setBusy(false); }
  };
  return <View style={styles.form}>
    <Field label="Goal" hint="In your own words."><Input size="sheet" value={title} onChangeText={setTitle} maxLength={160} placeholder="For example, walk after dinner every day" /></Field>
    {!goal ? <Field label="Measured by (optional)" hint="With a measure, a start and a target, the goal marks itself achieved.">
      <View style={styles.chips}>{metrics.map((x) => <FilterChip key={x.metric} label={shortLabel(x.label)} icon={iconOf(x.metric)} selected={x.metric === metric} onPress={() => setMetric(x.metric === metric ? null : x.metric)} />)}</View>
    </Field> : null}
    {m || goal?.metric ? <>
      <Field label={`Start (${unitText(m?.unit ?? goal?.unit ?? '')}), optional`} hint="Empty: your latest logged value."><NumberInput unit={unitText(m?.unit ?? goal?.unit ?? '').toUpperCase()} value={start} onChangeText={setStart} label="Start" /></Field>
      <Field label={`Target (${unitText(m?.unit ?? goal?.unit ?? '')})`} hint={m && m.min != null && m.max != null ? `Between ${m.min} and ${m.max}.` : undefined}><NumberInput unit={unitText(m?.unit ?? goal?.unit ?? '').toUpperCase()} value={target} onChangeText={setTarget} label="Target" /></Field>
    </> : null}
    <Field label="By (optional)" hint={date ? undefined : 'Pick when, or leave it open.'} error={dateOk ? null : 'A date from today'}><DatePick value={date} onChange={setDate} endAt={endAt} /></Field>
    {error ? <T v="bodySm" color={fx.red.error} accessibilityRole="alert">{error}</T> : null}
    <Button title={goal ? 'Save the goal' : 'Set the goal'} shape="flow" commit busy={busy} disabled={!ok} onPress={save} />
  </View>;
}

const styles = StyleSheet.create({
  link44: { minHeight: 44, minWidth: 44, paddingHorizontal: 4 },
  fill: { flex: 1 },
  gap: { gap: 16 },
  gapSm: { gap: 10 },
  card: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  kvValue: { alignItems: 'flex-end', flexShrink: 1, minWidth: 0 },
  milestones: { gap: 10, paddingTop: 4 },
  milestone: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { width: 22, height: 22 },
  checkEmpty: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: fx.line.a20 },
  checkOver: { position: 'absolute', left: 0, top: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  closedHead: { marginTop: 8, marginBottom: 0 },
  form: { gap: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateText: { flex: 1, minWidth: 0 },
});
