/* The web's Operations page (apps/dashboard/src/pages/Operations.tsx) for the admin Operations tab and the fixed Audit
   log screen: five tabs (Exceptions with its owners and resolution trail, Audit log with filters and paging, Enquiries,
   Outbox, Jobs and events). `fixedTab="audit"` renders the Audit log alone under its own title (the web's
   /admin/audit); `plain` marks the screens outside the tab bar, whose route files draw the stack header and the
   permission gate around this page (components/adminB1/parts PermissionScreen), so a refusal keeps its title and bell.
   The exception queue loads whenever the tab strip shows, as on the web (Operations.tsx:19,33), so the Exceptions
   count stays while another tab is open; the audit-only screen never asks for it (that endpoint needs
   operations.manage, the audit log only audit.view). Every table becomes a list of DetailRows with the table's
   actions beneath each row; the audit filter row becomes a collapsible card. Resolve is the portal's ReasonDialog
   (components/adminA/ReasonSheet). */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, patch, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime, label, relative } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { actionLabel, AUDIT_ACTIONS, AUDIT_TARGETS, recordHref, TASK_KINDS, TASK_STATUS_OPTIONS, tone } from '../../lib/admin/b1/common';
import type { AuditRow, DeadLetter, Enquiry, JobRun, OutboxRow, Task } from '../../lib/admin/b1/types';
import { Button, Card, ErrorBox, Eyebrow, H2, Loading, Notice, P, Screen, StaleBanner, Title } from '../ui';
import { DatePickerField, EmptyState, FilterChips, isIsoDate, Paginator, RecordList, SegmentTabs } from '../workspace';
import { notifyBadges } from '../workspaceShell';
import { Enter } from '../../motion';
import { colors, font, space } from '../../theme';
import { ReasonSheet } from '../adminA/ReasonSheet';
import { DetailRow } from './parts';
import { useToast } from './toast';

export type OperationsTab = 'queue' | 'audit' | 'enquiries' | 'outbox' | 'jobs';
const PAGE = 50;
const TITLE: Record<'queue' | 'audit', string> = { queue: 'Operations', audit: 'Audit log' };
const SUB: Record<'queue' | 'audit', string> = { queue: 'Every exception has an owner or an explicit unassigned state, a status, a timestamp and a resolution trail.', audit: 'Every administrative change with its actor, target, reason and time. Append-only: rows are never edited or removed.' };

