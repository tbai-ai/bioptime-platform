/* M6 Workouts: the cards on the member Home, the coach Today page and the admin Overview. */
import React from 'react';
import { Link } from '../../lib/nav';
import { api } from '../../lib/api';
import { label } from '../../lib/format';
import { Alert, Card, CardHead, Empty, Readout, Skeleton, useApi } from '../../ui';
import { fmtDay, weekday } from './shared';

/** Member Home: this week's sessions and the next one. */
export function ClientWeekCard() {
  const week = useApi(() => api.get('/me/workouts'), []);
  const d = week.data as any;
  return <Card><CardHead eyebrow="Workouts" title="This week" right={<Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/workouts">Open</Link>} />
    {week.error ? <Alert kind="error">{week.error}</Alert> : !d ? <Skeleton rows={2} /> : !d.programs?.length && !d.items?.length ? <p className="small">Your coach adds a workout programme here when it is ready.</p> : <>
      <div className="row" style={{ gap: 18 }}><Readout eyebrow="Due so far" value={d.summary.due} /><Readout eyebrow="Done" value={d.summary.done} /><Readout eyebrow="Still to come" value={d.summary.upcoming} /></div>
      {d.next ? <p className="small" style={{ marginTop: 10 }}>Next: <Link to={`/workouts/${d.next.id}`}>{d.next.title}</Link> on {weekday(d.next.scheduledDate)} {fmtDay(d.next.scheduledDate)}</p> : <p className="small" style={{ marginTop: 10 }}>Nothing else scheduled this week.</p>}
    </>}
  </Card>;
}

/** Coach Today: sessions clients logged in the last week that have no feedback yet. Feedback needs the client's
 *  sharing consent, so a client who does not share health data gets Open, not Review, as on the other coach cards. */
export function CoachReviewCard() {
  const recent = useApi(() => api.get('/coach/workouts/recent'), []);
  const items = (((recent.data as any)?.items ?? []) as any[]);
  return <Card><CardHead eyebrow="Workouts" title="Logged this week, awaiting feedback" />
    {recent.error ? <Alert kind="error">{recent.error}</Alert> : !recent.data ? <Skeleton rows={2} /> : items.length ? <div className="stack">{items.slice(0, 6).map((s) => <div key={s.id} className="row between"><span><b style={{ color: 'var(--bp-color-text-primary)' }}>{s.memberName}</b> <span className="small">{s.title} · {fmtDay(s.scheduledDate)} · {s.status === 'partial' ? 'partly done' : label(s.status)}{s.healthShared ? '' : ' · health records not shared'}</span></span><Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`/clients/${s.memberId}?tab=workouts`}>{s.healthShared ? 'Review' : 'Open'}</Link></div>)}</div> : <Empty title="All caught up" />}
  </Card>;
}

/** Admin Overview (library.manage): exercises proposed by coaches, waiting for review. */
export function AdminLibraryCard() {
  const drafts = useApi(() => api.get('/admin/exercises?status=draft&source=coach'), []);
  const items = (((drafts.data as any)?.items ?? []) as any[]);
  return <Card><CardHead eyebrow="Exercise library" title="Coach proposals to review" right={<Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/exercise-library">Open</Link>} />
    {drafts.error ? <Alert kind="error">{drafts.error}</Alert> : !drafts.data ? <Skeleton rows={2} /> : items.length ? <ul className="timeline">{items.slice(0, 5).map((e) => <li key={e.id}><b>{e.name}</b>{e.authorName ? ` · ${e.authorName}` : ''}</li>)}</ul> : <Empty title="Nothing waiting" />}
  </Card>;
}
