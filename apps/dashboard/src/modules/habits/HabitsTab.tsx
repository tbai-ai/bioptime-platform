/* The Habits tab on the client record. Coach (/coach/clients/:id?tab=habits): the client's habits with completion,
   weekly adherence and open follow-ups; set, change, pause, resume and archive the habits a coach set. The habits the
   client wrote themselves and their check-in notes appear only while the client shares health information. Administrator (/admin/clients/:id?tab=habits, members.manage):
   the same view, read only. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Pill, ReasonDialog, Skeleton, Table, useApi, useToast, errorText } from '../../ui';
import type { ClientRecordTabContext } from '../types';
import { DayStrip, HabitFields, WeekLine, draftFrom, fieldErrors, scheduleOf, type HabitDraft, type TeamHabit } from './shared';

type View = { today: string; timezone: string; habits: TeamHabit[]; weekly: Array<{ weekStart: string; due: number; done: number; pct: number | null; current: boolean }>; notesShared: boolean; memberHabitsShared: boolean; followUpThreshold: number | null; note: string; demo?: boolean };

const day = (d: string) => fmtDate(`${d}T12:00:00Z`);

export function HabitsTab({ ctx }: { ctx: ClientRecordTabContext }) {
  const { memberId, isPrivileged, detail } = ctx;
  const view = useApi(() => api.get<View>(isPrivileged ? `/admin/members/${memberId}/habits` : `/coach/clients/${memberId}/habits`), [memberId, isPrivileged]);
  const toast = useToast();
  const [edit, setEdit] = useState<{ habit: TeamHabit | null } | null>(null);
  const [archive, setArchive] = useState<TeamHabit | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const d = view.data;
  if (view.error) return <Alert kind="error">{view.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const plans = (((detail as { plans?: Array<{ id: string; title: string; status: string }> } | null)?.plans) ?? []).filter((p) => p.status !== 'archived').map((p) => ({ id: p.id, title: p.title }));
  const coach = !isPrivileged;
  const shown = d.habits.filter((h) => showArchived || h.status !== 'archived');
  // weeks before any habit ran say nothing: start the table at the first week with something due (the record's demo band is drawn by the client record)
  const firstDue = d.weekly.findIndex((w) => w.due > 0 || w.current);
  const weeks = firstDue === -1 ? [] : d.weekly.slice(firstDue);
  const setStatus = async (h: TeamHabit, status: 'active' | 'paused') => { try { await api.patch(`/coach/habits/${h.id}`, { status }); toast(status === 'paused' ? 'Paused' : 'Resumed'); view.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  return <div className="stack">
    {coach && !d.memberHabitsShared && <Alert kind="info" title="Health information not shared">You see the habits a coach set and whether they were done or skipped. Habits the client added themselves, and their check-in notes, stay private until they share health information with you.</Alert>}
    <div className="grid">
      <div className="span8"><Card><CardHead eyebrow="Weekly adherence" title="Due days checked in as done" right={coach ? <Button variant="primary" size="sm" onClick={() => setEdit({ habit: null })}>Set a habit</Button> : undefined} />
        {d.habits.length ? <Table dense label="Weekly adherence across habits" head={<><th>Week of</th><th className="num">Due</th><th className="num">Done</th><th className="num">%</th></>}>
          {weeks.map((w) => <tr key={w.weekStart}><td>{day(w.weekStart)}{w.current ? <span className="muted small"> · this week, so far</span> : null}</td><td className="num">{w.due}</td><td className="num">{w.done}</td><td className="num">{w.pct === null ? '—' : `${w.pct}%`}</td></tr>)}
        </Table> : <Empty title={coach && !d.memberHabitsShared ? 'No habits set by a coach' : 'No habits yet'} body={coach ? (d.memberHabitsShared ? 'Set one from the plan, or the client adds their own.' : 'Set one from the plan. Habits the client adds themselves show here only while they share health information with you.') : 'Neither the client nor their coach has added a habit.'} />}
        <p className="muted small" style={{ marginTop: 8 }}>{d.note} Paused days are not counted; this week counts what is settled.</p>
      </Card></div>
      <div className="span4"><Card><CardHead eyebrow="Follow-ups" title={d.followUpThreshold === null ? 'Off' : `After ${d.followUpThreshold} missed day${d.followUpThreshold === 1 ? '' : 's'}`} />
        <p className="small">{d.followUpThreshold === null ? 'No follow-up opens for a slipping habit until the owner chooses a threshold.' : `A habit that goes ${d.followUpThreshold} due days without any check-in opens one follow-up for the assigned coach, listed on Today.`}</p>
        <dl className="kv" style={{ marginTop: 10 }}><dt>Client’s timezone</dt><dd>{d.timezone}</dd><dt>Today there</dt><dd>{day(d.today)}</dd></dl>
      </Card></div>
    </div>
    {shown.map((h) => <Card key={h.id}>
      <CardHead eyebrow={`${h.scheduleLabel}${h.targetLabel ? ` · ${h.targetLabel}` : ''} · ${label(h.kind)}`} title={h.title} right={<div className="row" style={{ gap: 6 }}>
        <span className={`bp-pill ${h.setBy === 'coach' ? 'bp-pill-info' : 'bp-pill-plain'}`}>{h.setBy === 'coach' ? 'Set by a coach' : 'Client’s own'}</span>
        <Pill status={h.status} />{h.followUp && <span className="bp-pill bp-pill-warning">Follow-up open</span>}
      </div>} />
      {h.detail && <p className="small">{h.detail}</p>}
      <div className="grid" style={{ marginTop: 10 }}>
        <div className="span6"><div className="stack">
          <WeekLine h={h} />
          <DayStrip days={h.recent} />
          <dl className="kv"><dt>Started</dt><dd>{day(h.startDate)}{h.endDate ? ` · ends ${day(h.endDate)}` : ''}</dd>{h.status === 'active' && <><dt>Without a check-in</dt><dd>{h.missedDueDays ? `${h.missedDueDays} due day${h.missedDueDays === 1 ? '' : 's'}` : 'None'}</dd></>}<dt>Reminders</dt><dd>{h.remindersOn && h.reminderTimes.length ? h.reminderTimes.join(', ') : 'Off'} <span className="muted">(the client’s choice)</span></dd></dl>
        </div></div>
        <div className="span6">{h.checkins.length ? <Table dense label={`Check-ins for ${h.title}`} head={<><th>Day</th><th>Check-in</th>{d.notesShared && <th>Note</th>}</>}>
          {h.checkins.slice(0, 10).map((c) => <tr key={c.id}><td>{day(c.date)}</td><td><span className={`bp-pill ${c.status === 'done' ? 'bp-pill-success' : 'bp-pill-neutral'}`}>{c.status === 'done' ? 'Done' : 'Skipped'}</span></td>{d.notesShared && <td className="small">{c.note ?? ''}</td>}</tr>)}
        </Table> : <p className="muted small">No check-ins in the last four weeks.</p>}</div>
      </div>
      {coach && h.setBy === 'coach' && h.status !== 'archived' && <div className="bp-card-foot">
        <Button size="sm" onClick={() => setEdit({ habit: h })}>Edit</Button>
        <Button size="sm" variant="tertiary" onClick={() => setStatus(h, h.status === 'paused' ? 'active' : 'paused')}>{h.status === 'paused' ? 'Resume' : 'Pause'}</Button>
        <Button size="sm" variant="tertiary" onClick={() => setArchive(h)}>Archive</Button>
      </div>}
      {coach && h.setBy === 'member' && <p className="muted small" style={{ marginTop: 8 }}>The client wrote this habit; only they change it.</p>}
    </Card>)}
    {d.habits.some((h) => h.status === 'archived') && <div><Button size="sm" variant="tertiary" onClick={() => setShowArchived((s) => !s)}>{showArchived ? 'Hide archived habits' : 'Show archived habits'}</Button></div>}
    {coach && <CoachHabitDialog state={edit} memberId={memberId} plans={plans} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); view.reload(); }} />}
    {coach && <ReasonDialog open={!!archive} onClose={() => setArchive(null)} danger title={archive ? `Archive “${archive.title}”?` : ''} confirmLabel="Archive" body="It stops running for the client and leaves their list. Their check-ins stay in the record."
      onConfirm={async (reason) => { if (archive) { await api.post(`/coach/habits/${archive.id}/archive`, { reason }); toast('Archived'); view.reload(); } }} />}
    {!coach && <p className="muted small">Read only. Coaches set and change the habits they set; members change their own and their reminders. Opening this tab is recorded in the audit log.</p>}
  </div>;
}

function CoachHabitDialog({ state, memberId, plans, onClose, onSaved }: { state: { habit: TeamHabit | null } | null; memberId: string; plans: Array<{ id: string; title: string }>; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<HabitDraft>(draftFrom(null));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const habit = state?.habit ?? null;
  React.useEffect(() => { if (state) { setD(draftFrom(state.habit)); setErrs({}); setErr(''); } }, [state]);
  const save = async () => {
    setBusy(true); setErrs({}); setErr('');
    const body: Record<string, unknown> = { title: d.title, detail: d.detail, kind: d.kind, schedule: scheduleOf(d), targetLabel: d.targetLabel.trim() || null, endDate: d.endDate || null, planId: d.planId || null };
    try {
      if (habit) await api.patch(`/coach/habits/${habit.id}`, body);
      else await api.post(`/coach/clients/${memberId}/habits`, { ...body, ...(d.startDate ? { startDate: d.startDate } : {}), ...(d.reminderTimes.length ? { reminderTimes: d.reminderTimes, remindersOn: true } : {}) });
      toast(habit ? 'Habit saved' : 'Habit set; the client is told in the app');
      onSaved();
    } catch (e) { setErrs(fieldErrors(e)); setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={!!state} onClose={onClose} title={habit ? `Edit “${habit.title}”` : 'Set a habit'} footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} onClick={save} disabled={d.title.trim().length < 2 || (d.type === 'weekdays' && !d.weekdays.length)}>{habit ? 'Save' : 'Set habit'}</Button></>}>
    <HabitFields d={d} set={(p) => setD((x) => ({ ...x, ...p }))} audience="coach" creating={!habit} withReminders={!habit} plans={plans} errors={errs} />
    {err && <Alert kind="error">{err}</Alert>}
    <p className="muted small" style={{ marginTop: 8 }}>{habit ? 'Reminder times stay the client’s choice.' : 'Reminder times are optional; the client can change them at any time.'}</p>
  </Dialog>;
}
