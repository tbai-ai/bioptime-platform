/* The Habits tab on the coach's client record (the web's modules/habits/HabitsTab.tsx, coach mode): the client's habits
   with completion, weekly adherence and open follow-ups; set, change, pause, resume and archive the habits a coach set.
   The habits the client wrote themselves and their check-in notes appear only while the client shares health
   information (the server leaves them out and says so with memberHabitsShared / notesShared). */
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, patch, post } from '@/lib/api';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/coach/moduleTabs';
import { Button, Card, Chip, Empty, Eyebrow, Field, H2, Input, Notice, P, Pill, Row } from '@/components/ui';
import { DatePickerField, Sheet, isClockTime, isIsoDate } from '@/components/workspace';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { Bar, KvList, PickerField, StatusPill, TabState, day, fieldErrorsOf, useFlash, useRecordTick } from '@/components/coachModules/shared';
import { colors, font, space } from '@/theme';

type Schedule = { type: 'daily' } | { type: 'weekdays'; weekdays: number[] } | { type: 'times_per_week'; timesPerWeek: number };
type DayCell = { date: string; weekday: number; due: boolean; status: 'done' | 'skipped' | 'missed' | 'open' | 'off' };
type Checkin = { id: string; date: string; status: 'done' | 'skipped'; note?: string | null };
type TeamHabit = {
  id: string; planId: string | null; title: string; detail: string; kind: string; schedule: Schedule; scheduleLabel: string; targetLabel: string | null; reminderTimes: string[]; remindersOn: boolean;
  status: 'active' | 'paused' | 'archived'; startDate: string; endDate: string | null; setBy: 'member' | 'coach';
  week: { done: number; target: number }; streak: { count: number; unit: 'days' | 'weeks' }; recent: DayCell[];
  missedDueDays: number; followUp: { id: string; status: string; createdAt: string } | null; checkins: Checkin[];
};
type Payload = { today: string; timezone: string; habits: TeamHabit[]; weekly: Array<{ weekStart: string; due: number; done: number; pct: number | null; current: boolean }>; notesShared: boolean; memberHabitsShared: boolean; followUpThreshold: number | null; note: string };

const KINDS = ['habit', 'movement', 'training', 'nutrition', 'sleep', 'recovery', 'reflection'];
const WEEKDAYS: Array<[number, string]> = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const LETTER: Record<number, string> = { 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S', 7: 'S' };
const CELL_TEXT: Record<DayCell['status'], string> = { done: 'done', skipped: 'skipped', missed: 'no check-in', open: 'open today', off: 'not due' };

export function HabitsTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId, record } = ctx;
  const tick = useRecordTick(record); // the record screen's pull to refresh reloads this tab's data too
  const view = useLoad<Payload>(`coach-habits-${memberId}`, () => get(`/coach/clients/${memberId}/habits`), [memberId, tick]);
  const { show, node: flash } = useFlash();
  const [edit, setEdit] = useState<{ habit: TeamHabit | null } | null>(null);
  const [archive, setArchive] = useState<TeamHabit | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const d = view.data;
  const plans = (((record as { plans?: Array<{ id: string; title: string; status: string }> } | null)?.plans) ?? []).filter((p) => p.status !== 'archived').map((p) => ({ id: p.id, title: p.title }));
  const setStatus = async (h: TeamHabit, status: 'active' | 'paused') => { try { await patch(`/coach/habits/${h.id}`, { status }); show(status === 'paused' ? 'Paused' : 'Resumed'); view.reload(); } catch (e) { show(errorText(e), 'error'); } };
  return <TabState loading={view.loading && !d} error={view.error} onRetry={view.reload}>
    {d ? <View style={{ gap: space.md }}>
      {flash}
      {!d.memberHabitsShared ? <Notice kind="info" title="Health information not shared">You see the habits a coach set and whether they were done or skipped. Habits the client added themselves, and their check-in notes, stay private until they share health information with you.</Notice> : null}
      <Card>
        <Row between><View style={{ flex: 1 }}><Eyebrow>Weekly adherence</Eyebrow><H2>Due days checked in as done</H2></View><Button title="Set a habit" small onPress={() => setEdit({ habit: null })} /></Row>
        {d.habits.length ? <WeeklyTable weekly={d.weekly} />
          : <Empty title={!d.memberHabitsShared ? 'No habits set by a coach' : 'No habits yet'} body={d.memberHabitsShared ? 'Set one from the plan, or the client adds their own.' : 'Set one from the plan. Habits the client adds themselves show here only while they share health information with you.'} />}
        <P muted small>{d.note} Paused days are not counted; this week counts what is settled.</P>
      </Card>
      <Card>
        <Eyebrow>Follow-ups</Eyebrow><H2>{d.followUpThreshold === null ? 'Off' : `After ${d.followUpThreshold} missed day${d.followUpThreshold === 1 ? '' : 's'}`}</H2>
        <P small>{d.followUpThreshold === null ? 'No follow-up opens for a slipping habit until the owner chooses a threshold.' : `A habit that goes ${d.followUpThreshold} due days without any check-in opens one follow-up for the assigned coach, listed on Today.`}</P>
        <KvList rows={[['Client’s timezone', d.timezone], ['Today there', day(d.today)]]} />
      </Card>
      {d.habits.filter((h) => showArchived || h.status !== 'archived').map((h) => <HabitCard key={h.id} h={h} notesShared={d.notesShared} onEdit={() => setEdit({ habit: h })} onStatus={(s) => void setStatus(h, s)} onArchive={() => setArchive(h)} />)}
      {d.habits.some((h) => h.status === 'archived') ? <Button title={showArchived ? 'Hide archived habits' : 'Show archived habits'} variant="ghost" small onPress={() => setShowArchived((s) => !s)} style={{ alignSelf: 'flex-start' }} /> : null}
      <CoachHabitSheet state={edit} memberId={memberId} plans={plans} onClose={() => setEdit(null)} onSaved={(msg) => { setEdit(null); show(msg); view.reload(); }} />
      <ReasonSheet open={!!archive} onClose={() => setArchive(null)} destructive title={archive ? `Archive “${archive.title}”?` : ''} confirmLabel="Archive" body="It stops running for the client and leaves their list. Their check-ins stay in the record."
        onConfirm={async (reason) => { if (!archive) return; await post(`/coach/habits/${archive.id}/archive`, { reason }); show('Archived'); view.reload(); }} />
    </View> : null}
  </TabState>;
}

