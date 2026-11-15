/* M1 Habits: what the habit pages share (types, the day strip, the reminder-times editor and the habit form). Built
   from the existing components and classes only (src/ui, bp-pill, bp-chip, bp-seg, bp-progress, bp-switch); no new CSS. */
import React, { useState } from 'react';
import { fmtDate } from '../../lib/format';
import { Button, Field, Input, Select, Textarea } from '../../ui';

export type Schedule = { type: 'daily' } | { type: 'weekdays'; weekdays: number[] } | { type: 'times_per_week'; timesPerWeek: number };
export type DayCell = { date: string; weekday: number; due: boolean; status: 'done' | 'skipped' | 'missed' | 'open' | 'off' };
export type Checkin = { id: string; habitId: string; date: string; status: 'done' | 'skipped'; note?: string | null; createdAt: string; updatedAt: string };
export type Habit = {
  id: string; memberId: string; coachId: string | null; planId: string | null; title: string; detail: string; kind: string;
  schedule: Schedule; scheduleLabel: string; targetLabel: string | null; reminderTimes: string[]; remindersOn: boolean;
  status: 'active' | 'paused' | 'archived'; startDate: string; endDate: string | null; setBy: 'member' | 'coach';
  today: { date: string; due: boolean; checkin: { status: 'done' | 'skipped'; note?: string | null; at: string } | null };
  week: { done: number; target: number }; streak: { count: number; unit: 'days' | 'weeks' }; recent: DayCell[];
};
export type TeamHabit = Habit & { weekly: Array<{ weekStart: string; due: number; done: number; pct: number | null; current: boolean }>; missedDueDays: number; followUp: { id: string; status: string; createdAt: string } | null; checkins: Checkin[] };

