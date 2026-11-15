/* Coach workspace: Appointments overview (/coach/appointments). The coach's appointments dashboard, built from
   Bioptime's own data and actions:
   - header: Set availability (the working hours and blocks card on Settings, /settings#availability), Calendar, and
     "Book appointment", which asks for the client and then opens the client record's own Schedule dialog
     (ScheduleDialog, POST /coach/appointments);
   - four tiles from GET /coach/appointments (upcoming and past): upcoming, requests, completed, cancelled. Requests,
     Completed and Cancelled count the same appointments as the chips of the same name (a request whose time has
     passed is still a request: it can be confirmed, moved or cancelled, and the tile says how many are late);
   - the appointments table with chips All · Scheduled · Requests · Completed · Cancelled · No-show, and the actions the
     Appointments page has always had (confirm, complete, move, cancel with a reason, no-show; with the live sessions
     module on: how to join and the consultation summary);
   - the appointment notifications among the coach's latest 200 notifications (GET /notifications, which has no
     category filter).
   The full list with Upcoming / Past tabs stays at /coach/calendar. */
import React, { useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { addDaysIst, fmtDateTime, label, relative } from '../../../../lib/format';
import { Link } from '../../../../lib/nav';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Input, ReasonDialog, Select, Skeleton, Table, Textarea, errorText, useApi, useToast } from '../../../../ui';
import { ScheduleDialog } from '../../../ClientDetail';
import { MeetingDialog, SummaryDialog } from '../../../../modules/sessions/AppointmentTools';
import { safeLink, useSessionsOn } from '../../../../modules/sessions/shared';
import { AccentCard, CardGrid, Icon, KpiTile, PageHeader, SegmentChips, StatusPill } from '../ui';
import { ClientSelect, PlansPage, useCoachClients } from './parts';

