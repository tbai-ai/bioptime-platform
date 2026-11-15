/* A client's profile in the coach workspace: two columns.
   Left (identity and admin): the identity card (initials, name, member ID with copy, status, package, Message and
   Schedule consultation), Goal (the member's own goals), Notes (the latest coach notes), quick actions (Schedule
   consultation, Record a value while health information is shared, Add a follow-up, Write a plan), Personal information
   limited to what the coach payload carries (never phone, email, address, PIN code, date of birth or identity
   documents: apps/api/src/auth/fieldPolicy.ts strips them), and the package with its entitlements.
   Right (programme): a grid of tab buttons for every tab this record has (the seven core tabs and the module tabs while
   their flags are on), kept in ?tab= as before, over the existing client record (pages/ClientDetail): its tab panels,
   dialogs and "not shared" wording render unchanged, without its own header and tab strip.
   The record is fetched once, here (GET /coach/clients/:id writes a member.record_viewed audit row per request), and
   handed to ClientDetail in its embedded mode ({ embedded, data, reload }), so a note saved in its Notes tab reloads
   this page's one copy and the left column follows. On a phone the quick actions come right after the identity card. */
import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Link } from '../../../../lib/nav';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { fmtDate, label, relative } from '../../../../lib/format';
import { Alert, Button, Card, CardHead, Pill, Skeleton, useApi, useToast } from '../../../../ui';
import { useModuleTabs } from '../../../../modules/runtime';
import { ClientDetail, ScheduleDialog } from '../../../ClientDetail';
import { Icon, StatusPill, type IconName } from '../ui';
import { ClientStatusPill, FollowUpDialog, RecordValueDialog, clientStatus, initials, useOpenConversation } from './shared';

/** The core tabs of the client record, in its order (pages/ClientDetail: Overview, Plan, Bloodwork, Appointments,
 *  Progress, the module tabs, Messages, Notes). */
const CORE_IDS = ['overview', 'plan', 'bloodwork', 'appointments', 'progress', 'messages', 'notes', 'account'];
const TAB_ICONS: Record<string, IconName> = {
  overview: 'dashboard', plan: 'plans', bloodwork: 'report', appointments: 'calendar', progress: 'target', messages: 'messages', notes: 'note',
  habits: 'checklist', goals: 'flag', nutrition: 'meal', workouts: 'workout', 'lab-follow-ups': 'alert', sessions: 'video', learning: 'courses', ai: 'ai',
};
const PANEL_ID = 'wzd-record-panel';

/** pages/ClientDetail in its embedded mode: no page header and no tab strip (this page draws them), and the record
 *  comes from this page (`data`, `reload`) instead of a second fetch. A component that ignores these props is still
 *  assignable here, so this compiles with or without that mode. */
type EmbeddedRecordProps = { embedded?: boolean; data?: unknown; reload?: () => void };
const EmbeddedRecord: React.ComponentType<EmbeddedRecordProps> = ClientDetail;

