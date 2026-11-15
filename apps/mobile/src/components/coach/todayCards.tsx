/* The five cards the modules add to the coach's Today (the portal's useModuleCards('coachToday'), registry order:
   progress, support, workouts, labFollowups, sessions), each shown only while its flag is on and each loading its own
   endpoint with the portal's wording (modules/progress/CheckinReview.tsx, modules/support/CoachOnboarding.tsx,
   modules/workouts/Cards.tsx, modules/labFollowups/CoachTodayCard.tsx, modules/sessions/Cards.tsx). */
import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { get } from '@/lib/api';
import { fmtDate, label, relative } from '@/lib/format';
import { fmtDay } from '@/lib/coach/core/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, ErrorBox, Loading, Pill, Row } from '@/components/ui';
import { CardHead, LinkText, Muted, Small, Bold, TimelineItem } from './shared';
import { space } from '@/theme';

/** `refresh`: Today raises it when it is pulled to refresh or comes back into view, and each card then loads again (the
 *  portal loads every card each time Today is opened). */
type Refresh = { refresh?: number };

type Checkin = { id: string; memberId: string; memberName: string; title: string; dueDate: string; submittedAt: string; healthShared: boolean };

export function CheckinsToReviewCard({ refresh = 0 }: Refresh = {}) {
  const router = useRouter();
  const d = useLoad<{ items: Checkin[] }>('coach.today.checkins', () => get('/coach/checkins?status=submitted'), [refresh]);
  const items = d.data?.items ?? [];
  return <Card>
    <CardHead eyebrow="Needs you" title="Check-ins to review" />
    <ErrorBox error={d.error} onRetry={d.reload} />
    {d.loading && !d.data ? <Loading /> : items.length ? items.slice(0, 8).map((c) => <Row key={c.id} between style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}><LinkText onPress={() => router.push(`/coach/clients/${c.memberId}?tab=goals`)}>{c.memberName}</LinkText><Small>{`${c.title} · sent ${relative(c.submittedAt)}${c.healthShared ? '' : ' · health records not shared'}`}</Small></View>
      <Button title={c.healthShared ? 'Review' : 'Open'} small variant="secondary" onPress={() => router.push(`/coach/clients/${c.memberId}?tab=goals`)} />
    </Row>) : d.data ? <Empty title="Nothing to review" body="Check-ins your clients send appear here." /> : null}
  </Card>;
}

type Onboarding = { items: Array<{ key: string; label: string; detail: string; done: boolean; href: string | null }>; done: number; total: number; complete: boolean; training: { available: true; total: number; completed: number } | { available: false; note: string } };
const HREF: Record<string, string> = { '/profile': '/coach/profile', '/settings': '/coach/settings', '/training': '/coach/training' };

export function CoachOnboardingCard({ compact = true, refresh = 0 }: { compact?: boolean } & Refresh) {
  const router = useRouter();
  const d = useLoad<Onboarding>('coach.today.onboarding', () => get('/coach/onboarding'), [refresh]);
  const o = d.data;
  return <Card accent={!!o && !o.complete}>
    <CardHead eyebrow="Onboarding" title={o ? (o.complete ? 'You are set up' : `${o.done} of ${o.total} done`) : 'Your checklist'} right={o ? <Pill tone={o.complete ? 'success' : 'warning'}>{o.complete ? 'Complete' : 'To do'}</Pill> : undefined} />
    <ErrorBox error={d.error} onRetry={d.reload} />
    {d.loading && !o ? <Loading /> : o ? <>
      {o.items.map((it) => <Row key={it.key} between style={styles.row}>
        <View style={{ flex: 1, minWidth: 0 }}><Bold>{it.label}</Bold>{!compact || !it.done ? <Small>{it.detail}</Small> : null}</View>
        <Row style={{ flexWrap: 'nowrap' }}>{!it.done && it.href ? <Button title="Open" small variant="secondary" onPress={() => { const h = it.href ?? ''; router.push(HREF[h] ?? `/coach${h}`); }} /> : null}<Pill tone={it.done ? 'success' : 'warning'}>{it.done ? 'Done' : 'To do'}</Pill></Row>
      </Row>)}
      {!o.training.available ? <Muted>{o.training.note}</Muted> : null}
    </> : null}
  </Card>;
}

type RecentWorkout = { id: string; memberId: string; memberName: string; title: string; scheduledDate: string; status: string; healthShared: boolean };

