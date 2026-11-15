/* The member Home card: the open next steps from released reports, and the next home collection with the laboratory's
   own preparation text and when Bioptime's reminder goes out. */
import React from 'react';
import { api } from '../../lib/api';
import { Link } from '../../lib/nav';
import { fmtDateTime } from '../../lib/format';
import { Alert, Card, CardHead, Skeleton, useApi } from '../../ui';
import { day, type FollowUp } from './shared';

type Prep = { bookingId: string; reference: string; testName: string | null; slotAt: string; fastingHours: number; preparation: string | null; rebookPending: boolean; reminder: { dueAt: string; status: string } | null };

export function ClientHomeCard() {
  const steps = useApi(() => api.get<{ items: FollowUp[] }>('/me/lab-follow-ups'), []);
  const prep = useApi(() => api.get<{ items: Prep[]; timing: string }>('/me/lab-preparation'), []);
  const open = (steps.data?.items ?? []).filter((f) => f.status === 'open');
  const next = prep.data?.items?.[0];
  const loading = !steps.data || !prep.data;
  return <Card>
    <CardHead eyebrow="Reports" title={loading ? 'Next steps' : open.length ? `${open.length} next step${open.length === 1 ? '' : 's'} from your reports` : 'No open next steps'} right={<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/bloodwork">Bloodwork</Link>} />
    {steps.error || prep.error ? <Alert kind="error">{steps.error || prep.error}</Alert> : loading ? <Skeleton rows={3} /> : <div className="stack">
      {open.length ? <ul className="taskList">{open.slice(0, 4).map((f) => <li key={f.id}><div><span><b>{f.kindLabel}</b> · {f.note}</span><span className="muted">{f.report ? <Link to={`/reports/${f.report.id}`}>{f.report.testName ?? 'Report'} · {f.report.reference}</Link> : null}{f.dueDate ? ` · due ${day(f.dueDate)}` : ''}</span></div>{f.overdue ? <span className="bp-pill bp-pill-warning">Past due</span> : null}</li>)}</ul>
        : <p className="small">When your coach or the Bioptime team sets a next step after reviewing a report, it shows here.</p>}
      {next ? <div><span className="bp-label">Next home collection</span>
        <p className="small" style={{ marginTop: 4 }}>{next.testName ?? 'Blood test'} · {fmtDateTime(next.slotAt)}{next.rebookPending ? ' · the team is arranging a new visit' : ''}</p>
        <p className="small">{next.preparation ? `The laboratory’s preparation: ${next.preparation}` : next.fastingHours ? `The laboratory asks for ${next.fastingHours} hours of fasting before collection.` : 'The laboratory lists no preparation for this test.'}</p>
        <p className="muted small">{next.reminder ? (next.reminder.status === 'queued' ? `Reminder on ${fmtDateTime(next.reminder.dueAt)}, in the app.` : next.reminder.status === 'sent' ? `Reminder sent ${fmtDateTime(next.reminder.dueAt)}.` : 'Reminders are off in your notification settings.') : 'A reminder is set shortly before the collection.'}</p>
      </div> : null}
    </div>}
  </Card>;
}
