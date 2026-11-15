/* Coach workspace: "Assign client" on a workout plan card. Creates the chosen client's workout
   programme through the coach endpoints the client record's "New workout programme" flow uses (ProgramEditor):
   POST /coach/workout-programs (a draft; the server checks the client is assigned to this coach and that every
   template is one the coach may use), then, when the coach says so, POST /coach/workout-programs/:id/publish, which
   gives the client their sessions in the app and tells them. Nothing reaches the client before that.
   - A template (one session) goes on the training days chosen, for a number of weeks (as the administrator's "Start
     from a template" fill). Day 1 is the start date; day N falls N-1 days after it, every week.
   - A programme (weeks of days) is copied week for week; its summary is not copied, since it was written for another
     client.
   Whether the client shares health data with the coach changes what the coach sees afterwards (the server leaves out
   set logs, effort, duration and notes), not whether a programme can be given; the dialog says which applies. */
import React, { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { todayIst } from '../../../../lib/format';
import { useNavigate } from '../../../../lib/nav';
import { Alert, Button, Dialog, Field, Input, errorText, useApi, useToast } from '../../../../ui';
import { DAY_NAMES, fmtDay } from '../../../../modules/workouts/shared';
import { ClientSelect, useCoachClients } from './parts';
import type { WorkoutPlan } from './workoutPlans';

type Structure = { weeks: Array<{ week: number; focus?: string; days: Array<{ day: number; templateId: string }> }> };

function fromTemplate(templateId: string, weeks: number, days: number[]): Structure {
  const sorted = [...days].sort((a, b) => a - b);
  return { weeks: Array.from({ length: weeks }, (_, i) => ({ week: i + 1, days: sorted.map((day) => ({ day, templateId })) })) };
}
const sessionsIn = (s: Structure) => s.weeks.reduce((n, w) => n + w.days.length, 0);

export function AssignWorkoutDialog({ plan, onClose, onAssigned }: { plan: WorkoutPlan | null; onClose: () => void; onAssigned?: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const clients = useCoachClients(!!plan);
  const [member, setMember] = useState('');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(todayIst());
  const [weeks, setWeeks] = useState('4');
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<{ id: string; title: string; memberName: string; sessions: number; weeks: number; published: boolean } | null>(null);
  useEffect(() => {
    if (!plan) return;
    setMember(''); setTitle(plan.title); setStartDate(todayIst()); setWeeks('4'); setDays([1, 3, 5]); setErr(''); setCreated(null); setBusy(false);
  }, [plan]);
  // the chosen client's programmes, so the coach knows what is already there before adding another
  const existing = useApi(() => (member ? api.get(`/coach/workout-programs?memberId=${encodeURIComponent(member)}`) : Promise.resolve(null)), [member]);
  const client = clients.items.find((c) => c.id === member);
  const live = ((((existing.data as any)?.items ?? []) as any[])).filter((p) => p.status !== 'archived');

  const nWeeks = Math.min(52, Math.max(1, Math.floor(Number(weeks)) || 0));
  const structure: Structure | null = !plan ? null : plan.kind === 'template' ? fromTemplate(plan.id, nWeeks, days) : plan.structure;
  const empty = plan?.kind === 'template' && !plan.exercises;
  const ready = !!member && title.trim().length >= 2 && !!structure && sessionsIn(structure) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && !empty;

  const create = async () => {
    if (!plan || !structure) return;
    setBusy(true); setErr('');
    try {
      const r = await api.post('/coach/workout-programs', { memberId: member, title: title.trim(), summary: '', startDate, structure });
      setCreated({ id: r.id, title: r.title ?? title.trim(), memberName: r.memberName ?? client?.name ?? 'your client', sessions: sessionsIn(structure), weeks: structure.weeks.length, published: false });
      onAssigned?.();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const publish = async () => {
    if (!created) return;
    setBusy(true); setErr('');
    try {
      await api.post(`/coach/workout-programs/${created.id}/publish`, { startDate });
      setCreated({ ...created, published: true });
      toast(`Published: ${created.memberName} has their sessions in the app`);
      onAssigned?.();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const open = () => { if (created) { onClose(); nav(`/workout-programs/${created.id}`); } };

  const footer = created
    ? <><Button variant="tertiary" onClick={onClose}>Close</Button><Button variant={created.published ? 'primary' : 'secondary'} onClick={open}>Open the programme</Button>{!created.published && <Button variant="primary" busy={busy} onClick={publish}>Publish</Button>}</>
    : <><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!ready} onClick={create}>Create the programme</Button></>;

  return <Dialog open={!!plan} onClose={onClose} title={created ? (created.published ? 'Programme published' : 'Programme created as a draft') : `Assign: ${plan?.title ?? ''}`} footer={footer}>
    {plan && (created ? <div className="wzp-done">
      {created.published
        ? <Alert kind="success" title={`${created.memberName} has their sessions`}>{created.title}: {created.weeks} week{created.weeks === 1 ? '' : 's'}, {created.sessions} session{created.sessions === 1 ? '' : 's'} from {fmtDay(startDate)}. They were told, and see it under Workouts in the app.</Alert>
        : <Alert kind="info" title={`A draft for ${created.memberName}`}>{created.title}: {created.weeks} week{created.weeks === 1 ? '' : 's'}, {created.sessions} session{created.sessions === 1 ? '' : 's'} from {fmtDay(startDate)}. Nothing reaches {created.memberName} until you publish it. Open the programme to change any week or day first.</Alert>}
      {client && !client.healthShared && <p className="small muted">{client.name} does not share health data with you: you see the schedule and whether each session was done; sets, effort, duration and notes appear once they turn on sharing with their coach in the app.</p>}
      {err && <Alert kind="error">{err}</Alert>}
    </div> : <div className="form">
      <p className="small">{plan.kind === 'template'
        ? `${plan.title} is one session${plan.exercises ? ` of ${plan.exercises} exercise${plan.exercises === 1 ? '' : 's'}` : ''}. It goes on the training days you choose, every week, as a draft programme for the client.`
        : `${plan.title} has ${plan.weeks} week${plan.weeks === 1 ? '' : 's'} and ${plan.sessions} session${plan.sessions === 1 ? '' : 's'}. Its weeks and days are copied into a draft programme for the client; its summary is not.`}</p>
      {empty && <Alert kind="warning">This template has no exercises yet. Add them in the template first.</Alert>}
      <Field label="Client" hint={clients.error ? undefined : clients.items.length ? 'Your assigned clients' : clients.data ? 'No assigned clients yet' : 'Loading your clients…'} error={clients.error || undefined}>
        <ClientSelect clients={clients.items} value={member} onChange={setMember} />
      </Field>
      {client && !client.healthShared && <Alert kind="warning" title={`${client.name} does not share health data with you`}>You can still give them a programme. You will see the schedule and whether each session was done; sets, effort, duration and notes appear once they turn on sharing with their coach in the app, and feedback needs the same.</Alert>}
      {member && live.length > 0 && <p className="small muted">{client?.name ?? 'This client'} already has {live.map((p) => `${p.title} (${p.status === 'published' ? 'published' : 'draft'})`).join(', ')}. A new programme adds its own sessions alongside.</p>}
      <Field label="Programme title"><Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Start date (sessions are dated from it)"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
      {plan.kind === 'template' && <>
        <Field label="Weeks"><Input type="number" min={1} max={52} inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} /></Field>
        <fieldset className="wzp-days"><legend className="bp-label">Training days (day 1 is the start date)</legend>
          {DAY_NAMES.map((n, k) => <label key={k} className="bp-check"><input type="checkbox" checked={days.includes(k + 1)} onChange={(e) => setDays((d) => (e.target.checked ? [...d, k + 1] : d.filter((x) => x !== k + 1)))} /> {n}</label>)}
        </fieldset>
        {structure && <p className="small muted">{sessionsIn(structure)} session{sessionsIn(structure) === 1 ? '' : 's'} over {nWeeks} week{nWeeks === 1 ? '' : 's'}.</p>}
      </>}
      <p className="muted small">Created as a draft. You publish it next, or open it to adjust any week or day first.</p>
      {err && <Alert kind="error">{err}</Alert>}
    </div>)}
  </Dialog>;
}
