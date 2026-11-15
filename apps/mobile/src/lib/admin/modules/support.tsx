/* The Support tab on the administrator's member record (the web's modules/support/ClientSupportTab.tsx,
   operations.manage and the support_requests part): the member's support requests (GET /admin/support-requests?requesterId)
   and, with members.manage, their data exports (GET /admin/data-exports, filtered to this member here, as the web does).
   Each card loads on its own and shows its own error, as on the web. The team never sees an export's contents, only
   that the file exists and its size. */
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/admin/moduleTabs';
import { Button, Card, Empty, ErrorBox, Eyebrow, H2, Loading, Row, StaleBanner } from '@/components/ui';
import { StatusPill, useRecordTick } from '@/components/coachModules/shared';
import { oldestStale } from '@/components/adminModules/shared';
import { categoryLabel, fmtBytes, TeamStatusPill, type ExportRow, type RequestRow } from '@/components/adminModules/support';
import { colors, font, space } from '@/theme';

export function ClientSupportTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId } = ctx;
  const { can } = useAuth();
  const router = useRouter();
  const exportsAllowed = can('members.manage');
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  // two loads, as the web's two cards: an error on the exports list leaves the member's requests on screen
  const reqs = useLoad<{ items: RequestRow[] }>(`admin-support-requests-${memberId}`, () => get(`/admin/support-requests?requesterId=${encodeURIComponent(memberId)}`), [memberId, tick]);
  const exps = useLoad<{ items: ExportRow[] } | null>(exportsAllowed ? 'admin-data-exports' : null, () => (exportsAllowed ? get<{ items: ExportRow[] }>('/admin/data-exports') : Promise.resolve(null)), [memberId, exportsAllowed, tick]);
  const requests = reqs.data?.items ?? [];
  const exports = (exps.data?.items ?? []).filter((e) => e.memberId === memberId);
  return <View style={{ gap: space.md }}>
    <StaleBanner at={oldestStale(reqs.stale, exportsAllowed ? exps.stale : null)} />
    <Card>
      <Row between><View style={{ flex: 1 }}><Eyebrow>Support</Eyebrow><H2>Requests from this member</H2></View><Button title="Open the queue" variant="ghost" small onPress={() => router.push('/admin/support' as never)} /></Row>
      {reqs.error ? <ErrorBox error={reqs.error} onRetry={reqs.reload} /> : !reqs.data ? <Loading /> : requests.length ? requests.map((r) => <View key={r.id} style={st.item}>
        <Row between><Text accessibilityRole="link" style={[st.title, { color: colors.accentText }]} onPress={() => router.push(`/admin/support/${r.id}` as never)}>{r.reference}</Text><TeamStatusPill status={r.status} /></Row>
        <Text style={st.body}>{r.subject}</Text>
        <Text style={st.meta}>{`${categoryLabel(r.category)} · ${r.assignedTo?.name ?? 'Unowned'} · ${relative(r.updatedAt)}`}</Text>
      </View>) : <Empty title="No support requests" />}
    </Card>
    {exportsAllowed ? <Card>
      <Row between><View style={{ flex: 1 }}><Eyebrow>Data rights</Eyebrow><H2>Data exports</H2></View><Button title="All exports" variant="ghost" small onPress={() => router.push('/admin/support?tab=exports' as never)} /></Row>
      {exps.error ? <ErrorBox error={exps.error} onRetry={exps.reload} /> : !exps.data ? <Loading /> : exports.length ? exports.map((e) => <View key={e.id} style={st.item}>
        <Row between><Text style={st.title}>{`Requested ${fmtDate(e.requestedAt)}`}</Text><StatusPill status={e.status} /></Row>
        <Text style={st.meta}>{e.file ? `File ready · ${fmtBytes(e.file.size)} · only the member can open it` : 'No file yet'}</Text>
      </View>) : <Text style={st.meta}>No export requested.</Text>}
    </Card> : null}
  </View>;
}

const st = StyleSheet.create({
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  title: { color: colors.text, fontSize: font.body, fontWeight: '600', flex: 1 },
  body: { color: colors.text, fontSize: font.small },
  meta: { color: colors.muted, fontSize: font.small },
});
