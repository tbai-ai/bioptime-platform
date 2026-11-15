/* Password and devices: the security part of the portal's Profile page, on the same routes. Changing the password
   (POST /auth/password/change) signs out every other session and keeps this one; the list of active sessions
   (GET /auth/sessions, `current` is this one) lets the member sign out any other device (DELETE /auth/sessions/:id).
   Sign-in methods (GET /auth/social/identities): the Google or Apple identity linked to the account, with unlink
   (DELETE /auth/social/identities/:provider), which the server refuses while it is the only way in
   (LAST_SIGN_IN_METHOD). A member who joined with Google or Apple has no password yet; the card says how to set one.
   Reached from Profile › Settings. Shared with the staff build (its More screen links here): a coach or an
   administrator gets the legacy body (src/screens/profile/SecurityLegacy.tsx), members the client app's overlay. */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, ApiError, errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorState, Field, fx, GlassCard, Input, Notice, Overlay, Pill, Reveal, RingSpinner, RowDivider, T } from '@/fx';
import { Beside } from '@/fx/wordFit';
import { SecurityLegacy } from '@/screens/profile/SecurityLegacy';

type Session = { id: string; kind: string; user_agent: string | null; created_at: string; expires_at: string; last_seen_at: string };
type Identity = { provider: string; email: string | null; linkedAt: string };
const PROVIDER_LABEL: Record<string, string> = { google: 'Google', apple: 'Apple', standin: 'Preview sign-in' };

export default function SecurityRoute() {
  const { user } = useAuth();
  return user && user.role !== 'member' ? <SecurityLegacy /> : <Security />;
}

