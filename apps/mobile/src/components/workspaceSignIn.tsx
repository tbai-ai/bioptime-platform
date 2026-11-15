/* The coach and administrator sign-in form (the portal's pages/auth/Logins.tsx, coach and admin variants): email and
   password, then, when the server asks for it (MFA_REQUIRED), the authenticator code. The workspace travels with the
   credentials (POST /auth/login), so a member or a coach on the wrong screen is told where to go (WRONG_WORKSPACE)
   instead of being let in. In demo mode only, the server names a preview helper in its "code needed" answer, so the page can fill in the current
   code of a seeded administrator; nothing about that helper is hard-coded here.
   In the open preview (components/openPreview) nobody signs in here: the screen opens its workspace's session itself
   and goes to that workspace; when that fails it shows the reason and one "Open Bioptime" button, never the form.
   Motion (additive, from '@/motion'): the brand mark with motes above, the parts entering with depth. */
import { Link, Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { ApiError, get, PREVIEW_GATE } from '../lib/api';
import { isEmailRefusal, looksLikeEmail, NOT_AN_EMAIL, useAuth, WORKSPACE_HOME, WORKSPACE_SIGN_IN, type Workspace } from '../lib/auth';
import { apiBaseSync, SERVER_OVERRIDE_ALLOWED } from '../lib/config';
import { Button, Eyebrow, Field, Input, Notice, P, Screen, Title } from './ui';
import { colors, space } from '../theme';
import { BrandMark3D, BrandStage, Enter, Motes } from '../motion';
import { ServerNotice } from './serverNotice';
import { OpeningPreview, PreviewDoorScreen, usePreviewDoor } from './openPreview';

const MARK = 56;
const COPY: Record<'coach' | 'admin', { eyebrow: string; title: string; lead: string; cta: string }> = {
  coach: { eyebrow: 'Coaches', title: 'Coach workspace', lead: 'Your clients, their plans, reports to review and the consultations on your calendar.', cta: 'Sign in to the workspace' },
  admin: { eyebrow: 'Administration', title: 'Administrative portal', lead: 'Packages, assignments, content, integrations and the audit trail. A second factor is required.', cta: 'Continue' },
};

/** WRONG_WORKSPACE: where that account signs in instead, with links to those screens. */
function WrongWorkspace({ here }: { here: Workspace }) {
  const router = useRouter();
  const go = (ws: Workspace) => router.replace(WORKSPACE_SIGN_IN[ws]);
  const link = (ws: Workspace, text: string) => <Text style={{ color: colors.accentText }} onPress={() => go(ws)}>{text}</Text>;
  return <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
    That account does not sign in here.{' '}
    {here === 'coach' ? <>Members use the {link('member', 'member sign-in')}; administrators the {link('admin', 'administrative portal')}.</> : <>Members use the {link('member', 'member sign-in')}; coaches the {link('coach', 'coach workspace')}.</>}
  </Text>;
}

export function WorkspaceSignIn({ workspace }: { workspace: 'coach' | 'admin' }) {
  const c = COPY[workspace];
  const { signIn, config, sessionEnded } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfa, setMfa] = useState('');
  const [needMfa, setNeedMfa] = useState(false);
  const [err, setErr] = useState<React.ReactNode>(null);
  const [busy, setBusy] = useState(false);
  // where the server names its preview helper in the "code needed" answer (demo mode only): the current code of a seeded
  // administrator, so the screen can fill it in; nothing about that helper lives in the app
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const door = usePreviewDoor(workspace);

  const go = async () => {
    setErr(null);
    if (!looksLikeEmail(email)) { setErr(NOT_AN_EMAIL); return; }
    setBusy(true);
    try { await signIn(email.trim(), password, workspace, needMfa && mfa.trim() ? mfa.trim() : undefined); router.replace(WORKSPACE_HOME[workspace]); }
    catch (e) {
      if (e instanceof ApiError && e.code === PREVIEW_GATE) setErr(e.message);
      else if (e instanceof ApiError && e.code === 'MFA_REQUIRED') {
        const hint = (e.details as { previewCodePath?: unknown } | null)?.previewCodePath;
        setPreviewPath(typeof hint === 'string' && /^\/auth\/[\w/-]+$/.test(hint) ? hint : null);
        setNeedMfa(true); setErr(null);
      }
      else if (e instanceof ApiError && e.code === 'WRONG_WORKSPACE') setErr(<WrongWorkspace here={workspace} />);
      else if (e instanceof ApiError && e.code === 'RATE_LIMITED') setErr('Too many attempts. Wait a few minutes and try again; the account is protected, not lost.');
      else if (e instanceof ApiError && e.code === 'ACCOUNT_SUSPENDED') setErr(`This account is suspended. Contact support${config?.supportEmail ? ` at ${config.supportEmail}` : ''}.`);
      else if (e instanceof ApiError && e.code === 'INVITATION_PENDING') setErr('Finish setting up from your invitation link first. If it expired, ask an administrator for a new one.');
      else if (e instanceof ApiError && e.code === 'MFA_INVALID') setErr('That code was not accepted. Use the current six digits from your authenticator; wrong codes count toward the lockout.');
      else if (e instanceof ApiError && e.status === 401) setErr('Check the email and password. You can reset the password below.');
      else if (e instanceof ApiError && e.offline) setErr('The Bioptime service could not be reached. Check your connection' + (SERVER_OVERRIDE_ALLOWED ? ', or change the server address below.' : '.'));
      else if (isEmailRefusal(e)) setErr(NOT_AN_EMAIL);
      else setErr(e instanceof Error ? e.message : 'Sign-in failed');
    } finally { setBusy(false); }
  };
  const fillPreviewCode = async () => {
    if (!previewPath) return;
    try { const r = await get<{ code: string }>(`${previewPath}?email=${encodeURIComponent(email.trim().toLowerCase())}`); setMfa(r.code); setErr(null); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'The preview code could not be fetched'); }
  };
  const openWeb = (path: string) => Linking.openURL(`${apiBaseSync()}${path}`).catch(() => {});

  if (door.home) return <Redirect href={door.home} />;
  if (door.opening) return <OpeningPreview announce={door.announce} />;
  if (door.failed) return <PreviewDoorScreen door={door} />;
  return <Screen>
    <BrandStage><View style={{ alignItems: 'center', paddingTop: space.xl, marginBottom: space.md }}>
      <Motes count={12} style={{ top: 0, left: 0, right: 0, height: space.xl + MARK + space.sm }} />
      <BrandMark3D source={require('@/assets/images/splash-icon.png')} size={MARK} radius={14} accessibilityLabel="Bioptime" />
    </View></BrandStage>
    <Enter index={1} delay={200}><View><Eyebrow>{c.eyebrow}</Eyebrow><Title sub={c.lead}>{c.title}</Title></View></Enter>
    {sessionEnded ? <Notice kind="warning" title="Your session ended">Sign in again to continue. Sessions end a set time after sign-in, when you sign out elsewhere, or when the account is suspended.</Notice> : null}
    <ServerNotice />
    <Enter index={2} delay={200}><Field label="Email"><Input value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" editable={!needMfa} /></Field></Enter>
    <Enter index={3} delay={200}><Field label="Password"><Input value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={go} editable={!needMfa} /></Field></Enter>
    {needMfa ? <Field label="Authenticator code" hint="Six digits from your authenticator app. Wrong codes count toward the lockout."><Input value={mfa} onChangeText={(v) => setMfa(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} autoFocus onSubmitEditing={go} /></Field> : null}
    {needMfa && previewPath ? <Button title="Fill in the preview code" variant="ghost" small onPress={fillPreviewCode} style={{ alignSelf: 'flex-start' }} /> : null}
    {err ? <Notice kind="error">{typeof err === 'string' ? err : <View>{err}</View>}</Notice> : null}
    <Enter index={4} delay={200}><Button title={needMfa ? 'Verify and sign in' : c.cta} onPress={go} busy={busy} disabled={!email || !password || (needMfa && mfa.length !== 6)} /></Enter>
    {needMfa ? <Button title="Start again" variant="ghost" small onPress={() => { setNeedMfa(false); setMfa(''); setPreviewPath(null); setErr(null); }} style={{ alignSelf: 'flex-start' }} /> : null}
    <Enter index={5} delay={200}><View style={{ gap: space.sm, marginTop: space.md }}>
      <Link href="/(auth)/forgot" style={{ color: colors.accentText }}>Forgotten your password?</Link>
      {workspace === 'coach'
        ? <P muted small>Coach accounts are created by invitation. Received one? <Text style={{ color: colors.accentText }} onPress={() => openWeb('/login/coach/activate')}>Activate your workspace</Text> with the link’s code; it opens on the web. MFA is optional for coaches and can be turned on in Settings.</P>
        : <P muted small>Administrators are provisioned by an owner. Administrator sessions end after 12 hours. Every sign-in and every change is in the audit log.</P>}
      <Link href="/(auth)/choose" replace style={{ color: colors.accentText }}>Not you? Choose another sign-in</Link>
      {SERVER_OVERRIDE_ALLOWED ? <Link href="/settings/server" style={{ color: colors.muted, marginTop: space.md }}>Change the server address (testers)</Link> : null}
    </View></Enter>
  </Screen>;
}
