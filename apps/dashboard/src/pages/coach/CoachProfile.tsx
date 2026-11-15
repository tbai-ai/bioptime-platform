/* The coach's own record: identity (stable coach code, designation, statuses), workload, what members see, working
   hours and security. The coach edits only the fields the server lets them edit; code, designation, qualifications,
   scope, role and account status change through administrative workflows and show here read-only. */
import React from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, label } from '../../lib/format';
import { Alert, Card, CardHead, Pill, Skeleton, useApi } from '../../ui';
import { HeroBand } from '../../components/HeroBand';
import { CoachProfile as ProfileForm, Availability, Security } from '../Settings';

function initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join(''); }

/** The identity block shared by the coach home and the profile page. */
export function CoachIdentity({ coach, upcoming, unread }: { coach: any; upcoming?: number; unread?: number }) {
  return <Card className="identityCard"><div className="identity">
    <div className="avatar" aria-hidden="true">{initials(coach.displayName || coach.name || '')}</div>
    <div className="identityMain">
      <div className="row" style={{ gap: 8 }}><b className="identityName">{coach.displayName}</b><Pill status={coach.state ?? 'active'} /><Pill status={coach.available ? 'available' : 'paused'}>{coach.available ? 'Available' : `Away${coach.unavailableUntil ? ' until ' + fmtDate(String(coach.unavailableUntil).slice(0, 10)) : ''}`}</Pill><Pill status={coach.profileStatus === 'complete' ? 'active' : 'pending'}>{coach.profileStatus === 'complete' ? 'Profile complete' : 'Profile incomplete'}</Pill></div>
      <div className="small">{coach.designation ?? 'Coach'} · {(coach.expertise ?? []).join(', ') || 'expertise not set'}</div>
      <dl className="kv identityKv">
        <dt>Coach ID</dt><dd><code>{coach.coachCode ?? '—'}</code></dd>
        <dt>Work email</dt><dd>{coach.email}</dd>
        <dt>Caseload</dt><dd>{coach.caseload} of {coach.caseloadLimit} clients</dd>
        {upcoming !== undefined && <><dt>Upcoming consultations</dt><dd>{upcoming}</dd></>}
        {unread !== undefined && <><dt>Unread</dt><dd>{unread} conversation{unread === 1 ? '' : 's'}</dd></>}
        {coach.activatedAt && <><dt>Coaching since</dt><dd>{fmtDate(coach.activatedAt)}</dd></>}
      </dl>
    </div>
  </div></Card>;
}

export function CoachProfilePage() {
  const { user, refresh } = useAuth();
  const p = useApi(() => api.get('/coach/profile'), []);
  const home = useApi(() => api.get('/coach/home'), []);
  const d = p.data as any;
  if (p.error) return <Alert kind="error">{p.error}</Alert>;
  if (!d) return <Skeleton rows={6} />;
  const h = home.data as any;
  return <div className="stack">
    <HeroBand eyebrow="Coach profile" title={d.displayName} sub={<>Coach ID <code>{d.coachCode}</code> · {d.designation ?? 'Coach'} · account {label(d.state)}{d.lastLoginAt ? ` · last sign-in ${fmtDateTime(d.lastLoginAt)}` : ''}</>} />
    <CoachIdentity coach={d} upcoming={h ? h.metrics?.upcomingConsultations : undefined} unread={h ? h.unreadConversations?.length : undefined} />
    <div className="grid">
      <div className="span6"><ProfileForm /></div>
      <div className="span6"><Card><CardHead eyebrow="Set by Bioptime" title="Professional record" /><dl className="kv"><dt>Designation</dt><dd>{d.designation ?? '—'}</dd><dt>Qualifications</dt><dd>{(d.qualifications ?? []).join(', ') || 'None recorded'}</dd><dt>Scope</dt><dd>{(d.scope ?? []).join(', ') || '—'}</dd><dt>Languages</dt><dd>{(d.languages ?? []).join(', ') || '—'}</dd><dt>Caseload limit</dt><dd>{d.caseloadLimit}</dd><dt>MFA</dt><dd>{user?.mfaEnabled ? 'on' : 'off (two-factor sign-in is required for the Bioptime team)'}</dd></dl><p className="muted small" style={{ marginTop: 10 }}>These change through the administration workflow; ask the Bioptime team.</p></Card></div>
      <div className="span12"><Availability /></div>
      <div className="span6"><Security user={user} onChange={refresh} /></div>
    </div>
  </div>;
}
