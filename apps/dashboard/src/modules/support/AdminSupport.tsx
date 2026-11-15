/* /admin/support: the support queue (operations.manage) and the data exports members asked for (members.manage).
   /admin/support/:id: one request, its whole thread with internal notes, replies, notes, ownership and status. */
import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Link, useNavigate } from '../../lib/nav';
import { fmtDate, fmtDateTime, label, relative } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Field, Input, Pill, ReasonDialog, Select, Skeleton, Table, Tabs, Textarea, useApi, useToast, errorText } from '../../ui';
import { CATEGORIES, RequestStatus, Thread, categoryLabel, fmtBytes, useSupportParts } from './shared';

type Row = { id: string; reference: string; category: string; subject: string; status: string; requester: { id: string; name: string; email: string; role: string } | null; assignedTo: { id: string; name: string } | null; createdAt: string; updatedAt: string; messageCount: number; internalCount: number };
type Detail = Row & { requesterRole: string; resolvedAt: string | null; messages: Array<{ id: string; body: string; internal: boolean; createdAt: string; fromRequester: boolean; author: { id: string; name: string; role: string } }> };

const STATUSES = [{ id: 'open', label: 'Open' }, { id: 'waiting_on_requester', label: 'Waiting on requester' }, { id: 'resolved', label: 'Resolved' }, { id: 'closed', label: 'Closed' }];

export default function AdminSupport() {
  const { id } = useParams();
  return id ? <RequestDetail id={id} /> : <SupportHome />;
}

function SupportHome() {
  const { can } = useAuth();
  const parts = useSupportParts();
  const [params, setParams] = useSearchParams();
  const tabs = [...(can('operations.manage') && parts?.requests ? [{ id: 'requests' as const, label: 'Support requests' }] : []), ...(can('members.manage') ? [{ id: 'exports' as const, label: 'Data exports' }] : [])];
  const tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0]?.id;
  if (!parts) return <Skeleton rows={6} />;
  return <div className="stack">
    <div className="pageHead"><div><h1>Support</h1><p className="sub">Questions from members and coaches, answered in a thread they follow in the portal and the app, and the copies of their data members asked for. No response time is promised until Bioptime sets one.</p></div></div>
    {tab ? <Tabs items={tabs} value={tab} onChange={(t) => { params.set('tab', t); setParams(params, { replace: true }); }}>
      {tab === 'requests' && <Queue />}
      {tab === 'exports' && <Exports />}
    </Tabs> : <Card><Empty title="Nothing to show" body="Support requests need the operations permission; data exports need the members permission." /></Card>}
  </div>;
}

function Queue() {
  const [f, setF] = useState({ status: 'active', category: '', assigned: '', q: '' });
  const [q, setQ] = useState('');
  const list = useApi(() => api.get<{ items: Row[]; counts: Record<string, number> }>(`/admin/support-requests${qs({ status: f.status === 'all' ? '' : f.status, category: f.category, assigned: f.assigned, q: f.q })}`), [f]);
  const nav = useNavigate();
  const items = list.data?.items ?? [];
  const c = list.data?.counts;
  return <div className="stack">
    <div className="row">
      <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="active">Open or waiting{c ? ` (${(c.open ?? 0) + (c.waiting_on_requester ?? 0)})` : ''}</option>{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}{c ? ` (${c[s.id] ?? 0})` : ''}</option>)}<option value="all">All</option></Select>
      <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Topic"><option value="">Any topic</option>{CATEGORIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
      <Select value={f.assigned} onChange={(e) => setF({ ...f, assigned: e.target.value })} aria-label="Owner"><option value="">Anyone’s</option><option value="me">Mine</option><option value="none">Unowned</option></Select>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setF({ ...f, q: q.trim() }); }}><Input type="search" placeholder="Reference or subject" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requests" /><Button size="sm" type="submit">Search</Button></form>
    </div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!list.data && !list.error ? <Skeleton rows={5} /> : items.length ? <Card dense><Table label="Support requests" head={<><th>Reference</th><th>Subject</th><th>From</th><th>Topic</th><th>Owner</th><th>Status</th><th>Last activity</th></>}>{items.map((r) => <tr key={r.id} className="link" onClick={() => nav(`/support/${r.id}`)}><td><Link to={`/support/${r.id}`}>{r.reference}</Link></td><td>{r.subject}<div className="muted small">{r.messageCount} message{r.messageCount === 1 ? '' : 's'}{r.internalCount ? ` · ${r.internalCount} internal` : ''}</div></td><td>{r.requester?.name ?? '—'}<div className="muted small">{label(r.requester?.role)}</div></td><td className="small">{categoryLabel(r.category)}</td><td>{r.assignedTo?.name ?? <span className="muted">Unowned</span>}</td><td><RequestStatus status={r.status} forTeam /></td><td className="small">{relative(r.updatedAt)}</td></tr>)}</Table></Card> : <Card><Empty title="Nothing in this view" /></Card>}
  </div>;
}

function RequestDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const r = useApi(() => api.get<Detail>(`/admin/support-requests/${id}`), [id]);
  const toast = useToast();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState('waiting_on_requester');
  const [busy, setBusy] = useState(false);
  const [statusDlg, setStatusDlg] = useState<string | null>(null);
  const d = r.data;
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try { await api.post(`/admin/support-requests/${id}/messages`, { body: body.trim(), internal, ...(internal ? {} : { status: after }) }); setBody(''); toast(internal ? 'Internal note added' : 'Reply sent; the requester is notified'); r.reload(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const take = async () => { try { await api.patch(`/admin/support-requests/${id}`, { assignedTo: user?.id, reason: 'Taken from the queue' }); toast('You own it'); r.reload(); } catch (e) { toast(errorText(e), 'error'); } };
  const mine = d?.requester?.id === user?.id;
  return <div className="stack">
    <div className="pageHead"><div><h1>{d ? d.subject : 'Support request'}</h1><p className="sub">{d ? `${d.reference} · ${categoryLabel(d.category)} · opened ${fmtDateTime(d.createdAt)}` : ' '}</p></div><div className="actions">{d && <RequestStatus status={d.status} forTeam />}<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/support">Back to the queue</Link></div></div>
    {r.error ? <Alert kind="error">{r.error}</Alert> : !d ? <Skeleton rows={6} /> : <div className="grid">
      <div className="span8"><Card><CardHead eyebrow="Thread" title={`${d.messages.length} message${d.messages.length === 1 ? '' : 's'}`} />
        <Thread items={d.messages.map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt, internal: m.internal, mine: !m.fromRequester, authorName: m.fromRequester ? `${m.author.name} (${label(m.author.role)})` : m.author.name }))} />
        {mine ? <Alert kind="info">This is your own request; someone else on the team answers it.</Alert> : <div className="form" style={{ marginTop: 12 }}>
          <Textarea value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} placeholder={internal ? 'A note for the team. The requester never sees it.' : 'Your reply to the requester. Plain and specific; no health advice.'} />
          <div className="row between">
            <div className="row"><label className="bp-check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label>{!internal && <Field label="Then"><Select value={after} onChange={(e) => setAfter(e.target.value)}>{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>}</div>
            <Button variant="primary" busy={busy} disabled={!body.trim()} onClick={send}>{internal ? 'Add note' : 'Send reply'}</Button>
          </div>
          <span className="muted small">{internal ? 'Nobody is notified of an internal note.' : 'The requester is notified that a reply arrived; the notification does not carry the text.'}</span>
        </div>}
      </Card></div>
      <div className="span4"><Card><CardHead eyebrow="Request" title={d.reference} />
        <dl className="kv"><dt>From</dt><dd>{d.requester ? <>{d.requester.name} · {label(d.requester.role)}{d.requester.role === 'member' && <> · <Link to={`/clients/${d.requester.id}`}>client record</Link></>}</> : '—'}</dd><dt>Email</dt><dd>{d.requester?.email ?? '—'}</dd><dt>Topic</dt><dd>{categoryLabel(d.category)}</dd><dt>Owner</dt><dd>{d.assignedTo?.name ?? 'Unowned'}</dd><dt>Opened</dt><dd>{fmtDateTime(d.createdAt)}</dd><dt>Resolved</dt><dd>{d.resolvedAt ? fmtDateTime(d.resolvedAt) : '—'}</dd></dl>
        <div className="row" style={{ marginTop: 12 }}>{d.assignedTo?.id !== user?.id && !mine && <Button size="sm" onClick={take}>Take it</Button>}<Select value="" onChange={(e) => { if (e.target.value) setStatusDlg(e.target.value); }} aria-label="Change the status"><option value="">Change status…</option>{STATUSES.filter((s) => s.id !== d.status).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></div>
      </Card></div>
    </div>}
    <ReasonDialog open={!!statusDlg} onClose={() => setStatusDlg(null)} title={`Mark ${d?.reference ?? ''} ${STATUSES.find((s) => s.id === statusDlg)?.label.toLowerCase() ?? ''}?`} confirmLabel="Change status" body="The requester sees the new status. Changing it does not notify them; reply if they should hear from you." onConfirm={async (reason) => { await api.patch(`/admin/support-requests/${id}`, { status: statusDlg, reason }); toast('Status changed'); r.reload(); }} />
  </div>;
}

