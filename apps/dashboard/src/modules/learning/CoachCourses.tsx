/* M10 Learning, coach workspace (/coach/courses): the published member courses a coach may assign, to read before
   assigning one from a client's record (Learning tab). Package courses name the packages they come with. */
import React from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { Alert, Card, CardHead, Empty, Skeleton, useApi } from '../../ui';
import { type OutlineModule, audienceLabel } from './shared';

type Item = { id: string; title: string; summary: string; audience: string; sample: boolean; lessons: number; minutes: number | null; packages: Array<{ id: string; name: string }>; modules: OutlineModule[] };

export function CoachCourses() {
  const data = useApi(() => api.get('/coach/courses'), []);
  const items = (data.data as { items: Item[] } | null)?.items;
  return <div className="stack">
    <div className="pageHead"><div><h1>Courses</h1><p className="sub">Published courses from the Bioptime team that you can assign to your clients. Read one here; assign it from the client’s record, on the Learning tab.</p></div></div>
    {data.error ? <Alert kind="error">{data.error}</Alert> : !items ? <Skeleton rows={6} /> : items.length ? <div className="grid">{items.map((c) => <div key={c.id} className="span6"><Card>
      <CardHead eyebrow={`${audienceLabel(c.audience)} · ${c.lessons} ${c.lessons === 1 ? 'lesson' : 'lessons'}${c.minutes ? ` · about ${c.minutes} min` : ''}`} title={<Link to={`/courses/${c.id}`}>{c.title}</Link>} />
      {c.summary && <p className="small">{c.summary}</p>}
      {c.packages.length > 0 && <p className="muted" style={{ marginTop: 6 }}>Comes with: {c.packages.map((p) => p.name).join(', ')}. Only clients who hold one of these can be assigned it.</p>}
      <ul className="lrnOutline" style={{ marginTop: 8 }}>{c.modules.map((m) => <li key={m.id}><div><b style={{ color: 'var(--bp-color-text-primary)' }}>{m.title}</b><span className="muted">{m.lessons.map((l) => l.title).join(' · ')}</span></div></li>)}</ul>
      <div className="bp-card-foot"><Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`/courses/${c.id}`}>Read the course</Link></div>
    </Card></div>)}</div> : <Empty title="No courses yet" body="Courses appear here when the Bioptime team publishes them." />}
  </div>;
}