export function WorkoutsReviewCard({ refresh = 0 }: Refresh = {}) {
  const router = useRouter();
  const d = useLoad<{ items: RecentWorkout[] }>('coach.today.workouts', () => get('/coach/workouts/recent'), [refresh]);
  const items = d.data?.items ?? [];
  return <Card>
    <CardHead eyebrow="Workouts" title="Logged this week, awaiting feedback" />
    <ErrorBox error={d.error} onRetry={d.reload} />
    {d.loading && !d.data ? <Loading /> : items.length ? items.slice(0, 6).map((w) => <Row key={w.id} between style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}><Bold>{w.memberName}</Bold><Small>{`${w.title} · ${fmtDay(w.scheduledDate)} · ${w.status === 'partial' ? 'partly done' : label(w.status)}${w.healthShared ? '' : ' · health records not shared'}`}</Small></View>
      <Button title={w.healthShared ? 'Review' : 'Open'} small variant="secondary" onPress={() => router.push(`/coach/clients/${w.memberId}?tab=workouts`)} />
    </Row>) : d.data ? <Empty title="All caught up" /> : null}
  </Card>;
}

type FollowUp = { id: string; memberId: string; memberName?: string; kindLabel: string; note: string; dueDate: string | null; overdue: boolean; status: string };

export function LabNextStepsCard({ refresh = 0 }: Refresh = {}) {
  const router = useRouter();
  const d = useLoad<{ items: FollowUp[] }>('coach.today.labFollowUps', () => get('/coach/lab-follow-ups'), [refresh]);
  const items = (d.data?.items ?? []).slice().sort((a, b) => Number(b.overdue) - Number(a.overdue) || String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')));
  const overdue = items.filter((f) => f.overdue).length;
  return <Card>
    <CardHead eyebrow="Lab next steps" title={d.data ? (items.length ? `${items.length} open${overdue ? ` · ${overdue} past due` : ''}` : 'Nothing open') : 'Open next steps'} />
    <ErrorBox error={d.error} onRetry={d.reload} />
    {d.loading && !d.data ? <Loading /> : items.length ? items.slice(0, 6).map((f) => <View key={f.id} style={[styles.row, { gap: 2 }]}>
      <Row between><Bold style={{ flex: 1 }}>{`${f.kindLabel} · ${f.note}`}</Bold>{f.overdue ? <Pill tone="warning">Past due</Pill> : null}</Row>
      <LinkText muted small onPress={() => router.push(`/coach/clients/${f.memberId}?tab=lab-follow-ups`)}>{`${f.memberName ?? 'Client'}${f.dueDate ? ` · due ${fmtDay(f.dueDate)}` : ''}`}</LinkText>
    </View>) : d.data ? <Muted>Next steps you add to reviewed reports appear here until they are done.</Muted> : null}
  </Card>;
}

type FollowThrough = { appointmentId: string; memberId: string; memberName: string; kind: string; startAt: string; hasSummary: boolean; openFollowUps: number };

export function SessionsFollowThroughCard({ refresh = 0 }: Refresh = {}) {
  const router = useRouter();
  const d = useLoad<{ items: FollowThrough[] }>('coach.today.followThrough', () => get('/coach/consultation-follow-through'), [refresh]);
  const items = d.data?.items ?? [];
  const toWrite = items.filter((x) => !x.hasSummary);
  const open = items.reduce((n, x) => n + (x.openFollowUps ?? 0), 0);
  return <Card>
    <CardHead eyebrow="Consultations" title="Summaries to write" right={<Button title="Appointments" small variant="ghost" onPress={() => router.push('/(coach)/calendar')} />} />
    <ErrorBox error={d.error} onRetry={d.reload} />
    {d.loading && !d.data ? <Loading /> : toWrite.length ? toWrite.slice(0, 5).map((x) => <TimelineItem key={x.appointmentId} title={x.memberName} meta={`${label(x.kind)} on ${fmtDate(x.startAt)}`} />) : d.data ? <Empty title="All written" body="Completed consultations in the last 90 days all have their summary." /> : null}
    {open ? <Muted>{`${open} follow-up${open === 1 ? '' : 's'} from consultations still open.`}</Muted> : null}
  </Card>;
}

const styles = { row: { paddingVertical: space.sm, alignItems: 'flex-start' as const, flexWrap: 'nowrap' as const } };
