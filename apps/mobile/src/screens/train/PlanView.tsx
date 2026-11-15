/* Train › Plan: the coach's whole weekly plan (the old Plan tab, GAP_MAP §5): the plan's title, version and coach, its
   goals, then a card per week in the earlier app's style (the week number in Bebas, its focus, the tasks done) with
   every task of every kind: Done, Skip and Undo exactly as before (PATCH /me/tasks/:id), the status pill flipping as it
   changes; rows are keyed by the task's id. "Also in your plan" keeps the links the old tab had (the coach's
   recommendations and the modules that are on). The package card moved to Profile › Overview.
   Motion v2 (M75): Train asks for the plan when it gains focus and this view takes that answer (or draws the copy it
   showed last while it refreshes), so the segment opens on data; a spinner shows only for a load that lasts over
   S.m75.spinnerAfter. The cards cascade in once per launch (Reveal ids 'train.plan.*'). */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { EmptyState, ErrorState, GlassCard, H, Icon, Pill, Reveal, RingSpinner, SettingsRow, StaleBanner, T, fx, haptics, motionValues, statusTone, toast, type IconName } from '@/fx';
import { errorText, get, patch } from '@/lib/api';
import { onClearCache } from '@/lib/cache';
import { fmtDate, label } from '@/lib/format';
import { useModuleEntries } from '@/lib/modules';
import { useLoad } from '@/lib/useLoad';
import { MilestoneReveal } from '@/motion';
import { Beside, keepShort } from '@/fx/wordFit';
import { useDelayed } from './motion';
import { dayMonth } from './shared';

type Task = { id: string; title: string; kind: string; week: number; day: number; due_at: string; status: 'pending' | 'done' | 'skipped'; completed_at: string | null };
type ProgrammeData = {
  programme: { packageName: string; status: string } | null;
  plan: { title: string; goals?: string[]; current_version: number; coach_name: string; currentVersion?: { summary?: string; structure?: { weeks?: Array<{ week: number; focus?: string }> } } } | null;
  tasks: Task[];
};

/** GET /me/programme (Train prefetches it under 'programme' when it gains focus). */
export const loadProgramme = () => get<ProgrammeData>('/me/programme');
/** The plan this view showed last (memory only; dropped with the member's other data on sign-in and sign-out). */
let lastPlan: ProgrammeData | null = null;
onClearCache(() => { lastPlan = null; });

