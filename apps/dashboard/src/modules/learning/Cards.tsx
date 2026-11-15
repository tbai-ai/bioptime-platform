/* M10 Learning: the home cards. Member Home: the course to continue (or what is available to start). Admin Overview
   (learning.manage): how many courses are drafts, published and archived. Counts are read from the records; nothing
   is estimated. */
import React from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { Card, CardHead, Empty, Readout, Skeleton, useApi } from '../../ui';
import { type CourseCard, ProgressBar } from './shared';

export function ClientLearnCard() {
  const data = useApi(() => api.get('/me/courses'), []);
  const d = data.data as { enrolled: CourseCard[]; available: CourseCard[] } | null;
  if (data.error) return null;
  if (!d) return <Card><Skeleton rows={3} /></Card>;
  const current = d.enrolled.find((c) => c.enrollment?.status === 'active' && !c.locked && c.nextLessonId);
  return <Card><CardHead eyebrow="Learn" title={current ? 'Continue your course' : 'Courses'} right={<Link className="muted" to="/learn">All courses</Link>} />
    {current ? <div className="stack" style={{ gap: 8 }}>
      <b style={{ color: 'var(--bp-color-text-primary)' }}>{current.title}</b>
      <ProgressBar p={current.enrollment!.progress} />
      {current.enrollment!.assignedByName && <span className="muted">Assigned by {current.enrollment!.assignedByName}</span>}
      <div><Link className="bp-btn bp-btn-primary bp-btn-sm" to={`/learn/${current.id}/${current.nextLessonId}`}>{current.enrollment!.progress.completed ? 'Continue' : 'Start'}</Link></div>
    </div> : d.available.length ? <p className="small">{d.available.length === 1 ? 'One course is' : `${d.available.length} courses are`} ready for you to start. <Link to="/learn">See them</Link></p>
      : <Empty title="No course in progress" body="Courses from the Bioptime team and your coach appear on your Learn page." />}
  </Card>;
}

export function AdminCoursesCard() {
  const data = useApi(() => api.get('/admin/courses'), []);
  const items = (data.data as { items: Array<{ status: string }> } | null)?.items;
  if (data.error) return null;
  if (!items) return <Card><Skeleton rows={3} /></Card>;
  const n = (s: string) => items.filter((c) => c.status === s).length;
  return <Card><CardHead eyebrow="Learning" title="Courses" right={<Link className="muted" to="/learning">Open</Link>} />
    <div className="row" style={{ gap: 18 }}><Readout eyebrow="Drafts" value={n('draft')} /><Readout eyebrow="Published" value={n('published')} /><Readout eyebrow="Archived" value={n('archived')} /></div>
  </Card>;
}
