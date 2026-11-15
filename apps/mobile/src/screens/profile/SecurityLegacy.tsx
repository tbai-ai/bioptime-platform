/* The staff build's Password and devices screen (src/app/settings/security.tsx renders it for a coach or an
   administrator, whose More screen links here; members get the client app's look). Moved here unchanged. */
/* Password and devices: the security part of the portal's Profile page, on the same routes. Changing the password
   (POST /auth/password/change) signs out every other session and keeps this one; the list of active sessions
   (GET /auth/sessions, `current` is this one) lets the member sign out any other device (DELETE /auth/sessions/:id).
   Sign-in methods (GET /auth/social/identities): the Google or Apple identity linked to the account, with unlink
   (DELETE /auth/social/identities/:provider), which the server refuses while it is the only way in
   (LAST_SIGN_IN_METHOD). A member who joined with Google or Apple has no password yet; the card says how to set one.
   Reached from Me. Motion (additive, from '@/motion'): the title and the cards enter with depth, staggered. */
import React, { useState } from 'react';
import { api, ApiError, errorText, get, post } from '@/lib/api';
import { fmtDate, fmtDateTime, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, ErrorBox, Eyebrow, Field, Input, ListItem, Loading, Notice, P, Pill, Screen, Title } from '@/components/ui';
import { Enter, MotionCard } from '@/motion';

type Session = { id: string; kind: string; user_agent: string | null; created_at: string; expires_at: string; last_seen_at: string };
type Identity = { provider: string; email: string | null; linkedAt: string };
const PROVIDER_LABEL: Record<string, string> = { google: 'Google', apple: 'Apple', standin: 'Preview sign-in' };

export function SecurityLegacy() {
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
  return <Screen refreshing={sessions.loading || identities.loading} onRefresh={() => { void sessions.reload(); void identities.reload(); }}>
    <Enter><Title sub="Change your password and see where your account is signed in.">Password and devices</Title></Enter>
    <MotionCard index={1} pressable={false}><Card><Eyebrow>Password</Eyebrow>
      {noPassword ? <Notice kind="info" title="No password yet">This account signs in with {linked.map((i) => PROVIDER_LABEL[i.provider] ?? i.provider).join(' and ') || 'a linked sign-in'}. To add a password, use “Forgotten your password?” on the sign-in screen: the link sets the first one.</Notice> : null}
      <Field label="Current password" error={errs.currentPassword}><Input value={cur} onChangeText={setCur} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" /></Field>
      <Field label="New password" error={errs.newPassword} hint="At least 10 characters. Other sessions are signed out."><Input value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" onSubmitEditing={() => { if (cur && next) void change(); }} /></Field>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      <Button title="Change password" onPress={change} busy={busy} disabled={!cur || !next} />
    </Card></MotionCard>
    <MotionCard index={2} pressable={false}><Card><Eyebrow>Active sessions</Eyebrow>
      <ErrorBox error={sessions.error} onRetry={sessions.reload} />
      {sessions.loading && !sessions.data ? <Loading /> : items.map((s) => {
        const mine = s.id === currentId;
        return <ListItem key={s.id} title={`${label(s.kind)} · ${(s.user_agent || 'unknown device').slice(0, 60)}`} sub={`Signed in ${fmtDateTime(s.created_at)} · last seen ${relative(s.last_seen_at)} · ends ${fmtDate(s.expires_at)}`}
          right={mine ? <Pill tone="success">This one</Pill> : <Button title="Sign out" small variant="ghost" busy={ending === s.id} onPress={() => end(s)} />} />;
      })}
      {devMsg ? <Notice kind={devMsg.kind}>{devMsg.text}</Notice> : null}
      <P muted small>Each session ends by itself on the date shown. If you see a device you do not recognise, sign it out and change your password.</P>
    </Card></MotionCard>
    <MotionCard index={3} pressable={false}><Card><Eyebrow>Sign-in methods</Eyebrow>
      <ErrorBox error={identities.error} onRetry={identities.reload} />
      {identities.loading && !identities.data ? <Loading /> : null}
      {identities.data && !linked.length ? <P muted small>Email and password only. Signing in with Google or Apple from the sign-in screen links that identity to this account.</P> : null}
      {linked.map((i) => <ListItem key={i.provider} title={PROVIDER_LABEL[i.provider] ?? label(i.provider)} sub={`${i.email ?? 'no email shared'} · linked ${fmtDate(i.linkedAt)}`}
        right={<Button title="Unlink" small variant="ghost" busy={unlinking === i.provider} onPress={() => unlink(i)} />} />)}
      {idMsg ? <Notice kind={idMsg.kind}>{idMsg.text}</Notice> : null}
      {linked.length ? <P muted small>Unlinking is refused while it is the only way to sign in; set a password first.</P> : null}
    </Card></MotionCard>
  </Screen>;
}