export function OperationsScreen({ fixedTab, plain }: { fixedTab?: 'audit'; plain?: boolean }) {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<OperationsTab>(fixedTab ?? 'queue');
  const [status, setStatus] = useState('open');
  const [kind, setKind] = useState('');
  // the tab strip's Exceptions count needs the queue on every tab; the fixed audit screen has no strip and no queue
  const tasksOn = !fixedTab;
  const tasks = useLoad<{ items: Task[] } | null>(tasksOn ? `admin-tasks-${status}-${kind}` : null, () => (tasksOn ? get(`/admin/operations/tasks${qs({ status: status === 'all' ? '' : status, kind })}`) : Promise.resolve(null)), [tasksOn, status, kind]);
  const [af, setAf] = useState({ action: '', targetType: '', since: '', until: '' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const datesOk = (!af.since || isIsoDate(af.since)) && (!af.until || isIsoDate(af.until));
  const auditOn = tab === 'audit' && datesOk;
  const auditKey = `admin-audit-${af.action}-${af.targetType}-${af.since}-${af.until}`;
  const audit = useLoad<{ items: AuditRow[]; appendOnly?: boolean } | null>(auditOn ? auditKey : null, () => (auditOn ? get(`/admin/audit/search${qs({ action: af.action, targetType: af.targetType, since: af.since ? `${af.since}T00:00:00.000Z` : '', until: af.until ? `${af.until}T23:59:59.999Z` : '', limit: 500 })}`) : Promise.resolve(null)), [auditOn, auditKey]);
  const enquiries = useLoad<{ items: Enquiry[] } | null>(tab === 'enquiries' ? 'admin-enquiries' : null, () => (tab === 'enquiries' ? get('/admin/enquiries') : Promise.resolve(null)), [tab]);
  const outbox = useLoad<{ items: OutboxRow[]; note?: string } | null>(tab === 'outbox' ? 'admin-outbox' : null, () => (tab === 'outbox' ? get('/admin/outbox') : Promise.resolve(null)), [tab]);
  const jobs = useLoad<[{ items: JobRun[] }, { items: DeadLetter[] }] | null>(tab === 'jobs' ? 'admin-jobs' : null, () => (tab === 'jobs' ? Promise.all([get('/admin/jobs'), get('/admin/events/dead-letters')]) : Promise.resolve(null)), [tab]);
  const [outboxPage, setOutboxPage] = useState(1);
  const { toast, show } = useToast();
  const [resolving, setResolving] = useState<Task | null>(null);
  const items = tasks.data?.items ?? [];
  const kinds = [...TASK_KINDS, ...items.map((t) => String(t.kind ?? '')).filter((k) => k && !TASK_KINDS.includes(k))].filter((k, i, a) => a.indexOf(k) === i);
  const own = async (t: Task) => {
    try { await patch(`/admin/operations/tasks/${t.id}`, { ownerId: user?.id, status: 'in_progress' }); show('You own it'); void tasks.reload(); notifyBadges(); }
    catch (e) { show(errorText(e), 'error'); }
  };
  // a refusal throws back into the sheet, which keeps it open with the error (the web's ReasonDialog)
  const resolve = async (resolution: string) => {
    if (!resolving) return;
    await patch(`/admin/operations/tasks/${resolving.id}`, { status: 'resolved', resolution });
    show('Resolved'); void tasks.reload(); notifyBadges();
  };
  const progress = async (e: Enquiry) => {
    try { await patch(`/admin/enquiries/${e.id}`, { status: e.status === 'new' ? 'in_progress' : 'closed' }); void enquiries.reload(); }
    catch (err) { show(errorText(err), 'error'); }
  };
  const current = tab === 'queue' ? tasks : tab === 'audit' ? audit : tab === 'enquiries' ? enquiries : tab === 'outbox' ? outbox : jobs;
  const head = fixedTab ?? 'queue';
  const openCount = items.filter((t) => t.status !== 'resolved' && t.status !== 'dismissed').length;
  const auditItems = audit.data?.items ?? [];
  const activeFilters = [af.action, af.targetType, af.since, af.until].filter(Boolean).length;
  const setFilter = (next: Partial<typeof af>) => { setAf({ ...af, ...next }); setAuditPage(1); };
  const enq = enquiries.data?.items ?? [];
  const out = outbox.data?.items ?? [];
  const runs = (jobs.data?.[0]?.items ?? []).slice(0, 30);
  const dead = jobs.data?.[1]?.items ?? [];
  const refresh = () => { void current.reload(); if (tasksOn && current !== tasks) void tasks.reload(); };
  return <Screen refreshing={current.loading} onRefresh={refresh} depth={!plain}>
    <Enter><Title sub={SUB[head]}>{TITLE[head]}</Title></Enter>
    {!fixedTab ? <SegmentTabs items={[{ id: 'queue', label: 'Exceptions', count: openCount }, { id: 'audit', label: 'Audit log' }, { id: 'enquiries', label: 'Enquiries' }, { id: 'outbox', label: 'Outbox' }, { id: 'jobs', label: 'Jobs and events' }]} value={tab} onChange={(v) => setTab(v as OperationsTab)} /> : null}
    {toast}
    {tab === 'queue' ? <Enter index={1}>
      <FilterChips options={TASK_STATUS_OPTIONS} value={status} onChange={(v) => setStatus(String(v))} />
      <FilterChips options={[{ value: '', label: 'Any kind' }, ...kinds.map((k) => ({ value: k, label: label(k) }))]} value={kind} onChange={(v) => setKind(String(v))} />
      <StaleBanner at={tasks.stale} /><ErrorBox error={tasks.error} onRetry={tasks.reload} />
      {tasks.loading && !tasks.data ? <Loading /> : tasks.data ? (items.length ? <RecordList>
        {items.map((t, i) => {
          const href = recordHref(t);
          return <DetailRow key={t.id} last={i === items.length - 1} title={t.title}
            lines={[t.detail, `${t.owner_name ?? 'Unassigned'} · created ${relative(t.created_at)}`, t.resolution ? `Resolution: ${t.resolution}` : null]}
            pills={[{ label: label(t.kind), tone: 'info' }, { label: label(t.status), tone: tone(t.status) }]}
            actions={href || (!t.owner_id && t.status === 'open') || t.status === 'open' || t.status === 'in_progress' ? <>
              {href ? <Button title="Open record →" variant="ghost" small onPress={() => router.push(href)} /> : null}
              {!t.owner_id && t.status === 'open' ? <Button title="Own it" variant="secondary" small onPress={() => { void own(t); }} /> : null}
              {t.status === 'open' || t.status === 'in_progress' ? <Button title="Resolve" small onPress={() => setResolving(t)} /> : null}
            </> : undefined} />;
        })}
      </RecordList> : <EmptyState title="Nothing in this view" icon="construct-outline" />) : null}
    </Enter> : null}
    {tab === 'audit' ? <Enter index={1}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
          <Eyebrow>{`Filters${activeFilters ? ` · ${activeFilters} set` : ''}`}</Eyebrow>
          <Button title={filtersOpen ? 'Hide filters' : 'Show filters'} variant="ghost" small onPress={() => setFiltersOpen(!filtersOpen)} />
        </View>
        {filtersOpen ? <>
          <Text style={styles.filterLabel}>Action</Text>
          <FilterChips options={[{ value: '', label: 'Any action' }, ...AUDIT_ACTIONS.map((a) => ({ value: a, label: label(a.replace('.', '')) }))]} value={af.action} onChange={(v) => setFilter({ action: String(v) })} />
          <Text style={styles.filterLabel}>Target</Text>
          <FilterChips options={[{ value: '', label: 'Any target' }, ...AUDIT_TARGETS.map((t) => ({ value: t, label: label(t) }))]} value={af.targetType} onChange={(v) => setFilter({ targetType: String(v) })} />
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <View style={{ flex: 1 }}><DatePickerField label="Since" value={af.since} onChange={(v) => setFilter({ since: v })} /></View>
            <View style={{ flex: 1 }}><DatePickerField label="Until" value={af.until} onChange={(v) => setFilter({ until: v })} /></View>
          </View>
          {activeFilters ? <Button title="Clear filters" variant="secondary" small onPress={() => { setAf({ action: '', targetType: '', since: '', until: '' }); setAuditPage(1); }} style={{ alignSelf: 'flex-start' }} /> : null}
        </> : null}
        <P muted small>Append-only: rows are never edited or deleted (enforced in the database).</P>
      </Card>
      <StaleBanner at={audit.stale} /><ErrorBox error={audit.error} onRetry={audit.reload} />
      {!datesOk ? <Notice kind="warning">Write the dates as YYYY-MM-DD to filter the log.</Notice> : audit.loading && !audit.data ? <Loading /> : audit.data ? (auditItems.length ? <>
        <RecordList>
          {auditItems.slice(0, auditPage * PAGE).map((a, i, arr) => <DetailRow key={a.id} last={i === arr.length - 1} title={actionLabel(a.action)}
            lines={[`${a.actor_name ?? a.actor_role ?? '—'} · ${a.target_type ?? '—'} ${a.target_id ?? ''}`.trim(), a.reason]}
            right={<Text style={styles.time}>{relative(a.at)}</Text>} />)}
        </RecordList>
        <Paginator page={auditPage} pageSize={PAGE} total={auditItems.length} onMore={() => setAuditPage(auditPage + 1)} />
        {auditItems.length >= 500 ? <P muted small>The latest 500 entries are shown; narrow the filters for earlier ones.</P> : null}
      </> : <EmptyState title="No entries" icon="list-outline" />) : null}
    </Enter> : null}
    {tab === 'enquiries' ? <Enter index={1}>
      <StaleBanner at={enquiries.stale} /><ErrorBox error={enquiries.error} onRetry={enquiries.reload} />
      {enquiries.loading && !enquiries.data ? <Loading /> : enquiries.data ? <RecordList>
        {enq.map((e, i) => <DetailRow key={e.id} last={i === enq.length - 1} title={e.name}
          lines={[`${e.email} · ${label(e.purpose)} · received ${relative(e.created_at)}`, e.message]}
          pills={[{ label: label(e.status), tone: tone(e.status) }]}
          actions={e.status !== 'closed' ? <Button title={e.status === 'new' ? 'Take' : 'Close'} variant="secondary" small onPress={() => { void progress(e); }} /> : undefined} />)}
        {!enq.length ? <P muted style={{ paddingVertical: space.md }}>No enquiries.</P> : null}
      </RecordList> : null}
    </Enter> : null}
    {tab === 'outbox' ? <Enter index={1}>
      <StaleBanner at={outbox.stale} /><ErrorBox error={outbox.error} onRetry={outbox.reload} />
      {outbox.loading && !outbox.data ? <Loading /> : outbox.data ? <Card>
        <Eyebrow>Not delivered</Eyebrow><H2>What a configured provider would have sent</H2>
        {outbox.data.note ? <Notice kind="info">{outbox.data.note}</Notice> : null}
        {out.slice(0, outboxPage * PAGE).map((m, i, arr) => <DetailRow key={m.id} last={i === arr.length - 1} title={`${label(m.channel)} · ${m.to_address}`} lines={[m.subject, m.body]} right={<Text style={styles.time}>{relative(m.created_at)}</Text>} />)}
        <Paginator page={outboxPage} pageSize={PAGE} total={out.length} onMore={() => setOutboxPage(outboxPage + 1)} />
      </Card> : null}
    </Enter> : null}
    {tab === 'jobs' ? <Enter index={1}>
      <StaleBanner at={jobs.stale} /><ErrorBox error={jobs.error} onRetry={jobs.reload} />
      {jobs.loading && !jobs.data ? <Loading /> : jobs.data ? <>
        <Card><Eyebrow>Background</Eyebrow><H2>Recent job runs</H2>
          {runs.map((j, i) => <DetailRow key={j.id} last={i === runs.length - 1} title={j.job} lines={[`Started ${fmtDateTime(j.started_at)}`, j.detail]} pills={[j.ok ? { label: 'ok', tone: 'success' } : j.ok === 0 || j.ok === false ? { label: 'failed', tone: 'error' } : { label: 'running', tone: 'warning' }]} />)}
        </Card>
        <Card><Eyebrow>Outbox events</Eyebrow><H2>Dead letters</H2>
          {dead.length ? dead.map((e, i) => <DetailRow key={e.id} last={i === dead.length - 1} title={e.type} lines={[`${e.aggregate_type ?? '—'} ${e.aggregate_id ?? ''}`.trim(), `${e.attempts} attempts`, e.last_error]} />) : <EmptyState title="No dead letters" body="Every domain event was processed." />}
        </Card>
      </> : null}
    </Enter> : null}
    <ReasonSheet open={!!resolving} onClose={() => setResolving(null)} title={`Resolve: ${resolving?.title ?? ''}`} body="Say what was done; it becomes the resolution trail." confirmLabel="Resolve" onConfirm={resolve} />
  </Screen>;
}

const styles = {
  filterLabel: { color: colors.text, fontSize: font.small, fontWeight: '600' as const, marginTop: space.sm },
  time: { color: colors.muted, fontSize: font.tiny },
};
