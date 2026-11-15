/* Coach › Coach AI (the web's /coach/ai, modules/ai/CoachAi.tsx): choose one of your clients (or none, for a general
   outline) and what to draft, add instructions, then review the drafts: edit, accept and copy, or discard. Nothing is
   ever sent to a client from here, and nothing is applied silently. While no AI provider is configured, the page shows
   exactly what is missing and every request is refused. Shown while the 'ai' flag is on. */
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { get } from '@/lib/api';
import { useFeatures } from '@/lib/features';
import { useLoad } from '@/lib/useLoad';
import { Card, Eyebrow, H2, P } from '@/components/ui';
import { NotificationBell, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { AiDraftPanel } from '@/components/coachModules/aiDraftPanel';
import { ModuleGate, PickerField } from '@/components/coachModules/shared';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

type Clients = { items: Array<{ id: string; name: string; memberCode: string | null }> };
const HOW = [
  'Drafts are never sent. You edit, accept and send them yourself.',
  'A draft about a client needs their Coach AI consent; health detail only while they also share health records with you.',
  'Phone, email, address, PIN code and date of birth are never taken from a client’s profile. Messages and your instructions are sent as written.',
  'The AI provider is asked not to give medical advice or state nutrient values. That is a request, not a guarantee: review every draft before anything reaches your client.',
];

export default function CoachAi() {
  const features = useFeatures(true);
  const on = !!features?.has('ai');
  const clients = useLoad<Clients>(on ? 'coach-clients-ai' : null, () => (on ? get('/coach/clients?limit=100&sort=name') : Promise.resolve({ items: [] })), [on]);
  const [memberId, setMemberId] = useState('');
  const [tick, setTick] = useState(0);
  return <RoleGate workspace="coach">
    <Stack.Screen options={{ title: 'Coach AI', headerRight: () => <NotificationBell /> }} />
    <WorkspaceScreen workspace="coach" title="Coach AI" sub="Drafts for you to read and edit. Nothing is sent to a client: you accept a draft and send it yourself." refreshing={on && clients.loading} onRefresh={() => { clients.reload(); setTick((n) => n + 1); }}>
      <ModuleGate features={features} module="ai">
        <Enter><Card>
          <PickerField label="Client" hint="Only your assigned clients. A draft about a client needs their Coach AI consent." value={memberId} placeholder="No client (a general outline from your instructions)" options={(clients.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.name}${c.memberCode ? ` · ${c.memberCode}` : ''}` }))} onChange={setMemberId} chipsUpTo={0} />
          {clients.error ? <P muted small>{clients.error.message}</P> : null}
        </Card></Enter>
        <Enter index={1}><Card><Eyebrow>How it works</Eyebrow><H2>You stay in charge</H2>
          <View style={{ gap: space.xs }}>{HOW.map((t) => <Text key={t} style={{ color: colors.text, fontSize: font.small, lineHeight: 19 }}>{`• ${t}`}</Text>)}</View>
        </Card></Enter>
        <AiDraftPanel key={`${memberId || 'general'}-${tick}`} memberId={memberId || null} />
      </ModuleGate>
    </WorkspaceScreen>
  </RoleGate>;
}