type Chip = 'all' | 'scheduled' | 'requested' | 'completed' | 'cancelled' | 'no_show';
const STATUS_WORD: Record<string, string> = { requested: 'Request', scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show' };
const PAGE = 25;

export function AppointmentsOverview() {
  const { user } = useAuth();
  const toast = useToast();
  const upcoming = useApi(() => api.get('/coach/appointments?range=upcoming'), []);
  const past = useApi(() => api.get('/coach/appointments?range=past'), []);
  const notifs = useApi(() => api.get('/notifications?limit=200'), []);
  const sessionsOn = useSessionsOn() === true;
  const followThrough = useApi(() => (sessionsOn ? api.get('/coach/consultation-follow-through') : Promise.resolve(null)), [sessionsOn]);
  const summarised = new Set((((followThrough.data as any)?.items ?? []) as any[]).filter((x) => x.hasSummary).map((x) => x.appointmentId as string));
  const [chip, setChip] = useState<Chip>('all');
  const [shownCount, setShownCount] = useState(PAGE);
  const [cancel, setCancel] = useState<any>(null);
  const [complete, setComplete] = useState<any>(null);
  const [move, setMove] = useState<any>(null);
  const [meeting, setMeeting] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [booking, setBooking] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);

  const up = (((upcoming.data as any)?.items ?? []) as any[]);
  const before = (((past.data as any)?.items ?? []) as any[]);
  const seen = new Set(up.map((a) => a.id));
  const all = [...up, ...before.filter((a) => !seen.has(a.id))];
  const loaded = !!upcoming.data && !!past.data;
  const pastCapped = before.length >= 200; // the API sends the latest 200 past appointments
  const n = (status: string, list = all) => list.filter((a) => a.status === status).length;
  const now = new Date().toISOString();
  const late = (a: any) => a.status === 'requested' && String(a.endAt ?? a.startAt) < now;
  const lateRequests = all.filter(late).length;
  const rows = chip === 'all' ? all : all.filter((a) => a.status === chip);
  const reload = () => { upcoming.reload(); past.reload(); };
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); reload(); } catch (e) { toast(errorText(e), 'error'); } };
  const apptNotifs = (((notifs.data as any)?.items ?? []) as any[]).filter((x) => typeof x.category === 'string' && x.category.startsWith('appointment')).slice(0, 8);

  return <PlansPage label="Appointments">
    <PageHeader title="Appointments" sub="Requests, bookings and consultations with your clients." actions={<>
      <Link className="bp-btn bp-btn-secondary" to="/settings#availability"><Icon name="clock" size={16} /> Set availability</Link>
      <Link className="bp-btn bp-btn-secondary" to="/calendar"><Icon name="calendar" size={16} /> Calendar</Link>
      <Button variant="primary" onClick={() => setBooking(true)}><Icon name="plus" size={16} /> Book appointment</Button>
    </>} />
    {(upcoming.error || past.error) && <Alert kind="error">{upcoming.error || past.error}</Alert>}
    <CardGrid columns={4} phone={2} label="Overview">
      <KpiTile label="Upcoming" value={n('scheduled', up)} icon="calendar" tone="info" loading={!upcoming.data && !upcoming.error} sub="Scheduled from now on" />
      <KpiTile label="Requests" value={loaded ? n('requested') : null} icon="clientPending" tone="warning" loading={!loaded && !(upcoming.error || past.error)} sub={lateRequests ? `${lateRequests} past the requested time` : 'Waiting for you to confirm'} />
      <KpiTile label="Completed" value={past.data ? `${n('completed', before)}${pastCapped ? '+' : ''}` : null} icon="check" tone="success" loading={!past.data && !past.error} />
      <KpiTile label="Cancelled" value={past.data ? `${n('cancelled', before)}${pastCapped ? '+' : ''}` : null} icon="close" tone="neutral" loading={!past.data && !past.error} />
    </CardGrid>
    <div className="wzp-split">
      <AccentCard title="Appointments" eyebrow="Overview">
        <div className="wzp-chips"><SegmentChips label="Show" value={chip} onChange={(c) => { setChip(c); setShownCount(PAGE); }} size="sm" items={[
          { id: 'all', label: 'All', count: all.length }, { id: 'scheduled', label: 'Scheduled', count: n('scheduled') }, { id: 'requested', label: 'Requests', count: n('requested') },
          { id: 'completed', label: 'Completed', count: n('completed') }, { id: 'cancelled', label: 'Cancelled', count: n('cancelled') }, { id: 'no_show', label: 'No-show', count: n('no_show') },
        ]} /></div>
        {!loaded && !(upcoming.error || past.error) ? <Skeleton rows={5} /> : rows.length ? <>
          <div className="wzp-apptable"><Table label="Appointments" dense head={<><th>Appointment / Client</th><th>Time and date</th><th>Status</th><th>Action</th></>}>
            {rows.slice(0, shownCount).map((a) => <tr key={a.id}>
              <td className="wzp-who" data-label="Appointment / Client"><b>{label(a.kind)}</b>{a.consumesEntitlement ? <span className="small muted"> · uses a consultation</span> : null}<div><Link to={`/clients/${a.memberId}`}>{a.memberName}</Link></div>{(a.memberNote ?? a.note) ? <div className="small muted">{a.memberNote ?? a.note}</div> : null}</td>
              <td data-label="Time and date">{fmtDateTime(a.startAt)}{sessionsOn && (a.status === 'scheduled' || a.status === 'requested') ? <div className="small"><button type="button" className="linkButton" onClick={() => setMeeting(a)}>{safeLink(a.meetingLink) ? 'Edit join link' : 'Add how to join'}</button></div> : a.status === 'scheduled' && safeLink(a.meetingLink) ? <div className="small muted">Join link added</div> : null}</td>
              <td data-label="Status"><StatusPill status={a.status}>{STATUS_WORD[a.status] ?? label(a.status)}</StatusPill>{late(a) ? <div className="small muted">Time has passed</div> : null}</td>
              <td data-label="Action"><div className="wzp-actions-cell">
                {a.status === 'requested' && <Button size="sm" variant="primary" onClick={() => act(() => api.post(`/coach/appointments/${a.id}/confirm`), 'Confirmed')}>Confirm</Button>}
                {a.status === 'scheduled' && <Button size="sm" onClick={() => setComplete(a)}>Complete</Button>}
                {(a.status === 'scheduled' || a.status === 'requested') && <Button size="sm" variant="tertiary" onClick={() => setMove(a)}>Move</Button>}
                {(a.status === 'scheduled' || a.status === 'requested') && <Button size="sm" variant="destructive" onClick={() => setCancel(a)}>Cancel</Button>}
                {a.status === 'scheduled' && <Button size="sm" variant="tertiary" onClick={() => act(() => api.post(`/coach/appointments/${a.id}/no-show`), 'Marked no-show')}>No-show</Button>}
                {sessionsOn && a.status === 'completed' && <Button size="sm" variant={summarised.has(a.id) ? 'tertiary' : 'secondary'} onClick={() => setSummary(a)}>{summarised.has(a.id) ? 'Summary' : 'Write summary'}</Button>}
                {(a.status === 'cancelled' || a.status === 'no_show' || (a.status === 'completed' && !sessionsOn)) && <span className="small muted">—</span>}
              </div></td>
            </tr>)}
          </Table></div>
          {rows.length > shownCount && <div className="bp-card-foot"><Button size="sm" onClick={() => setShownCount((c) => c + PAGE)}>Show more ({rows.length - shownCount} left)</Button></div>}
        </> : <Empty title={chip === 'all' ? 'No appointments yet' : `No ${chip === 'requested' ? 'requests' : chip === 'no_show' ? 'no-shows' : label(chip).toLowerCase() + ' appointments'}`} body={chip === 'all' ? 'Book one for a client, or share your working hours so clients can request one.' : undefined} />}
        {pastCapped && <p className="small muted" style={{ marginTop: 8 }}>Past appointments: the latest 200 are counted here.</p>}
      </AccentCard>
      <Card><CardHead eyebrow="Appointments" title="Notifications" right={<Icon name="bell" size={18} />} />
        {notifs.error ? <Alert kind="error">{notifs.error}</Alert> : !notifs.data ? <Skeleton rows={3} /> : apptNotifs.length ? <div className="notifList">{apptNotifs.map((x) => <div key={x.id} className={`notif ${x.read_at ? 'read' : ''}`}><span className="dot" /><div><b>{x.title}</b>{x.body}</div><time className="muted">{relative(x.created_at)}</time></div>)}</div>
          : <Empty title="Nothing new" body="Requests, changes and reminders about appointments appear here and under the bell." />}
      </Card>
    </div>
    <ReasonDialog open={!!cancel} onClose={() => setCancel(null)} title="Cancel this appointment?" danger confirmLabel="Cancel appointment" body="The member is notified and any reserved consultation is given back." onConfirm={async (reason) => { await api.post(`/coach/appointments/${cancel.id}/cancel`, { reason }); toast('Cancelled'); reload(); }} />
    <CompleteDialog a={complete} onClose={() => setComplete(null)} onDone={() => { toast('Completed'); reload(); }} />
    <MoveDialog a={move} onClose={() => setMove(null)} onDone={() => { toast('Moved'); reload(); }} />
    {sessionsOn && <MeetingDialog appointment={meeting} onClose={() => setMeeting(null)} onSaved={() => { toast('Join details saved'); reload(); }} />}
    {sessionsOn && <SummaryDialog appointment={summary} onClose={() => setSummary(null)} onSaved={() => { toast('Summary sent to the member'); followThrough.reload(); }} />}
    <PickClientDialog open={booking} onClose={() => setBooking(false)} onPick={(id) => { setBooking(false); setScheduleFor(id); }} />
    <ScheduleDialog open={!!scheduleFor} onClose={() => setScheduleFor(null)} memberId={scheduleFor ?? ''} coachId={user?.id ?? ''} onDone={() => { toast('Consultation scheduled'); reload(); }} />
  </PlansPage>;
}

/** "Book appointment" starts with the client: the Schedule dialog is the client record's own and needs one. */
function PickClientDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (memberId: string) => void }) {
  const clients = useCoachClients(open);
  const [member, setMember] = useState('');
  return <Dialog open={open} onClose={onClose} title="Book an appointment" footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!member} onClick={() => { const m = member; setMember(''); onPick(m); }}>Choose a time</Button></>}>
    <div className="form">
      <Field label="Client" hint={clients.items.length ? 'Your assigned clients' : clients.data ? 'No assigned clients yet' : 'Loading your clients…'} error={clients.error || undefined}><ClientSelect clients={clients.items} value={member} onChange={setMember} /></Field>
      <p className="muted small">Next: the date, a free slot in your working hours, and the kind of appointment.</p>
    </div>
  </Dialog>;
}

/* The Appointments page's Complete and Move dialogs (src/pages/Appointments.tsx keeps them private), with the same
   requests and wording. */
function CompleteDialog({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const go = async () => { try { await api.post(`/coach/appointments/${a.id}/complete`, { note }); setNote(''); onDone(); onClose(); } catch (e) { setErr(errorText(e)); } };
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
