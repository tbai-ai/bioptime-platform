/* Coach › a client's record (the portal's /coach/clients/:id?tab=, pages/ClientDetail.tsx for a coach): GET
   /coach/clients/:id once (every opening is audited by the server as member.record_viewed), the head with the package
   line and the actions, the "Health records not shared" notice, and the tab strip: the core tabs (components/coach/
   record), then the module tabs the module builders register (lib/coach/moduleTabs MODULE_RECORD_TABS, each while its
   flag is on), then Messages and Notes. The Schedule and Record-a-value sheets live here. Coach endpoints only: phone,
   email, address, PIN code, date of birth and government ids never arrive and are never rendered. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { get } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDate, label } from '@/lib/format';
import { MODULE_RECORD_TABS } from '@/lib/coach/moduleTabs';
import { useLoad } from '@/lib/useLoad';
import { useReloadOnFocus } from '@/lib/coach/core/focus';
import { Button, ErrorBox, Loading, Notice, Screen, StaleBanner } from '@/components/ui';
import { SegmentTabs, type SegmentItem } from '@/components/workspace';
import { RoleGate, notifyBadges } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { coachScreenOptions } from '@/components/coach/bell';
import { ProgressDialog, ScheduleDialog } from '@/components/coach/dialogs';
import { AppointmentsTab, BloodworkTab, MessagesTab, NotesTab, OverviewTab, PlanTab, ProgressTab } from '@/components/coach/record';
import { PageHead, StatusPill, ToastFloat, useToast } from '@/components/coach/shared';
import { space } from '@/theme';

const CORE_FIRST: SegmentItem[] = [{ id: 'overview', label: 'Overview' }, { id: 'plan', label: 'Plan' }, { id: 'bloodwork', label: 'Bloodwork' }, { id: 'appointments', label: 'Appointments' }, { id: 'progress', label: 'Progress' }];
const CORE_LAST: SegmentItem[] = [{ id: 'messages', label: 'Messages' }, { id: 'notes', label: 'Notes' }];

export default function ClientRecord() {
  const { id = '', tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const features = useFeatures(true);
  const [tab, setTabState] = useState(tabParam || 'overview');
  useEffect(() => { if (tabParam) setTabState(tabParam); }, [tabParam]);
  // the tab is kept in ?tab= as on the web, so Today's links and a reload land on the same tab
  const setTab = (t: string) => { setTabState(t); router.setParams({ tab: t }); };
  const detail = useLoad<any>(`coach-client-${id}`, () => get(`/coach/clients/${id}`), [id]);
  useReloadOnFocus(detail.reload);
  const { toast, show } = useToast(id);
  const [schedule, setSchedule] = useState(false);
  const [progressDlg, setProgressDlg] = useState(false);
  const d = detail.data;
  const moduleTabs = MODULE_RECORD_TABS.filter((t) => !!features && features.has(t.module) && (!t.feature || features.has(t.feature)));
  const withheld = !!d && (d.healthShared === false || d.progress?.withheld === true);
  const tabs: SegmentItem[] = d ? [
    { id: 'overview', label: 'Overview' }, { id: 'plan', label: 'Plan', count: (d.plans ?? []).filter((p: any) => p.status === 'draft').length }, { id: 'bloodwork', label: 'Bloodwork', count: (d.reports ?? []).filter((r: any) => !r.reviewed).length }, { id: 'appointments', label: 'Appointments' }, { id: 'progress', label: 'Progress' },
    ...moduleTabs.map((t) => ({ id: t.id, label: t.label })),
    ...CORE_LAST,
  ] : [...CORE_FIRST, ...CORE_LAST];
  const reload = () => { void detail.reload(); notifyBadges(); };
  const m = d?.member ?? {};
  const sub = d ? `${d.programme ? `${d.programme.packageName} · ${d.programme.durationLabel ?? ''} · ends ${fmtDate(d.programme.endAt)}` : 'No active programme'} · ${d.coach ? `coach ${d.coach.displayName}` : `assignment ${label(d.assignmentStatus)}`}` : undefined;
  const noPublished = !!d && !(d.plans ?? []).some((p: any) => p.status === 'published');
  const current = moduleTabs.find((t) => t.id === tab);
  return <RoleGate workspace="coach"><View style={{ flex: 1 }}><Screen refreshing={detail.loading} onRefresh={detail.reload}>
    <Stack.Screen options={coachScreenOptions(d?.member?.name ?? 'Client')} />
    <Enter><PageHead back="Clients" onBack={() => router.push('/(coach)/clients')} title={m.name ?? 'Client'} code={m.memberCode ?? d?.profile?.memberCode} sub={sub}>
      {d ? <><StatusPill status={m.state} /><Button title="Schedule consultation" small onPress={() => setSchedule(true)} />{noPublished ? <Button title="Write a plan" small variant="secondary" onPress={() => setTab('plan')} /> : null}</> : null}
    </PageHead></Enter>
    <StaleBanner at={detail.stale} /><ErrorBox error={detail.error} onRetry={detail.reload} />
    {d && d.healthShared === false ? <Notice kind="warning" title="Health records not shared">This member has not shared their measurements, progress log, bloodwork and reports with their coach. Ask them to turn on sharing in the app.</Notice> : null}
    {detail.loading && !d ? <Loading /> : d ? <>
      <SegmentTabs items={tabs} value={tab} onChange={setTab} style={{ marginHorizontal: -space.lg }} />
      <View style={{ gap: space.md }}>
        {tab === 'overview' ? <OverviewTab d={d} withheld={withheld} /> : null}
        {tab === 'plan' ? <PlanTab d={d} memberId={id} /> : null}
        {tab === 'bloodwork' ? <BloodworkTab d={d} withheld={withheld} /> : null}
        {tab === 'appointments' ? <AppointmentsTab d={d} onSchedule={() => setSchedule(true)} /> : null}
        {tab === 'progress' ? <ProgressTab d={d} withheld={withheld} onRecord={() => setProgressDlg(true)} /> : null}
        {tab === 'messages' ? <MessagesTab memberId={id} /> : null}
        {tab === 'notes' ? <NotesTab d={d} memberId={id} reload={reload} show={show} /> : null}
        {current ? <React.Fragment key={current.id}>{current.render({ memberId: id, record: d, sharing: !withheld, reload })}</React.Fragment> : null}
      </View>
      <ScheduleDialog open={schedule} onClose={() => setSchedule(false)} memberId={id} onDone={() => { reload(); show('Consultation scheduled'); }} />
      <ProgressDialog open={progressDlg} onClose={() => setProgressDlg(false)} memberId={id} metrics={d.progress?.metrics ?? []} onDone={() => { reload(); show('Value recorded'); }} />
    </> : null}
  </Screen><ToastFloat toast={toast} /></View></RoleGate>;
}
