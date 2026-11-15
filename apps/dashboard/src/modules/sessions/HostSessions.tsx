/* M8 Live sessions, the hosts' list: /coach/sessions (the sessions the coach hosts) and /admin/sessions (every
   session, sessions.manage). New sessions start as drafts; publishing opens registration to their audience. */
import React, { useState } from 'react';
import { Link, useNavigate } from '../../lib/nav';
import { api, qs } from '../../lib/api';
import { label } from '../../lib/format';
import { Alert, Button, Card, Empty, Skeleton, Table, Tabs, useApi, useToast } from '../../ui';
import { SessionForm, type Mode } from './SessionForm';
import { AUDIENCE_SHORT, SessionStatusPill, SessionTitle, fmtSpan, placesText } from './shared';

export function HostSessions({ mode }: { mode: Mode }) {
  const [range, setRange] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const base = mode === 'admin' ? '/admin/sessions' : '/coach/sessions';
  const list = useApi(() => api.get(`${base}${qs({ range })}`), [range, mode]);
  const items = (((list.data as any)?.items ?? []) as any[]);
  return <div className="stack">
    <div className="pageHead"><div><h1>Live sessions</h1><p className="sub">{mode === 'admin' ? 'Every group class, webinar and workshop, whoever hosts it. Public webinars are set up here.' : 'The group classes, webinars and workshops you host. Members in the audience register; when a session is full they join its waitlist.'}</p></div>
      <div className="actions"><Button variant="primary" onClick={() => setCreating(true)}>New session</Button></div></div>
    <Alert kind="info" title="Video meetings: pending configuration">No video provider is connected, so no meeting is created for a session. Add the https link you will use, or members read that the host will share how to join.</Alert>
    <Tabs items={[{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' }]} value={range} onChange={setRange}>
      {list.error && <Alert kind="error">{list.error}</Alert>}
      {list.loading && !list.data ? <Skeleton rows={5} /> : items.length ? <Card dense><Table label="Live sessions" head={<><th>When</th><th>Session</th>{mode === 'admin' && <th>Host</th>}<th>Who can join</th><th>Places</th><th>Status</th><th /></>}>
        {items.map((s) => <tr key={s.id}><td className="small">{fmtSpan(s.startAt, s.endAt)}</td><td><SessionTitle s={s} /><div className="small">{s.kindLabel}</div></td>{mode === 'admin' && <td className="small">{s.hostName}{s.hostRole !== 'coach' ? <div className="muted">Bioptime team</div> : null}</td>}
          <td className="small">{AUDIENCE_SHORT[s.audience] ?? label(s.audience)}{s.packages?.length ? <div className="muted">{s.packages.map((p: any) => p.name).join(', ')}</div> : null}</td><td className="small">{placesText(s)}</td><td><SessionStatusPill status={s.status} /></td>
          <td><Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`/sessions/${s.id}`}>Open</Link></td></tr>)}
      </Table></Card> : <Card><Empty title={range === 'upcoming' ? 'Nothing scheduled' : 'Nothing here'} body={range === 'upcoming' ? 'Create a session; it stays a draft until you publish it.' : undefined} /></Card>}
    </Tabs>
    <SessionForm mode={mode} open={creating} onClose={() => setCreating(false)} onSaved={(s) => { toast('Draft saved'); nav(`/sessions/${s.id}`); }} />
  </div>;
}

export default HostSessions;