function Security() {
  const sessions = useLoad<{ items: Session[]; current: string }>(null, () => get('/auth/sessions'), []);
  const identities = useLoad<{ items: Identity[]; hasPassword: boolean }>(null, () => get('/auth/social/identities'), []);
  const [unlinking, setUnlinking] = useState('');
  const [idMsg, setIdMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [devMsg, setDevMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const change = async () => {
    setBusy(true); setMsg(null); setDevMsg(null); setErrs({});
    try {
      await post('/auth/password/change', { currentPassword: cur, newPassword: next });
      setCur(''); setNext('');
      setMsg({ kind: 'success', text: 'Password changed. Every other session was signed out; this one stays signed in.' });
      void sessions.reload();
    } catch (e) {
      if (e instanceof ApiError) setErrs(e.fieldErrors());
      setMsg({ kind: 'error', text: errorText(e) });
    } finally { setBusy(false); }
  };
  const end = async (s: Session) => {
    setEnding(s.id); setDevMsg(null);
    try { await api('DELETE', `/auth/sessions/${s.id}`); setDevMsg({ kind: 'success', text: 'Signed out. That device has to sign in again.' }); void sessions.reload(); }
    catch (e) { setDevMsg({ kind: 'error', text: errorText(e) }); } finally { setEnding(''); }
  };
  const unlink = async (i: Identity) => {
    setUnlinking(i.provider); setIdMsg(null);
    try { await api('DELETE', `/auth/social/identities/${encodeURIComponent(i.provider)}`); setIdMsg({ kind: 'success', text: `${PROVIDER_LABEL[i.provider] ?? i.provider} is no longer linked to this account.` }); void identities.reload(); }
    catch (e) { setIdMsg({ kind: 'error', text: errorText(e) }); } finally { setUnlinking(''); }
  };

  const currentId = sessions.data?.current;
  const items = sessions.data?.items ?? [];
  const linked = identities.data?.items ?? [];
  const noPassword = identities.data ? !identities.data.hasPassword : false;
  return <Overlay kind="back" title="Password and devices" subtitle="Change your password and see where your account is signed in." fallback="/(tabs)/profile?tab=settings">
    <Reveal index={0} mount>
      <GlassCard>
        <T v="label" accessibilityRole="header" style={styles.head}>Password</T>
        <View style={styles.gap}>
          {noPassword ? <Notice kind="info" title="No password yet">{`This account signs in with ${linked.map((i) => PROVIDER_LABEL[i.provider] ?? i.provider).join(' and ') || 'a linked sign-in'}. To add a password, use “Forgotten your password?” on the sign-in screen: the link sets the first one.`}</Notice> : null}
          <Field label="Current password" error={errs.currentPassword}><Input value={cur} onChangeText={setCur} secureToggle autoCapitalize="none" autoComplete="current-password" textContentType="password" /></Field>
          <Field label="New password" error={errs.newPassword} hint="At least 10 characters. Other sessions are signed out."><Input value={next} onChangeText={setNext} secureToggle autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" onSubmitEditing={() => { if (cur && next) void change(); }} /></Field>
          {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
          <Button title="Change password" shape="flow" onPress={change} busy={busy} disabled={!cur || !next} commit />
        </View>
      </GlassCard>
    </Reveal>

    <Reveal index={1} mount>
      <GlassCard>
        <T v="label" accessibilityRole="header" style={styles.head}>Active sessions</T>
        <ErrorState error={sessions.error} onRetry={sessions.reload} />
        {sessions.loading && !sessions.data ? <View style={styles.loading}><RingSpinner label="Loading your sessions" /></View> : items.map((s, i) => {
          const mine = s.id === currentId;
          return <View key={s.id}>
            {i ? <RowDivider /> : null}
            {/* the pill or the button moves under the device when its two lines would not hold it beside them
                ('Mobile · unknown dev…' at 320 dp and text 1.3: SWA-17) */}
            <Beside words={[{ text: `${label(s.kind)} · ${(s.user_agent || 'unknown device').slice(0, 60)}`, v: 'section' }]} lines={2} underGap={8} style={styles.rowPad} columnStyle={styles.gap2}
              side={mine ? <Pill tone="success">This one</Pill> : <Button title="Sign out" variant="soft" small full={false} busy={ending === s.id} onPress={() => end(s)} label={`Sign out ${label(s.kind)} session`} />}>
              <T v="section" numberOfLines={2}>{`${label(s.kind)} · ${(s.user_agent || 'unknown device').slice(0, 60)}`}</T>
              <T v="caption" color={fx.ink.a55}>{`Signed in ${fmtDateTime(s.created_at)} · last seen ${relative(s.last_seen_at)} · ends ${fmtDate(s.expires_at)}`}</T>
            </Beside>
          </View>;
        })}
        {devMsg ? <Notice kind={devMsg.kind} style={styles.note}>{devMsg.text}</Notice> : null}
        <T v="caption" color={fx.ink.a55} style={styles.note}>Each session ends by itself on the date shown. If you see a device you do not recognise, sign it out and change your password.</T>
      </GlassCard>
    </Reveal>

    <Reveal index={2} mount>
      <GlassCard>
        <T v="label" accessibilityRole="header" style={styles.head}>Sign-in methods</T>
        <ErrorState error={identities.error} onRetry={identities.reload} />
        {identities.loading && !identities.data ? <View style={styles.loading}><RingSpinner label="Loading your sign-in methods" /></View> : null}
        {identities.data && !linked.length ? <T v="bodySm" color={fx.ink.a60}>Email and password only. Signing in with Google or Apple from the sign-in screen links that identity to this account.</T> : null}
        {linked.map((i, n) => <View key={i.provider}>
          {n ? <RowDivider /> : null}
          <View style={styles.row}>
            <View style={styles.flex}>
              <T v="section">{PROVIDER_LABEL[i.provider] ?? label(i.provider)}</T>
              <T v="caption" color={fx.ink.a55}>{`${i.email ?? 'no email shared'} · linked ${fmtDate(i.linkedAt)}`}</T>
            </View>
            <Button title="Unlink" variant="soft" small full={false} busy={unlinking === i.provider} onPress={() => unlink(i)} label={`Unlink ${PROVIDER_LABEL[i.provider] ?? i.provider}`} />
          </View>
        </View>)}
        {idMsg ? <Notice kind={idMsg.kind} style={styles.note}>{idMsg.text}</Notice> : null}
        {linked.length ? <T v="caption" color={fx.ink.a55} style={styles.note}>Unlinking is refused while it is the only way to sign in; set a password first.</T> : null}
      </GlassCard>
    </Reveal>
  </Overlay>;
}

const styles = StyleSheet.create({
  head: { marginBottom: 12 },
  gap: { gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  rowPad: { paddingVertical: 12 },
  gap2: { gap: 2 },
  loading: { paddingVertical: 24, alignItems: 'center' },
  note: { marginTop: 8 },
});
