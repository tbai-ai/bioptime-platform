/* The coach Today card: open next steps across the coach's clients who share health information, the ones past their
   due date first, each linking to the client's "Lab next steps" tab. */
import React from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { Alert, Card, CardHead, Skeleton, useApi } from '../../ui';
import { day, type FollowUp } from './shared';

export function CoachTodayCard() {
  const list = useApi(() => api.get<{ items: FollowUp[] }>('/coach/lab-follow-ups'), []);
  const items = [...(list.data?.items ?? [])].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const overdue = items.filter((f) => f.overdue).length;
  return <Card>
    <CardHead eyebrow="Lab next steps" title={!list.data ? 'Open next steps' : items.length ? `${items.length} open${overdue ? ` · ${overdue} past due` : ''}` : 'Nothing open'} />
    {list.error ? <Alert kind="error">{list.error}</Alert> : !list.data ? <Skeleton rows={3} />
      : items.length ? <ul className="taskList">{items.slice(0, 6).map((f) => <li key={f.id}><div><span><b>{f.kindLabel}</b> · {f.note}</span><span className="muted"><Link to={`/clients/${f.memberId}?tab=lab-follow-ups`}>{f.memberName ?? 'Client'}</Link>{f.dueDate ? ` · due ${day(f.dueDate)}` : ''}</span></div>{f.overdue ? <span className="bp-pill bp-pill-warning">Past due</span> : null}</li>)}</ul>
        : <p className="small">Next steps you add to reviewed reports appear here until they are done.</p>}
  </Card>;
}
