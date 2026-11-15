/* The coach onboarding checklist (GET /coach/onboarding; the web's modules/support/CoachOnboarding.tsx): a card at the
   top of Help. Computed by the server from the coach's own profile, working hours and accepted policies, plus the
   coach training courses while the Learning module is on and has published some; otherwise a note says why training is
   not listed. `compact` hides the detail of done items (the Today card). `register` hands its reload to the screen's
   pull to refresh (Help). */
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Eyebrow, H2, Loading, Notice, P, Pill, Row } from '@/components/ui';
import { colors, font, space } from '@/theme';

type Item = { key: string; label: string; detail: string; done: boolean; href: string | null };
type Checklist = { items: Item[]; done: number; total: number; complete: boolean; training: { available: true; total: number; completed: number } | { available: false; note: string } };

/** The web's workspace-relative href ('/profile', '/settings', '/training') as this app's route. */
const route = (href: string) => (href.startsWith('/coach/') ? href : `/coach${href.startsWith('/') ? href : `/${href}`}`);

export function CoachOnboarding({ compact, register }: { compact?: boolean; register?: (key: string, reload: () => Promise<unknown>) => () => void }) {
  const router = useRouter();
  const r = useLoad<Checklist>('coach-onboarding', () => get('/coach/onboarding'), []);
  useEffect(() => register?.('onboarding', r.reload), [register, r.reload]);
  const d = r.data;
  return <Card accent={!!d && !d.complete}>
    <Eyebrow>Onboarding</Eyebrow>
    <Row between><H2>{d ? (d.complete ? 'You are set up' : `${d.done} of ${d.total} done`) : 'Your checklist'}</H2>{d ? <Pill tone={d.complete ? 'success' : 'warning'}>{d.complete ? 'Complete' : 'To do'}</Pill> : null}</Row>
    {r.error ? <Notice kind="error">{r.error.message}</Notice> : null}
    {!d && !r.error ? <Loading /> : null}
    {d ? d.items.map((i) => <View key={i.key} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs }}>
      <Row between><Text style={{ color: colors.text, fontSize: font.body, fontWeight: '600', flex: 1 }}>{i.label}</Text><Pill tone={i.done ? 'success' : 'warning'}>{i.done ? 'Done' : 'To do'}</Pill></Row>
      {!compact || !i.done ? <Text style={{ color: colors.muted, fontSize: font.small }}>{i.detail}</Text> : null}
      {!i.done && i.href ? <Button title="Open" variant="secondary" small onPress={() => router.push(route(i.href!))} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>) : null}
    {d && !d.training.available && d.training.note ? <P muted small>{d.training.note}</P> : null}
  </Card>;
}