function WeeklyTable({ weekly }: { weekly: Payload['weekly'] }) {
  // weeks before any habit ran say nothing: start at the first week with something due
  const firstDue = weekly.findIndex((w) => w.due > 0 || w.current);
  const weeks = firstDue === -1 ? [] : weekly.slice(firstDue);
  return <View accessibilityLabel="Weekly adherence across habits">
    <View style={[st.tr, { borderBottomColor: colors.borderStrong }]}><Text style={[st.th, { flex: 2 }]}>Week of</Text><Text style={st.th}>Due</Text><Text style={st.th}>Done</Text><Text style={st.th}>%</Text></View>
    {weeks.map((w) => <View key={w.weekStart} style={st.tr}><Text style={[st.td, { flex: 2 }]}>{day(w.weekStart)}{w.current ? <Text style={{ color: colors.muted }}> · this week, so far</Text> : null}</Text><Text style={st.td}>{w.due}</Text><Text style={st.td}>{w.done}</Text><Text style={st.td}>{w.pct === null ? '—' : `${w.pct}%`}</Text></View>)}
  </View>;
}

function HabitCard({ h, notesShared, onEdit, onStatus, onArchive }: { h: TeamHabit; notesShared: boolean; onEdit: () => void; onStatus: (s: 'active' | 'paused') => void; onArchive: () => void }) {
  const pct = h.week.target ? Math.min(100, Math.round((h.week.done / h.week.target) * 100)) : 0;
  const streak = h.streak.count > 0 ? ` · ${h.streak.count} ${h.streak.unit === 'days' ? (h.streak.count === 1 ? 'day' : 'days') : (h.streak.count === 1 ? 'week' : 'weeks')} in a row` : '';
  return <Card>
    <Eyebrow>{`${h.scheduleLabel}${h.targetLabel ? ` · ${h.targetLabel}` : ''} · ${label(h.kind)}`}</Eyebrow>
    <H2>{h.title}</H2>
    <Row><Pill tone="info">{h.setBy === 'coach' ? 'Set by a coach' : 'Client’s own'}</Pill><StatusPill status={h.status} />{h.followUp ? <Pill tone="warning">Follow-up open</Pill> : null}</Row>
    {h.detail ? <P small>{h.detail}</P> : null}
    <Bar pct={pct} tone="success" />
    <P muted small>{h.week.target ? `${h.week.done} of ${h.week.target} this week` : 'Nothing due this week'}{streak}</P>
    <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }} accessibilityLabel="Recent days">
      {h.recent.map((c) => <View key={c.date} accessibilityLabel={`${day(c.date)}: ${CELL_TEXT[c.status]}`} style={[st.cell, c.status === 'done' && { backgroundColor: colors.success, borderColor: colors.success }, c.status === 'missed' && { borderColor: colors.warning }, c.status === 'open' && { borderColor: colors.info }]}>
        <Text style={{ color: c.status === 'done' ? colors.onAccent : c.status === 'off' ? colors.disabled : colors.text, fontSize: font.tiny, fontWeight: '700' }}>{LETTER[c.weekday]}</Text>
      </View>)}
    </View>
    <KvList rows={[
      ['Started', `${day(h.startDate)}${h.endDate ? ` · ends ${day(h.endDate)}` : ''}`],
      h.status === 'active' ? ['Without a check-in', h.missedDueDays ? `${h.missedDueDays} due day${h.missedDueDays === 1 ? '' : 's'}` : 'None'] : null,
      ['Reminders', `${h.remindersOn && h.reminderTimes.length ? h.reminderTimes.join(', ') : 'Off'} (the client’s choice)`],
    ]} />
    {h.checkins.length ? <View accessibilityLabel={`Check-ins for ${h.title}`}>
      <View style={[st.tr, { borderBottomColor: colors.borderStrong }]}><Text style={[st.th, { flex: 2 }]}>Day</Text><Text style={[st.th, { flex: 2 }]}>Check-in</Text>{notesShared ? <Text style={[st.th, { flex: 3 }]}>Note</Text> : null}</View>
      {h.checkins.slice(0, 10).map((c) => <View key={c.id} style={st.tr}><Text style={[st.td, { flex: 2 }]}>{day(c.date)}</Text><View style={{ flex: 2 }}><Pill tone={c.status === 'done' ? 'success' : 'info'}>{c.status === 'done' ? 'Done' : 'Skipped'}</Pill></View>{notesShared ? <Text style={[st.td, { flex: 3 }]}>{c.note ?? ''}</Text> : null}</View>)}
    </View> : <P muted small>No check-ins in the last four weeks.</P>}
    {h.setBy === 'coach' && h.status !== 'archived' ? <Row>
      <Button title="Edit" variant="secondary" small onPress={onEdit} />
      <Button title={h.status === 'paused' ? 'Resume' : 'Pause'} variant="ghost" small onPress={() => onStatus(h.status === 'paused' ? 'active' : 'paused')} />
      <Button title="Archive" variant="ghost" small onPress={onArchive} />
    </Row> : null}
    {h.setBy === 'member' ? <P muted small>The client wrote this habit; only they change it.</P> : null}
  </Card>;
}

