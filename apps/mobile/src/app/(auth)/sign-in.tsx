/* The member sign-in (the portal's /login/client) in the earlier app's look (shots 08–10, r360/r820-03): the 2 px red
   hairline, the backdrop photo, the 64 pt tile with the Bioptime mark (the splash's mark flies into it), the BIOPTIME
   eyebrow, "Sign in" in Bebas 56, the red Email | Phone segment (Phone only while the switch phone_sign_in is on), the
   inputs and the red button with its glow, "Or continue with" Google and Apple where the server offers them
   (components/socialSignIn), "Create an account" and, for testers, the Server screen.
   The workspace 'member' travels with the credentials, so a coach or an administrator is told where their sign-in is
   (WRONG_WORKSPACE) instead of being let in; in the client app (STAFF_APP off) that names the website addresses as
   plain text (CLIENTS_ONLY), with no link to the chooser or the other sign-ins. The Email field must hold an email
   address before anything is sent (NOT_AN_EMAIL: a password manager may offer the Server screen's preview login here).
   The open preview (BUILD §7.4): while the server offers it, a one-tap "Continue without signing in" card sits above the
   form (src/flow/auth/PreviewCard); nothing is sent until it is tapped. A staff build keeps the earlier behaviour
   (components/openPreview usePreviewDoor: the screen opens the member session itself, never the form).
   A cold start that could not reach the server opens here with "Service not reached" (ServerNoticeFx) while lib/auth
   keeps looking; when the server answers and the session stored on this device is still good (useAuth().resumed),
   the screen goes on to Home by itself.
   Motion v2: the screen enters in four beats (tile, eyebrow and title; subtitle and the preview card; the form; the
   social buttons and the footer; src/flow/auth/beats), the pinned 240 and 280 delays inside them. Email | Phone
   swap in place without a blank or a jump (src/flow/auth/FormSwap, M53). Every way to Home leaves in one flow exit
   (src/flow/auth/leave: the column fades and rises, the tile's mark lifts and flies on into Home's ring, M52, M56),
   after Home's first loads have answered or m52.prefetchCap has passed; the preview card stays put, busy, from the
   tap until the screen leaves (useHeldOffer). Home renders behind the exit and the backdrop holds as its last stage
   until Home's first frame takes the screen, so no black comes between them (useHomeExit, release T4-02).
   "New here? Create an account" sits under the subtitle as well as in the footer, so the way to sign up is in sight
   on the first screen (release T6-12); every link here is a 44 pt touch box (release T5-17). */
import { Link, Redirect, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Button, Field, Input, Notice, NoticeText, P, Reveal, Segmented, T, VerifiedOverlay, fontFor, fx, useMotion } from '@/fx';
import { ease, motionValues } from '@/fx/motion/tokens';
import { ApiError, PREVIEW_GATE } from '@/lib/api';
import { CLIENTS_ONLY, homeFor, isEmailRefusal, looksLikeEmail, NOT_AN_EMAIL, useAuth, WORKSPACE_SIGN_IN, type SocialSignInResult } from '@/lib/auth';
import { SERVER_OVERRIDE_ALLOWED, STAFF_APP } from '@/lib/config';
import { useFeatures } from '@/lib/features';
import { SocialSignInButtons } from '@/components/socialSignIn';
import { OpeningPreview, PreviewDoorScreen, usePreviewAway, usePreviewDoor, usePreviewOffer } from '@/components/openPreview';
import { AuthScreen } from '@/flow/auth/AuthScreen';
import { Beat } from '@/flow/auth/beats';
import { FormSwap } from '@/flow/auth/FormSwap';
import { homeReady, useAuthLeave } from '@/flow/auth/leave';
import { followLayout, useFollow } from '@/flow/follow';
import { PhoneCodeForm } from '@/flow/auth/PhoneCodeForm';
import { PreviewCard, useHeldOffer, useHomeExit } from '@/flow/auth/PreviewCard';
import { ServerNoticeFx } from '@/flow/auth/ServerNoticeFx';

type Mode = 'email' | 'phone';

