/* Where the app finds the Bioptime service, for testers (builds with EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE=1): the address in
   use, a typed address with the preview password in front of it, Reset. In a build that reads the link relay (lib/config
   findServer; tester builds only) the relay keeps a quick-tunnel address current by itself; a typed address stays the
   tester's choice. Changing the server signs this device out; the client app then shows its sign-in (with the one-tap
   preview card where the new server offers it), a staff build's open preview opens its session again by itself.
   The client app draws it in the sign-in's look (ServerFx); a staff build keeps the earlier body unchanged
   (ServerLegacy, the staff kit). The password manager is kept away from the preview login fields (autofill off), so it
   cannot offer that login to the Email field of a sign-in. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth, type PublicConfig } from '@/lib/auth';
import { apiBaseSource, apiBaseSync, defaultApiBase, findServer, gateSummary, LINK_RELAY, SERVER_OVERRIDE_ALLOWED, setApiBaseOverride, setGateCredentials, STAFF_APP } from '@/lib/config';
import { ApiError, get, PREVIEW_GATE, serverUnreachable, setToken } from '@/lib/api';
import { clearCache } from '@/lib/cache';
import { Button, Field, Input, KV, Notice, P, Row, Screen, Title } from '@/components/ui';
import { Button as FxButton, Field as FxField, GlassCard, Input as FxInput, KVRow, Notice as FxNotice, T, fx } from '@/fx';
import { AuthScreen } from '@/flow/auth/AuthScreen';

/** The address, the preview login and their checks, shared by both bodies. */
function useServerForm() {
  const { refresh, config, offline, setUser } = useAuth();
  const [value, setValue] = useState(apiBaseSync());
  // a preview password in front of the server (the shared demo link): the saved username is shown, the password never is
  const [gateUser, setGateUser] = useState(gateSummary()?.user ?? '');
  const [gatePass, setGatePass] = useState('');
  const [saved, setSaved] = useState(gateSummary());
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // changing the server signs this device out first: the existing session token is never sent to a newly typed host,
  // and the preview password is bound to the address it is saved with (Reset removes it)
  const apply = async (v: string | null) => {
    setBusy(true);
    try {
      await setToken(null); await clearCache(); setUser(null);
      // the app's own default address is kept as "no override", so a build that starts on a new link moves this device
      // too; the preview login is still saved for the address typed (an empty password with the same username keeps it)
      const typed = v ? v.trim().replace(/\/+$/, '') : null;
      await setApiBaseOverride(typed && typed !== defaultApiBase() ? typed : null);
      await setGateCredentials(typed, typed ? gateUser : '', typed ? gatePass : '');
      setValue(apiBaseSync()); setGatePass(''); setSaved(gateSummary()); setGateUser(gateSummary()?.user ?? '');
      const asked = apiBaseSync();
      let check: { kind: 'info' | 'error'; text: string } = { kind: 'info', text: `Now using ${asked}. Sign in again to continue.` };
      try { const c = await get<PublicConfig>('/public/config'); if (c?.openPreview) check = { kind: 'info', text: STAFF_APP ? `Now using ${asked}.` : `Now using ${asked}. Sign in again, or continue without signing in from the sign-in screen.` }; }
      catch (e) {
        if (e instanceof ApiError && (e.code === PREVIEW_GATE || e.offline)) check = { kind: 'error', text: e.code === PREVIEW_GATE ? e.message : `${asked} could not be reached. Check the address and the connection.` };
        // nothing answered there: the link relay may know the shared link's current address (a typed address that is not
        // a quick tunnel stays as typed; lib/config findServer)
        if (serverUnreachable(e)) await findServer(true);
      }
      await refresh();
      // the address did not answer and the link relay knew the shared link's current one: the app moved there
      if (apiBaseSync() !== asked) { check = { kind: 'info', text: `${asked} did not answer. The link relay gave the shared link's current address, now in use: ${apiBaseSync()}.` }; setValue(apiBaseSync()); }
      setMsg(check);
    } finally { setBusy(false); }
  };
  const source = apiBaseSource();
  const relayRow: [string, string][] = LINK_RELAY ? [['Link relay', source === 'relay' ? 'On · the address in use came from it' : source === 'typed' ? 'On · a typed address stays in use while it answers' : 'On']] : [];
  const reachable = offline ? 'No' : config ? (config.demo ? 'Yes · simulated services' : `Yes · ${config.mode} mode`) : 'Unknown';
  return { config, value, setValue, gateUser, setGateUser, gatePass, setGatePass, saved, msg, busy, apply, relayRow, reachable };
}

const ADDRESS_HINT = 'Example: http://192.168.1.20:3000 for a Mac on the same Wi-Fi, or a shared preview link (https://….trycloudflare.com). The Android emulator reaches the host at http://10.0.2.2:3000.';
const USER_HINT = 'Only for an address behind a preview password, such as a shared preview link. Leave empty for none. This is not your Bioptime account: sign in with your own email afterwards.';
const FOOTNOTE = 'No credentials or keys are built into this app. A preview password stays in this device’s secure storage and goes only to the address it was saved with. Changing the server signs this device out; Reset also removes the preview password.';
const passHint = (saved: { user: string } | null) => (saved ? `A password is saved for ${saved.user}. Leave this empty to keep it, also for a new address.` : 'Kept in this device’s secure storage and sent only to the address above.');

