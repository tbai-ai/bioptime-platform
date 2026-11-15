/* /admin/growth/discovery-calls (growth.manage): prospects who asked for a short call, the times the team offers on the
   website, and one request at /admin/growth/discovery-calls/:id (status, who handles it, the agreed time, team notes).
   The server enforces the permission and strips phone numbers for administrators without members.view_restricted. */
import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { Link, useNavigate } from '../../lib/nav';
import { fmtDateTime, relative } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Field, Input, ReasonDialog, Select, Skeleton, Table, Tabs, Textarea, useApi, useToast, errorText } from '../../ui';
import { Notes } from './Notes';
import { DISCOVERY_STATUSES, GrowthPill, PreferredTimes, SOURCE_LABELS, istInputToIso, isoToIstInput, istLabel, type DiscoveryCall, type DiscoveryStatus, type Person } from './shared';

type Tab = 'requests' | 'times';

export default function AdminDiscoveryCalls() {
  const { id } = useParams();
  return id ? <CallDetail id={id} /> : <CallsHome />;
}

function CallsHome() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'times' ? 'times' : 'requests';
  return <div className="stack">
    <div className="pageHead"><div><h1>Discovery calls</h1><p className="sub">People without an account who asked for a short call from the website. They were told someone will be in touch; nothing is booked until the team has spoken with them. A closed request is deleted with its notes 180 days after it was closed, and one nobody has changed for a year is deleted too.</p></div></div>
    <Tabs items={[{ id: 'requests', label: 'Requests' }, { id: 'times', label: 'Offered times' }]} value={tab} onChange={(t) => { params.set('tab', t); setParams(params, { replace: true }); }}>
      {tab === 'requests' ? <Requests /> : <Times />}
    </Tabs>
  </div>;
}

function Requests() {
  const [f, setF] = useState({ status: 'open', assigned: '' });
  const list = useApi(() => api.get<{ items: DiscoveryCall[]; counts: Record<string, number> }>(`/admin/growth/discovery-calls${qs({ status: f.status, assigned: f.assigned })}`), [f]);
  const nav = useNavigate();
  const items = list.data?.items ?? [];
  const c = list.data?.counts ?? {};
  return <div className="stack">
    <div className="row">
      <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="open">Open ({(c.new ?? 0) + (c.contacted ?? 0) + (c.booked ?? 0)})</option>{DISCOVERY_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label} ({c[s.id] ?? 0})</option>)}<option value="all">All</option></Select>
      <Select value={f.assigned} onChange={(e) => setF({ ...f, assigned: e.target.value })} aria-label="Handled by"><option value="">Anyone</option><option value="me">Mine</option><option value="none">Not assigned</option></Select>
    </div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!list.data && !list.error ? <Skeleton rows={5} /> : items.length ? <Card dense><Table label="Discovery call requests" head={<><th>Reference</th><th>Person</th><th>Goals</th><th>Preferred times</th><th>Handled by</th><th>Status</th><th>Received</th></>}>
      {items.map((r) => <tr key={r.id} className="link" onClick={() => nav(`/growth/discovery-calls/${r.id}`)}>
        <td><Link to={`/growth/discovery-calls/${r.id}`}>{r.reference}</Link><div className="muted small">{SOURCE_LABELS[r.source] ?? r.source}</div></td>
        <td>{r.name}<div className="muted small">{r.email}{r.phone ? ` · ${r.phone}` : ''}</div></td>
        <td className="small">{r.goals.length > 120 ? `${r.goals.slice(0, 117)}…` : r.goals}</td>
        <td className="small">{r.preferredSlots.length ? r.preferredSlots.map((s) => s.label).join('; ') : ''}{r.preferredWindows ? `${r.preferredSlots.length ? '; ' : ''}“${r.preferredWindows}”` : ''}</td>
        <td>{r.assignedTo?.name ?? <span className="muted">Not assigned</span>}</td>
        <td><GrowthPill status={r.status} />{r.status === 'booked' && r.bookedAt && <div className="muted small">{istLabel(r.bookedAt)}</div>}</td>
        <td className="small">{relative(r.createdAt)}</td>
      </tr>)}
    </Table></Card> : <Card><Empty title="Nothing in this view" body="Requests from the discovery call page appear here." /></Card>}
  </div>;
}

type SlotRow = { id: string; startAt: string; endAt: string; label: string; status: 'published' | 'withdrawn'; past: boolean; requests: number };

