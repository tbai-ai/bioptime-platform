/* /admin/referrals (members.manage): every member who joined with someone's referral code, with its status: signed up,
   or became a paying member (their first order paid, after the payment provider's verified confirmation). Names link to
   the client record. Nothing about rewards is stored: they are an owner decision. */
import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { Link } from '../../lib/nav';
import { fmtDate } from '../../lib/format';
import { Alert, Card, Empty, Input, Pill, Readout, Select, Skeleton, Table, useApi } from '../../ui';

type Person = { id: string; name: string; memberCode: string | null };
type Item = { id: string; code: string; status: 'signed_up' | 'paying_member'; statusLabel: string; signedUpAt: string; becamePayingAt: string | null; referrer: Person; referred: Person };
type List = { items: Item[]; counts: { signed_up: number; paying_member: number; total: number; referringMembers: number } };

export function AdminReferrals() {
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const list = useApi(() => api.get<List>(`/admin/referrals${qs({ status, q: search })}`), [status, search]);
  const d = list.data;
  const c = d?.counts;
  return <div className="stack">
    <div className="pageHead"><div><h1>Referrals</h1><p className="sub">Members who created an account with another member’s link. A referral becomes a paying member when their first order is paid. Rewards are set by the Bioptime team; nothing here promises one.</p></div></div>
    {c && <div className="grid">
      <div className="span3"><Card><Readout eyebrow="Referrals" value={c.total} /></Card></div>
      <div className="span3"><Card><Readout eyebrow="Signed up" value={c.signed_up} /></Card></div>
      <div className="span3"><Card><Readout eyebrow="Paying members" value={c.paying_member} /></Card></div>
      <div className="span3"><Card><Readout eyebrow="Members referring" value={c.referringMembers} /></Card></div>
    </div>}
    <form className="row" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
      <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="all">All statuses</option><option value="signed_up">Signed up</option><option value="paying_member">Became a paying member</option></Select>
      <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSearch(q.trim())} placeholder="Name, member ID or code" aria-label="Search referrals" />
    </form>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!d && !list.error ? <Skeleton rows={6} /> : d && d.items.length ? <Card dense><Table label="Referrals" head={<><th>Joined</th><th>New member</th><th>Referred by</th><th>Code</th><th>Status</th></>}>
      {d.items.map((r) => <tr key={r.id}>
        <td className="small">{fmtDate(r.signedUpAt)}</td>
        <td><Link to={`/clients/${r.referred.id}`}>{r.referred.name}</Link>{r.referred.memberCode && <div className="muted small">{r.referred.memberCode}</div>}</td>
        <td><Link to={`/clients/${r.referrer.id}`}>{r.referrer.name}</Link>{r.referrer.memberCode && <div className="muted small">{r.referrer.memberCode}</div>}</td>
        <td><code>{r.code}</code></td>
        <td><Pill status={r.status === 'paying_member' ? 'active' : 'confirmed'}>{r.statusLabel}</Pill>{r.becamePayingAt && <div className="muted small">{fmtDate(r.becamePayingAt)}</div>}</td>
      </tr>)}
    </Table></Card> : <Card><Empty title="No referrals in this view" body="Members find their personal link under Refer a friend in the portal and the app." /></Card>}
  </div>;
}
