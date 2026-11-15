/* /admin/growth/corporate (growth.manage): companies that asked about Bioptime for their team, and one enquiry at
   /admin/growth/corporate/:id (status, who handles it, team notes). Only team members holding growth.manage take one:
   the contact's details stay with the team. */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { Link, useNavigate } from '../../lib/nav';
import { fmtDateTime, relative } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Field, Select, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../../ui';
import { Notes } from './Notes';
import { CORPORATE_INTEREST_LABELS, CORPORATE_STATUSES, GrowthPill, type CorporateEnquiry, type CorporateStatus, type Person } from './shared';

export default function AdminCorporate() {
  const { id } = useParams();
  return id ? <EnquiryDetail id={id} /> : <EnquiryList />;
}

function EnquiryList() {
  const [status, setStatus] = useState('open');
  const list = useApi(() => api.get<{ items: CorporateEnquiry[]; counts: Record<string, number> }>(`/admin/growth/corporate${qs({ status })}`), [status]);
  const nav = useNavigate();
  const items = list.data?.items ?? [];
  const c = list.data?.counts ?? {};
  return <div className="stack">
    <div className="pageHead"><div><h1>Corporate enquiries</h1><p className="sub">Companies asking what Bioptime could offer their team. They were told someone will reply by email and that nothing is agreed or priced until you have talked. A closed enquiry is deleted with its notes 180 days after it was closed, and one nobody has changed for a year is deleted too.</p></div></div>
    <div className="row"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="open">Open ({(c.new ?? 0) + (c.contacted ?? 0) + (c.in_discussion ?? 0)})</option>{CORPORATE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label} ({c[s.id] ?? 0})</option>)}<option value="all">All</option></Select></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!list.data && !list.error ? <Skeleton rows={5} /> : items.length ? <Card dense><Table label="Corporate enquiries" head={<><th>Reference</th><th>Company</th><th>Team size</th><th>Interested in</th><th>Handled by</th><th>Status</th><th>Received</th></>}>
      {items.map((r) => <tr key={r.id} className="link" onClick={() => nav(`/growth/corporate/${r.id}`)}>
        <td><Link to={`/growth/corporate/${r.id}`}>{r.reference}</Link></td>
        <td>{r.company}<div className="muted small">{r.contactName} · {r.email}</div></td>
        <td>{r.teamSize}</td>
        <td className="small">{r.interests.map((i) => CORPORATE_INTEREST_LABELS[i] ?? i).join(', ')}</td>
        <td>{r.assignedTo?.name ?? <span className="muted">Not assigned</span>}</td>
        <td><GrowthPill status={r.status} /></td>
        <td className="small">{relative(r.createdAt)}</td>
      </tr>)}
    </Table></Card> : <Card><Empty title="Nothing in this view" body="Enquiries from the corporate page appear here." /></Card>}
  </div>;
}

function EnquiryDetail({ id }: { id: string }) {
  const r = useApi(() => api.get<CorporateEnquiry>(`/admin/growth/corporate/${id}`), [id]);
  const people = useApi(() => api.get<{ items: Person[] }>('/admin/growth/assignees'), []);
  const toast = useToast();
  const d = r.data;
  const [status, setStatus] = useState<CorporateStatus>('new');
  const [assigned, setAssigned] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (d) { setStatus(d.status); setAssigned(d.assignedTo?.id ?? ''); setNote(''); setErr(''); } }, [d]);
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.patch(`/admin/growth/corporate/${id}`, { status, assignedTo: assigned || null, ...(note.trim() ? { note: note.trim() } : {}) }); toast('Saved'); r.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const changed = !!d && (status !== d.status || (assigned || null) !== (d.assignedTo?.id ?? null) || !!note.trim());
  const team = (people.data?.items ?? []).filter((p) => p.role !== 'coach');
  return <div className="stack">
    <div className="pageHead"><div><h1>{d ? d.company : 'Corporate enquiry'}</h1><p className="sub">{d ? `${d.reference} · received ${fmtDateTime(d.createdAt)}` : ' '}</p></div><div className="actions">{d && <GrowthPill status={d.status} />}<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/growth/corporate">Back to the list</Link></div></div>
    {r.error ? <Alert kind="error">{r.error}</Alert> : !d ? <Skeleton rows={6} /> : <div className="grid">
      <div className="span8 stack">
        <Card><CardHead eyebrow="Their enquiry" title={`A team of ${d.teamSize}`} />
          <p className="small">Interested in: {d.interests.map((i) => CORPORATE_INTEREST_LABELS[i] ?? i).join(', ')}</p>
          {d.message ? <p style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{d.message}</p> : <p className="muted small" style={{ marginTop: 8 }}>No message.</p>}
        </Card>
        <Notes notes={d.notes ?? []} path={`/admin/growth/corporate/${id}/notes`} onSaved={r.reload} />
      </div>
      <div className="span4 stack">
        <Card><CardHead eyebrow="Contact" title={d.contactName} />
          <dl className="kv"><dt>Email</dt><dd>{d.email}</dd><dt>Phone</dt><dd>{d.phone === undefined ? <span className="muted">Hidden: needs the restricted fields permission</span> : d.phone ?? <span className="muted">Not given</span>}</dd><dt>Agreed to</dt><dd className="small">{d.consentText ?? d.consentVersion} <span className="muted">({fmtDateTime(d.consentAt)})</span></dd></dl>
          <p className="muted small">Reply to them yourself; saving here sends them nothing. Promise only what Bioptime runs today.</p>
        </Card>
        <Card><CardHead eyebrow="Handling" title="Status and owner" />
          <div className="form">
            <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as CorporateStatus)}>{CORPORATE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
            <Field label="Handled by" hint="Team members who handle growth."><Select value={assigned} onChange={(e) => setAssigned(e.target.value)}><option value="">Not assigned</option>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Note" optional><Textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></Field>
            {err && <Alert kind="error">{err}</Alert>}
            <Button variant="primary" busy={busy} disabled={!changed} onClick={save}>Save</Button>
          </div>
        </Card>
      </div>
    </div>}
  </div>;
}