function Times() {
  const list = useApi(() => api.get<{ items: SlotRow[] }>('/admin/growth/slots'), []);
  const toast = useToast();
  const [start, setStart] = useState('');
  const [minutes, setMinutes] = useState('20');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [withdraw, setWithdraw] = useState<SlotRow | null>(null);
  const add = async () => {
    const startAt = istInputToIso(start);
    if (!startAt) { setErr('Choose a date and time'); return; }
    setBusy(true); setErr('');
    try { await api.post('/admin/growth/slots', { startAt, endAt: new Date(Date.parse(startAt) + Number(minutes) * 60_000).toISOString() }); toast('Time offered on the website'); setStart(''); list.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const items = list.data?.items ?? [];
  return <div className="stack">
    <Card><CardHead eyebrow="Offer a time" title="Times on the discovery call page" />
      <p className="small">Visitors may name up to three of these as preferences. Choosing one books nothing: you agree the time with them. Times are in India time (IST).</p>
      <div className="row" style={{ alignItems: 'flex-end', marginTop: 8 }}>
        <Field label="Starts (IST)" error={err}><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Length"><Select value={minutes} onChange={(e) => setMinutes(e.target.value)}>{['15', '20', '30', '45', '60'].map((m) => <option key={m} value={m}>{m} minutes</option>)}</Select></Field>
        <Button variant="primary" busy={busy} disabled={!start} onClick={add}>Offer this time</Button>
      </div>
    </Card>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!list.data && !list.error ? <Skeleton rows={4} /> : items.length ? <Card dense><Table label="Offered times" head={<><th>Time</th><th>Status</th><th>Open requests naming it</th><th /></>}>
      {items.map((s) => <tr key={s.id}><td>{s.label}{s.past && <span className="muted small"> · past</span>}</td><td><GrowthPill status={s.status} /></td><td className="num">{s.requests}</td><td className="num">{s.status === 'published' && !s.past && <Button size="sm" variant="tertiary" onClick={() => setWithdraw(s)}>Withdraw</Button>}</td></tr>)}
    </Table></Card> : <Card><Empty title="No times offered" body="Without offered times, visitors write when suits them in their own words." /></Card>}
    <ReasonDialog open={!!withdraw} onClose={() => setWithdraw(null)} title={`Stop offering ${withdraw?.label ?? ''}?`} confirmLabel="Withdraw" body="The website stops offering it. Requests that already named it keep it, marked as no longer offered." onConfirm={async (reason) => { await api.post(`/admin/growth/slots/${withdraw!.id}/withdraw`, { reason }); toast('Withdrawn'); list.reload(); }} />
  </div>;
}

function CallDetail({ id }: { id: string }) {
  const r = useApi(() => api.get<DiscoveryCall>(`/admin/growth/discovery-calls/${id}`), [id]);
  const people = useApi(() => api.get<{ items: Person[] }>('/admin/growth/assignees'), []);
  const toast = useToast();
  const d = r.data;
  const [status, setStatus] = useState<DiscoveryStatus>('new');
  const [assigned, setAssigned] = useState('');
  const [booked, setBooked] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (d) { setStatus(d.status); setAssigned(d.assignedTo?.id ?? ''); setBooked(isoToIstInput(d.bookedAt)); setNote(''); setErr(''); } }, [d]);
  const save = async () => {
    if (!d) return;
    const bookedAt = status === 'booked' ? (booked ? istInputToIso(booked) : null) : undefined;
    if (status === 'booked' && booked && !bookedAt) { setErr('Choose the agreed date and time'); return; }
    setBusy(true); setErr('');
    try {
      await api.patch(`/admin/growth/discovery-calls/${id}`, { status, assignedTo: assigned || null, ...(bookedAt !== undefined ? { bookedAt } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      toast('Saved'); r.reload();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const changed = !!d && (status !== d.status || (assigned || null) !== (d.assignedTo?.id ?? null) || (status === 'booked' && booked !== isoToIstInput(d.bookedAt)) || !!note.trim());
  return <div className="stack">
    <div className="pageHead"><div><h1>{d ? d.name : 'Discovery call'}</h1><p className="sub">{d ? `${d.reference} · asked ${fmtDateTime(d.createdAt)} · ${SOURCE_LABELS[d.source] ?? d.source}` : ' '}</p></div><div className="actions">{d && <GrowthPill status={d.status} />}<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/growth/discovery-calls">Back to the list</Link></div></div>
    {r.error ? <Alert kind="error">{r.error}</Alert> : !d ? <Skeleton rows={6} /> : <div className="grid">
      <div className="span8 stack">
        <Card><CardHead eyebrow="What they told us" title="Goals" /><p style={{ whiteSpace: 'pre-wrap' }}>{d.goals}</p>
          <h3 className="small" style={{ marginTop: 12 }}>Preferred times</h3><PreferredTimes slots={d.preferredSlots} windows={d.preferredWindows} />
          {d.interests.length > 0 && <p className="small" style={{ marginTop: 8 }}>Packages the package finder suggested: {d.interests.join(', ')}</p>}
        </Card>
        <Notes notes={d.notes ?? []} path={`/admin/growth/discovery-calls/${id}/notes`} onSaved={r.reload} />
      </div>
      <div className="span4 stack">
        <Card><CardHead eyebrow="Contact" title={d.reference} />
          <dl className="kv"><dt>Email</dt><dd>{d.email}</dd><dt>Phone</dt><dd>{d.phone === undefined ? <span className="muted">Hidden: needs the restricted fields permission</span> : d.phone ?? <span className="muted">Not given</span>}</dd><dt>Agreed to</dt><dd className="small">{d.consentText ?? d.consentVersion} <span className="muted">({fmtDateTime(d.consentAt)})</span></dd></dl>
          <p className="muted small">Write to them yourself to agree a time; saving here sends them nothing.</p>
        </Card>
        <Card><CardHead eyebrow="Handling" title="Status and owner" />
          <div className="form">
            <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as DiscoveryStatus)}>{DISCOVERY_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
            {status === 'booked' && <Field label="Agreed time (IST)" optional hint="The time you agreed with them."><Input type="datetime-local" value={booked} onChange={(e) => setBooked(e.target.value)} /></Field>}
            <Field label="Handled by" hint="A coach is told by reference and sees the name, goals and times, never the email or phone number."><Select value={assigned} onChange={(e) => setAssigned(e.target.value)}><option value="">Not assigned</option>{(people.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role === 'coach' ? 'coach' : 'team'})</option>)}</Select></Field>
            <Field label="Note" optional><Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="For example: emailed two evening options." /></Field>
            {err && <Alert kind="error">{err}</Alert>}
            <Button variant="primary" busy={busy} disabled={!changed} onClick={save}>Save</Button>
          </div>
        </Card>
      </div>
    </div>}
  </div>;
}
