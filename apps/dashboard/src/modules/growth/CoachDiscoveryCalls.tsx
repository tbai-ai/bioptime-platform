/* /coach/discovery-calls: discovery calls the team assigned to this coach. The coach sees the name, the stated goals,
   the preferred times and the status; never the email address or the phone number (the team arranges the time and
   shares how to join). */
import React from 'react';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Alert, Card, CardHead, Empty, Skeleton, useApi } from '../../ui';
import { GrowthPill, PreferredTimes, istLabel, type Slot } from './shared';

type CoachCall = { id: string; reference: string; name: string; goals: string; preferredSlots: Slot[]; preferredWindows: string | null; interests: string[]; status: string; bookedAt: string | null; createdAt: string };

export default function CoachDiscoveryCalls() {
  const list = useApi(() => api.get<{ items: CoachCall[] }>('/coach/growth/discovery-calls'), []);
  const items = list.data?.items ?? [];
  return <div className="stack">
    <div className="pageHead"><div><h1>Discovery calls</h1><p className="sub">Short calls with people thinking about Bioptime, assigned to you by the team. The team agrees the time with them and tells you how to join; their contact details stay with the team.</p></div></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!list.data && !list.error ? <Skeleton rows={4} /> : items.length ? <div className="grid">{items.map((c) => <div key={c.id} className="span6"><Card>
      <CardHead eyebrow={c.reference} title={c.name} right={<GrowthPill status={c.status} />} />
      <p style={{ whiteSpace: 'pre-wrap' }}>{c.goals}</p>
      {c.status === 'booked' && c.bookedAt ? <p className="small" style={{ marginTop: 8 }}><b>Agreed time:</b> {istLabel(c.bookedAt)} IST</p> : <><h3 className="small" style={{ marginTop: 8 }}>Times they suggested</h3><PreferredTimes slots={c.preferredSlots} windows={c.preferredWindows} /></>}
      <p className="muted small" style={{ marginTop: 8 }}>Asked {fmtDateTime(c.createdAt)}</p>
    </Card></div>)}</div> : <Card><Empty title="None assigned to you" body="When the team assigns you a discovery call, it appears here." /></Card>}
  </div>;
}