const KIND_ICON: Record<string, IconName> = { movement: 'footprints', training: 'dumbbell', nutrition: 'salad', sleep: 'moon', mindset: 'sparkles', hydration: 'droplet', recovery: 'wind', habit: 'list-checks' };
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function PlanView({ register, onWeek }: { register: (reload: (() => Promise<unknown>) | null) => void;
  /** Opens This week (where the workouts are), when Train offers it. */
  onWeek?: () => void }) {
  const router = useRouter();
  const prog = useLoad<ProgrammeData>('programme', loadProgramme, [], { shared: true });
  const notes = useLoad<{ items?: Array<{ created_at: string }> }>('notes', () => get('/me/notes'), []);
  const entries = useModuleEntries('plan').filter((e) => e.key !== 'workouts' && e.key !== 'sessions');
  const [busy, setBusy] = useState<string | null>(null);
  const reloadProg = prog.reload, reloadNotes = notes.reload;
  useEffect(() => { register(() => Promise.all([reloadProg(), reloadNotes()])); return () => register(null); }, [register, reloadProg, reloadNotes]);

  useEffect(() => { if (prog.data) lastPlan = prog.data; }, [prog.data]);
  const d = prog.data ?? lastPlan;
  const late = useDelayed(prog.loading && !d, motionValues.screens.m75.spinnerAfter);
  const setStatus = async (t: Task, status: Task['status']) => {
    setBusy(t.id);
    try {
      await patch(`/me/tasks/${t.id}`, { status });
      prog.setData((cur) => (cur ? { ...cur, tasks: cur.tasks.map((x) => (x.id === t.id ? { ...x, status } : x)) } : cur));
      if (status === 'done') haptics.success();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(null); }
  };

  if (prog.loading && !d) return <View style={styles.loading}>{late ? <RingSpinner label="Loading your plan" /> : null}</View>;
  const tasks = d?.tasks ?? [];
  const weeks = [...new Set(tasks.map((t) => Number(t.week)))].sort((a, b) => a - b);
  const structure = d?.plan?.currentVersion?.structure?.weeks ?? [];
  const recs = notes.data?.items ?? [];
  const today = istToday();

  return <View style={styles.wrap}>
    <StaleBanner at={prog.stale} />
    <ErrorState error={prog.error} onRetry={prog.reload} />
    {d ? <>
      {d.plan ? <>
        <Reveal mount id="train.plan.head">
          <GlassCard style={styles.gap6}>
            <T v="eyebrowStore" color={fx.ink.a60}>{`Version ${d.plan.current_version} · by ${d.plan.coach_name}`}</T>
            <T v="card24">{d.plan.title}</T>
            {d.plan.currentVersion?.summary ? <T v="bodySm" color={fx.ink.a70}>{d.plan.currentVersion.summary}</T> : null}
            {d.plan.goals?.length ? <View style={styles.goals}>{d.plan.goals.map((g) => <Pill key={g} color={fx.red.label} icon="target">{g}</Pill>)}</View> : null}
          </GlassCard>
        </Reveal>
        {weeks.map((w, wi) => {
          const list = tasks.filter((t) => Number(t.week) === w);
          const focus = structure.find((s) => s.week === w)?.focus;
          const dates = list.map((t) => t.due_at.slice(0, 10)).sort();
          const current = !!dates.length && today >= dates[0] && today <= shift(dates[0], 6);
          const done = list.filter((t) => t.status === 'done').length;
          return <Reveal key={w} mount id={`train.plan.week.${w}`} index={wi + 1}>
            <GlassCard borderColor={current ? fx.red.a30 : undefined} style={styles.gap12}>
              <View style={styles.weekHead}>
                <View style={styles.flex}>
                  <View style={styles.row8}>
                    <T v="card24">{`Week ${w}`}</T>
                    {current ? <Pill tone="error">This week</Pill> : null}
                  </View>
                  {focus ? <T v="bodySm" color={fx.ink.a60}>{focus}</T> : null}
                </View>
                <T v="mono12" color={done === list.length ? fx.hue.green400 : fx.ink.a50} accessibilityLabel={`${done} of ${list.length} done`}>{`${done}/${list.length}`}</T>
              </View>
              {list.map((t) => <TaskRow key={t.id} t={t} busy={busy === t.id} onStatus={(st) => setStatus(t, st)} />)}
            </GlassCard>
          </Reveal>;
        })}
      </> : d.programme
        // the coach's weekly plan (tasks, habits, meals) is not the workout programme counted on This week: said apart
        ? <EmptyState icon="clipboard-list" title="No weekly plan yet"
          body={`Your coach’s weekly plan of tasks, habits and meals is not published yet; you are told here when it is ready.${onWeek ? ' Your workouts are under This week.' : ''}`}
          action={onWeek ? { title: 'Open This week', onPress: onWeek } : undefined} />
        : <EmptyState icon="package" title="No package" body="A plan comes with a package and a coach." action={{ title: 'See the packages', onPress: () => router.push('/(tabs)/store') }} />}
      {entries.length || recs.length ? <View style={styles.gap8}>
        <H strong icon={<Icon name="layers" size={15} color={fx.red.label} />}>Also in your plan</H>
        {recs.length ? <SettingsRow icon="message-square" title="Recommendations from your coach" sub={`${recs.length} note${recs.length === 1 ? '' : 's'} · latest ${fmtDate(recs[0].created_at)}`} onPress={() => router.push('/recommendations')} /> : null}
        {entries.map((e) => <SettingsRow key={e.route} icon={(e.icon ?? 'circle-dot') as IconName} title={e.title} sub={e.sub} onPress={() => router.push(e.route as never)} />)}
      </View> : null}
    </> : null}
  </View>;
}

function shift(date: string, days: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10); }

