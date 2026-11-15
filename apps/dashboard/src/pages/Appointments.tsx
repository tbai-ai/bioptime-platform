import React, { useState } from 'react';
import { Link } from '../lib/nav';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, label, addDaysIst } from '../lib/format';
import { Alert, Button, Card, Dialog, Empty, Field, Input, Pill, ReasonDialog, Select, Skeleton, Table, Tabs, Textarea, useApi, useToast, errorText } from '../ui';
// M8 consultation follow-through: meeting details, the summary and calendar files, only while the sessions module is on
import { safeLink, useSessionsOn } from '../modules/sessions/shared';
import { MeetingDialog, SummaryDialog } from '../modules/sessions/AppointmentTools';

export function Appointments() {
  const { isPrivileged } = useAuth();
  const [range, setRange] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const list = useApi(() => api.get(isPrivileged ? `/admin/appointments${qs({ range })}` : `/coach/appointments${qs({ range })}`), [range, isPrivileged]);
  const toast = useToast();
  const [cancel, setCancel] = useState<any>(null);
  const [complete, setComplete] = useState<any>(null);
  const [move, setMove] = useState<any>(null);
  const [meeting, setMeeting] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const sessionsOn = useSessionsOn() === true;
  const followThrough = useApi(() => (!isPrivileged && sessionsOn ? api.get('/coach/consultation-follow-through') : Promise.resolve(null)), [isPrivileged, sessionsOn, range]);
  const summarised = new Set((((followThrough.data as any)?.items ?? []) as any[]).filter((x) => x.hasSummary).map((x) => x.appointmentId as string));
  const items = ((list.data as any)?.items ?? []) as any[];
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); list.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  return <div className="stack">
    <div className="pageHead"><div><h1>Appointments</h1><p className="sub">{isPrivileged ? 'Every consultation, check-in and review across coaches.' : 'Requested appointments need your confirmation; completed consultations consume the member\'s entitlement.'}</p></div></div>
    <Tabs items={[{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' }]} value={range} onChange={setRange}>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {list.loading && !list.data ? <Skeleton rows={5} /> : items.length ? <Card dense><Table head={<><th>When</th><th>Member</th>{isPrivileged && <th>Coach</th>}<th>Kind</th><th>Status</th><th>Note</th>{!isPrivileged && <th></th>}</>}>
      {items.map((a) => <tr key={a.id}><td>{fmtDateTime(a.startAt)}{!isPrivileged && sessionsOn && (a.status === 'scheduled' || a.status === 'requested') ? <div className="small"><button type="button" className="linkButton" onClick={() => setMeeting(a)}>{safeLink(a.meetingLink) ? 'Edit join link' : 'Add how to join'}</button></div> : a.status === 'scheduled' && safeLink(a.meetingLink) ? <div className="small muted">Join link added</div> : null}</td><td><Link to={`/clients/${a.memberId}`}>{a.memberName}</Link></td>{isPrivileged && <td>{a.coachName ?? '—'}</td>}<td>{label(a.kind)}{a.consumesEntitlement ? <div className="muted">uses entitlement</div> : null}</td><td><Pill status={a.status} /></td><td className="small">{a.memberNote ?? a.note ?? ''}</td>{!isPrivileged && <td><div className="row">{a.status === 'requested' && <Button size="sm" variant="primary" onClick={() => act(() => api.post(`/coach/appointments/${a.id}/confirm`), 'Confirmed')}>Confirm</Button>}{a.status === 'scheduled' && <Button size="sm" onClick={() => setComplete(a)}>Complete</Button>}{(a.status === 'scheduled' || a.status === 'requested') && <Button size="sm" variant="tertiary" onClick={() => setMove(a)}>Move</Button>}{(a.status === 'scheduled' || a.status === 'requested') && <Button size="sm" variant="destructive" onClick={() => setCancel(a)}>Cancel</Button>}{a.status === 'scheduled' && <Button size="sm" variant="tertiary" onClick={() => act(() => api.post(`/coach/appointments/${a.id}/no-show`), 'Marked no-show')}>No-show</Button>}{sessionsOn && a.status === 'completed' && <Button size="sm" variant={summarised.has(a.id) ? 'tertiary' : 'secondary'} onClick={() => setSummary(a)}>{summarised.has(a.id) ? 'Summary' : 'Write summary'}</Button>}</div></td>}</tr>)}
    </Table></Card> : <Card><Empty title="No appointments" body={range === 'upcoming' ? 'Schedule one from a client\'s page.' : undefined} /></Card>}
    </Tabs>
    <ReasonDialog open={!!cancel} onClose={() => setCancel(null)} title="Cancel this appointment?" danger confirmLabel="Cancel appointment" body="The member is notified and any reserved consultation is given back." onConfirm={async (reason) => { await api.post(`/coach/appointments/${cancel.id}/cancel`, { reason }); toast('Cancelled'); list.reload(); }} />
    <CompleteDialog a={complete} onClose={() => setComplete(null)} onDone={() => { toast('Completed'); list.reload(); }} />
    <MoveDialog a={move} onClose={() => setMove(null)} onDone={() => { toast('Moved'); list.reload(); }} />
    {sessionsOn && <MeetingDialog appointment={meeting} onClose={() => setMeeting(null)} onSaved={() => { toast('Join details saved'); list.reload(); }} />}
    {sessionsOn && <SummaryDialog appointment={summary} onClose={() => setSummary(null)} onSaved={() => { toast('Summary sent to the member'); followThrough.reload(); }} />}
  </div>;
}

function CompleteDialog({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const go = async () => { try { await api.post(`/coach/appointments/${a.id}/complete`, { note }); onDone(); onClose(); } catch (e) { setErr(errorText(e)); } };
  return <Dialog open={!!a} onClose={onClose} title="Mark the consultation completed" footer={<><Button variant="tertiary" onClick={onClose}>Not yet</Button><Button variant="primary" onClick={go}>Complete</Button></>}><Field label="What was covered (internal)" optional><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>{err && <Alert kind="error">{err}</Alert>}<p className="muted">Completing a consultation consumes one of the member's consultations.</p></Dialog>;
}

function MoveDialog({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(addDaysIst(1));
  const [slot, setSlot] = useState('');
  const [err, setErr] = useState('');
  const slots = useApi(() => (a ? api.get(`/coach/appointments/slots?date=${date}`) : Promise.resolve(null)), [date, a?.id]);
  const list = ((slots.data as any)?.slots ?? []) as Array<{ startAt: string }>;
  const go = async () => { try { await api.patch(`/coach/appointments/${a.id}`, { startAt: slot, reason: 'moved by the coach' }); onDone(); onClose(); } catch (e) { setErr(errorText(e)); } };
  return <Dialog open={!!a} onClose={onClose} title="Move the appointment" footer={<><Button variant="tertiary" onClick={onClose}>Keep</Button><Button variant="primary" disabled={!slot} onClick={go}>Move</Button></>}><div className="form"><Field label="Date"><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlot(''); }} /></Field><Field label="Slot"><Select value={slot} onChange={(e) => setSlot(e.target.value)}><option value="">Choose</option>{list.map((s) => <option key={s.startAt} value={s.startAt}>{new Date(s.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })}</option>)}</Select></Field>{err && <Alert kind="error">{err}</Alert>}</div></Dialog>;
}
