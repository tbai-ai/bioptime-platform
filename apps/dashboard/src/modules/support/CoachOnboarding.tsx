/* The coach onboarding checklist (GET /coach/onboarding): a card on Today and at the top of Help. Computed by the
   server from the coach's own profile, working hours and accepted policies, plus the coach training courses while the
   Learning module is on and has published some; otherwise a note says why training is not listed. */
import React from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { Alert, Card, CardHead, Pill, Skeleton, useApi } from '../../ui';
import './support.css';

type Item = { key: string; label: string; detail: string; done: boolean; href: string | null };
type Checklist = { items: Item[]; done: number; total: number; complete: boolean; training: { available: true; total: number; completed: number } | { available: false; note: string } };

export default function CoachOnboarding({ compact }: { compact?: boolean }) {
  const r = useApi(() => api.get<Checklist>('/coach/onboarding'), []);
  const d = r.data;
  return <Card accent={!!d && !d.complete}>
    <CardHead eyebrow="Onboarding" title={d ? (d.complete ? 'You are set up' : `${d.done} of ${d.total} done`) : 'Your checklist'} right={d ? <Pill status={d.complete ? 'completed' : 'pending'}>{d.complete ? 'Complete' : 'To do'}</Pill> : undefined} />
    {r.error && <Alert kind="error">{r.error}</Alert>}
    {!d && !r.error && <Skeleton rows={3} />}
    {d && <ul className="supCheck">{d.items.map((i) => <li key={i.key}>
      <div><b style={{ color: 'var(--bp-color-text-primary)' }}>{i.label}</b>{!compact || !i.done ? <span className="small">{i.detail}</span> : null}</div>
      <div className="row" style={{ flex: '0 0 auto' }}>{!i.done && i.href ? <Link className="bp-btn bp-btn-secondary bp-btn-sm" to={i.href}>Open</Link> : null}<Pill status={i.done ? 'completed' : 'pending'}>{i.done ? 'Done' : 'To do'}</Pill></div>
    </li>)}</ul>}
    {d && !d.training.available && d.training.note ? <p className="muted small" style={{ marginTop: 10 }}>{d.training.note}</p> : null}
  </Card>;
}
