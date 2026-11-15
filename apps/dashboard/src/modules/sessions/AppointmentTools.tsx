/* M8 consultation follow-through: the dialogs the coach's Appointments page opens (only while the sessions module is
   on). How to join: the https link the coach will use, or none; no video provider creates meetings yet. The summary:
   after a completed consultation, a summary the member reads, an optional private note and the coach's follow-ups. */
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, label } from '../../lib/format';
import { Alert, Button, Dialog, Field, Input, Pill, Skeleton, Textarea, useApi, errorText } from '../../ui';
import { CalendarLink } from './shared';

export function MeetingDialog({ appointment, onClose, onSaved }: { appointment: any; onClose: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (appointment) { setUrl(appointment.meetingLink ?? ''); setErr(''); } }, [appointment]);
  const save = async (value: string | null) => {
    setBusy(true); setErr('');
    try { await api.patch(`/coach/appointments/${appointment.id}/meeting`, { joinUrl: value }); onSaved(); onClose(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={!!appointment} onClose={onClose} title="How to join" footer={<>{appointment?.meetingLink && <Button variant="tertiary" busy={busy} onClick={() => save(null)}>Remove the link</Button>}<Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!url.trim()} onClick={() => save(url.trim())}>Save</Button></>}>
    {appointment && <div className="form">
      <p className="small">{appointment.memberName} · {fmtDateTime(appointment.startAt)}</p>
      <Field label="Meeting link" hint="The https link you will use for this consultation. The member sees it under Appointments once the consultation is confirmed, and is told when you add it."><Input type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
      <p className="muted small">No video provider is connected, so Bioptime creates no meeting. Without a link the member reads “Your coach will share how to join.”</p>
      <div><CalendarLink href={`/coach/appointments/${appointment.id}/ics`} label="Add this consultation to your calendar" /></div>
      {err && <Alert kind="error">{err}</Alert>}
    </div>}
  </Dialog>;
}

type FollowUp = { title: string; detail: string };

export function SummaryDialog({ appointment, onClose, onSaved }: { appointment: any; onClose: () => void; onSaved: () => void }) {
  const existing = useApi(() => (appointment ? api.get(`/coach/appointments/${appointment.id}/summary`) : Promise.resolve(null)), [appointment?.id]);
  const [forMember, setForMember] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (appointment) { setForMember(''); setPrivateNote(''); setFollowUps([]); setErr(''); } }, [appointment]);
  const d = existing.data as any;
  const written = !!d?.summary;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api.post(`/coach/appointments/${appointment.id}/summary`, { forMember, privateNote: privateNote.trim() || undefined, followUps: followUps.filter((f) => f.title.trim()).map((f) => ({ title: f.title.trim(), detail: f.detail.trim() || undefined })) });
      onSaved(); onClose();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const setFollowUp = (i: number, patch: Partial<FollowUp>) => setFollowUps((list) => list.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  return <Dialog open={!!appointment} onClose={onClose} title={written ? 'Consultation summary' : 'Write the consultation summary'} footer={written ? <Button variant="primary" onClick={onClose}>Close</Button> : <><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} disabled={forMember.trim().length < 10} onClick={save}>Send to the member</Button></>}>
    {appointment && (existing.loading && !d ? <Skeleton rows={4} /> : written ? <div className="stack">
      <p className="small">{appointment.memberName} · {label(appointment.kind)} on {fmtDate(appointment.startAt)}</p>
      <div><span className="bp-label">Sent to the member, {fmtDate(d.summary.createdAt)}</span><p>{d.summary.body}</p></div>
      {d.privateNotes?.length ? <div><span className="bp-label">Private notes</span>{d.privateNotes.map((n: any) => <p key={n.id} className="small">{n.body}</p>)}</div> : null}
      {d.followUps?.length ? <div><span className="bp-label">Follow-ups</span><ul className="taskList">{d.followUps.map((f: any) => <li key={f.id}><div><span>{f.title}</span>{f.detail && <span className="small">{f.detail}</span>}</div><Pill status={f.status} /></li>)}</ul></div> : null}
    </div> : <div className="form">
      <p className="small">{appointment.memberName} · {label(appointment.kind)} on {fmtDate(appointment.startAt)}</p>
      <Field label="Summary for the member" hint="What you covered and agreed, in plain words. The member reads it under Appointments; the notification carries no detail."><Textarea value={forMember} maxLength={4000} onChange={(e) => setForMember(e.target.value)} /></Field>
      <Field label="Private note" optional hint="For the coaching team only; the member never sees it."><Textarea value={privateNote} maxLength={4000} onChange={(e) => setPrivateNote(e.target.value)} /></Field>
      <div className="stack"><span className="bp-label">Follow-ups for you</span>
        {followUps.map((f, i) => <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start' }}><Input aria-label={`Follow-up ${i + 1}`} placeholder="What to follow up" value={f.title} maxLength={200} onChange={(e) => setFollowUp(i, { title: e.target.value })} /><Input aria-label={`Detail ${i + 1}`} placeholder="Detail (optional)" value={f.detail} maxLength={1000} onChange={(e) => setFollowUp(i, { detail: e.target.value })} /><Button size="sm" variant="tertiary" onClick={() => setFollowUps((list) => list.filter((_, k) => k !== i))}>Remove</Button></div>)}
        {followUps.length < 10 && <div><Button size="sm" onClick={() => setFollowUps((list) => [...list, { title: '', detail: '' }])}>Add a follow-up</Button></div>}
        <p className="muted small">Follow-ups join your list on Today and in the client’s record. One summary per consultation.</p>
      </div>
      {err && <Alert kind="error">{err}</Alert>}
    </div>)}
  </Dialog>;
}