function TaskRow({ t, busy, onStatus }: { t: Task; busy: boolean; onStatus: (s: Task['status']) => void }) {
  const done = t.status === 'done';
  return <View style={styles.task}>
    <View style={[styles.kind, done ? styles.kindDone : null]}><Icon name={KIND_ICON[t.kind] ?? 'circle-dot'} size={16} color={done ? fx.hue.green400 : fx.ink.a60} /></View>
    <View style={styles.flex}>
      {/* the status pill sits beside the title while the title's longest word, and a short word with the word beside
          it, fit whole beside it, else under it (measured: Beside, SWA-13; never 'Protein / at / breakfast': VA-5) */}
      <Beside words={[{ text: keepShort(t.title), v: 'section', pairs: true }]} gap={8} align="flex-start" underGap={2} style={styles.taskTitle}
        side={<MilestoneReveal trigger={t.status} variant="flip" style={styles.pill}><Pill tone={statusTone(t.status)}>{label(t.status)}</Pill></MilestoneReveal>}>
        <T v="section" color={done ? fx.ink.a50 : fx.ink.white} style={done ? styles.struck : null}>{keepShort(t.title)}</T>
      </Beside>
      <T v="caption" color={fx.ink.a50}>{`${label(t.kind)} · day ${t.day} · ${dayMonth(t.due_at.slice(0, 10))}`}</T>
      <View style={styles.taskFoot}>
        <View style={styles.actions}>
          {t.status !== 'done' ? <Action text="Done" color={fx.hue.green400} disabled={busy} onPress={() => onStatus('done')} a11y={`Mark ${t.title} done`} /> : null}
          {t.status === 'pending' ? <Action text="Skip" color={fx.ink.a60} disabled={busy} onPress={() => onStatus('skipped')} a11y={`Skip ${t.title}`} /> : null}
          {t.status !== 'pending' ? <Action text="Undo" color={fx.ink.a60} disabled={busy} onPress={() => onStatus('pending')} a11y={`Undo ${t.title}`} /> : null}
        </View>
      </View>
    </View>
  </View>;
}

/** A task's Done / Skip / Undo: a 30 pt pill that takes a touch 44 pt tall (ACTION_REACH above and below: hitSlop on
 *  native; on the web the pressable is that much taller inside a matching negative margin, with the pill drawn inside
 *  it), so the row keeps its height. The reach stays in the card's gap between tasks, never over the next task. */
function Action({ text, color, onPress, disabled, a11y }: { text: string; color: string; onPress: () => void; disabled?: boolean; a11y: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    hitSlop={WEB ? undefined : ACTION_SLOP} style={WEB ? styles.actionBox : null}>
    {({ pressed }) => <View style={[styles.action, pressed ? styles.actionPressed : null, disabled ? styles.dim : null]}>
      <T v="chip" color={color}>{text}</T>
    </View>}
  </Pressable>;
}
const WEB = Platform.OS === 'web';
/** The pill is 30 pt: 7 above and below make the 44 pt touch (8 on native). */
const ACTION_REACH = 7;
const ACTION_SLOP = { top: ACTION_REACH + 1, bottom: ACTION_REACH + 1 };

const styles = StyleSheet.create({
  wrap: { gap: 16, paddingHorizontal: fx.space.cardX },
  loading: { paddingVertical: 64, alignItems: 'center', minHeight: 160 },
  flex: { flex: 1 },
  gap6: { gap: 6 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  row8: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  goals: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  weekHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  task: { flexDirection: 'row', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: fx.line.a05 },
  kind: { width: 36, height: 36, borderRadius: fx.radius.xl, backgroundColor: fx.fill.a05, borderWidth: 1, borderColor: fx.line.a08, alignItems: 'center', justifyContent: 'center' },
  kindDone: { backgroundColor: fx.tone.greenBg, borderColor: fx.tone.greenLine },
  struck: { textDecorationLine: 'line-through' },
  taskTitle: { marginBottom: 2 },
  pill: { alignSelf: 'flex-start' },
  taskFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 6 },
  actionBox: { paddingVertical: ACTION_REACH, marginVertical: -ACTION_REACH },
  action: { paddingHorizontal: 12, minHeight: 30, justifyContent: 'center', borderRadius: fx.radius.pill, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a04 },
  actionPressed: { backgroundColor: fx.fill.a10 },
  dim: { opacity: 0.4 },
});
