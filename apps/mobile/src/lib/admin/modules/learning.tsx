/* The Learning tab on the administrator's member record (the web's modules/learning/LearningTab.tsx in admin mode,
   members.manage): the member's courses and progress (GET /admin/members/:id/learning). Read only: coaches assign
   courses from their own client record. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { get } from '@/lib/api';
import { fmtDate, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/admin/moduleTabs';
import { Card, Empty, Eyebrow, H2, Pill, Row, StaleBanner } from '@/components/ui';
import { Bar, KvList, StatusPill, TabState, useRecordTick } from '@/components/coachModules/shared';
import { colors, font, space } from '@/theme';

type Progress = { completed: number; total: number; pct: number | null; lastActivityAt?: string | null };
type Row_ = { id: string; courseId: string; courseTitle: string; courseStatus: string; audience: string; source: string; status: string; assignedByName: string | null; assignedByMe?: boolean; assignedNote: string | null; enrolledAt: string; completedAt: string | null; progress: Progress };

const AUDIENCE: Record<string, string> = { all_members: 'Every member', packages: 'Members with a package', assigned_only: 'Assigned by a coach', coaches: 'Coaches (training)' };
const SOURCES: Record<string, string> = { self: 'Chosen by the member', coach_assigned: 'Assigned by a coach', package: 'With their package' };

function EnrollmentPill({ status }: { status: string }) {
  if (status === 'active') return <Pill tone="warning">In progress</Pill>;
  if (status === 'withdrawn') return <Pill tone="info">Left</Pill>;
  return <StatusPill status={status} />;
}

export function AdminLearningTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId } = ctx;
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const data = useLoad<{ items: Row_[] }>(`admin-learning-${memberId}`, () => get(`/admin/members/${memberId}/learning`), [memberId, tick]);
  const d = data.data;
  return <TabState loading={data.loading && !d} error={data.error} onRetry={data.reload}>
    {d ? <View style={{ gap: space.md }}>
      <StaleBanner at={data.stale} />
      <Card>
      <Eyebrow>Learning</Eyebrow><H2>Courses and progress</H2>
      {d.items.length ? d.items.map((e) => <View key={e.id} style={st.item}>
        <Row between><Text style={st.title}>{e.courseTitle}</Text><EnrollmentPill status={e.status} /></Row>
        <Text style={st.meta}>{`${AUDIENCE[e.audience] ?? label(e.audience)}${e.courseStatus !== 'published' ? ` · course ${e.courseStatus}` : ''}`}</Text>
        {e.assignedNote ? <Text style={st.meta}>{`Note: ${e.assignedNote}`}</Text> : null}
        <KvList rows={[['How', `${SOURCES[e.source] ?? label(e.source)}${e.assignedByName ? ` · ${e.assignedByMe ? 'by you' : `by ${e.assignedByName}`}` : ''}`], e.completedAt ? ['Completed', fmtDate(e.completedAt)] : null, ['Started', fmtDate(e.enrolledAt)], ['Last activity', e.progress.lastActivityAt ? relative(e.progress.lastActivityAt) : '—']]} />
        <Text style={st.meta}>{e.progress.total ? `${e.progress.completed} of ${e.progress.total} lessons` : 'No lessons yet'}</Text>
        {e.progress.pct !== null ? <Bar pct={e.progress.pct} tone="success" /> : null}
      </View>) : <Empty title="No courses" body="The client has not started a course." />}
    </Card>
    </View> : null}
  </TabState>;
}

const st = StyleSheet.create({
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  title: { color: colors.text, fontSize: font.body, fontWeight: '600', flex: 1 },
  meta: { color: colors.muted, fontSize: font.small },
});
