/* Coach › Today (the portal's /coach, pages/Home.tsx CoachHome): GET /coach/home once, for the hero, the identity card,
   the four queue readouts, the four core cards and the tab badges; then the five module cards (components/coach/
   todayCards) while their flags are on, and the operational note. Pull to refresh and coming back to Today load the
   home payload and every module card again, as the portal does each time Today is opened. Coach endpoints only: the API's field policy keeps
   members' contact details out, and so does this screen. */
import { Tabs, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { fmtDateTime, label, relative } from '@/lib/format';
import { actionLabel, plural } from '@/lib/coach/core/format';
import { useReloadOnFocus } from '@/lib/coach/core/focus';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, ErrorBox, Eyebrow, Loading, Screen, StaleBanner, Title } from '@/components/ui';
import { Enter, MotionCard } from '@/motion';
import { CoachBell } from '@/components/coach/bell';
import { CoachIdentity } from '@/components/coach/identity';
import { Bold, CardHead, LinkText, Muted, Readout, Small, StatusPill, TimelineItem, WarnPills } from '@/components/coach/shared';
import { CheckinsToReviewCard, CoachOnboardingCard, LabNextStepsCard, SessionsFollowThroughCard, WorkoutsReviewCard } from '@/components/coach/todayCards';
import { space } from '@/theme';
import { Row } from '@/components/ui';

