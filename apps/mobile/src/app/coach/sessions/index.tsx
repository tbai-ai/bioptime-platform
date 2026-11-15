/* Coach › Live sessions (the web's /coach/sessions, modules/sessions/HostSessions.tsx coach mode): the group classes,
   webinars and workshops the coach hosts, upcoming, past or all; a new session starts as a draft until it is
   published. Shown while the 'sessions' flag is on. Coach endpoints only. */
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { get, qs } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, ErrorBox, Loading, Notice, StaleBanner } from '@/components/ui';
import { RecordList, RecordRow, SegmentTabs } from '@/components/workspace';
import { NotificationBell, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { ModuleGate, fmtSpan } from '@/components/coachModules/shared';
import { AUDIENCE_SHORT, SessionForm, placesText, type Session } from '@/components/coachModules/sessions';
import { Enter } from '@/motion';

type Range = 'upcoming' | 'past' | 'all';

export default function CoachSessions() {
  const features = useFeatures(true);
  const router = useRouter();
  const [range, setRange] = useState<Range>('upcoming');
  const [creating, setCreating] = useState(false);
  const on = !!features?.has('sessions');
  const list = useLoad<{ items: Session[] }>(on ? `coach-sessions-${range}` : null, () => (on ? get(`/coach/sessions${qs({ range })}`) : Promise.resolve({ items: [] })), [range, on]);
  const items = list.data?.items ?? [];
  return <RoleGate workspace="coach">
    <Stack.Screen options={{ title: 'Live sessions', headerRight: () => <NotificationBell /> }} />
    <WorkspaceScreen workspace="coach" title="Live sessions" sub="The group classes, webinars and workshops you host. Members in the audience register; when a session is full they join its waitlist." refreshing={on && list.loading} onRefresh={list.reload}>
      <ModuleGate features={features} module="sessions">
        <Enter><Button title="New session" onPress={() => setCreating(true)} /></Enter>
        <Notice kind="info" title="Video meetings: pending configuration">No video provider is connected, so no meeting is created for a session. Add the https link you will use, or members read that the host will share how to join.</Notice>
        <SegmentTabs items={[{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }, { id: 'all', label: 'All' }]} value={range} onChange={(id) => setRange(id as Range)} />
        <StaleBanner at={list.stale} />
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? <Loading /> : items.length ? <Enter index={1}><RecordList title="Live sessions">
          {items.map((s) => <RecordRow key={s.id} title={s.title} meta={`${fmtSpan(s.startAt, s.endAt)} · ${s.kindLabel} · ${AUDIENCE_SHORT[s.audience] ?? label(s.audience)}${s.packages?.length ? ` (${s.packages.map((p) => p.name).join(', ')})` : ''} · ${placesText(s)}`} onPress={() => router.push(`/coach/sessions/${s.id}`)}
            pills={[{ label: s.status === 'published' ? 'Open' : s.status === 'draft' ? 'Draft' : s.status === 'completed' ? 'Completed' : 'Cancelled', tone: s.status === 'published' || s.status === 'completed' ? 'success' : s.status === 'draft' ? 'warning' : 'info' }]} />)}
        </RecordList></Enter> : list.data ? <Card><Empty title={range === 'upcoming' ? 'Nothing scheduled' : 'Nothing here'} body={range === 'upcoming' ? 'Create a session; it stays a draft until you publish it.' : undefined} /></Card> : null}
        {/* the web's toast('Draft saved') follows the coach to the new session: the detail screen shows it (?saved=draft) */}
        <SessionForm open={creating} onClose={() => setCreating(false)} onSaved={(s) => { list.reload(); router.push(`/coach/sessions/${s.id}?saved=draft`); }} />
      </ModuleGate>
    </WorkspaceScreen>
  </RoleGate>;
}