export const KINDS = ['habit', 'movement', 'training', 'nutrition', 'sleep', 'recovery', 'reflection'];
const WEEKDAYS: Array<[number, string]> = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const DAY_LETTER: Record<number, string> = { 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S', 7: 'S' };
const CELL: Record<DayCell['status'], { pill: string; text: string }> = {
  done: { pill: 'bp-pill-success', text: 'done' }, skipped: { pill: 'bp-pill-neutral', text: 'skipped' }, missed: { pill: 'bp-pill-warning', text: 'no check-in' },
  open: { pill: 'bp-pill-info', text: 'open today' }, off: { pill: 'bp-pill-plain', text: 'not due' },
};

/** The last days as small pills (weekday letter; the state in the label for assistive technology). */
export function DayStrip({ days }: { days: DayCell[] }) {
  return <div className="pillRow" role="list" aria-label="Recent days">
    {days.map((c) => <span key={c.date} role="listitem" className={`bp-pill ${CELL[c.status].pill}`} title={`${fmtDate(`${c.date}T12:00:00Z`)}: ${CELL[c.status].text}`} aria-label={`${fmtDate(`${c.date}T12:00:00Z`)}: ${CELL[c.status].text}`}>{DAY_LETTER[c.weekday]}</span>)}
  </div>;
}

/** This week as a bar and a sentence, and the streak as a count (descriptive, never a reward). */
export function WeekLine({ h }: { h: Habit }) {
  const pct = h.week.target ? Math.min(100, Math.round((h.week.done / h.week.target) * 100)) : 0;
  return <div className="stack" style={{ gap: 6 }}>
    <div className="bp-progress bp-progress-success" role="progressbar" aria-valuemin={0} aria-valuemax={h.week.target} aria-valuenow={h.week.done} aria-label="This week"><span style={{ width: `${pct}%` }} /></div>
    <span className="muted small">{h.week.target ? `${h.week.done} of ${h.week.target} this week` : 'Nothing due this week'}{h.streak.count > 0 ? ` · ${h.streak.count} ${h.streak.unit === 'days' ? (h.streak.count === 1 ? 'day' : 'days') : (h.streak.count === 1 ? 'week' : 'weeks')} in a row` : ''}</span>
  </div>;
}

/** Reminder times as removable chips plus a time field. No time is suggested: the list starts empty. */
export function TimesEditor({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [t, setT] = useState('');
  const add = () => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t) || value.includes(t) || value.length >= 4) return; onChange([...value, t].sort()); setT(''); };
  return <div className="stack" style={{ gap: 8 }}>
    {value.length ? <div className="bp-chips">{value.map((v) => <button key={v} type="button" className="bp-chip" disabled={disabled} onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove the ${v} reminder`}>{v} ✕</button>)}</div> : <span className="muted small">No reminder times yet.</span>}
    <div className="row"><Input type="time" value={t} onChange={(e) => setT(e.target.value)} aria-label="Reminder time" style={{ maxWidth: 140 }} disabled={disabled || value.length >= 4} /><Button size="sm" onClick={add} disabled={disabled || !t || value.length >= 4}>Add time</Button></div>
  </div>;
}

export type HabitDraft = { title: string; detail: string; kind: string; type: Schedule['type']; weekdays: number[]; timesPerWeek: number; targetLabel: string; startDate: string; endDate: string; reminderTimes: string[]; remindersOn: boolean; planId: string };

export function draftFrom(h?: Habit | null): HabitDraft {
  return {
    title: h?.title ?? '', detail: h?.detail ?? '', kind: h?.kind ?? 'habit', type: h?.schedule.type ?? 'daily',
    weekdays: h?.schedule.type === 'weekdays' ? h.schedule.weekdays : [], timesPerWeek: h?.schedule.type === 'times_per_week' ? h.schedule.timesPerWeek : 3,
    targetLabel: h?.targetLabel ?? '', startDate: '', endDate: h?.endDate ?? '', reminderTimes: h?.reminderTimes ?? [], remindersOn: h?.remindersOn ?? false, planId: h?.planId ?? '',
  };
}

export function scheduleOf(d: HabitDraft): Schedule {
  if (d.type === 'weekdays') return { type: 'weekdays', weekdays: [...d.weekdays].sort() };
  if (d.type === 'times_per_week') return { type: 'times_per_week', timesPerWeek: d.timesPerWeek };
  return { type: 'daily' };
}

/** The habit's fields. `audience` is who fills them in (the member for their own habit, a coach for a client), so the
 *  hints address the right person; `withReminders` shows reminder times (creating); `plans` adds the plan choice (coaches). */
export function HabitFields({ d, set, audience, creating, withReminders, plans, errors }: { d: HabitDraft; set: (p: Partial<HabitDraft>) => void; audience: 'member' | 'coach'; creating: boolean; withReminders?: boolean; plans?: Array<{ id: string; title: string }>; errors?: Record<string, string> }) {
  const e = errors ?? {};
  const remindersHint = audience === 'member'
    ? 'In your timezone. Nothing is suggested; leave it empty for no reminders.'
    : 'In the client’s timezone. Nothing is suggested; leave it empty for no reminders.';
  return <div className="form">
    <Field label="Habit" hint="A short, concrete action, for example the plan item it comes from." error={e.title}><Input value={d.title} maxLength={120} onChange={(ev) => set({ title: ev.target.value })} /></Field>
    <Field label="Detail" optional error={e.detail}><Textarea rows={2} maxLength={1000} value={d.detail} onChange={(ev) => set({ detail: ev.target.value })} /></Field>
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <Field label="Kind"><Select value={d.kind} onChange={(ev) => set({ kind: ev.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{k[0]!.toUpperCase() + k.slice(1)}</option>)}</Select></Field>
      <Field label="Target" optional hint="As you would say it, for example 25 minutes." error={e.targetLabel}><Input value={d.targetLabel} maxLength={80} onChange={(ev) => set({ targetLabel: ev.target.value })} /></Field>
    </div>
    <Field label="When" error={e.schedule}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="bp-seg" role="group" aria-label="Schedule">{([['daily', 'Every day'], ['weekdays', 'Chosen days'], ['times_per_week', 'Times a week']] as Array<[Schedule['type'], string]>).map(([t, l]) => <button key={t} type="button" aria-pressed={d.type === t} onClick={() => set({ type: t })}>{l}</button>)}</div>
        {d.type === 'weekdays' && <div className="bp-chips" role="group" aria-label="Days">{WEEKDAYS.map(([n, l]) => <button key={n} type="button" className="bp-chip" aria-pressed={d.weekdays.includes(n)} onClick={() => set({ weekdays: d.weekdays.includes(n) ? d.weekdays.filter((x) => x !== n) : [...d.weekdays, n] })}>{l}</button>)}</div>}
        {d.type === 'times_per_week' && <Select value={String(d.timesPerWeek)} onChange={(ev) => set({ timesPerWeek: Number(ev.target.value) })} aria-label="Times a week">{[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n === 1 ? 'Once a week' : `${n} times a week`}</option>)}</Select>}
      </div>
    </Field>
    <div className="row" style={{ alignItems: 'flex-start' }}>
      {creating && <Field label="Starts" optional hint="Today when empty." error={e.startDate}><Input type="date" value={d.startDate} onChange={(ev) => set({ startDate: ev.target.value })} /></Field>}
      <Field label="Ends" optional error={e.endDate}><Input type="date" value={d.endDate} onChange={(ev) => set({ endDate: ev.target.value })} /></Field>
    </div>
    {plans && plans.length > 0 && <Field label="Part of a plan" optional><Select value={d.planId} onChange={(ev) => set({ planId: ev.target.value })}><option value="">No plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></Field>}
    {withReminders && <Field label="Reminder times" optional hint={remindersHint} error={e.reminderTimes}><TimesEditor value={d.reminderTimes} onChange={(v) => set({ reminderTimes: v, remindersOn: v.length > 0 })} /></Field>}
  </div>;
}

/** Field errors from the API's VALIDATION_FAILED details ({ path, message }[]). */
export function fieldErrors(e: unknown): Record<string, string> {
  const details = (e as { details?: unknown })?.details;
  const out: Record<string, string> = {};
  if (Array.isArray(details)) for (const d of details as Array<{ path?: string; message?: string }>) { const k = (d.path ?? '').split('.')[0] ?? ''; if (k && !out[k]) out[k] = d.message ?? 'Check this field'; }
  return out;
}
