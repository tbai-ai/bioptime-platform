import React, { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { uuid } from '../../lib/ids';
import { api, ApiRequestError } from '../../lib/api';
import { addDaysIst, fmtDate, fmtDateTime, fmtTime, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, ConfirmDialog, Empty, Field, Pill, Skeleton, Textarea, useApi, useToast, errorText } from '../../ui';
// M8: how to join (the link the coach typed, or who shares it), calendar files and summaries while the sessions module is on
import { CalendarLink, JoinLine, useSessionsOn } from '../../modules/sessions/shared';

/** Why the API said no: a state error (409) carries its reason in details.code (NO_COACH), other errors in code. */
const reason = (e: unknown): string | null => (e instanceof ApiRequestError ? (e.details as { code?: string } | null | undefined)?.code ?? e.code : null);

/** Appointments: the coach, upcoming and past consultations, and booking from the coach's free slots. */
export function ClientAppointments() {
  const [params, setParams] = useSearchParams();
  const coach = useApi(() => api.get('/me/coach'), []);
  const upcoming = useApi(() => api.get('/me/appointments?range=upcoming'), []);
  const past = useApi(() => api.get('/me/appointments?range=past'), []);
  const config = useApi(() => api.get('/public/config'), []);
  const sessionsOn = useSessionsOn() === true;
  const summaries = useApi(() => (sessionsOn ? api.get('/me/consultation-summaries') : Promise.resolve(null)), [sessionsOn]);
  const summaryItems = (((summaries.data as any)?.items ?? []) as any[]);
  const toast = useToast();
  const [cancel, setCancel] = useState<any>(null);
  const [booking, setBooking] = useState(params.get('book') === '1');
  const c = (coach.data as any)?.coach;
  const a = (coach.data as any)?.assignment;
  const reload = () => { coach.reload(); upcoming.reload(); past.reload(); };
  if (coach.error) return <Alert kind="error">{coach.error}</Alert>;
  if (!coach.data) return <Skeleton rows={6} />;
  return <div className="stack">
    <div className="pageHead"><div><h1>Appointments</h1><p className="sub">Consultations with your coach, booked from their free slots (IST). Bookings need at least 30 minutes' notice.</p></div><div className="actions">{c && <Button variant="primary" onClick={() => { setBooking(true); params.delete('book'); setParams(params, { replace: true }); }}>Book a consultation</Button>}</div></div>
    <div className="grid">
      <div className="span4"><Card>{c ? <><CardHead eyebrow="Your coach" title={c.displayName} right={a ? <Pill status={a.status} /> : undefined} />{c.bio && <p className="small">{c.bio}</p>}
        <dl className="kv" style={{ marginTop: 10 }}><dt>Expertise</dt><dd>{(c.expertise ?? []).join(', ') || '—'}</dd><dt>Languages</dt><dd>{(c.languages ?? []).join(', ') || '—'}</dd><dt>Qualifications</dt><dd>{(c.qualifications ?? []).length ? c.qualifications.join(', ') : 'Shown once verified by Bioptime'}</dd><dt>Scope</dt><dd>{(c.scope ?? []).join(', ') || 'Wellness and fitness coaching; not medical advice'}</dd></dl>
        {a?.status === 'paused' && <Alert kind="warning" title="Away for now">Your coach is away. Your plan and bookings stay as they are, messages wait for your coach, and Bioptime can reassign you if needed.</Alert>}</>
        : <><CardHead eyebrow="Coach" title="Not assigned yet" /><p className="small">Bioptime matches you with a coach by expertise, language and availability, and tells you here. Once a coach is assigned, you can ask for a different one by writing to the Bioptime team at {(config.data as any)?.supportEmail ?? 'the support address'}; there is no switch for it in the portal.</p></>}</Card></div>
      <div className="span8"><div className="stack">
        {booking && c && <Booking onDone={() => { setBooking(false); reload(); }} onClose={() => setBooking(false)} />}
        <Card><CardHead eyebrow="Upcoming" title="Consultations" />{((upcoming.data as any)?.items ?? []).length ? <div className="stack">{((upcoming.data as any).items as any[]).map((ap) => <div key={ap.id} className="row between"><div><b style={{ color: 'var(--bp-color-text-primary)' }}>{label(ap.kind)} · {fmtDateTime(ap.startAt)}</b><div className="small">{ap.coachName ?? ''}{ap.consumesEntitlement ? ' · counts against your package' : ''}{ap.note ? ' · ' + ap.note : ''}</div>{sessionsOn && ap.status === 'scheduled' && <JoinLine url={ap.meetingLink} />}</div><div className="row"><Pill status={ap.status} />{sessionsOn && (ap.status === 'scheduled' || ap.status === 'requested') && <CalendarLink href={`/me/appointments/${ap.id}/ics`} />}{(ap.status === 'scheduled' || ap.status === 'requested') && <Button size="sm" variant="tertiary" onClick={() => setCancel(ap)}>Cancel</Button>}</div></div>)}</div> : <Empty title="Nothing booked" body={c ? "Book from your coach's free slots." : 'Available once a coach is assigned.'} />}</Card>
        {((past.data as any)?.items ?? []).length ? <Card><CardHead eyebrow="Past" title="History" /><div className="stack">{((past.data as any).items as any[]).slice(0, 10).map((ap) => <div key={ap.id} className="row between"><span>{label(ap.kind)} · {fmtDateTime(ap.startAt)} <span className="muted">{ap.coachName ?? ''}</span></span><Pill status={ap.status} /></div>)}</div></Card> : null}
        {summaryItems.length ? <Card><CardHead eyebrow="From your coach" title="Consultation summaries" /><div className="stack">{summaryItems.slice(0, 10).map((x) => <div key={x.id}><b style={{ color: 'var(--bp-color-text-primary)' }}>{label(x.kind)} · {fmtDate(x.startAt)}</b> <span className="muted small">{x.coachName}</span><p className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{x.body}</p></div>)}</div></Card> : null}
      </div></div>
    </div>
    <ConfirmDialog open={!!cancel} onClose={() => setCancel(null)} title="Cancel this consultation?" confirmLabel="Cancel it" danger body="The slot is given back to your package." note="A word for your coach" onConfirm={async (note) => { await api.post(`/me/appointments/${cancel.id}/cancel`, { reason: note || 'cancelled in the portal' }); toast('Consultation cancelled'); reload(); }} />
  </div>;
}

function Booking({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [date, setDate] = useState(addDaysIst(1));
  const [slot, setSlot] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [noCoach, setNoCoach] = useState(false);
  const key = useRef(uuid());
  const slots = useApi(() => api.get(`/me/appointments/slots?date=${date}`).catch((e) => { if (reason(e) === 'NO_COACH') { setNoCoach(true); return { slots: [] }; } throw e; }), [date]);
  const book = async () => {
    if (!slot) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<any>('/me/appointments', { startAt: slot, kind: 'consultation', note: note.trim() || undefined, idempotencyKey: key.current });
      const when = `${fmtDate(r.startAt ?? slot)} at ${fmtTime(r.startAt ?? slot)}`;
      setMsg({ kind: 'success', text: r.status === 'scheduled' ? `Booked for ${when}. One consultation is held from your package until it is completed; cancelling gives it back.` : `Requested for ${when}. Your coach confirms it; one consultation is held from your package until then.` });
      setSlot(null); key.current = uuid(); onDone();
    } catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(false); }
  };
  const days = [1, 2, 3, 4, 5, 6, 7].map((n) => addDaysIst(n));
  return <Card accent><CardHead eyebrow="Book" title="A consultation" right={<Button size="sm" variant="tertiary" onClick={onClose}>Close</Button>} />
    {noCoach ? <Alert kind="warning" title="No coach yet">Consultations open once a coach is assigned.</Alert> : slots.error ? <Alert kind="error">{slots.error}</Alert> : null}
    <div className="pillRow" style={{ marginBottom: 10 }}>{days.map((d) => <button key={d} type="button" className="bp-chip" aria-pressed={d === date} onClick={() => { setDate(d); setSlot(null); }}>{fmtDate(d).replace(/ \d{4}$/, '')}</button>)}</div>
    {slots.loading ? <Skeleton rows={1} /> : ((slots.data as any)?.slots ?? []).length ? <div className="pillRow">{((slots.data as any).slots as any[]).map((s) => <button key={s.startAt} type="button" className="bp-chip" aria-pressed={slot === s.startAt} onClick={() => setSlot(s.startAt)}>{fmtTime(s.startAt)}</button>)}</div> : !noCoach && !slots.error ? <p className="small">No free slots that day.</p> : null}
    <div className="form" style={{ marginTop: 12 }}><Field label="Anything your coach should know" optional><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Button variant="primary" busy={busy} disabled={!slot} onClick={book}>Request this slot</Button></div>
  </Card>;
}
