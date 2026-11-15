/* The "Lab next steps" tab on the administrator's member record (the web's modules/labFollowups/ClientRecordTab.tsx in
   team mode, reports.view): the member's next steps from their reports (GET /admin/lab-follow-ups?memberId → items,
   summary, options). The team marks done, cancels, reopens and links with integrations.manage, each with a reason; new
   team next steps are added on a report the team released itself (the report screen's "Next steps" section). */
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/admin/moduleTabs';
import { useToast } from '@/components/adminA/toast';
import { Card, Empty, Eyebrow, H2, P, StaleBanner } from '@/components/ui';
import { TabState, useRecordTick } from '@/components/coachModules/shared';
import { FollowUpLine, TeamActions, TeamLinkEditor, type FollowUp, type LinkOptions, type Summary } from '@/components/adminModules/labFollowups';
import { colors, font, space } from '@/theme';

type Payload = { items: FollowUp[]; summary: Summary; options?: LinkOptions };
type ReportRow = { id: string; reference: string; released?: boolean; releasedAt?: string | null; test?: { name: string } | null };

export function AdminLabFollowupsTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId, record } = ctx;
  const { can } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const canWrite = can('integrations.manage');
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const view = useLoad<Payload>(`admin-lab-follow-ups-${memberId}`, () => get(`/admin/lab-follow-ups?memberId=${encodeURIComponent(memberId)}`), [memberId, tick]);
  const reports = (((record as { reports?: ReportRow[] } | null)?.reports) ?? []).filter((r) => r.released ?? !!r.releasedAt);
  const d = view.data;
  const open = d?.items.filter((f) => f.status === 'open') ?? [];
  const closed = d?.items.filter((f) => f.status !== 'open') ?? [];
  const line = (f: FollowUp) => <FollowUpLine key={f.id} f={f} showReport>{canWrite ? <><TeamLinkEditor f={f} options={d?.options ?? null} onChanged={view.reload} show={toast.show} /><TeamActions f={f} onChanged={view.reload} show={toast.show} /></> : null}</FollowUpLine>;
  return <TabState loading={view.loading && !d} error={view.error} onRetry={view.reload}>
    {d ? <View style={{ gap: space.md }}>
      {toast.node}
      <StaleBanner at={view.stale} />
      <Card><Eyebrow>Lab next steps</Eyebrow><H2>{open.length ? `${open.length} open` : 'Nothing open'}</H2>
        {open.length ? open.map(line) : <Empty title="No open next steps" body={reports.length ? 'Add one from a released report.' : 'Next steps are added to a report once it is reviewed and released.'} />}
      </Card>
      {closed.length ? <Card><Eyebrow>History</Eyebrow><H2>Done and cancelled</H2>{closed.map(line)}</Card> : null}
      <Card><Eyebrow>Reports</Eyebrow><H2>Add a next step</H2>
        {reports.length ? reports.map((r) => <View key={r.id} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 }}>
          <Pressable accessibilityRole="link" onPress={() => router.push(`/admin/reports/${r.id}` as never)}><Text style={{ color: colors.accentText, fontSize: font.body, fontWeight: '600' }}>{r.test?.name ?? 'Report'}</Text></Pressable>
          <Text style={{ color: colors.muted, fontSize: font.small }}>{`${r.reference}${r.releasedAt ? ` · released ${fmtDate(r.releasedAt)}` : ''}`}</Text>
        </View>) : <P small>No released report yet.</P>}
        <P muted small>The team adds next steps only on a report it released itself; the assigned coach adds them once a report is released. On a step a coach wrote, the team can mark it done, cancel or reopen it, or change its link, each with a reason; its words and due date stay the coach’s.</P>
      </Card>
    </View> : null}
  </TabState>;
}