export function ClientProfile() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const toast = useToast();
  const openThread = useOpenConversation();
  const detail = useApi(() => api.get(`/coach/clients/${id}`), [id]);
  const moduleTabs = useModuleTabs('coach').filter((t) => !CORE_IDS.includes(t.id));
  const [dlg, setDlg] = useState<null | 'schedule' | 'value' | 'followup'>(null);
  const [embedKey, setEmbedKey] = useState(0);
  const d = detail.data as any;
  const tab = params.get('tab') || 'overview';
  /** the record's own actions (a note, a module tab's change) read the one copy again, and both columns follow */
  const reload = detail.reload;
  /** after an action in the left column the record on the right also starts afresh (its dialogs and drafts closed);
   *  in the embedded mode that costs no request, as it reads this page's copy */
  const refresh = () => { detail.reload(); setEmbedKey((k) => k + 1); };

  if (detail.error) return <div className="stack wzdPage"><Link className="muted" to="/clients">← Clients</Link><Alert kind="error">{detail.error}</Alert></div>;
  if (!d) return <div className="stack wzdPage"><Link className="muted" to="/clients">← Clients</Link><Card><Skeleton rows={8} /></Card></div>;

  const m = d.member ?? {}, view = d.profile ?? {}, profile = view.profile ?? {};
  const code: string | null = m.memberCode ?? view.memberCode ?? null;
  const shared = d.healthShared !== false && d.progress?.withheld !== true;
  const plans = (d.plans ?? []) as any[];
  const published = plans.some((p) => p.status === 'published');
  const status = clientStatus({ assignmentStatus: d.assignmentStatus, accountState: m.state, hasPlan: published });
  const activeAssignment = (d.assignmentStatus ?? 'active') === 'active';
  const notes = (d.notes ?? []) as any[];
  const goals = (profile.goals ?? []) as string[];
  const prefs = (profile.preferences ?? {}) as Record<string, unknown>;
  const since = (d.assignmentHistory ?? [])[0]?.effective_at as string | undefined;
  const metrics = (d.progress?.metrics ?? []) as any[];

  const tabs: Array<{ id: string; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'plan', label: 'Plan', count: plans.filter((p) => p.status === 'draft').length },
    { id: 'bloodwork', label: 'Bloodwork', count: (d.reports ?? []).filter((r: any) => !r.reviewed).length },
    { id: 'appointments', label: 'Appointments' },
    { id: 'progress', label: 'Progress' },
    ...moduleTabs.map((t) => ({ id: t.id, label: t.label, count: t.count?.(d) })),
    { id: 'messages', label: 'Messages' },
    { id: 'notes', label: 'Notes' },
  ];
  const selected = tabs.find((t) => t.id === tab); // none while a module tab named in ?tab= is still loading or switched off
  const choose = (t: string) => setParams({ tab: t });
  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = Math.max(0, tabs.findIndex((t) => t.id === selected?.id)), n = tabs.length;
    const cols = Math.max(1, getComputedStyle(e.currentTarget).gridTemplateColumns.split(' ').filter(Boolean).length);
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'ArrowDown' ? Math.min(n - 1, i + cols) : e.key === 'ArrowUp' ? Math.max(0, i - cols) : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(tabs[next]!.id);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  const copyCode = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); toast('Member ID copied'); } catch { toast('Copying is blocked in this browser; select the ID instead', 'error'); }
  };

  return <div className="wzdPage wzdProfile">
    <Link className="muted wzdBackLink" to="/clients">← Clients</Link>

    {/* ---------- left: identity ---------- */}
    <section className="wzdProfileId" aria-label="Client">
      <Card className="wzdIdCard">
        <div className="wzdIdTop">
          <span className="avatar wzdAvatarLg" aria-hidden="true">{initials(m.name)}</span>
          <div className="wzdIdMain">
            <h1 className="wzdIdName">{m.name}</h1>
            <div className="wzdIdCode">{code ? <><code>{code}</code><button type="button" className="bp-iconbtn wzdCopy" onClick={copyCode} aria-label={`Copy member ID ${code}`} title="Copy member ID"><Icon name="copy" size={16} /></button></> : <span className="muted">No member ID</span>}</div>
            <div className="wzdIdPills"><ClientStatusPill status={status} /><StatusPill tone="neutral">{d.programme?.packageName ?? 'No package'}</StatusPill></div>
          </div>
        </div>
        <div className="wzdIdActions">
          <Button size="sm" variant="primary" onClick={() => void openThread(id)}><Icon name="messages" size={16} /> Message</Button>
          {activeAssignment && <Button size="sm" onClick={() => setDlg('schedule')}><Icon name="calendar" size={16} /> Schedule consultation</Button>}
        </div>
        {since && <p className="muted wzdIdSince">Assigned to you since {fmtDate(since)}{d.programme?.endAt ? ` · programme ends ${fmtDate(d.programme.endAt)}` : ''}</p>}
      </Card>
    </section>

    {/* ---------- left: the rest of the admin column (Goal, Notes, Quick actions, Personal information, Package); on a
         phone the quick actions move up under the identity card and the rest follows the record ---------- */}
    <section className="wzdProfileSide wzdSideA stack" aria-label="Goal and notes">
      <Card dense><CardHead eyebrow="Goal" title={goals.length ? goals.join(' · ') : 'No goal recorded'} />
        <p className="muted">{goals.length ? 'The member chose these in the app; they change them from their profile.' : 'The member sets their goals in the app during onboarding.'}</p></Card>

      <Card dense><CardHead eyebrow="Notes" title={notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : 'No notes yet'} right={<button type="button" className="bp-btn bp-btn-tertiary bp-btn-sm" onClick={() => choose('notes')}>{notes.length ? 'All notes' : 'Add a note'}</button>} />
        {notes.length ? <ul className="wzdNoteList">{notes.slice(0, 3).map((n) => <li key={n.id}><p>{n.body}</p><span className="muted">{n.coach_name} · {label(n.kind)} · {n.visibility === 'client' ? 'member can read' : n.visibility === 'admin' ? 'administrative' : 'private'} · {relative(n.created_at)}</span></li>)}</ul>
          : <p className="muted">Private notes, recommendations the member reads and administrative notes appear here.</p>}
      </Card>
    </section>
    <section className="wzdProfileSide wzdSideQuick stack" aria-label="Quick actions">
      <Card dense><CardHead eyebrow="Quick actions" title="Next steps" />
        <div className="wzdQuick">
          {activeAssignment && <Button size="sm" onClick={() => setDlg('schedule')}><Icon name="calendar" size={16} /> Schedule consultation</Button>}
          {shared && metrics.length > 0 && <Button size="sm" onClick={() => setDlg('value')}><Icon name="target" size={16} /> Record a value</Button>}
          {activeAssignment && <Button size="sm" onClick={() => setDlg('followup')}><Icon name="flag" size={16} /> Add a follow-up</Button>}
          {!published && activeAssignment && <button type="button" className="bp-btn bp-btn-secondary bp-btn-sm" onClick={() => choose('plan')}><Icon name="plans" size={16} /> Write a plan</button>}
        </div>
        {!shared && <p className="muted" style={{ marginTop: 8 }}>Recording a value needs the member to share health information with you.</p>}
      </Card>
    </section>
    <section className="wzdProfileSide wzdSideB stack" aria-label="Personal information and package">
      <Card dense><CardHead eyebrow="Personal information" title="What you can see" />
        <dl className="kv">
          <dt>Member ID</dt><dd><code>{code ?? '—'}</code></dd>
          {profile.age != null && <><dt>Age</dt><dd>{profile.age}</dd></>}
          {profile.gender && <><dt>Sex</dt><dd>{label(profile.gender)}</dd></>}
          {profile.heightCm != null && <><dt>Height</dt><dd>{profile.heightCm} cm</dd></>}
          {'city' in profile && <><dt>City</dt><dd>{profile.city ?? '—'}</dd></>}
          {typeof prefs.language === 'string' && <><dt>Language</dt><dd>{prefs.language}</dd></>}
          {typeof prefs.trainingDays === 'number' && <><dt>Training days</dt><dd>{prefs.trainingDays} a week</dd></>}
          <dt>Onboarding</dt><dd>{profile.onboardingCompletedAt ? `done ${fmtDate(profile.onboardingCompletedAt)}` : label(profile.onboardingStep)}</dd>
          <dt>Health sharing</dt><dd>{shared ? 'Shared with you' : 'Not shared'}</dd>
        </dl>
        <p className="muted small" style={{ marginTop: 8 }}>Phone, address and identity documents stay with Bioptime; message the member here or ask the team.</p>
      </Card>

      <Card dense><CardHead eyebrow="Package" title={d.programme?.packageName ?? 'No active package'} right={d.programme && <Pill status={d.programme.status} />} />
        {d.programme ? <dl className="kv"><dt>Length</dt><dd>{d.programme.durationLabel ?? '—'}</dd><dt>Started</dt><dd>{fmtDate(d.programme.startAt)}</dd><dt>Ends</dt><dd>{fmtDate(d.programme.endAt)}</dd></dl> : <p className="muted">The member has no active programme.</p>}
        {Array.isArray(d.entitlements) && d.entitlements.length > 0 && <ul className="wzdEnt" aria-label="Entitlements">{d.entitlements.map((e: any) => <li key={e.id}>
          <span><b>{e.serviceType === 'consultation' ? 'Consultations' : e.serviceType === 'bloodwork' ? 'Blood tests' : label(e.serviceType)}</b><span className="muted"> · {e.remaining} of {e.quantity} left{e.reserved ? ` · ${e.reserved} held` : ''}</span></span>
          <StatusPill status={e.status} /></li>)}</ul>}
      </Card>
    </section>

    {/* ---------- right: the tab grid over the existing record ---------- */}
    <section className="wzdProfileMain" aria-label={`${m.name}: record`}>
      <div className="wzdTabGrid" role="tablist" aria-label="Client record sections" onKeyDown={onTabKey}>
        {tabs.map((t) => <button key={t.id} id={`wzd-tab-${t.id}`} type="button" role="tab" className="wzdTabBtn" aria-selected={t.id === selected?.id} aria-controls={PANEL_ID} tabIndex={t.id === (selected ?? tabs[0]!).id ? 0 : -1} onClick={() => choose(t.id)}>
          <Icon name={TAB_ICONS[t.id] ?? 'page'} size={18} /><span>{t.label}</span>{t.count !== undefined && t.count > 0 && <span className="bp-badge">{t.count}</span>}
        </button>)}
      </div>
      <div id={PANEL_ID} className="wzdEmbed" role="tabpanel" aria-labelledby={selected ? `wzd-tab-${selected.id}` : undefined} aria-label={selected ? undefined : 'Client record'}>
        <EmbeddedRecord key={embedKey} embedded data={d} reload={reload} />
      </div>
    </section>

    <ScheduleDialog open={dlg === 'schedule'} onClose={() => setDlg(null)} memberId={id} coachId={user?.id ?? ''} onDone={() => { refresh(); toast('Consultation scheduled'); }} />
    <RecordValueDialog open={dlg === 'value'} onClose={() => setDlg(null)} memberId={id} metrics={metrics} onDone={() => { refresh(); toast('Value recorded'); }} />
    <FollowUpDialog open={dlg === 'followup'} onClose={() => setDlg(null)} memberId={id} name={m.name ?? 'client'} onDone={() => toast('Follow-up created')} />
  </div>;
}