export default function SignIn() {
  const { signIn, config, sessionEnded, resumed, user } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<React.ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const leave = useAuthLeave();
  const { calm, inHtml } = useMotion();
  const below = useFollow(motionValues.screens.m53.shiftMs, !calm && !inHtml, ease.cubicOut);
  const features = useFeatures(true); // GET /public/config: the Phone segment shows only while phone_sign_in is on
  const door = usePreviewDoor('member'); // a staff build's open preview (does nothing in the client app)
  const preview = useHeldOffer(usePreviewOffer()); // the client app's one-tap card
  const away = usePreviewAway(); // opened with a session already on this device: its home
  const phoneOn = !!features?.has('phone_sign_in');
  const shown: Mode = phoneOn ? mode : 'email';
  // one flow exit into Home: the column leaves, the tile's mark lifts and flies on into Home's ring, and Home renders
  // behind the exit (useHomeExit). The backdrop (photo band, orbs, hairline) is the exit's last stage: it stays until
  // Home's first frame replaces the screen, so a Home still rendering never leaves the screen black (release T4-02)
  const toHome = useHomeExit(leave);
  const [leaving, setLeaving] = useState(false); // on the way Home: the faded screen takes no touches
  const home = () => { setLeaving(true); toHome({ mark: true }); };
  // the Verified moment: Home's loads start during its hold; the exit starts with the veil's (the mark is handed over
  // once the veil is gone)
  useEffect(() => { if (verified) void homeReady(); }, [verified]);
  const homeAfterVerified = () => { setLeaving(true); toHome({ mark: true, recordAfter: motionValues.verified.veilOutMs, underVeil: motionValues.verified.veilOutMs }); };
  const elsewhere = (ws: 'coach' | 'admin', text: string) => <T v="body" color={fx.red.label} onPress={() => router.replace(WORKSPACE_SIGN_IN[ws] as never)}>{text}</T>;
  const go = async () => {
    setErr(null);
    if (!looksLikeEmail(email)) { setErr(NOT_AN_EMAIL); return; }
    setBusy(true);
    let left = false;
    try { await signIn(email.trim(), password, 'member'); await homeReady(); left = true; home(); }
    catch (e) {
      if (e instanceof ApiError && e.code === PREVIEW_GATE) setErr(e.message);
      else if (e instanceof ApiError && e.code === 'WRONG_WORKSPACE' && !STAFF_APP) setErr(CLIENTS_ONLY);
      else if (e instanceof ApiError && e.code === 'WRONG_WORKSPACE') setErr(<NoticeText>That account does not sign in here. Coaches use the {elsewhere('coach', 'coach workspace')}; administrators the {elsewhere('admin', 'administrative portal')}.</NoticeText>);
      else if (e instanceof ApiError && e.code === 'RATE_LIMITED') setErr('Too many attempts. Wait a few minutes and try again; the account is protected, not lost.');
      else if (e instanceof ApiError && e.code === 'ACCOUNT_SUSPENDED') setErr(`This account is suspended. Contact support${config?.supportEmail ? ` at ${config.supportEmail}` : ''}.`);
      else if (e instanceof ApiError && e.code === 'INVITATION_PENDING') setErr('Finish setting up from your invitation link first. If it expired, ask the team for a new one.');
      else if (e instanceof ApiError && e.status === 401) setErr('Check the email and password. To reset the password, use “Forgotten your password?” above.');
      else if (e instanceof ApiError && e.offline) setErr('The Bioptime service could not be reached. Check your connection' + (SERVER_OVERRIDE_ALLOWED ? ', or change the server address below.' : '.'));
      else if (isEmailRefusal(e)) setErr(NOT_AN_EMAIL);
      else setErr(e instanceof Error ? e.message : 'Sign-in failed');
    } finally { if (!left) setBusy(false); } // leaving: the button stays busy until the screen goes
  };
  const social = (r: SocialSignInResult) => { if (r.kind === 'signed_in') void homeReady().then(home); else router.push('/(auth)/social-finish'); };

  if (STAFF_APP) {
    if (door.home) return <Redirect href={door.home as never} />;
    if (door.opening) return <OpeningPreview announce={door.announce} />;
    if (door.failed) return <PreviewDoorScreen door={door} />;
  }
  if (away.to && !verified) return <Redirect href={away.to as never} />;
  if (resumed && user && !verified) return <Redirect href={homeFor(user.role) as never} />;

  return <AuthScreen
    logo
    ownBeats
    inert={leaving}
    leave={leave}
    title="Sign in"
    subtitle={<View style={styles.lead}>
      <P>Your coach, your plan, your blood tests, in one place.</P>
      {/* the way to sign up, in sight on the first screen (the footer keeps its own) */}
      <Pressable accessibilityRole="link" onPress={() => router.push('/(auth)/register')} style={styles.newHere}>
        <T v="body" color={fx.ink.a60}>New here? <T v="body" style={styles.linkStrong}>Create an account</T></T>
      </Pressable>
    </View>}
    overlay={<VerifiedOverlay visible={verified} onExitStart={homeAfterVerified} />}>
    {preview.offer ? <Reveal delay={240}><PreviewCard preview={preview} onOpened={home} /></Reveal> : null}
    {sessionEnded ? <Beat n={1}><Notice kind="warning" title="Session ended">Your session on this device has ended, so you have been signed out. Sign in again to continue.</Notice></Beat> : null}
    <ServerNoticeFx beat={1} />
    {phoneOn ? <Reveal delay={280}>
      <Segmented kind="red" value={shown} onChange={(v) => { setMode(v); setErr(null); }} items={[{ value: 'email', label: 'Email', icon: 'mail' }, { value: 'phone', label: 'Phone', icon: 'smartphone' }]} />
    </Reveal> : null}
    <Beat n={2}>
      <FormSwap id={shown} watchRef={below.watchRef}>
        {shown === 'email' ? <View style={styles.form}>
          <Field label="Email" title="Email address"><Input value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="username" /></Field>
          <View style={styles.password}>
            <Field label="Password"><Input value={password} onChangeText={setPassword} secureToggle autoCapitalize="none" autoCorrect={false} autoComplete="password" textContentType="password" onSubmitEditing={go} /></Field>
            <View style={styles.forgot}><Link href="/(auth)/forgot" style={[styles.link, styles.reach]}>Forgotten your password?</Link></View>
          </View>
          {err ? <Notice kind="error">{typeof err === 'string' ? err : <View>{err}</View>}</Notice> : null}
          <Button title="Sign in" iconRight="arrow-right" commit onPress={go} busy={busy} disabled={!email || !password} />
        </View> : <PhoneCodeForm onSignedIn={() => setVerified(true)} />}
      </FormSwap>
    </Beat>
    <View style={styles.spacer} />
    {/* what follows the form glides from its old place when the form changes height (the web; native: LinearTransition) */}
    <Animated.View ref={below.moverRef} layout={followLayout(motionValues.screens.m53.shiftMs)} style={[styles.after, below.style]}>
      <Beat n={3}><SocialSignInButtons onResult={social} divider="Or continue with" /></Beat>
      <Beat n={3} style={styles.footer}>
        <Pressable accessibilityRole="link" onPress={() => router.push('/(auth)/register')} style={styles.footLink}>
          <T v="body" color={fx.ink.a60} center>New to Bioptime? <T v="body" style={styles.linkStrong}>Create an account</T></T>
        </Pressable>
        {STAFF_APP ? <Link href="/(auth)/choose" replace style={[styles.link, styles.centre]}>Not you? Choose another sign-in</Link> : null}
        {SERVER_OVERRIDE_ALLOWED ? <Link href="/settings/server" style={[styles.muted, styles.centre]}>Change the server address (testers)</Link> : null}
      </Beat>
    </Animated.View>
  </AuthScreen>;
}

const styles = StyleSheet.create({
  form: { gap: 24 },
  password: { gap: 10 },
  forgot: { alignItems: 'flex-end' },
  link: { color: fx.red.label, fontFamily: fontFor('sans', 500), fontSize: 12, lineHeight: 18, paddingVertical: 4 },
  // a 44 pt touch box around a one-line link, without moving what is around it
  reach: { paddingVertical: 13, marginVertical: -9, paddingLeft: 16 },
  lead: { gap: 2 },
  newHere: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginBottom: -10 },
  footLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'stretch' },
  linkStrong: { color: fx.red.label, fontFamily: fontFor('sans', 600) },
  // its touch box is 44 pt tall; the negative margins keep the line where it was (30 pt)
  muted: { color: fx.ink.a50, fontFamily: fontFor('sans', 400), fontSize: 12, lineHeight: 18, paddingVertical: 13, marginVertical: -7 },
  centre: { textAlign: 'center', alignSelf: 'center' },
  spacer: { flexGrow: 1, minHeight: 16 },
  after: { gap: 24 },
  footer: { gap: 6, alignItems: 'center', paddingBottom: 8 },
});
