/* The "Goals and check-ins" tab on the administrator's member record (the web's modules/progress/AdminProgressTab.tsx,
   members.manage): the member's goals, the status of their check-ins and their weekly schedule; never the check-in
   answers and never a photo, only counts. GET /admin/members/:id/progress (audited as member.record_viewed). Read only. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { get } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/admin/moduleTabs';
import { Readout } from '@/components/adminA/parts';
import { Card, Empty, Eyebrow, H2, P, Pill, Row, StaleBanner } from '@/components/ui';
import { StatusPill, TabState, day, useRecordTick } from '@/components/coachModules/shared';
import { colors, font, space } from '@/theme';

type Goal = { id: string; title: string; metricLabel: string | null; unit: string | null; targetValue?: number | null; status: string; createdByRole: 'member' | 'coach'; createdAt: string };
type Checkin = { id: string; title: string; dueDate: string; status: 'requested' | 'submitted' | 'reviewed' | 'missed' };
type Schedule = { id: string; coachName: string; templateTitle: string; weekdayLabel: string; active: boolean; createdAt: string };
type Overview = { goals: { byStatus: Record<string, number>; items: Goal[] }; checkins: { byStatus: Record<string, number>; items: Checkin[] }; schedules: Schedule[]; photos: { total: number; shared: number; consentGranted: boolean; note: string } };

const CHECKIN_PILL: Record<Checkin['status'], [string, 'warning' | 'info' | 'success']> = { requested: ['Waiting for answers', 'warning'], submitted: ['Sent, not reviewed', 'warning'], reviewed: ['Reviewed', 'success'], missed: ['Missed', 'info'] };
/** The web's GoalPill (modules/progress/shared.tsx:40): the status it borrows for the tone, and the words. */
const GOAL_PILL: Record<string, [string, string]> = { active: ['active', 'Active'], achieved: ['completed', 'Achieved'], paused: ['paused', 'Paused'], dropped: ['cancelled', 'Dropped'] };

export function AdminProgressTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId } = ctx;
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const view = useLoad<Overview>(`admin-progress-${memberId}`, () => get(`/admin/members/${memberId}/progress`), [memberId, tick]);
  const d = view.data;
  const n = (o: Record<string, number> | undefined, k: string) => o?.[k] ?? 0;
  const active = d?.schedules.find((s) => s.active) ?? null;
  return <TabState loading={view.loading && !d} error={view.error} onRetry={view.reload}>
    {d ? <View style={{ gap: space.md }}>
      <StaleBanner at={view.stale} />
      <View style={st.grid}>
        <Readout eyebrow="Open goals" value={n(d.goals.byStatus, 'active') + n(d.goals.byStatus, 'paused')} sub={`${n(d.goals.byStatus, 'achieved')} achieved`} />
        <Readout eyebrow="Check-ins waiting" value={n(d.checkins.byStatus, 'requested')} sub={`${n(d.checkins.byStatus, 'submitted')} to review · ${n(d.checkins.byStatus, 'missed')} missed`} />
        <Readout eyebrow="Progress photos" value={d.photos.total} sub={`${d.photos.shared} shared with the coach · consent ${d.photos.consentGranted ? 'given' : 'not given'}`} />
        <Readout eyebrow="Weekly check-in" value={active?.weekdayLabel ?? 'None'} sub={active?.templateTitle ?? 'Not scheduled'} />
      </View>
      <Card>
        <Eyebrow>Goals</Eyebrow><H2>Set by the member or their coach</H2>
        {d.goals.items.length ? d.goals.items.map((g) => <View key={g.id} style={st.row}>
          <Row between><Text style={st.rowTitle}>{g.title}</Text><StatusPill status={GOAL_PILL[g.status]?.[0] ?? g.status}>{GOAL_PILL[g.status]?.[1] ?? g.status}</StatusPill></Row>
          <Text style={st.meta}>{`${g.metricLabel ?? '—'}${g.targetValue != null ? ` · target ${g.targetValue}${g.unit ? ` ${g.unit}` : ''}` : ''} · ${g.createdByRole === 'coach' ? 'Coach' : 'Member'} · ${fmtDate(g.createdAt)}`}</Text>
        </View>) : <Empty title="No goals" />}
      </Card>
      <Card>
        <Eyebrow>Check-ins</Eyebrow><H2>Statuses (answers stay between the member and their coach)</H2>
        {active ? <P small>{`Every ${active.weekdayLabel}: “${active.templateTitle}”, set by ${active.coachName} on ${fmtDate(active.createdAt)}.`}</P> : null}
        {d.checkins.items.length ? d.checkins.items.map((c) => <View key={c.id} style={st.row}>
          <Row between><Text style={st.rowTitle}>{c.title}</Text><Pill tone={CHECKIN_PILL[c.status][1]}>{CHECKIN_PILL[c.status][0]}</Pill></Row>
          <Text style={st.meta}>{`Due ${day(c.dueDate)}`}</Text>
        </View>) : <Empty title="No check-ins" />}
      </Card>
      <P muted small>{d.photos.note}</P>
    </View> : null}
  </TabState>;
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  row: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600', flex: 1 },
  meta: { color: colors.muted, fontSize: font.small },
});
