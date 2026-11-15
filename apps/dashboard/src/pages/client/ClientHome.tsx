import React from 'react';
import { Navigate } from 'react-router-dom';
import { Link } from '../../lib/nav';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, label, wellnessLabel } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Pill, Readout, Skeleton, useApi, useToast, errorText } from '../../ui';
import { HeroBand } from '../../components/HeroBand';
import { ModuleCards, useModuleCards } from '../../modules/runtime';

/** The member's home: the same facts the mobile app shows, arranged for a wider screen. */
export function ClientHome() {
  const { user } = useAuth();
  const home = useApi(() => api.get('/me'), []);
  const milestones = useApi(() => api.get('/me/milestones'), []);
  const toast = useToast();
  const moduleCards = useModuleCards('clientHome'); // cards the registered modules add (src/modules), while their flag is on
  const d = home.data as any;
  if (home.error) return <Alert kind="error">{home.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  if (d.member && !d.member.onboardingCompleted) return <Navigate to="/client/welcome" replace />;
  const ent = d.entitlements;
  const toggle = async (t: any) => {
    try { await api.patch(`/me/tasks/${t.id}`, { status: t.status === 'done' ? 'pending' : 'done' }); home.reload(); }
    catch (e) { toast(errorText(e), 'error'); }
  };
  const first = (d.member?.name || user?.name || '').split(' ')[0];
  // the Today card (TODAY-CARD contract with the API): todaysActions lists tasks due today first, then overdue ones, capped;
  // todaysActionsTotal counts every pending task due today or overdue, and an item with overdue === true says since when.
  // Older payloads without these fields show the list's own length and plain due dates; a task without a date shows its kind only.
  const todays = (d.todaysActions ?? []) as any[];
  const todayCount: number = typeof d.todaysActionsTotal === 'number' ? d.todaysActionsTotal : todays.length;
  const notShown = Math.max(0, todayCount - todays.length);
  return <div className="stack">
    <HeroBand eyebrow="Member portal" title={`Hello, ${first}.`} sub={d.programme ? `${d.programme.packageName} · ends ${fmtDate(d.programme.endAt)}` : 'No active package yet.'} actions={d.coach ? <><Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/messages">Message your coach</Link><Link className="bp-btn bp-btn-primary bp-btn-sm" to="/appointments?book=1">Book a consultation</Link></> : undefined} />
    {d.member?.state === 'pending_verification' && <Alert kind="warning" title="Confirm your email">Blood test bookings wait until your email address is confirmed. Use the link in the email, or <a href="/verify">request it again</a>.</Alert>}
    <div className="grid">
      <div className="span3"><Card dense><Readout eyebrow="Today" value={todayCount} sub={todayCount ? (todayCount === 1 ? 'task due' : 'tasks due') : 'nothing due'} /></Card></div>
      <div className="span3"><Card dense><Readout eyebrow="Consultations left" value={ent ? `${ent.consultation.remaining}` : '—'} sub={ent ? `of ${ent.consultation.total}` : 'no package'} /></Card></div>
      <div className="span3"><Card dense><Readout eyebrow="Blood tests left" value={ent ? `${ent.bloodwork.remaining}` : '—'} sub={ent ? `of ${ent.bloodwork.total}` : 'no package'} /></Card></div>
      <div className="span3"><Card dense><Readout eyebrow="Wellness score" value={d.member?.wellnessScore ?? '—'} sub={wellnessLabel(d.member?.wellnessScoreLabel, 'estimate, not a diagnosis')} /></Card></div>
    </div>
    <div className="grid">
      {!d.programme && <div className="span12"><Card accent><CardHead eyebrow="Start" title="Choose a package" /><p className="small">A coach, blood tests at home and consultations, in one package.</p><div className="bp-card-foot"><Link className="bp-btn bp-btn-primary" to="/program">See the packages</Link></div></Card></div>}
      <div className="span6"><Card><CardHead eyebrow="Today" title={todayCount ? `${todayCount} task${todayCount === 1 ? '' : 's'}` : 'Nothing due'} right={d.plan ? <Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/program">Open the plan</Link> : undefined} />
        {todays.length ? <><ul className="taskList">{todays.map((t: any) => <li key={t.id}><label className="bp-check"><input type="checkbox" checked={t.status === 'done'} onChange={() => toggle(t)} /> <span className={t.status === 'done' ? 'done' : ''}>{t.title}</span></label><span className="muted">{label(t.kind)}{t.overdue === true ? ` · overdue since ${fmtDate(t.due_at)}` : t.due_at ? ` · due ${fmtDate(t.due_at)}` : ''}</span></li>)}</ul>{notShown > 0 && <p className="muted small" style={{ marginTop: 8 }}>{notShown} more {notShown === 1 ? 'is' : 'are'} in your plan.</p>}</>
          : notShown > 0 ? <p className="small">They are in your plan.</p>
          : <p className="small">{d.plan ? 'Your plan has nothing due today. Rest counts.' : d.coach ? 'Your coach is writing your plan.' : 'Tasks appear once your coach publishes a plan.'}</p>}
      </Card></div>
      <div className="span6"><Card><CardHead eyebrow="Coach" title={d.coach ? d.coach.displayName ?? d.coach.name ?? 'Your coach' : d.assignmentStatus === 'pending' ? 'Being matched' : d.assignmentStatus === 'needs_attention' ? 'The team is choosing' : 'Not assigned yet'} right={d.coach ? <Pill status={d.coach.status} /> : undefined} />
        <p className="small">{d.coach ? (d.coach.status === 'paused' ? 'Your coach is away for now; messages wait for them, and Bioptime can reassign you if needed.' : `${d.unread?.messages ? `${d.unread.messages} unread message${d.unread.messages === 1 ? '' : 's'}. ` : ''}Write any time; consultations are booked from their free slots.`) : d.programme ? 'Bioptime matches you with a coach and tells you here.' : 'Bioptime matches you with a coach after the payment is confirmed and tells you here.'}</p>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>Next appointment</dt><dd>{d.nextAppointment ? `${label(d.nextAppointment.kind)} · ${fmtDateTime(d.nextAppointment.start_at)} · ${label(d.nextAppointment.status)}` : 'None booked'}</dd>
          <dt>Blood test</dt><dd>{d.bloodwork ? `${d.bloodwork.test_name} · ${label(d.bloodwork.status)}${d.bloodwork.flag ? ' · ' + d.bloodwork.flag : ''}` : 'None booked'}</dd>
        </dl>
      </Card></div>
      <ModuleCards cards={moduleCards} />
      <div className="span12"><Card><CardHead eyebrow="Milestones" title="From your records" /><div className="milestones">{(((milestones.data as any)?.items ?? []) as any[]).map((ms) => <div key={ms.key} className={`milestone ${ms.achievedAt ? 'done' : ''}`}><span className="dot" aria-hidden="true" /><div><b>{ms.title}</b><div className="muted small">{ms.achievedAt ? fmtDate(ms.achievedAt) : 'not yet'} · {ms.detail}</div></div></div>)}</div><p className="muted small" style={{ marginTop: 10 }}>Each milestone comes from a record: a payment, an assignment, a completed consultation, a released report, tasks you ticked, days you logged. Nothing here is estimated.</p></Card></div>
      <div className="span12"><Card><CardHead eyebrow="Logged recently" title="Progress" right={<Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/progress">Log a value</Link>} />
        {d.recentProgress?.length ? <div className="stack">{d.recentProgress.slice(0, 5).map((p: any, i: number) => <div key={i} className="row between"><span>{label(p.metric)}</span><span className="muted">{p.value} {p.unit} · {fmtDate(p.at)}</span></div>)}</div> : <Empty title="Nothing logged yet" body="Weight, sleep, steps, resting heart rate: what you log is what you see, and your coach sees it too while health sharing is on." />}
        <p className="muted small" style={{ marginTop: 10 }}>Scores and trends are estimates from what you log, never a diagnosis.</p>
      </Card></div>
    </div>
    {!d.coach && d.programme && <Button variant="tertiary" size="sm" onClick={() => home.reload()}>Refresh</Button>}
  </div>;
}