type ExportRow = { id: string; status: string; requestedAt: string; completedAt: string | null; memberId: string; memberName: string; memberCode: string | null; note: string | null; file: { name: string; size: number; createdAt: string } | null };

function Exports() {
  const list = useApi(() => api.get<{ items: ExportRow[] }>('/admin/data-exports'), []);
  const toast = useToast();
  const [gen, setGen] = useState<ExportRow | null>(null);
  const items = list.data?.items ?? [];
  return <div className="stack">
    <Alert kind="info" title="What the team can and cannot see">An export is generated once its request is in progress (here, or when the request is marked in progress), by the data exports job. The file is a JSON archive that only the member can open, through a link that works for five minutes; the team sees that it exists and its size, never its contents.</Alert>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!list.data && !list.error ? <Skeleton rows={4} /> : items.length ? <Card dense><Table label="Data export requests" head={<><th>Member</th><th>Requested</th><th>Status</th><th>File</th><th /></>}>{items.map((e) => <tr key={e.id}><td><Link to={`/clients/${e.memberId}`}>{e.memberName}</Link><div className="muted small">{e.memberCode ?? ''}{e.note ? ` · ${e.note}` : ''}</div></td><td className="small">{fmtDate(e.requestedAt)}</td><td><Pill status={e.status} /></td><td className="small">{e.file ? `Ready · ${fmtBytes(e.file.size)} · ${fmtDateTime(e.file.createdAt)}` : e.status === 'in_progress' ? 'Waiting for the next job run' : '—'}</td><td className="num">{!e.file && (e.status === 'requested' || e.status === 'in_progress') && <Button size="sm" onClick={() => setGen(e)}>Generate now</Button>}</td></tr>)}</Table></Card> : <Card><Empty title="No export requests" body="Members ask for a copy of their data under Profile › Your data." /></Card>}
    <ReasonDialog open={!!gen} onClose={() => setGen(null)} title={`Generate ${gen?.memberName ?? ''}’s data export?`} confirmLabel="Generate" body={`${gen?.status === 'requested' ? 'The request moves to in progress, and is' : 'The request is'} completed when the file is written. The member is notified and downloads it themselves.`} onConfirm={async (reason) => { await api.post(`/admin/data-exports/${gen!.id}/generate`, { reason }); toast('Export generated; the member is notified'); list.reload(); }} />
  </div>;
}
