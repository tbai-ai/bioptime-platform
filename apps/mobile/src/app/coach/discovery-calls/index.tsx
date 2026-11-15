/* Coach › Discovery calls (the web's /coach/discovery-calls, modules/growth/CoachDiscoveryCalls.tsx): the calls the
   team assigned to this coach. The coach sees the name, the stated goals, the preferred times and the status; never
   the email address or the phone number (the team arranges the time and shares how to join). Read only; shown while
   the 'growth' flag is on. */
import { Stack } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { get } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Card, Empty, ErrorBox, Eyebrow, H2, Loading, P, Pill, Row, StaleBanner } from '@/components/ui';
import { NotificationBell, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { ModuleGate, istLabel } from '@/components/coachModules/shared';
import { MotionCard } from '@/motion';
import { colors, font, space } from '@/theme';

type Slot = { id: string; startAt: string; endAt: string; label: string; withdrawn?: boolean };
type Call = { id: string; reference: string; name: string; goals: string; preferredSlots: Slot[]; preferredWindows: string | null; interests: string[]; status: string; bookedAt: string | null; createdAt: string };
const PILL: Record<string, [string, 'warning' | 'info' | 'success']> = { new: ['New', 'warning'], contacted: ['Contacted', 'warning'], booked: ['Booked', 'success'], closed: ['Closed', 'info'] };

export default function CoachDiscoveryCalls() {
  const features = useFeatures(true);
  const on = !!features?.has('growth');
  const list = useLoad<{ items: Call[] }>(on ? 'coach-discovery-calls' : null, () => (on ? get('/coach/growth/discovery-calls') : Promise.resolve({ items: [] })), [on]);
  const items = list.data?.items ?? [];
  return <RoleGate workspace="coach">
    <Stack.Screen options={{ title: 'Discovery calls', headerRight: () => <NotificationBell /> }} />
    <WorkspaceScreen workspace="coach" title="Discovery calls" sub="Short calls with people thinking about Bioptime, assigned to you by the team. The team agrees the time with them and tells you how to join; their contact details stay with the team." refreshing={on && list.loading} onRefresh={list.reload}>
      <ModuleGate features={features} module="growth">
        <StaleBanner at={list.stale} />
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? <Loading /> : items.length ? items.map((c, i) => <MotionCard key={c.id} index={i} pressable={false}><Card>
          <Eyebrow>{c.reference}</Eyebrow>
          <Row between><H2>{c.name}</H2><Pill tone={(PILL[c.status] ?? [c.status, 'info'])[1]}>{(PILL[c.status] ?? [c.status, 'info'])[0]}</Pill></Row>
          <P>{c.goals}</P>
          {c.status === 'booked' && c.bookedAt ? <P small><Text style={{ fontWeight: '700' }}>Agreed time:</Text>{` ${istLabel(c.bookedAt)} IST`}</P> : <View style={{ gap: space.xs }}>
            <Text style={{ color: colors.text, fontSize: font.small, fontWeight: '700' }}>Times they suggested</Text>
            {!c.preferredSlots.length && !c.preferredWindows ? <Text style={{ color: colors.muted, fontSize: font.small }}>None given</Text> : <>
              {c.preferredSlots.map((s) => <Text key={s.id} style={{ color: colors.text, fontSize: font.small }}>{`• ${s.label}${s.withdrawn ? ' · no longer offered' : ''}`}</Text>)}
              {c.preferredWindows ? <Text style={{ color: colors.text, fontSize: font.small }}>{`• “${c.preferredWindows}”`}</Text> : null}
            </>}
          </View>}
          <P muted small>{`Asked ${fmtDateTime(c.createdAt)}`}</P>
        </Card></MotionCard>) : list.data ? <Card><Empty title="None assigned to you" body="When the team assigns you a discovery call, it appears here." /></Card> : null}
      </ModuleGate>
    </WorkspaceScreen>
  </RoleGate>;
}
