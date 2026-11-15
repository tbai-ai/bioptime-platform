/* The "Today's habits" card on the member Home: what is due today, ticked off in place; the full page is /habits. */
import React, { useState } from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { Alert, Card, CardHead, Skeleton, useApi, useToast, errorText } from '../../ui';
import type { Habit } from './shared';

export function HabitsHomeCard() {
  const list = useApi(() => api.get<{ today: string; items: Habit[] }>('/me/habits'), []);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const items = (list.data?.items ?? []).filter((h) => h.status === 'active' && (h.today.due || h.today.checkin));
  const open = items.filter((h) => !h.today.checkin).length;
  const toggle = async (h: Habit) => {
    setBusy(h.id);
    try {
      if (h.today.checkin) await api.del(`/me/habits/${h.id}/checkins/${h.today.date}`);
      else await api.post(`/me/habits/${h.id}/checkins`, { status: 'done' });
      list.reload();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  return <Card>
    <CardHead eyebrow="Habits" title={!list.data ? 'Today’s habits' : items.length ? (open ? `${open} to check in today` : 'All checked in today') : 'Nothing due today'} right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/habits">All habits</Link>} />
    {list.error ? <Alert kind="error">{list.error}</Alert> : !list.data ? <Skeleton rows={3} />
      : items.length ? <ul className="taskList">{items.map((h) => <li key={h.id}>
        <label className="bp-check"><input type="checkbox" checked={h.today.checkin?.status === 'done'} disabled={busy === h.id || h.today.checkin?.status === 'skipped'} onChange={() => toggle(h)} /> <span className={h.today.checkin ? 'done' : ''}>{h.title}</span></label>
        <span className="muted">{h.today.checkin?.status === 'skipped' ? 'skipped today' : h.schedule.type === 'times_per_week' ? `${h.week.done} of ${h.week.target} this week` : h.scheduleLabel}</span>
      </li>)}</ul>
      : <p className="small">{(list.data.items ?? []).length ? 'Your habits have nothing due today.' : <>No habits yet. <Link to="/habits">Add one</Link>, or your coach sets them from your plan.</>}</p>}
  </Card>;
}
