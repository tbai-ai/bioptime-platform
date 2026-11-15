/* The sign-in chooser: three doors, one Bioptime (the website's login page and the portal's three sign-in pages). A
   member, a coach and an administrator each have their own sign-in; the one chosen here is remembered on this device,
   so the next cold start opens it directly ("Not you? Choose another sign-in" leads back here). The server decides
   every outcome: the workspace sent with the credentials limits which roles may sign in through each screen.
   Motion (additive, from '@/motion'): the 3D brand mark with motes, as on the member sign-in; the cards enter with
   depth and respond to a press. */
import { Link, useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { homeFor, useAuth, WORKSPACE_SIGN_IN, type Workspace } from '@/lib/auth';
import { SERVER_OVERRIDE_ALLOWED } from '@/lib/config';
import { Button, Card, Eyebrow, H2, Notice, P, Screen, Title } from '@/components/ui';
import { colors, space } from '@/theme';
import { BrandMark3D, BrandStage, Enter, MotionCard, Motes } from '@/motion';
import { ServerNotice } from '@/components/serverNotice';

const MARK = 72;

const DOORS: Array<{ workspace: Workspace; eyebrow: string; title: string; lead: string; cta: string; note?: string }> = [
  { workspace: 'member', eyebrow: 'Members', title: 'Welcome back.', lead: 'Your programme, your coach, your blood tests and your progress, in one place.', cta: 'Sign in as a member' },
  { workspace: 'coach', eyebrow: 'Coaches', title: 'Coach workspace', lead: 'Your clients, their plans, reports to review and the consultations on your calendar.', cta: 'Sign in as a coach', note: 'Coach accounts are created by invitation.' },
  { workspace: 'admin', eyebrow: 'Administration', title: 'Administrative portal', lead: 'Packages, assignments, content, integrations and the audit trail. A second factor is required.', cta: 'Sign in as an administrator', note: 'Administrators are provisioned by an owner.' },
];

export default function Choose() {
  const { user, rememberWorkspace } = useAuth();
  const router = useRouter();
  const pick = (workspace: Workspace) => { void rememberWorkspace(workspace); router.push(WORKSPACE_SIGN_IN[workspace]); };
  return <Screen>
    <BrandStage><View style={{ alignItems: 'center', paddingTop: space.xxl, marginBottom: space.lg }}>
      {/* motes drift in the empty band around the mark, above the tagline; they draw behind the mark */}
      <Motes count={16} style={{ top: 0, left: 0, right: 0, height: space.xxl + MARK + space.sm }} />
      <BrandMark3D source={require('@/assets/images/splash-icon.png')} size={MARK} radius={18} accessibilityLabel="Bioptime" />
      <Enter delay={420} distance={8} depth={false}><Text style={{ color: colors.muted, fontSize: 11, letterSpacing: 2, marginTop: space.md }}>YOUR WELLNESS, OUR PASSION.</Text></Enter>
    </View></BrandStage>
    <Enter index={2} delay={240}><Title sub="Members, coaches and the Bioptime team each have their own sign-in. Pick yours; the right one for your account is the only one that will let you in.">Three doors, one Bioptime.</Title></Enter>
    {user ? <Notice kind="info" title={`Signed in as ${user.name}`}><Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>You are already signed in. Signing in as someone else replaces this session.</Text><Button title="Go to your workspace" variant="secondary" small onPress={() => router.replace(homeFor(user.role))} style={{ marginTop: space.sm, alignSelf: 'flex-start' }} /></Notice> : null}
    <ServerNotice />
    {DOORS.map((d, i) => <MotionCard key={d.workspace} index={3 + i} delay={240}><Card accent={d.workspace === 'member'}>
      <Eyebrow>{d.eyebrow}</Eyebrow>
      <H2>{d.title}</H2>
      <P muted>{d.lead}</P>
      <Button title={d.cta} variant={d.workspace === 'member' ? 'primary' : 'secondary'} onPress={() => pick(d.workspace)} style={{ marginTop: space.xs }} />
      {d.workspace === 'member' ? <P muted small>New to Bioptime? <Link href="/(auth)/register" onPress={() => { void rememberWorkspace('member'); }} style={{ color: colors.accentText }}>Create an account</Link>.</P> : <P muted small>{d.note}</P>}
    </Card></MotionCard>)}
    <Enter index={6} delay={240}><View style={{ gap: space.sm, marginTop: space.md }}>
      <P muted small>Bioptime offers general wellbeing guidance and coaching, not medical advice.</P>
      {SERVER_OVERRIDE_ALLOWED ? <Link href="/settings/server" style={{ color: colors.muted }}>Change the server address (testers)</Link> : null}
    </View></Enter>
  </Screen>;
}
