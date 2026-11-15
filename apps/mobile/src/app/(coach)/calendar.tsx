/* Coach › Calendar (the portal's /coach/calendar and /coach/appointments, pages/Appointments.tsx, page title
   "Appointments"): GET /coach/appointments?range= with Upcoming, Past and All, one card per appointment with the
   portal's columns and actions (Confirm, Complete, Move, Cancel, No-show), and, while the 'sessions' flag is on, the
   join-link and summary sheets (components/coach/sessionTools) plus GET /coach/consultation-follow-through to tell
   which completed consultations have a summary. The toast floats over the bottom of the screen (ToastFloat, outside
   the scroll view), so a Confirm or No-show pressed on a card far down the list is seen; the Cancel sheet is the
   portal's ReasonDialog wording (components/adminA/ReasonSheet: "Keep as is", "Reason (recorded in the audit log)"). */
import { Tabs, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDateTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, ErrorBox, Loading, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { SegmentTabs } from '@/components/workspace';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { notifyBadges } from '@/components/workspaceShell';
import { Enter, MotionCard } from '@/motion';
import { CoachBell } from '@/components/coach/bell';
import { CompleteDialog, MoveDialog } from '@/components/coach/dialogs';
import { MeetingDialog, SummaryDialog, safeLink, type Appointment } from '@/components/coach/sessionTools';
import { Bold, LinkText, Muted, Small, StatusPill, ToastFloat, useToast } from '@/components/coach/shared';
import { space } from '@/theme';

const RANGES = [{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' }];

export default function CoachCalendar() {
  const router = useRouter();
  const [range, setRange] = useState('upcoming');
  const list = useLoad<any>(`coach-appointments-${range}`, () => get(`/coach/appointments?range=${range}`), [range]);
  const sessionsOn = !!useFeatures(true)?.has('sessions');
  const followThrough = useLoad<any>(sessionsOn ? 'coach-follow-through' : null, () => (sessionsOn ? get('/coach/consultation-follow-through') : Promise.resolve(null)), [sessionsOn, range]);
  const summarised = new Set(((followThrough.data?.items ?? []) as any[]).filter((x) => x.hasSummary).map((x) => x.appointmentId as string));
  const { toast, show } = useToast();
  const [cancel, setCancel] = useState<any>(null);
  const [complete, setComplete] = useState<any>(null);
  const [move, setMove] = useState<any>(null);
  const [meeting, setMeeting] = useState<Appointment | null>(null);
  const [summary, setSummary] = useState<Appointment | null>(null);
  const items: any[] = list.data?.items ?? [];
  const done = (msg: string) => { show(msg); void list.reload(); notifyBadges(); };
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); done(msg); } catch (e) { show(errorText(e), 'error'); } };
  return <View style={{ flex: 1 }}><Screen refreshing={list.loading} onRefresh={list.reload} depth>
    <Tabs.Screen options={{ headerRight: () => <CoachBell /> }} />
    <Enter><Title sub="Requested appointments need your confirmation; completed consultations consume the member's entitlement.">Appointments</Title></Enter>
    <SegmentTabs items={RANGES} value={range} onChange={setRange} style={{ marginHorizontal: -space.lg }} />
    <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Loading /> : list.data ? (items.length ? items.map((a, i) => {
      const openish = a.status === 'scheduled' || a.status === 'requested';
      return <MotionCard key={a.id} index={1 + i} pressable={false}><Card>
        <Row between style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Bold>{fmtDateTime(a.startAt)}</Bold>
            {sessionsOn && openish ? <LinkText small onPress={() => setMeeting(a)}>{safeLink(a.meetingLink) ? 'Edit join link' : 'Add how to join'}</LinkText> : a.status === 'scheduled' && safeLink(a.meetingLink) ? <Muted>Join link added</Muted> : null}
          </View>
          <StatusPill status={a.status} />
        </Row>
        <LinkText onPress={() => router.push(`/coach/clients/${a.memberId}`)}>{a.memberName ?? 'Member'}</LinkText>
        <Small>{`${label(a.kind)}${a.consumesEntitlement ? ' · uses entitlement' : ''}`}</Small>
        {a.memberNote ?? a.note ? <Small>{a.memberNote ?? a.note}</Small> : null}
        <Row>
          {a.status === 'requested' ? <Button title="Confirm" small onPress={() => { void act(() => post(`/coach/appointments/${a.id}/confirm`), 'Confirmed'); }} /> : null}
          {a.status === 'scheduled' ? <Button title="Complete" small variant="secondary" onPress={() => setComplete(a)} /> : null}
          {openish ? <Button title="Move" small variant="ghost" onPress={() => setMove(a)} /> : null}
          {openish ? <Button title="Cancel" small variant="danger" onPress={() => setCancel(a)} /> : null}
          {a.status === 'scheduled' ? <Button title="No-show" small variant="ghost" onPress={() => { void act(() => post(`/coach/appointments/${a.id}/no-show`), 'Marked no-show'); }} /> : null}
          {sessionsOn && a.status === 'completed' ? <Button title={summarised.has(a.id) ? 'Summary' : 'Write summary'} small variant={summarised.has(a.id) ? 'ghost' : 'secondary'} onPress={() => setSummary(a)} /> : null}
        </Row>
      </Card></MotionCard>;
    }) : <Card><Empty title="No appointments" body={range === 'upcoming' ? "Schedule one from a client's page." : undefined} /></Card>) : null}
    <ReasonSheet open={!!cancel} onClose={() => setCancel(null)} title="Cancel this appointment?" destructive confirmLabel="Cancel appointment" body="The member is notified and any reserved consultation is given back."
      onConfirm={async (reason) => { if (!cancel) return; await post(`/coach/appointments/${cancel.id}/cancel`, { reason }); done('Cancelled'); }} />
    <CompleteDialog a={complete} onClose={() => setComplete(null)} onDone={() => done('Completed')} />
    <MoveDialog a={move} onClose={() => setMove(null)} onDone={() => done('Moved')} />
    {sessionsOn ? <MeetingDialog appointment={meeting} onClose={() => setMeeting(null)} onSaved={() => done('Join details saved')} /> : null}
    {sessionsOn ? <SummaryDialog appointment={summary} onClose={() => setSummary(null)} onSaved={() => { show('Summary sent to the member'); void followThrough.reload(); notifyBadges(); }} /> : null}
  </Screen><ToastFloat toast={toast} /></View>;
}
