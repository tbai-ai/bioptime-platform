/* M8 Live sessions, member portal (/client/sessions): the group classes, webinars and workshops the member can join,
   with their place or waitlist position, how to join once they hold a place, a calendar file, and the ones they
   joined before. Join links are only what the host typed; otherwise the member reads who will share how to join. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Alert, Button, Card, CardHead, ConfirmDialog, Empty, Skeleton, useApi, useToast, errorText } from '../../ui';
import { CalendarLink, JoinLine, RegistrationPill, SessionStatusPill, SessionTitle, fmtSpan, placesText } from './shared';

type MemberSession = {
  id: string; kind: string; kindLabel: string; title: string; description: string; hostName: string; startAt: string; endAt: string; status: string;
  cancelledReason: string | null; sample: boolean; capacity: number | null; spotsLeft: number | null; full: boolean; started: boolean; eligible: boolean;
  myRegistration: { id: string; status: string; waitlistPosition: number | null } | null; joinUrl: string | null; howToJoin: string | null;
};

export function ClientSessions() {
  const data = useApi(() => api.get<{ items: MemberSession[]; history: MemberSession[] }>('/me/sessions'), []);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<MemberSession | null>(null);
  const d = data.data;
  const register = async (s: MemberSession) => {
    setBusy(s.id);
    try {
      const r = await api.post<MemberSession>(`/me/sessions/${s.id}/register`);
      toast(r.myRegistration?.status === 'waitlisted' ? `You are number ${r.myRegistration.waitlistPosition} on the waitlist` : 'You are registered');
      data.reload();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const items = d?.items ?? [];
  const mine = items.filter((s) => s.myRegistration);
  const open = items.filter((s) => !s.myRegistration);
  return <div className="stack">
    <div className="pageHead"><div><h1>Live sessions</h1><p className="sub">Group classes, webinars and workshops you can join. Times are in IST. When a session is full you can join its waitlist; if a place opens up, you are told.</p></div></div>
    {data.error && <Alert kind="error">{data.error}</Alert>}
    {!d && !data.error ? <Skeleton rows={6} /> : d && <div className="grid">
      <div className="span8"><div className="stack">
        <Card><CardHead eyebrow="Your places" title="Sessions you joined" />
          {mine.length ? <ul className="taskList">{mine.map((s) => <li key={s.id}>
            <div><span><SessionTitle s={s} /></span><span className="muted">{s.kindLabel} · {fmtSpan(s.startAt, s.endAt)} · {s.hostName}</span>
              {s.myRegistration?.status === 'registered' ? <JoinLine url={s.joinUrl} fallback={s.howToJoin} by="the host" /> : <span className="small muted">You are told here and by notification if a place opens up.</span>}</div>
            <div className="row" style={{ gap: 6 }}><RegistrationPill status={s.myRegistration!.status} position={s.myRegistration!.waitlistPosition} />
              {s.myRegistration?.status === 'registered' && <CalendarLink href={`/me/sessions/${s.id}/ics`} />}
              {!s.started && <Button size="sm" variant="tertiary" onClick={() => setLeaving(s)}>{s.myRegistration?.status === 'waitlisted' ? 'Leave the waitlist' : 'Give my place back'}</Button>}</div>
          </li>)}</ul> : <Empty title="Nothing joined yet" body="Sessions you register for appear here, with how to join." />}
        </Card>
        <Card><CardHead eyebrow="Open to you" title="Upcoming sessions" />
          {open.length ? <ul className="taskList">{open.map((s) => <li key={s.id}>
            <div><span><SessionTitle s={s} /></span><span className="muted">{s.kindLabel} · {fmtSpan(s.startAt, s.endAt)} · {s.hostName}</span>{s.description && <span className="small">{s.description}</span>}<span className="small muted">{placesText(s)}</span></div>
            <div className="row" style={{ gap: 6 }}>{s.started ? <span className="small muted">Started</span> : <Button size="sm" variant={s.full ? 'secondary' : 'primary'} busy={busy === s.id} onClick={() => register(s)}>{s.full ? 'Join the waitlist' : 'Register'}</Button>}</div>
          </li>)}</ul> : <Empty title="No sessions open right now" body="New group classes, webinars and workshops appear here when the Bioptime team or your coach publishes them." />}
        </Card>
      </div></div>
      <div className="span4"><div className="stack">
        <Card><CardHead eyebrow="Before you join" title="How it works" />
          <ul className="timeline small">
            <li>Register while places are free; when a session is full you join its waitlist in the order people signed up.</li>
            <li>Give your place back any time before the start, and the next person waiting is told.</li>
            <li>How to join is shown here once you hold a place. Until a link is shared, the host tells you how to join.</li>
          </ul>
        </Card>
        {(d.history ?? []).length ? <Card><CardHead eyebrow="Earlier" title="Past and cancelled" />
          <ul className="taskList">{d.history.map((s) => <li key={s.id}><div><span><SessionTitle s={s} /></span><span className="muted">{fmtSpan(s.startAt, s.endAt)}</span>{s.cancelledReason && <span className="small">{s.cancelledReason}</span>}</div>
            <div className="row" style={{ gap: 6 }}>{s.status === 'cancelled' ? <SessionStatusPill status="cancelled" /> : s.myRegistration && <RegistrationPill status={s.myRegistration.status} />}</div></li>)}</ul>
        </Card> : null}
      </div></div>
    </div>}
    <ConfirmDialog open={!!leaving} onClose={() => setLeaving(null)} title={leaving?.myRegistration?.status === 'waitlisted' ? 'Leave the waitlist?' : 'Give your place back?'} confirmLabel={leaving?.myRegistration?.status === 'waitlisted' ? 'Leave the waitlist' : 'Give it back'} danger
      body={leaving?.myRegistration?.status === 'waitlisted' ? 'You lose your place in the queue. You can join again later, at the end of the waitlist.' : 'The next person waiting gets your place. You can register again if places are free.'}
      onConfirm={async () => { await api.post(`/me/sessions/${leaving!.id}/cancel`, {}); toast('Done'); data.reload(); }} />
  </div>;
}

export default ClientSessions;
