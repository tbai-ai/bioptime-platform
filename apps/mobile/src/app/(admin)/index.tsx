/* Admin › Overview (the web's /admin, pages/Home.tsx AdminOverview): GET /admin/overview (reports.view): the eight queue
   readouts, orders per week, bookings by status, coach capacity, exceptions by kind, then the cards the switched-on
   modules add (lib/admin/a/overviewCards). An administrator without reports.view is sent to the first section they
   hold, in the web's AdminIndex order (lib/admin/a/format FIRST_SECTION); with no permission at all they read the
   web's "No permissions yet". */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { inr, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { firstPermittedSection, num } from '@/lib/admin/a/format';
import { MODULE_OVERVIEW_CARDS } from '@/lib/admin/a/overviewCards';
import { Bars, ProgressBar, Readout } from '@/components/adminA/parts';
import { Button, Card, ErrorBox, Eyebrow, H2, Loading, Notice, P, Pill, Row, StaleBanner } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { RequirePermission, WorkspaceScreen } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { space } from '@/theme';

type Overview = {
  demo?: boolean;
  members: { total: number; active: number; onboarding: number; new30d: number };
  orders: { new30d: number; pendingPayment: number; activated30d: number };
  revenue: { verifiedInr30d: number; verifiedInrAll: number; refundedInr: number; note?: string };
  programmes: { active: number; endingIn7d: number };
  assignments: { unassigned: number; exceptions: number };
  coaches: { active: number; available: number; utilisationPct: number; byCoach: Array<{ coachId: string; name: string; caseload: number; limit: number; available: boolean }> };
  appointments: { upcoming7d: number; requested: number };
  bloodwork: Record<string, number>;
  reportsAwaitingReview: number;
  exceptions: { open: number; byKind: Record<string, number> };
  ordersByWeek: Array<{ week: string; n: number; inr: number }>;
  generatedAt?: string;
};

export default function AdminOverview() {
  const { can } = useAuth();
  const router = useRouter();
  const allowed = can('reports.view');
  const features = useFeatures(allowed);
  const [refreshTick, setRefreshTick] = useState(0);
  const ov = useLoad<Overview | null>(allowed ? 'admin-overview' : null, () => (allowed ? get<Overview>('/admin/overview') : Promise.resolve(null)), [allowed]);
  const first = allowed ? null : firstPermittedSection(can);
  useEffect(() => { if (!allowed && first) router.replace(first as never); }, [allowed, first, router]);

  if (!allowed) {
    return <WorkspaceScreen workspace="admin" title="Overview">
      {first ? <Loading /> : <Notice kind="warning" title="No permissions yet">An owner grants them under Users and permissions.</Notice>}
    </WorkspaceScreen>;
  }

  const d = ov.data;
  const sub = d ? `${num(d.members?.active)} active members · ${num(d.programmes?.active)} active programmes · ${num(d.coaches?.utilisationPct)}% coach utilisation · ${num(d.exceptions?.open)} open exceptions` : undefined;
  const weeks = d?.ordersByWeek ?? [];
  const bloodwork = Object.entries(d?.bloodwork ?? {});
  const byKind = Object.entries(d?.exceptions?.byKind ?? {});
  const moduleCards = MODULE_OVERVIEW_CARDS.filter((c) => !!features && features.has(c.module) && (!c.feature || features.has(c.feature)) && (!c.permission || can(c.permission)));
  const go = (href: string) => () => router.push(href as never);
  // the web's simulated-revenue note, shown only while the server says it runs in its simulated mode (Home.tsx)
  const revenueNote = d?.demo && d.revenue?.note ? ` ${d.revenue.note}` : '';

  return <WorkspaceScreen workspace="admin" title="Overview" sub={sub} refreshing={ov.loading} onRefresh={() => { void ov.reload(); setRefreshTick((t) => t + 1); }} depth>
    <RequirePermission permission="reports.view">
      <StaleBanner at={ov.stale} /><ErrorBox error={ov.error} onRetry={ov.reload} />
      {ov.loading && !d ? <Loading /> : d ? <>
        <Enter index={1}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          <Readout eyebrow="Members" value={num(d.members?.total)} onPress={go('/(admin)/members')} />
          <Readout eyebrow="New orders · 30 days" value={num(d.orders?.new30d)} onPress={go('/admin/orders')} />
          <Readout eyebrow="Verified revenue · 30 days" value={inr(d.revenue?.verifiedInr30d ?? 0)} onPress={go('/admin/orders')} />
          <Readout eyebrow="Unassigned members" value={num(d.assignments?.unassigned)} hot={(d.assignments?.unassigned ?? 0) > 0} onPress={go('/admin/assignments')} />
          <Readout eyebrow="Coach utilisation" value={num(d.coaches?.utilisationPct)} unit="%" onPress={go('/admin/coaches')} />
          <Readout eyebrow="Appointments · 7 days" value={num(d.appointments?.upcoming7d)} onPress={go('/admin/appointments')} />
          <Readout eyebrow="Reports awaiting review" value={num(d.reportsAwaitingReview)} hot={(d.reportsAwaitingReview ?? 0) > 0} onPress={go('/admin/bloodwork')} />
          <Readout eyebrow="Operational exceptions" value={num(d.exceptions?.open)} hot={(d.exceptions?.open ?? 0) > 0} onPress={go('/(admin)/operations')} />
        </View></Enter>
        <MotionCard index={2} pressable={false}><Card>
          <Eyebrow>12 weeks</Eyebrow><H2>Orders per week</H2>
          <Bars series={weeks.map((w) => w.n)} labels={weeks.map((w) => w.week.slice(5))} />
          <P muted small>{`Bars: orders created. Verified revenue in the period: ${inr(weeks.reduce((s, w) => s + (w.inr ?? 0), 0))}.${revenueNote}`}</P>
        </Card></MotionCard>
        <MotionCard index={3} pressable={false}><Card>
          <Eyebrow>Bloodwork</Eyebrow><H2>Bookings by status</H2>
          {bloodwork.length ? <KeyValue rows={bloodwork.map(([k, v]) => [label(k), String(v)] as [string, string])} /> : <P muted>No bookings</P>}
        </Card></MotionCard>
        <MotionCard index={4} pressable={false}><Card>
          <Row between><View><Eyebrow>Capacity</Eyebrow><H2>Coaches</H2></View><Button title="Manage" small variant="ghost" onPress={go('/admin/coaches')} /></Row>
          <View style={{ gap: space.md }}>{(d.coaches?.byCoach ?? []).map((c) => <View key={c.coachId} style={{ gap: space.xs }}>
            <Row between>
              <P style={{ fontWeight: '600', flexShrink: 1 }}>{c.name} <P muted small>{`${c.caseload}/${c.limit}`}</P></P>
              <Pill tone={c.available ? 'success' : 'info'}>{c.available ? 'Available' : 'Away'}</Pill>
            </Row>
            <ProgressBar pct={(100 * c.caseload) / Math.max(1, c.limit)} />
          </View>)}</View>
        </Card></MotionCard>
        <MotionCard index={5} pressable={false}><Card>
          <Row between><View><Eyebrow>Exceptions</Eyebrow><H2>By kind</H2></View><Button title="Queue" small variant="ghost" onPress={go('/(admin)/operations')} /></Row>
          {byKind.length ? <KeyValue rows={byKind.map(([k, v]) => [label(k), String(v)] as [string, string])} /> : <P muted>None open</P>}
        </Card></MotionCard>
        {moduleCards.map((c, i) => <MotionCard key={c.id} index={6 + i} pressable={false}><View>{c.render({ overview: d, refreshTick })}</View></MotionCard>)}
      </> : null}
    </RequirePermission>
  </WorkspaceScreen>;
}
