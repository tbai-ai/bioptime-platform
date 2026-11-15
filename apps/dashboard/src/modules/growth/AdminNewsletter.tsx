/* /admin/growth/newsletter (growth.manage): newsletter sign-ups. A sign-up counts once the person has opened the link
   emailed to them (double opt-in); the CSV export holds confirmed subscribers unless another status is chosen, and
   each export is recorded in the audit log. No newsletter is sent from here: there is no email provider yet. */
import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Alert, Button, Card, Empty, Input, ReasonDialog, Readout, Select, Skeleton, Table, useApi, useToast } from '../../ui';
import { GrowthPill, SOURCE_LABELS, type Subscriber } from './shared';

export default function AdminNewsletter() {
  const [status, setStatus] = useState('confirmed');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const list = useApi(() => api.get<{ items: Subscriber[]; counts: Record<string, number> }>(`/admin/growth/newsletter${qs({ status, q: search })}`), [status, search]);
  const toast = useToast();
  const [off, setOff] = useState<Subscriber | null>(null);
  const items = list.data?.items ?? [];
  const c = list.data?.counts ?? {};
  const csv = `/api/admin/growth/newsletter/export.csv${qs({ status })}`;
  return <div className="stack">
    <div className="pageHead"><div><h1>Newsletter</h1><p className="sub">People who signed up in the website footer. Each one confirmed by opening a link sent to their address, and every email carries a link to leave. Nothing is sent from here.</p></div><div className="actions"><a className="bp-btn bp-btn-secondary bp-btn-sm" href={csv} download>Download CSV</a></div></div>
    <div className="grid">
      <div className="span4"><Readout eyebrow="Confirmed" value={c.confirmed ?? 0} sub="Agreed twice" /></div>
      <div className="span4"><Readout eyebrow="Waiting to confirm" value={c.pending ?? 0} sub="Deleted 30 days after the link expires" /></div>
      <div className="span4"><Readout eyebrow="Unsubscribed" value={c.unsubscribed ?? 0} sub="Deleted 30 days after leaving" /></div>
    </div>
    <div className="row">
      <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="confirmed">Confirmed</option><option value="pending">Waiting to confirm</option><option value="unsubscribed">Unsubscribed</option><option value="all">All</option></Select>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}><Input type="search" placeholder="Email address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by email" /><Button size="sm" type="submit">Search</Button></form>
    </div>
    <p className="muted small">The CSV holds the rows of the status chosen above. Downloads are recorded in the audit log with how many rows they held.</p>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!list.data && !list.error ? <Skeleton rows={5} /> : items.length ? <Card dense><Table label="Newsletter subscribers" head={<><th>Email</th><th>Status</th><th>Signed up</th><th>Confirmed</th><th>From</th><th /></>}>
      {items.map((s) => <tr key={s.id}>
        <td>{s.email}</td>
        <td><GrowthPill status={s.status} />{s.status === 'pending' && s.confirmExpiresAt && <div className="muted small">Link works until {fmtDateTime(s.confirmExpiresAt)}</div>}</td>
        <td className="small">{fmtDateTime(s.requestedAt)}</td>
        <td className="small">{s.confirmedAt ? fmtDateTime(s.confirmedAt) : '—'}{s.unsubscribedAt && <div className="muted">Left {fmtDateTime(s.unsubscribedAt)}</div>}</td>
        <td className="small">{SOURCE_LABELS[s.source] ?? s.source}</td>
        <td className="num">{s.status !== 'unsubscribed' && <Button size="sm" variant="tertiary" onClick={() => setOff(s)}>Unsubscribe</Button>}</td>
      </tr>)}
    </Table></Card> : <Card><Empty title="Nobody in this view" body="Sign-ups from the website footer appear here." /></Card>}
    <ReasonDialog open={!!off} onClose={() => setOff(null)} title={`Take ${off?.email ?? ''} off the newsletter?`} confirmLabel="Unsubscribe" body="For example when they ask by email. They can sign up again themselves." onConfirm={async (reason) => { await api.post(`/admin/growth/newsletter/${off!.id}/unsubscribe`, { reason }); toast('Unsubscribed'); list.reload(); }} />
  </div>;
}
