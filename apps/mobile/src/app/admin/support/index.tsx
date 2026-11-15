/* Admin › Support (the web's /admin/support, modules/support/AdminSupport.tsx SupportHome; support module, any of
   operations.manage or members.manage): the support queue (operations.manage, while the support_requests part is on;
   GET /admin/support-requests?status&category&assigned&q → { items, counts }) and the data exports members asked for
   (members.manage; GET /admin/data-exports, "Generate now" with a reason → POST /admin/data-exports/:id/generate). A
   request opens at /admin/support/:id. Emails show only as the API returns them (stripped without the restricted
   permission). */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { get, post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { fmtDate, fmtDateTime, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { DetailRow, LoadError } from '@/components/adminB1/parts';
import { Button, Card, Empty, Loading, Notice } from '@/components/ui';
import { FilterChips, RecordList, SearchBar, SegmentTabs } from '@/components/workspace';
import { notifyBadges } from '@/components/workspaceShell';
import { StatusPill } from '@/components/coachModules/shared';
import { AdminModuleScreen, useScreenRefresh } from '@/components/adminModules/shared';
import { CATEGORIES, categoryLabel, fmtBytes, STATUSES, TeamStatusPill, type ExportRow, type RequestRow } from '@/components/adminModules/support';
import { space } from '@/theme';

export default function AdminSupportScreen() {
  return <AdminModuleScreen title="Support" module="support" permission={['operations.manage', 'members.manage']} any
    sub="Questions from members and coaches, answered in a thread they follow in the portal and the app, and the copies of their data members asked for. No response time is promised until Bioptime sets one.">
    <SupportHome />
  </AdminModuleScreen>;
}

function SupportHome() {
  const { can } = useAuth();
  const features = useFeatures(true);
  const params = useLocalSearchParams<{ tab?: string }>();
  const requestsOn = !!features?.has('support_requests');
  const tabs = [...(can('operations.manage') && requestsOn ? [{ id: 'requests', label: 'Support requests' }] : []), ...(can('members.manage') ? [{ id: 'exports', label: 'Data exports' }] : [])];
  const [picked, setPicked] = useState<string | null>(typeof params.tab === 'string' ? params.tab : null);
  useEffect(() => { if (typeof params.tab === 'string') setPicked(params.tab); }, [params.tab]);
  const tab = tabs.find((t) => t.id === picked)?.id ?? tabs[0]?.id;
  if (!features) return <Loading />;
  if (!tab) return <Card><Empty title="Nothing to show" body="Support requests need the operations permission; data exports need the members permission." /></Card>;
  return <View style={{ gap: space.md }}>
    <SegmentTabs items={tabs} value={tab} onChange={setPicked} />
    {tab === 'requests' ? <Queue /> : <Exports />}
  </View>;
}

const OWNER_OPTIONS = [{ value: '', label: 'Anyone’s' }, { value: 'me', label: 'Mine' }, { value: 'none', label: 'Unowned' }];
const TOPIC_OPTIONS = [{ value: '', label: 'Any topic' }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))];

