/* The Support tab on the client record (/admin/clients/:id, operations.manage): this member's support requests, and,
   for administrators holding members.manage, their data export requests (below the requests, so the requests table has
   the full width). Coaches never get this tab. */
import React from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Link, useNavigate } from '../../lib/nav';
import { fmtDate, relative } from '../../lib/format';
import { Alert, Card, CardHead, Empty, Pill, Skeleton, Table, useApi } from '../../ui';
import { RequestStatus, categoryLabel, fmtBytes } from './shared';

type Row = { id: string; reference: string; category: string; subject: string; status: string; assignedTo: { name: string } | null; updatedAt: string };
type ExportRow = { id: string; memberId: string; status: string; requestedAt: string; file: { size: number } | null };

export default function ClientSupportTab({ memberId }: { memberId: string }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useApi(() => api.get<{ items: Row[] }>(`/admin/support-requests?requesterId=${encodeURIComponent(memberId)}`), [memberId]);
  const exportsList = useApi(() => (can('members.manage') ? api.get<{ items: ExportRow[] }>('/admin/data-exports') : Promise.resolve(null)), [memberId]);
  const items = list.data?.items ?? [];
  const exports = (exportsList.data?.items ?? []).filter((e) => e.memberId === memberId);
  return <div className="grid">
    <div className="span12"><Card><CardHead eyebrow="Support" title="Requests from this member" right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/support">Open the queue</Link>} />
      {list.error && <Alert kind="error">{list.error}</Alert>}
      {!list.data && !list.error ? <Skeleton rows={3} /> : items.length ? <Table label="Support requests from this member" head={<><th>Reference</th><th>Subject</th><th>Topic</th><th>Owner</th><th>Status</th><th>Last activity</th></>}>{items.map((r) => <tr key={r.id} className="link" onClick={() => nav(`/support/${r.id}`)}><td className="supNowrap"><Link to={`/support/${r.id}`}>{r.reference}</Link></td><td>{r.subject}</td><td className="small">{categoryLabel(r.category)}</td><td>{r.assignedTo?.name ?? <span className="muted">Unowned</span>}</td><td><RequestStatus status={r.status} forTeam /></td><td className="small supNowrap">{relative(r.updatedAt)}</td></tr>)}</Table> : <Empty title="No support requests" />}
    </Card></div>
    {can('members.manage') && <div className="span6"><Card><CardHead eyebrow="Data rights" title="Data exports" right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/support?tab=exports">All exports</Link>} />
      {exportsList.error && <Alert kind="error">{exportsList.error}</Alert>}
      {!exportsList.data && !exportsList.error ? <Skeleton rows={2} /> : exports.length ? <ul className="supList">{exports.map((e) => <li key={e.id}><div className="row between"><span>Requested {fmtDate(e.requestedAt)}</span><Pill status={e.status} /></div><div className="muted small">{e.file ? `File ready · ${fmtBytes(e.file.size)} · only the member can open it` : 'No file yet'}</div></li>)}</ul> : <p className="small">No export requested.</p>}
    </Card></div>}
  </div>;
}
