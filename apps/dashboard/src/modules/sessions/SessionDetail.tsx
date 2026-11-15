/* M8 Live sessions, one session: /coach/sessions/:id (the host) and /admin/sessions/:id (sessions.manage). Details,
   edit, publish, cancel with a reason, complete, the calendar file, and the registrations: names, statuses and waitlist
   places for the host (never an email address or a phone number); administrators also see public registrants' emails
   and can cancel a registration with a reason. Attendance is recorded once the session has started. */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from '../../lib/nav';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, ReasonDialog, Select, Skeleton, Table, useApi, useToast, errorText } from '../../ui';
import { SessionForm, type Mode } from './SessionForm';
import { AUDIENCES, CalendarLink, JoinLine, RegistrationPill, SessionStatusPill, SessionTitle, fmtSpan, placesText } from './shared';

type Reg = { id: string; name: string; status: string; registeredAt: string; waitlistPosition: number | null; attendanceAt: string | null; source: 'member' | 'public'; clientId?: string | null; memberId?: string | null; email?: string | null };

export function SessionDetail({ mode }: { mode: Mode }) {
  const { id = '' } = useParams();
  const toast = useToast();
  const base = mode === 'admin' ? '/admin/sessions' : '/coach/sessions';
  const data = useApi(async () => {
    if (mode === 'admin') { const r = await api.get<{ session: any; registrations: Reg[] }>(`${base}/${id}`); return { session: r.session, regs: r.registrations }; }
    const [session, regs] = await Promise.all([api.get(`${base}/${id}`), api.get<{ items: Reg[] }>(`${base}/${id}/registrations`)]);
    return { session, regs: regs.items };
  }, [id, mode]);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [removing, setRemoving] = useState<Reg | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  useEffect(() => { setMarks({}); }, [data.data]);
  const d = data.data;
  if (data.error) return <div className="stack"><Link to="/sessions">← Live sessions</Link><Alert kind="error">{data.error}</Alert></div>;
  if (!d) return <Skeleton rows={8} />;
  const s = d.session;
  const regs = d.regs;
  const started = Date.parse(s.startAt) <= Date.now();
  const open = s.status === 'draft' || s.status === 'published';
  const attendanceOpen = started && (s.status === 'published' || s.status === 'completed');
  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => { setBusy(key); try { await fn(); toast(msg); data.reload(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); } };
  const changed = Object.entries(marks).filter(([rid, st]) => regs.find((r) => r.id === rid)?.status !== st);
  const saveAttendance = () => act('attendance', () => api.post(`${base}/${id}/attendance`, { marks: changed.map(([registrationId, status]) => ({ registrationId, status })) }), 'Attendance saved');
  const personLink = (r: Reg) => {
    const target = mode === 'admin' ? r.memberId : r.clientId;
    return target ? <Link to={`/clients/${target}`}>{r.name}</Link> : <span>{r.name}</span>;
  };
  return <div className="stack">
    <Link to="/sessions">← Live sessions</Link>
    <div className="pageHead"><div><h1><SessionTitle s={s} /></h1><p className="sub">{s.kindLabel} · {fmtSpan(s.startAt, s.endAt)}</p></div>
      <div className="actions row" style={{ gap: 6 }}>
        <SessionStatusPill status={s.status} />
        {open && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
        {s.status === 'draft' && <Button size="sm" variant="primary" busy={busy === 'publish'} onClick={() => act('publish', () => api.post(`${base}/${id}/publish`), 'Published: members in the audience can register')}>Publish</Button>}
        {s.status === 'published' && started && <Button size="sm" variant="primary" busy={busy === 'complete'} onClick={() => act('complete', () => api.post(`${base}/${id}/complete`), 'Marked completed')}>Mark completed</Button>}
        {s.status !== 'draft' && <CalendarLink href={`${base}/${id}/ics`} />}
        {open && <Button size="sm" variant="destructive" onClick={() => setCancelling(true)}>Cancel session</Button>}
      </div></div>
    {s.status === 'cancelled' && <Alert kind="warning" title="Cancelled">{s.cancelledReason}</Alert>}
    {s.status === 'draft' && <Alert kind="info" title="Draft">Members cannot see it yet. Publish it to open registration.</Alert>}
    <div className="grid">
      <div className="span4"><Card><CardHead eyebrow="Details" title="The session" />
        <dl className="kv">
          <dt>Host</dt><dd>{s.hostName}{s.hostRole && s.hostRole !== 'coach' ? ' (Bioptime team)' : ''}</dd>
          <dt>Who can join</dt><dd>{AUDIENCES[s.audience] ?? s.audience}{s.packages?.length ? `: ${s.packages.map((p: any) => p.name).join(', ')}` : ''}</dd>
          <dt>Places</dt><dd>{placesText(s)}</dd>
          <dt>How to join</dt><dd>{s.joinUrl ? <JoinLine url={s.joinUrl} by="the host" /> : <span className="small muted">No join link. No video provider is connected; add the link you will use, or tell people how to join.</span>}</dd>
          <dt>Created</dt><dd>{fmtDateTime(s.createdAt)}</dd>
        </dl>
        {s.description && <p className="small" style={{ marginTop: 10 }}>{s.description}</p>}
      </Card></div>
      <div className="span8"><Card><CardHead eyebrow={mode === 'admin' ? 'Registrations' : 'Registrations (names only)'} title={`${regs.filter((r) => r.status !== 'cancelled').length} people`} right={attendanceOpen && changed.length ? <Button size="sm" variant="primary" busy={busy === 'attendance'} onClick={saveAttendance}>Save attendance ({changed.length})</Button> : undefined} />
        {!started && s.status !== 'cancelled' && regs.length > 0 && <p className="small muted" style={{ marginBottom: 8 }}>Attendance opens when the session starts.</p>}
        {regs.length ? <Table label="Registrations" head={<><th>Name</th>{mode === 'admin' && <th>Email</th>}<th>Status</th><th>Signed up</th>{attendanceOpen && <th>Attendance</th>}{mode === 'admin' && <th />}</>}>
          {regs.map((r) => <tr key={r.id}><td>{personLink(r)}<div className="small muted">{r.source === 'public' ? 'Visitor (public sign-up)' : 'Member'}</div></td>
            {mode === 'admin' && <td className="small">{r.email ?? '—'}</td>}
            <td><RegistrationPill status={r.status} position={r.waitlistPosition} /></td><td className="small">{fmtDateTime(r.registeredAt)}</td>
            {attendanceOpen && <td>{['registered', 'attended', 'no_show'].includes(r.status) ? <Select aria-label={`Attendance for ${r.name}`} value={marks[r.id] ?? r.status} onChange={(e) => setMarks((m) => ({ ...m, [r.id]: e.target.value }))}><option value="registered">Not recorded</option><option value="attended">Attended</option><option value="no_show">No-show</option></Select> : <span className="small muted">—</span>}</td>}
            {mode === 'admin' && <td>{(r.status === 'registered' || r.status === 'waitlisted') && <Button size="sm" variant="tertiary" onClick={() => setRemoving(r)}>Remove</Button>}</td>}
          </tr>)}
        </Table> : <Empty title="Nobody yet" body={s.status === 'draft' ? 'Registration opens when you publish.' : 'People who register appear here.'} />}
      </Card></div>
    </div>
    <SessionForm mode={mode} open={editing} session={s} onClose={() => setEditing(false)} onSaved={() => { toast('Saved'); data.reload(); }} />
    <ReasonDialog open={cancelling} onClose={() => setCancelling(false)} title="Cancel this session?" danger confirmLabel="Cancel session" body="Everyone registered or waiting is told, with your reason." onConfirm={async (reason) => { await api.post(`${base}/${id}/cancel`, { reason }); toast('Session cancelled'); data.reload(); }} />
    <ReasonDialog open={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.name ?? 'this person'}?`} danger confirmLabel="Remove" body="Their registration is cancelled and they are told; if they held a place, the next person waiting gets it." onConfirm={async (reason) => { await api.post(`${base}/${id}/registrations/${removing!.id}/cancel`, { reason }); toast('Registration cancelled'); data.reload(); }} />
  </div>;
}

export default SessionDetail;