type Draft = { title: string; detail: string; kind: string; type: Schedule['type']; weekdays: number[]; timesPerWeek: number; targetLabel: string; startDate: string; endDate: string; reminderTimes: string[]; planId: string };
const draftFrom = (h: TeamHabit | null): Draft => ({
  title: h?.title ?? '', detail: h?.detail ?? '', kind: h?.kind ?? 'habit', type: h?.schedule.type ?? 'daily',
  weekdays: h?.schedule.type === 'weekdays' ? h.schedule.weekdays : [], timesPerWeek: h?.schedule.type === 'times_per_week' ? h.schedule.timesPerWeek : 3,
  targetLabel: h?.targetLabel ?? '', startDate: '', endDate: h?.endDate ?? '', reminderTimes: h?.reminderTimes ?? [], planId: h?.planId ?? '',
});
const scheduleOf = (d: Draft): Schedule => (d.type === 'weekdays' ? { type: 'weekdays', weekdays: [...d.weekdays].sort() } : d.type === 'times_per_week' ? { type: 'times_per_week', timesPerWeek: d.timesPerWeek } : { type: 'daily' });

/** The portal's CoachHabitDialog as a sheet: "Set a habit" / "Edit “title”". */
function CoachHabitSheet({ state, memberId, plans, onClose, onSaved }: { state: { habit: TeamHabit | null } | null; memberId: string; plans: Array<{ id: string; title: string }>; onClose: () => void; onSaved: (toast: string) => void }) {
  const [d, setD] = useState<Draft>(draftFrom(null));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [newTime, setNewTime] = useState('');
  const habit = state?.habit ?? null;
  const creating = !habit;
  useEffect(() => { if (state) { setD(draftFrom(state.habit)); setErrs({}); setErr(''); setNewTime(''); } }, [state]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const save = async () => {
    setBusy(true); setErrs({}); setErr('');
    const body: Record<string, unknown> = { title: d.title.trim(), detail: d.detail, kind: d.kind, schedule: scheduleOf(d), targetLabel: d.targetLabel.trim() || null, endDate: d.endDate || null, planId: d.planId || null };
    try {
      if (habit) await patch(`/coach/habits/${habit.id}`, body);
      else await post(`/coach/clients/${memberId}/habits`, { ...body, ...(d.startDate ? { startDate: d.startDate } : {}), ...(d.reminderTimes.length ? { reminderTimes: d.reminderTimes, remindersOn: true } : {}) });
      onSaved(habit ? 'Habit saved' : 'Habit set; the client is told in the app');
    } catch (e) { setErrs(fieldErrorsOf(e)); setErr(errorText(e)); } finally { setBusy(false); }
  };
  const addTime = () => { if (!isClockTime(newTime) || d.reminderTimes.includes(newTime) || d.reminderTimes.length >= 4) return; set({ reminderTimes: [...d.reminderTimes, newTime].sort() }); setNewTime(''); };
  const datesOk = (!d.startDate || isIsoDate(d.startDate)) && (!d.endDate || isIsoDate(d.endDate));
  return <Sheet open={!!state} onClose={onClose} title={habit ? `Edit “${habit.title}”` : 'Set a habit'} footer={<Row><Button title="Not now" variant="ghost" onPress={onClose} disabled={busy} /><Button title={habit ? 'Save' : 'Set habit'} busy={busy} disabled={d.title.trim().length < 2 || (d.type === 'weekdays' && !d.weekdays.length) || !datesOk} onPress={save} style={{ flex: 1 }} /></Row>}>
    <Field label="Habit" hint="A short, concrete action, for example the plan item it comes from." error={errs.title}><Input value={d.title} maxLength={120} onChangeText={(title) => set({ title })} /></Field>
    <Field label="Detail (optional)" error={errs.detail}><Input value={d.detail} maxLength={1000} onChangeText={(detail) => set({ detail })} multiline style={{ minHeight: 64, textAlignVertical: 'top' }} /></Field>
    <PickerField label="Kind" value={d.kind} options={KINDS.map((k) => ({ value: k, label: label(k) }))} onChange={(kind) => set({ kind })} />
    <Field label="Target (optional)" hint="As you would say it, for example 25 minutes." error={errs.targetLabel}><Input value={d.targetLabel} maxLength={80} onChangeText={(targetLabel) => set({ targetLabel })} /></Field>
    <Field label="When" error={errs.schedule}>
      <View style={{ gap: space.sm }}>
        <Row>{([['daily', 'Every day'], ['weekdays', 'Chosen days'], ['times_per_week', 'Times a week']] as Array<[Schedule['type'], string]>).map(([t, l]) => <Chip key={t} selected={d.type === t} onPress={() => set({ type: t })}>{l}</Chip>)}</Row>
        {d.type === 'weekdays' ? <Row>{WEEKDAYS.map(([n, l]) => <Chip key={n} selected={d.weekdays.includes(n)} onPress={() => set({ weekdays: d.weekdays.includes(n) ? d.weekdays.filter((x) => x !== n) : [...d.weekdays, n] })}>{l}</Chip>)}</Row> : null}
        {d.type === 'times_per_week' ? <Row>{[1, 2, 3, 4, 5, 6, 7].map((n) => <Chip key={n} selected={d.timesPerWeek === n} onPress={() => set({ timesPerWeek: n })}>{n === 1 ? 'Once a week' : `${n} times a week`}</Chip>)}</Row> : null}
      </View>
    </Field>
    {creating ? <DatePickerField label="Starts (optional)" value={d.startDate} onChange={(startDate) => set({ startDate })} hint="Today when empty." error={errs.startDate} /> : null}
    <DatePickerField label="Ends (optional)" value={d.endDate} onChange={(endDate) => set({ endDate })} error={errs.endDate} />
    {plans.length ? <PickerField label="Part of a plan (optional)" value={d.planId} placeholder="No plan" options={plans.map((p) => ({ value: p.id, label: p.title }))} onChange={(planId) => set({ planId })} /> : null}
    {creating ? <Field label="Reminder times (optional)" hint="In the client’s timezone. Nothing is suggested; leave it empty for no reminders." error={errs.reminderTimes}>
      <View style={{ gap: space.sm }}>
        {d.reminderTimes.length ? <Row>{d.reminderTimes.map((t) => <Chip key={t} onPress={() => set({ reminderTimes: d.reminderTimes.filter((x) => x !== t) })}>{`${t} ✕`}</Chip>)}</Row> : <P muted small>No reminder times yet.</P>}
        <Row><Input value={newTime} onChangeText={(v) => setNewTime(v.replace(/[^\d:]/g, '').slice(0, 5))} placeholder="HH:MM" accessibilityLabel="Reminder time" maxLength={5} style={{ flex: 1 }} editable={d.reminderTimes.length < 4} /><Button title="Add time" variant="secondary" small onPress={addTime} disabled={!isClockTime(newTime) || d.reminderTimes.length >= 4} /></Row>
      </View>
    </Field> : null}
    {err ? <Notice kind="error">{err}</Notice> : null}
    <P muted small>{habit ? 'Reminder times stay the client’s choice.' : 'Reminder times are optional; the client can change them at any time.'}</P>
  </Sheet>;
}

const st = {
  tr: { flexDirection: 'row' as const, gap: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'center' as const },
  th: { flex: 1, color: colors.muted, fontSize: font.tiny, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.8 },
  td: { flex: 1, color: colors.text, fontSize: font.small },
  cell: { width: 26, height: 26, borderRadius: 13, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: colors.border },
};
