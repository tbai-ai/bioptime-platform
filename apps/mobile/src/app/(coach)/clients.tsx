/* Coach › Clients (the portal's /coach/clients, pages/coach/CoachClients.tsx): GET /coach/clients with the search
   (name or member ID), the assignment-status filter, the sort and the pages; one card per client with the portal's seven
   columns as labelled lines. Coach endpoints only: the API's field policy (coachSafe) keeps members' contact details
   out, and so does this screen. */
import { Tabs, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { get, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { useReloadOnFocus } from '@/lib/coach/core/focus';
import { Button, Card, Empty, ErrorBox, Loading, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { SearchBar } from '@/components/workspace';
import { Enter, MotionCard } from '@/motion';
import { CoachBell } from '@/components/coach/bell';
import { Avatar, Muted, PickerField, ProgressBar, Small, StatusPill } from '@/components/coach/shared';
import { colors, font, space } from '@/theme';

const STATUS = [{ value: '', label: 'Active and paused' }, { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'ended', label: 'Ended (history)' }, { value: 'all', label: 'All' }];
const SORT = [{ value: 'name', label: 'Name' }, { value: 'recent', label: 'Last check-in' }, { value: 'next', label: 'Next appointment' }, { value: 'ends', label: 'Programme end' }, { value: 'progress', label: 'Tasks done' }];
const LIMIT = 25;
/** The portal's engagement pill takes the tone of these statuses (CoachClients.tsx): active, pending, draft. */
const ENGAGEMENT_TONE: Record<string, string> = { active: 'active', quiet: 'pending', new: 'draft' };

export default function CoachClients() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const [typed, setTyped] = useState(params.q ?? '');
  const [q, setQ] = useState(params.q ?? '');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  useEffect(() => { if (params.q !== undefined) { setTyped(params.q); setQ(params.q); setPage(1); } }, [params.q]);
  const list = useLoad<any>(`coach-clients-${status}-${sort}-${page}-${q}`, () => get(`/coach/clients${qs({ q, status, sort, page, limit: LIMIT })}`), [q, status, sort, page]);
  useReloadOnFocus(list.reload);
  const d = list.data;
  const items: any[] = d?.items ?? [];
  const pages = d ? Math.max(1, Math.ceil(d.total / d.limit)) : 1;
  return <Screen refreshing={list.loading} onRefresh={list.reload} depth>
    <Tabs.Screen options={{ headerRight: () => <CoachBell /> }} />
    <Enter><Title sub="Members assigned to you, and only them. Contact details stay with Bioptime; messages and consultations happen here.">My clients</Title></Enter>
    <Enter index={1}><View style={{ gap: space.sm }}>
      <SearchBar value={typed} onChangeText={(v) => { setTyped(v); if (!v) { setQ(''); setPage(1); } }} placeholder="Name or member ID" onSubmit={() => { setQ(typed.trim()); setPage(1); }} />
      <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}><PickerField label="Assignment status" value={status} options={STATUS} onChange={(v) => { setStatus(v); setPage(1); }} /></View>
        <View style={{ flex: 1 }}><PickerField label="Sort" value={sort} options={SORT} onChange={(v) => { setSort(v); setPage(1); }} /></View>
      </Row>
    </View></Enter>
    <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !d ? <Loading /> : d ? (items.length ? <>
      {items.map((m, i) => <MotionCard key={m.id} index={2 + i}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${m.name}`} onPress={() => router.push(`/coach/clients/${m.id}`)}><Card>
        <Row style={{ flexWrap: 'nowrap', gap: space.md }}>
          <Avatar name={m.name} size={36} />
          <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.name}>{m.name}</Text><Muted>{`${m.memberCode ?? '—'}${m.age ? ` · ${m.age}` : ''}${m.city ? ` · ${m.city}` : ''}`}</Muted></View>
        </Row>
        <View style={styles.grid}>
          <Line label="Package">{m.programme ? <><Text style={styles.value}>{m.programme.packageName}</Text><Row style={styles.endRow}><End><StatusPill status={m.programme.status} /></End><Small style={styles.right}>{`${fmtDate(m.programme.startAt)} → ${fmtDate(m.programme.endAt)}`}</Small></Row></> : <Muted>No package</Muted>}{m.assignment?.status !== 'active' ? <End><StatusPill status={m.assignment?.status} /></End> : null}</Line>
          <Line label="Progress">{m.progress?.hasPlan ? <><ProgressBar pct={m.progress.completionPct} style={{ width: 120, marginTop: 4, marginBottom: 4 }} /><Small style={styles.right}>{`${m.progress.completionPct ?? 0}% of due · ${m.progress.tasksPending} pending${m.progress.tasksOverdue ? ` · ${m.progress.tasksOverdue} overdue` : ''}`}</Small></> : <Muted>No plan yet</Muted>}</Line>
          <Line label="Next">{m.nextAppointmentAt ? <Text style={styles.value}>{fmtDateTime(m.nextAppointmentAt)}</Text> : <Muted>None booked</Muted>}</Line>
          <Line label="Last check-in">{m.lastCheckInAt ? <Text style={styles.value}>{relative(m.lastCheckInAt)}</Text> : <Muted>Never</Muted>}</Line>
          <Line label="Bloodwork">{m.bloodworkStatus ? <End><StatusPill status={m.bloodworkStatus} /></End> : <Muted>{m.healthShared === false ? 'not shared' : '—'}</Muted>}{m.reportsToReview ? <Small>{`${m.reportsToReview} to review`}</Small> : null}</Line>
          <Line label="Engagement"><End><StatusPill status={ENGAGEMENT_TONE[m.engagement] ?? 'draft'}>{m.engagement === 'active' ? 'Active this week' : m.engagement === 'quiet' ? 'Quiet' : 'New'}</StatusPill></End>{!m.onboardingCompleted ? <Muted>onboarding</Muted> : null}</Line>
        </View>
      </Card></Pressable></MotionCard>)}
      <Row between>
        <Muted>{`${d.total} client${d.total === 1 ? '' : 's'} · page ${d.page} of ${pages}`}</Muted>
        <Row style={{ flexWrap: 'nowrap' }}><Button title="Previous" small variant="ghost" disabled={page <= 1} onPress={() => setPage(page - 1)} /><Button title="Next" small variant="ghost" disabled={page >= pages} onPress={() => setPage(page + 1)} /></Row>
      </Row>
    </> : <Card><Empty title={q ? 'No client matches' : status === 'ended' ? 'No ended assignments' : 'No clients assigned yet'} body={q ? 'Try another name or member ID.' : 'Members appear here once Bioptime assigns them to you.'} /></Card>) : null}
    <Muted>Progress is the share of due plan tasks marked done; engagement is whether the member logged, messaged or ticked a task in the last seven days. Neither is a health outcome.</Muted>
  </Screen>;
}

/** A pill keeps its own alignSelf: 'flex-start'; this wrapper puts it at the right edge with the text values. */
function End({ children }: { children: React.ReactNode }) { return <View style={styles.end}>{children}</View>; }

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.line}><Text style={styles.eyebrow}>{label}</Text><View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end', gap: 2 }}>{children}</View></View>;
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  grid: { gap: 2, marginTop: space.xs },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  eyebrow: { color: colors.muted, fontSize: font.tiny, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '600', paddingTop: 3, width: 118 },
  value: { color: colors.text, fontSize: font.small, textAlign: 'right' },
  right: { textAlign: 'right' },
  end: { alignSelf: 'flex-end', maxWidth: '100%' },
  endRow: { justifyContent: 'flex-end', alignSelf: 'flex-end' },
});