function Queue() {
  const router = useRouter();
  const [f, setF] = useState({ status: 'active', category: '', assigned: '', q: '' });
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  const list = useLoad<{ items: RequestRow[]; counts: Record<string, number> }>(`admin-support-queue-${f.status}-${f.category}-${f.assigned}-${f.q}`, () => get(`/admin/support-requests${qs({ status: f.status === 'all' ? '' : f.status, category: f.category, assigned: f.assigned, q: f.q })}`), [f, tick]);
  const pull = useScreenRefresh(list.loading, list.stale);
  useEffect(() => { if (pull) setTick((n) => n + 1); }, [pull]);
  useEffect(() => { if (!q.trim() && f.q) setF((x) => ({ ...x, q: '' })); }, [q, f.q]);
  const c = list.data?.counts;
  const statusOptions = [{ value: 'active', label: `Open or waiting${c ? ` (${(c.open ?? 0) + (c.waiting_on_requester ?? 0)})` : ''}` }, ...STATUSES.map((s) => ({ value: s.id, label: `${s.label}${c ? ` (${c[s.id] ?? 0})` : ''}` })), { value: 'all', label: 'All' }];
  const items = list.data?.items ?? [];
  return <View style={{ gap: space.md }}>
    <FilterChips options={statusOptions} value={f.status} onChange={(v) => setF({ ...f, status: String(v) })} />
    <FilterChips options={TOPIC_OPTIONS} value={f.category} onChange={(v) => setF({ ...f, category: String(v) })} />
    <FilterChips options={OWNER_OPTIONS} value={f.assigned} onChange={(v) => setF({ ...f, assigned: String(v) })} />
    <SearchBar value={q} onChangeText={setQ} placeholder="Reference or subject" onSubmit={() => setF({ ...f, q: q.trim() })} />
    <Button title="Search" small variant="secondary" onPress={() => setF({ ...f, q: q.trim() })} style={{ alignSelf: 'flex-start' }} />
    <LoadError title="Support requests could not be loaded" error={list.error} onRetry={list.reload} />
    {!list.data && !list.error ? <Loading /> : items.length ? <RecordList title="Support requests">
      {items.map((r, i) => <DetailRow key={r.id} last={i === items.length - 1} title={`${r.reference} · ${r.subject}`}
        lines={[
          `${r.messageCount} message${r.messageCount === 1 ? '' : 's'}${r.internalCount ? ` · ${r.internalCount} internal` : ''}`,
          `From ${r.requester?.name ?? '—'}${r.requester?.role ? ` · ${label(r.requester.role)}` : ''} · ${categoryLabel(r.category)}`,
          `${r.assignedTo?.name ?? 'Unowned'} · ${relative(r.updatedAt)}`,
        ]}
        right={<TeamStatusPill status={r.status} />} onPress={() => router.push(`/admin/support/${r.id}` as never)} />)}
    </RecordList> : list.data ? <Card><Empty title="Nothing in this view" /></Card> : null}
  </View>;
}

function Exports() {
  const router = useRouter();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [gen, setGen] = useState<ExportRow | null>(null);
  const list = useLoad<{ items: ExportRow[] }>('admin-data-exports', () => get('/admin/data-exports'), [tick]);
  const pull = useScreenRefresh(list.loading, list.stale);
  useEffect(() => { if (pull) setTick((n) => n + 1); }, [pull]);
  const items = list.data?.items ?? [];
  return <View style={{ gap: space.md }}>
    {toast.node}
    <Notice kind="info" title="What the team can and cannot see">An export is generated once its request is in progress (here, or when the request is marked in progress), by the data exports job. The file is a JSON archive that only the member can open, through a link that works for five minutes; the team sees that it exists and its size, never its contents.</Notice>
    <LoadError title="Data exports could not be loaded" error={list.error} onRetry={list.reload} />
    {!list.data && !list.error ? <Loading /> : items.length ? <RecordList title="Data export requests">
      {items.map((e, i) => <DetailRow key={e.id} last={i === items.length - 1} title={e.memberName}
        lines={[
          `${e.memberCode ?? ''}${e.note ? ` · ${e.note}` : ''}`,
          `Requested ${fmtDate(e.requestedAt)}`,
          e.file ? `Ready · ${fmtBytes(e.file.size)} · ${fmtDateTime(e.file.createdAt)}` : e.status === 'in_progress' ? 'Waiting for the next job run' : null,
        ]}
        right={<StatusPill status={e.status} />}
        actions={<>
          {!e.file && (e.status === 'requested' || e.status === 'in_progress') ? <Button title="Generate now" small variant="secondary" onPress={() => setGen(e)} /> : null}
          <Button title="Client record" small variant="ghost" onPress={() => router.push(`/admin/clients/${e.memberId}` as never)} />
        </>} />)}
    </RecordList> : list.data ? <Card><Empty title="No export requests" body="Members ask for a copy of their data under Profile › Your data." /></Card> : null}
    <ReasonSheet open={!!gen} onClose={() => setGen(null)} title={`Generate ${gen?.memberName ?? ''}’s data export?`} confirmLabel="Generate"
      body={`${gen?.status === 'requested' ? 'The request moves to in progress, and is' : 'The request is'} completed when the file is written. The member is notified and downloads it themselves.`}
      onConfirm={async (reason) => { const row = gen; if (!row) return; await post(`/admin/data-exports/${row.id}/generate`, { reason }); toast.show('Export generated; the member is notified'); void list.reload(); notifyBadges(); }} />
  </View>;
}
