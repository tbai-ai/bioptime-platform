/* /client/habits: the member's habits. Check in for today (done or skipped, with an optional note), see this week and
   the last days, set reminder times, and add, change, pause or archive their own habits. On a habit their coach set,
   only the reminders are theirs to change; the server enforces the same. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { fmtDate } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Dialog, Empty, Field, Input, Pill, Skeleton, useApi, useToast, errorText } from '../../ui';
import { DayStrip, HabitFields, TimesEditor, WeekLine, draftFrom, fieldErrors, scheduleOf, type Habit, type HabitDraft } from './shared';

type List = { today: string; timezone: string; items: Habit[]; dueToday: number; note: string; delivery: { detail: string }; demo?: boolean };

export function ClientHabits() {
  const [archived, setArchived] = useState(false);
  const list = useApi(() => api.get<List>(`/me/habits${archived ? '?archived=1' : ''}`), [archived]);
  const [edit, setEdit] = useState<{ habit: Habit | null } | null>(null);
  const [confirm, setConfirm] = useState<{ habit: Habit; action: 'archive' } | null>(null);
  const toast = useToast();
  const d = list.data;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const open = d.items.filter((h) => h.status !== 'archived');
  const gone = d.items.filter((h) => h.status === 'archived');
  const patch = async (h: Habit, body: Record<string, unknown>, done: string) => { try { await api.patch(`/me/habits/${h.id}`, body); toast(done); list.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  return <div className="stack">
    <div className="pageHead"><div><h1>Habits</h1><p className="sub">Small actions on a schedule. Check in on the days you do them. Your coach sees the habits a coach set for you and what you complete on them. Habits you add yourself, and your notes, reach your coach only while health sharing is on.</p></div>
      <div className="actions"><Button variant="primary" size="sm" onClick={() => setEdit({ habit: null })}>Add a habit</Button></div></div>
    <div className="grid">
      {open.length ? open.map((h) => <div key={h.id} className="span6"><HabitCard h={h} reload={list.reload} onEdit={() => setEdit({ habit: h })} onPause={() => patch(h, { status: h.status === 'paused' ? 'active' : 'paused' }, h.status === 'paused' ? 'Resumed' : 'Paused')} onArchive={() => setConfirm({ habit: h, action: 'archive' })} /></div>)
        : <div className="span12"><Card><Empty title="No habits yet" body="Add one of your own, or wait for your coach to set one from your plan." action={<Button variant="primary" size="sm" onClick={() => setEdit({ habit: null })}>Add a habit</Button>} /></Card></div>}
    </div>
    {archived && gone.length > 0 && <Card><CardHead eyebrow="Archived" title="No longer running" /><ul className="taskList">{gone.map((h) => <li key={h.id}><div><span>{h.title}</span><span className="muted">{h.scheduleLabel} · started {fmtDate(`${h.startDate}T12:00:00Z`)}</span></div><Pill status="archived" /></li>)}</ul></Card>}
    <div className="row between">
      <p className="muted small">{d.delivery.detail} The switch for all reminders is under <Link to="/profile">Profile</Link>, Notifications. Times are in {d.timezone}.</p>
      <Button size="sm" variant="tertiary" onClick={() => setArchived((a) => !a)}>{archived ? 'Hide archived' : 'Show archived'}</Button>
    </div>
    <p className="muted small">{d.note}</p>
    <HabitDialog state={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />
    <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger title={confirm ? `Archive “${confirm.habit.title}”?` : ''} confirmLabel="Archive" body="It stops running and leaves your list. Your check-ins stay in your record."
      onConfirm={async () => { if (confirm) { await api.patch(`/me/habits/${confirm.habit.id}`, { status: 'archived' }); toast('Archived'); list.reload(); } }} />
  </div>;
}

function HabitCard({ h, reload, onEdit, onPause, onArchive }: { h: Habit; reload: () => void; onEdit: () => void; onPause: () => void; onArchive: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [times, setTimes] = useState<string[] | null>(null);
  const c = h.today.checkin;
  const checkIn = async (status: 'done' | 'skipped') => {
    setBusy(true);
    try { await api.post(`/me/habits/${h.id}/checkins`, { status, ...(note.trim() ? { note: note.trim() } : {}) }); setNote(''); reload(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const undo = async () => { setBusy(true); try { await api.del(`/me/habits/${h.id}/checkins/${h.today.date}`); reload(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); } };
  const saveReminders = async (body: { reminderTimes?: string[]; remindersOn?: boolean }) => {
    setBusy(true);
    try { await api.patch(`/me/habits/${h.id}`, body); setTimes(null); toast('Reminders saved'); reload(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const editing = times !== null;
  return <Card accent={h.today.due && !c}>
    <CardHead eyebrow={`${h.scheduleLabel}${h.targetLabel ? ` · ${h.targetLabel}` : ''}`} title={h.title} right={<div className="row" style={{ gap: 6 }}>{h.setBy === 'coach' && <span className="bp-pill bp-pill-info">From your coach</span>}{h.status !== 'active' && <Pill status={h.status} />}</div>} />
    {h.detail && <p className="small">{h.detail}</p>}
    <div className="stack" style={{ marginTop: 10 }}>
      {h.status === 'paused' ? <p className="small">Paused. Paused days are not counted.</p>
        : c ? <div className="row between"><span><span className={`bp-pill ${c.status === 'done' ? 'bp-pill-success' : 'bp-pill-neutral'}`}>{c.status === 'done' ? 'Done today' : 'Skipped today'}</span>{c.note && <span className="muted small" style={{ marginLeft: 8 }}>{c.note}</span>}</span><Button size="sm" variant="tertiary" busy={busy} onClick={undo}>Undo</Button></div>
        : h.today.due ? <div className="stack" style={{ gap: 8 }}>
          <Field label="Note" optional><Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering about today" /></Field>
          <div className="row"><Button variant="primary" size="sm" busy={busy} onClick={() => checkIn('done')}>Done</Button><Button size="sm" disabled={busy} onClick={() => checkIn('skipped')}>Skip today</Button></div>
        </div>
          : <p className="small">Not due today.</p>}
      <WeekLine h={h} />
      <DayStrip days={h.recent} />
      <div className="bp-divider" />
      <div className="row between">
        <label className="bp-switch"><input type="checkbox" role="switch" checked={h.remindersOn} disabled={busy || h.status !== 'active' || (!h.reminderTimes.length && !h.remindersOn)} onChange={() => saveReminders({ remindersOn: !h.remindersOn })} aria-label={`Reminders for ${h.title}`} /><span className="bp-switch-track" /> <span className="small">Reminders{h.reminderTimes.length ? ` at ${h.reminderTimes.join(', ')}` : ''}</span></label>
        {!editing && <Button size="sm" variant="tertiary" disabled={h.status === 'archived'} onClick={() => setTimes(h.reminderTimes)}>{h.reminderTimes.length ? 'Change times' : 'Set times'}</Button>}
      </div>
      {editing && <div className="stack" style={{ gap: 8 }}>
        <TimesEditor value={times!} onChange={setTimes} disabled={busy} />
        <div className="row"><Button size="sm" variant="primary" busy={busy} onClick={() => saveReminders({ reminderTimes: times!, remindersOn: times!.length > 0 })}>Save reminders</Button><Button size="sm" variant="tertiary" onClick={() => setTimes(null)}>Cancel</Button></div>
      </div>}
    </div>
    <div className="bp-card-foot">
      {h.setBy === 'member' ? <><Button size="sm" onClick={onEdit}>Edit</Button><Button size="sm" variant="tertiary" onClick={onPause}>{h.status === 'paused' ? 'Resume' : 'Pause'}</Button><Button size="sm" variant="tertiary" onClick={onArchive}>Archive</Button></>
        : <span className="muted small">Set by your coach. Its reminders are yours to change; ask your coach about the rest.</span>}
    </div>
  </Card>;
}

function HabitDialog({ state, onClose, onSaved }: { state: { habit: Habit | null } | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<HabitDraft>(draftFrom(null));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const habit = state?.habit ?? null;
  React.useEffect(() => { if (state) { setD(draftFrom(state.habit)); setErrs({}); setErr(''); } }, [state]);
  const save = async () => {
    setBusy(true); setErrs({}); setErr('');
    const body: Record<string, unknown> = { title: d.title, detail: d.detail, kind: d.kind, schedule: scheduleOf(d), targetLabel: d.targetLabel.trim() || null, endDate: d.endDate || null };
    try {
      if (habit) await api.patch(`/me/habits/${habit.id}`, body);
      else await api.post('/me/habits', { ...body, ...(d.startDate ? { startDate: d.startDate } : {}), ...(d.reminderTimes.length ? { reminderTimes: d.reminderTimes, remindersOn: true } : {}) });
      toast(habit ? 'Habit saved' : 'Habit added');
      onSaved();
    } catch (e) { setErrs(fieldErrors(e)); setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={!!state} onClose={onClose} title={habit ? `Edit “${habit.title}”` : 'Add a habit'} footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} onClick={save} disabled={d.title.trim().length < 2 || (d.type === 'weekdays' && !d.weekdays.length)}>{habit ? 'Save' : 'Add habit'}</Button></>}>
    <HabitFields d={d} set={(p) => setD((x) => ({ ...x, ...p }))} audience="member" creating={!habit} withReminders={!habit} errors={errs} />
    {err && <Alert kind="error">{err}</Alert>}
    {!habit && <p className="muted small" style={{ marginTop: 8 }}>Habits you add are yours to change. Your coach sees them only while health sharing is on.</p>}
  </Dialog>;
}