export default function CoachToday() {
  const { user } = useAuth();
  const router = useRouter();
  const features = useFeatures(true);
  const on = (flag: string) => !!features?.has(flag);
  const home = useLoad<any>('coach-home', () => get('/coach/home'), []);
  const [cardsTick, setCardsTick] = useState(0);
  const reloadHome = home.reload;
  const reloadAll = useCallback(() => { void reloadHome(); setCardsTick((n) => n + 1); }, [reloadHome]);
  useReloadOnFocus(reloadAll);
  const d = home.data;
  const first = (d?.coach?.displayName ?? user?.name ?? '').split(' ')[0];
  const sub = d ? `${plural(d.activeClients, 'active client')} · ${plural(d.todaysAppointments?.length, 'consultation')} today · ${plural(d.reportsToReview?.length, 'report')} to review · ${plural(d.unreadConversations?.length, 'unread thread')}` : undefined;
  const consultations: any[] = d ? [...(d.todaysAppointments ?? []), ...(d.upcomingAppointments ?? [])] : [];
  const plansToWrite = d ? new Set([...(d.draftPlans ?? []).map((p: any) => p.member_id), ...(d.clientsWithoutPlan ?? []).map((c: any) => c.id)]).size : 0;
  return <Screen refreshing={home.loading} onRefresh={reloadAll} depth>
    <Tabs.Screen options={{ headerRight: () => <CoachBell /> }} />
    <Enter><View><Eyebrow>Coach workspace</Eyebrow><Title sub={sub}>{first ? `Today, ${first}` : 'Today'}</Title></View></Enter>
    <StaleBanner at={home.stale} /><ErrorBox error={home.error} onRetry={home.reload} />
    {home.loading && !d ? <Loading /> : d ? <>
      <MotionCard index={1} pressable={false}><CoachIdentity coach={d.coach} upcoming={d.metrics?.upcomingConsultations} unread={d.unreadConversations?.length} /></MotionCard>
      <Enter index={2}><View style={{ gap: space.sm }}>
        <Row style={{ flexWrap: 'nowrap' }}><Readout eyebrow="Results to review" value={d.reportsToReview?.length ?? 0} hot={(d.reportsToReview?.length ?? 0) > 0} onPress={() => router.push('/coach/bloodwork')} /><Readout eyebrow="Consultation requests" value={d.requestedAppointments?.length ?? 0} onPress={() => router.push('/(coach)/calendar')} /></Row>
        <Row style={{ flexWrap: 'nowrap' }}><Readout eyebrow="Unread conversations" value={d.unreadConversations?.length ?? 0} onPress={() => router.push('/(coach)/messages')} /><Readout eyebrow="Plans to write or publish" value={plansToWrite} onPress={() => router.push('/(coach)/clients')} /></Row>
      </View></Enter>
      <MotionCard index={3} pressable={false}><Card>
        <CardHead eyebrow="Today and next" title="Consultations" right={<Button title="All" small variant="ghost" onPress={() => router.push('/(coach)/calendar')} />} />
        {consultations.length ? consultations.slice(0, 6).map((a: any) => <Row key={a.id} between style={styles.row}><View style={{ flex: 1, minWidth: 0 }}><Bold>{a.member_name}</Bold><Small>{`${fmtDateTime(a.start_at)} · ${label(a.kind)}`}</Small></View><StatusPill status={a.status} /></Row>) : <Empty title="No consultations scheduled" body="Book one from a client's page." />}
      </Card></MotionCard>
      <MotionCard index={4} pressable={false}><Card>
        <CardHead eyebrow="Needs you" title="Reports to review" right={<Button title="Queue" small variant="ghost" onPress={() => router.push('/coach/bloodwork')} />} />
        {d.reportsToReview?.length ? d.reportsToReview.map((r: any) => <Row key={r.id} between style={styles.row}>
          <View style={{ flex: 1, minWidth: 0 }}><LinkText onPress={() => router.push(`/coach/reports/${r.id}`)}>{r.member_name}</LinkText><Small>{`${r.test_name} · ${r.reference} · delivered ${relative(r.delivered_at)}`}</Small><WarnPills items={r.flagged} /></View>
          <Button title="Review" small onPress={() => router.push(`/coach/reports/${r.id}`)} />
        </Row>) : <Empty title="Nothing to review" body="New laboratory reports appear here." />}
      </Card></MotionCard>
      <MotionCard index={5} pressable={false}><Card>
        <CardHead eyebrow="Clients" title="Follow-ups and plans" />
        {(d.clientsWithoutPlan ?? []).map((c: any) => <Row key={c.id} between style={styles.row}><View style={{ flex: 1, minWidth: 0 }}><Bold>{c.name}</Bold><Small>has no published plan</Small></View><Button title="Write a plan" small variant="secondary" onPress={() => router.push(`/coach/clients/${c.id}?tab=plan`)} /></Row>)}
        {(d.draftPlans ?? []).map((p: any) => <Row key={p.id} between style={styles.row}><View style={{ flex: 1, minWidth: 0 }}><Bold>{p.member_name}</Bold><Small>{`draft: ${p.title}`}</Small></View><Button title="Open draft" small variant="secondary" onPress={() => router.push(`/coach/plans/${p.id}`)} /></Row>)}
        {(d.followUps ?? []).map((t: any) => <Row key={t.id} between style={styles.row}><View style={{ flex: 1, minWidth: 0 }}><Bold>{t.title}</Bold>{t.detail ? <Small>{t.detail}</Small> : null}</View><StatusPill status={t.status} /></Row>)}
        {!(d.clientsWithoutPlan ?? []).length && !(d.draftPlans ?? []).length && !(d.followUps ?? []).length ? <Empty title="All caught up" /> : null}
      </Card></MotionCard>
      <MotionCard index={6} pressable={false}><Card>
        <CardHead eyebrow="Recent" title="Activity" />
        {((d.recentActivity ?? []) as any[]).slice(0, 8).map((a, i) => <TimelineItem key={i} done title={`${actionLabel(a.action)}${a.reason ? ` · ${a.reason}` : ''}`} time={`${a.actor_name ?? 'system'} · ${relative(a.at)}`} />)}
      </Card></MotionCard>
      {on('progress') ? <MotionCard index={7} pressable={false}><CheckinsToReviewCard refresh={cardsTick} /></MotionCard> : null}
      {on('support') ? <MotionCard index={8} pressable={false}><CoachOnboardingCard refresh={cardsTick} /></MotionCard> : null}
      {on('workouts') ? <MotionCard index={9} pressable={false}><WorkoutsReviewCard refresh={cardsTick} /></MotionCard> : null}
      {on('labFollowups') ? <MotionCard index={10} pressable={false}><LabNextStepsCard refresh={cardsTick} /></MotionCard> : null}
      {on('sessions') ? <MotionCard index={11} pressable={false}><SessionsFollowThroughCard refresh={cardsTick} /></MotionCard> : null}
      <Muted small={false}>{d.metrics?.note ?? 'Operational counts only; these are not performance rankings.'}</Muted>
    </> : null}
  </Screen>;
}

const styles = { row: { paddingVertical: space.sm, alignItems: 'flex-start' as const, flexWrap: 'nowrap' as const } };