export default function Server() { return STAFF_APP ? <ServerLegacy /> : <ServerFx />; }

function ServerFx() {
  const router = useRouter();
  const s = useServerForm();
  const rows: [string, string][] = SERVER_OVERRIDE_ALLOWED
    ? [['In use', apiBaseSync()], ['Default', defaultApiBase()], ['Reachable', s.reachable], ['Preview password', s.saved ? `Saved for ${s.saved.user} at ${s.saved.origin}` : 'None'], ...s.relayRow, ['Laboratory', s.config?.labVendor ?? '—'], ['Payments', s.config?.payments ?? '—']]
    : [['In use', apiBaseSync()], ['Reachable', s.reachable]];
  return <AuthScreen back small eyebrow="Testers" title="Server" subtitle={SERVER_OVERRIDE_ALLOWED ? 'Where this app finds the Bioptime service. Testers point it at a machine on their network or at a shared preview link; production builds have the address baked in.' : 'This build talks to one fixed Bioptime server.'}>
    <GlassCard variant="card" padding={16}>
      {rows.map(([k, v], i) => <KVRow key={k} label={k} value={<T v="mono12" style={styles.value} selectable>{v}</T>} divider={i < rows.length - 1} />)}
    </GlassCard>
    {SERVER_OVERRIDE_ALLOWED ? <>
      <FxField label="Address" hint={ADDRESS_HINT}><FxInput value={s.value} onChangeText={s.setValue} autoCapitalize="none" autoCorrect={false} keyboardType="url" autoComplete="off" textContentType="URL" importantForAutofill="no" mono /></FxField>
      <FxField label="Preview username" hint={USER_HINT}><FxInput value={s.gateUser} onChangeText={s.setGateUser} autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" importantForAutofill="no" /></FxField>
      <FxField label="Preview password" hint={passHint(s.saved)}><FxInput value={s.gatePass} onChangeText={s.setGatePass} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" importantForAutofill="no" /></FxField>
      {s.msg ? <FxNotice kind={s.msg.kind}>{s.msg.text}</FxNotice> : null}
      <View style={styles.row}>
        <View style={styles.flex}><FxButton title="Use this address" commit busy={s.busy} onPress={() => s.apply(s.value)} disabled={!/^https?:\/\//.test(s.value)} /></View>
        <FxButton title="Reset" variant="ghost" onPress={() => s.apply(null)} disabled={s.busy} />
      </View>
      <T v="bodySm" color={fx.ink.a60}>{FOOTNOTE}</T>
      {s.msg && !s.busy ? <FxButton title="Back to sign-in" variant="soft" onPress={() => router.replace('/(auth)/sign-in')} /> : null}
    </> : null}
  </AuthScreen>;
}

/** The staff build's Server screen, as it was. */
function ServerLegacy() {
  const s = useServerForm();
  // a build where testers may not change the server reads no link relay either (lib/config LINK_RELAY): as before
  if (!SERVER_OVERRIDE_ALLOWED) return <Screen><Title sub="This build talks to one fixed Bioptime server.">Server</Title><KV rows={[['In use', apiBaseSync()], ['Reachable', s.reachable]]} /></Screen>;
  return <Screen>
    <Title sub="Where this app finds the Bioptime service. Testers point it at a machine on their network or at a shared preview link; production builds have the address baked in.">Server</Title>
    <KV rows={[['In use', apiBaseSync()], ['Default', defaultApiBase()], ['Reachable', s.reachable], ['Preview password', s.saved ? `Saved for ${s.saved.user} at ${s.saved.origin}` : 'None'], ...s.relayRow, ['Laboratory', s.config?.labVendor ?? '—'], ['Payments', s.config?.payments ?? '—']]} />
    <Field label="Address" hint={ADDRESS_HINT}><Input value={s.value} onChangeText={s.setValue} autoCapitalize="none" autoCorrect={false} keyboardType="url" /></Field>
    <Field label="Preview username" hint={USER_HINT}><Input value={s.gateUser} onChangeText={s.setGateUser} autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" importantForAutofill="no" /></Field>
    <Field label="Preview password" hint={passHint(s.saved)}><Input value={s.gatePass} onChangeText={s.setGatePass} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" importantForAutofill="no" /></Field>
    {s.msg ? <Notice kind={s.msg.kind}>{s.msg.text}</Notice> : null}
    <Row><Button title="Use this address" onPress={() => s.apply(s.value)} disabled={!/^https?:\/\//.test(s.value)} style={{ flex: 1 }} /><Button title="Reset" variant="secondary" onPress={() => s.apply(null)} /></Row>
    <P muted small>{FOOTNOTE}</P>
  </Screen>;
}

const styles = StyleSheet.create({
  value: { textAlign: 'right', flexShrink: 1, maxWidth: '62%' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  flex: { flex: 1 },
});
