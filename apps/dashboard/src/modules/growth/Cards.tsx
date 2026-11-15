/* Growth: the admin Overview card (growth.manage): what came in from the website. */
import React from 'react';
import { Link } from '../../lib/nav';
import { api } from '../../lib/api';
import { Alert, Card, CardHead, Skeleton, useApi } from '../../ui';

type Summary = { discoveryNew: number; discoveryOpen: number; corporateNew: number; corporateOpen: number; subscribersConfirmed: number; subscribersPending: number; slotsOffered: number };

export function AdminGrowthCard() {
  const data = useApi(() => api.get<Summary>('/admin/growth/summary'), []);
  const s = data.data;
  return <Card><CardHead eyebrow="Growth" title="From the website" right={<Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/growth/discovery-calls">Open</Link>} />
    {data.error ? <Alert kind="error">{data.error}</Alert> : !s ? <Skeleton rows={3} /> : <ul className="timeline">
      <li><Link to="/growth/discovery-calls"><b>{s.discoveryNew}</b> new discovery call request{s.discoveryNew === 1 ? '' : 's'}</Link><div className="small muted">{s.discoveryOpen} open · {s.slotsOffered} time{s.slotsOffered === 1 ? '' : 's'} offered on the website</div></li>
      <li><Link to="/growth/corporate"><b>{s.corporateNew}</b> new corporate enquir{s.corporateNew === 1 ? 'y' : 'ies'}</Link><div className="small muted">{s.corporateOpen} open</div></li>
      <li><Link to="/growth/newsletter"><b>{s.subscribersConfirmed}</b> newsletter subscriber{s.subscribersConfirmed === 1 ? '' : 's'}</Link><div className="small muted">{s.subscribersPending} waiting to confirm</div></li>
    </ul>}
  </Card>;
}

