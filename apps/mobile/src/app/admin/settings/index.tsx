/* Admin › Settings (the web's /admin/settings, pages/Settings.tsx in admin mode; settings.manage). Seven cards, as on
   the web: Security (password change, the authenticator set-up with the secret for an authenticator app, MFA off with a
   current code: POST /auth/password/change, /auth/mfa/setup|confirm|disable), Sessions (GET /auth/sessions, never
   cached on the device), Runtime policies and App settings (PATCH /admin/settings, each change with the reason typed
   above the fields), notification templates (PUT /admin/notification-templates), the Integrations link card and the
   metric catalogue (PATCH /admin/metrics-config/:metric). The MFA secret is shown once, never logged or stored.
   Pills take the portal's colours (lib/admin/b2/pill): the runtime card's 'simulated services' is the web's 'draft'. The
   cards sit inside RequirePermission, so without settings.manage none of them mounts and nothing is requested. */
import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, ApiError, errorText, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { pillTone } from '@/lib/admin/b2/pill';
import { ChoiceChips, MonoText, Toggle, useToast } from '@/components/adminB2/parts';
import { Button, Card, ErrorBox, Eyebrow, Field, H2, Input, ListItem, Loading, Notice, P, Pill, Row } from '@/components/ui';
import { FilterChips } from '@/components/workspace';
import { NotificationBell, RequirePermission, RoleGate, WorkspaceScreen } from '@/components/workspaceShell';
import { MotionCard } from '@/motion';
import { space } from '@/theme';

type SettingsPayload = { settings: Record<string, unknown>; mode: string; demo: boolean };
type Session = { id: string; kind: string; ip?: string | null; user_agent: string | null; created_at: string; expires_at: string; last_seen_at: string };
type Templates = { categories: string[]; templates: Record<string, { subject?: string; body?: string }> };
type Metric = { metric: string; label: string; unit: string; enabled: boolean; min: number | null; max: number | null };
type Show = (text: string, kind?: 'success' | 'error' | 'info') => void;

/* Administrators and owners only: anyone else sees the workspace notice, and nothing here asks the API. */
export default function AdminSettings() {
  return <RoleGate workspace="admin"><AdminSettingsScreen /></RoleGate>;
}

function AdminSettingsScreen() {
  const { user, refresh } = useAuth();
  const [toast, showToast] = useToast();
  const [tick, setTick] = useState(0);
  return <WorkspaceScreen workspace="admin" title="Settings" sub="Your account and security, runtime settings, integrations and the metric catalogue." refreshing={false} onRefresh={() => setTick((t) => t + 1)}>
    <Stack.Screen options={{ title: 'Settings', headerRight: () => <NotificationBell /> }} />
    <RequirePermission permission="settings.manage">
      {toast}
      <MotionCard index={1} pressable={false}><Security user={user} show={showToast} onChange={refresh} /></MotionCard>
      <MotionCard index={2} pressable={false}><Sessions show={showToast} tick={tick} /></MotionCard>
      <MotionCard index={3} pressable={false}><Runtime show={showToast} tick={tick} /></MotionCard>
      <MotionCard index={4} pressable={false}><Features show={showToast} tick={tick} /></MotionCard>
      <MotionCard index={5} pressable={false}><TemplatesCard show={showToast} tick={tick} /></MotionCard>
      <MotionCard index={6} pressable={false}><IntegrationsCard /></MotionCard>
      <MotionCard index={7} pressable={false}><Metrics show={showToast} tick={tick} /></MotionCard>
    </RequirePermission>
  </WorkspaceScreen>;
}

function Security({ user, show, onChange }: { user: { role: string; mfaEnabled?: boolean } | null; show: Show; onChange: () => Promise<void> }) {
  const [cur, setCur] = useState(''); const [next, setNext] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [mfa, setMfa] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState('');
  const change = async () => {
    setBusy('password'); setErrs({});
    try { await post('/auth/password/change', { currentPassword: cur, newPassword: next }); setCur(''); setNext(''); show('Password changed; other sessions signed out'); }
    catch (e) { if (e instanceof ApiError) setErrs(e.fieldErrors()); show(errorText(e), 'error'); } finally { setBusy(''); }
  };
  const setup = async () => { setBusy('setup'); try { setMfa(await post<{ secret: string; otpauth: string }>('/auth/mfa/setup')); setCode(''); } catch (e) { show(errorText(e), 'error'); } finally { setBusy(''); } };
  const confirm = async () => { setBusy('confirm'); try { await post('/auth/mfa/confirm', { code }); setMfa(null); setCode(''); show('MFA enabled'); await onChange(); } catch (e) { show(errorText(e), 'error'); } finally { setBusy(''); } };
  const disable = async () => { setBusy('disable'); try { await post('/auth/mfa/disable', { code }); setCode(''); show('MFA disabled'); await onChange(); } catch (e) { show(errorText(e), 'error'); } finally { setBusy(''); } };
  const copy = async (what: 'secret' | 'otpauth') => { if (!mfa) return; try { await Clipboard.setStringAsync(what === 'secret' ? mfa.secret : mfa.otpauth); setCopied(what); } catch { setCopied(''); } };
  const privileged = user?.role === 'admin' || user?.role === 'owner';
  return <Card>
    <Row between><Eyebrow>Security</Eyebrow>{user?.mfaEnabled ? <Pill tone={pillTone('active')}>MFA on</Pill> : <Pill tone={pillTone('pending')}>MFA off</Pill>}</Row>
    <H2>Password and MFA</H2>
    <Field label="Current password" error={errs.currentPassword}><Input value={cur} onChangeText={setCur} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" accessibilityLabel="Current password" /></Field>
    <Field label="New password" hint="At least 10 characters." error={errs.newPassword}><Input value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" accessibilityLabel="New password" /></Field>
    <Button title="Change password" small disabled={!cur || next.length < 10} busy={busy === 'password'} onPress={change} style={{ alignSelf: 'flex-start' }} />
    {privileged ? <View style={{ gap: space.md, marginTop: space.md }}>
      {!user?.mfaEnabled && !mfa ? <Button title="Set up authenticator (MFA)" small busy={busy === 'setup'} onPress={setup} style={{ alignSelf: 'flex-start' }} /> : null}
      {mfa ? <View style={{ gap: space.md }}>
        <Notice kind="info" title="Add this secret to your authenticator app">
          <View style={{ gap: space.xs }}>
            <P small>Secret:</P><MonoText>{mfa.secret}</MonoText>
            <MonoText small>{mfa.otpauth}</MonoText>
            <Row><Button title={copied === 'secret' ? 'Secret copied' : 'Copy the secret'} variant="secondary" small onPress={() => copy('secret')} /><Button title={copied === 'otpauth' ? 'Link copied' : 'Copy the otpauth link'} variant="secondary" small onPress={() => copy('otpauth')} /></Row>
            <P muted small>Open your authenticator app and add the account by typing the secret, or paste the otpauth link where the app accepts one. The secret is shown once and is never stored on this phone.</P>
          </View>
        </Notice>
        <Field label="Code from the app"><Input value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} accessibilityLabel="Code from the app" /></Field>
        <Button title="Confirm" small busy={busy === 'confirm'} disabled={code.length !== 6} onPress={confirm} style={{ alignSelf: 'flex-start' }} />
      </View> : null}
      {user?.mfaEnabled ? <Row>
        <Input placeholder="Current code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} style={{ maxWidth: 160 }} accessibilityLabel="Current code" />
        <Button title="Disable MFA" variant="danger" small busy={busy === 'disable'} disabled={code.length !== 6} onPress={disable} />
      </Row> : null}
    </View> : null}
  </Card>;
}

function Sessions({ show, tick }: { show: Show; tick: number }) {
  const s = useLoad<{ items: Session[]; current: string }>(null, () => get('/auth/sessions'), [tick]);
  const [ending, setEnding] = useState('');
  const end = async (x: Session) => { setEnding(x.id); try { await api('DELETE', `/auth/sessions/${x.id}`); show('Session signed out'); void s.reload(); } catch (e) { show(errorText(e), 'error'); } finally { setEnding(''); } };
  const d = s.data;
  return <Card>
    <Eyebrow>Devices</Eyebrow><H2>Active sessions</H2>
    <ErrorBox error={s.error} onRetry={s.reload} />
    {!d ? (s.error ? null : <Loading />) : d.items.map((x) => <ListItem key={x.id} title={`${x.kind}${x.id === d.current ? ' · this one' : ''}`} sub={`${(x.user_agent ?? '').slice(0, 60)}${x.ip ? ` · ${x.ip}` : ''} · last seen ${relative(x.last_seen_at)}`} right={x.id !== d.current ? <Button title="Sign out" variant="ghost" small busy={ending === x.id} onPress={() => end(x)} /> : undefined} />)}
  </Card>;
}

const REASON_LABEL = 'Reason for the next change (recorded, required)';
const SAY_WHY = 'Say why first: the reason is recorded with the change.';

function Runtime({ show, tick }: { show: Show; tick: number }) {
  const s = useLoad<SettingsPayload>('admin-settings', () => get('/admin/settings'), [tick]);
  const [reason, setReason] = useState('');
  const [nums, setNums] = useState<Record<string, string>>({});
  const d = s.data;
  useEffect(() => { if (d) setNums({ cancellation_cutoff_minutes: String(d.settings.cancellation_cutoff_minutes ?? ''), appointment_cutoff_minutes: String(d.settings.appointment_cutoff_minutes ?? ''), support_email: String(d.settings.support_email ?? '') }); }, [d]);
  if (!d) return <Card><Eyebrow>Runtime</Eyebrow><H2>Policies</H2><ErrorBox error={s.error} onRetry={s.reload} />{s.error ? null : <Loading />}</Card>;
  const set = async (key: string, value: unknown) => {
    if (String(value) === String(d.settings[key])) return; // nothing changed: no write, no audit row
    if (reason.trim().length < 3) { show(SAY_WHY, 'error'); void s.reload(); return; }
    try { await patch('/admin/settings', { key, value, reason: reason.trim() }); show('Setting saved'); setReason(''); void s.reload(); } catch (e) { show(errorText(e), 'error'); }
  };
  return <Card>
    <Row between><Eyebrow>Runtime</Eyebrow><Pill tone={pillTone(d.demo ? 'draft' : 'active')}>{d.demo ? 'simulated services' : d.mode}</Pill></Row>
    <H2>Policies</H2>
    <Field label={REASON_LABEL}><Input value={reason} onChangeText={setReason} placeholder="Why this change" accessibilityLabel={REASON_LABEL} /></Field>
    <Field label="Assignment policy" hint="Auto assigns when one eligible coach leads clearly; manual always asks you."><ChoiceChips options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }]} value={String(d.settings.assignment_policy)} onChange={(v) => set('assignment_policy', v)} /></Field>
    <Field label="One bloodwork entitlement means" hint="Configurable: a panel, a collection or a single test."><ChoiceChips options={[{ value: 'collection', label: 'One collection' }, { value: 'panel', label: 'One panel' }, { value: 'test', label: 'One test' }]} value={String(d.settings.entitlement_unit)} onChange={(v) => set('entitlement_unit', v)} /></Field>
    <Field label="Cancellation cutoff (minutes before a collection)"><Input value={nums.cancellation_cutoff_minutes ?? ''} onChangeText={(v) => setNums({ ...nums, cancellation_cutoff_minutes: v })} keyboardType="number-pad" onBlur={() => set('cancellation_cutoff_minutes', Number(nums.cancellation_cutoff_minutes))} accessibilityLabel="Cancellation cutoff (minutes before a collection)" /></Field>
    <Field label="Appointment move cutoff (minutes)"><Input value={nums.appointment_cutoff_minutes ?? ''} onChangeText={(v) => setNums({ ...nums, appointment_cutoff_minutes: v })} keyboardType="number-pad" onBlur={() => set('appointment_cutoff_minutes', Number(nums.appointment_cutoff_minutes))} accessibilityLabel="Appointment move cutoff (minutes)" /></Field>
    <Field label="Support email"><Input value={nums.support_email ?? ''} onChangeText={(v) => setNums({ ...nums, support_email: v })} autoCapitalize="none" keyboardType="email-address" onBlur={() => set('support_email', nums.support_email)} accessibilityLabel="Support email" /></Field>
  </Card>;
}

function Features({ show, tick }: { show: Show; tick: number }) {
  const s = useLoad<SettingsPayload>('admin-settings-limits', () => get('/admin/settings'), [tick]);
  const [reason, setReason] = useState('');
  const [nums, setNums] = useState<Record<string, string>>({});
  const d = s.data;
  useEffect(() => { if (d) setNums({ reminder_hours_before: String(d.settings.reminder_hours_before ?? ''), max_open_appointments: String(d.settings.max_open_appointments ?? '') }); }, [d]);
  if (!d) return <Card><Eyebrow>App settings</Eyebrow><H2>Limits</H2><ErrorBox error={s.error} onRetry={s.reload} />{s.error ? null : <Loading />}</Card>;
  const set = async (key: string, value: number) => {
    if (value === d.settings[key]) return;
    if (reason.trim().length < 3) { show(SAY_WHY, 'error'); return; }
    try { await patch('/admin/settings', { key, value, reason: reason.trim() }); show('Saved'); setReason(''); void s.reload(); } catch (e) { show(errorText(e), 'error'); }
  };
  return <Card>
    <Eyebrow>App settings</Eyebrow><H2>Limits</H2>
    <Field label={REASON_LABEL}><Input value={reason} onChangeText={setReason} placeholder="Why this change" accessibilityLabel="Reason for the next limit change" /></Field>
    <Field label="Reminder before a consultation (hours)"><Input value={nums.reminder_hours_before ?? ''} onChangeText={(v) => setNums({ ...nums, reminder_hours_before: v })} keyboardType="number-pad" onBlur={() => set('reminder_hours_before', Number(nums.reminder_hours_before))} accessibilityLabel="Reminder before a consultation (hours)" /></Field>
    <Field label="Open consultation requests per member"><Input value={nums.max_open_appointments ?? ''} onChangeText={(v) => setNums({ ...nums, max_open_appointments: v })} keyboardType="number-pad" onBlur={() => set('max_open_appointments', Number(nums.max_open_appointments))} accessibilityLabel="Open consultation requests per member" /></Field>
    <View><P small style={{ fontWeight: '600' }}>Not used by the platform yet</P><P muted small>These settings are stored, but nothing in the platform reads them, so they have no control here: the review SLA, the feature switches (in-app messaging, bespoke plan requests, members booking consultations and tests themselves) and the notice banner switch.</P></View>
  </Card>;
}

function TemplatesCard({ show, tick }: { show: Show; tick: number }) {
  const t = useLoad<Templates>('admin-notification-templates', () => get('/admin/notification-templates'), [tick]);
  const [cat, setCat] = useState('');
  const [subject, setSubject] = useState(''); const [body, setBody] = useState(''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const d = t.data;
  useEffect(() => { if (d && cat) { setSubject(d.templates?.[cat]?.subject ?? ''); setBody(d.templates?.[cat]?.body ?? ''); } }, [d, cat]);
  if (!d) return <Card><Eyebrow>Notifications</Eyebrow><H2>Email wording per category</H2><ErrorBox error={t.error} onRetry={t.reload} />{t.error ? null : <Loading />}</Card>;
  const save = async () => {
    setBusy(true);
    try { await api('PUT', '/admin/notification-templates', { category: cat, subject, body, reason }); show(subject || body ? 'Template saved' : 'Template cleared; the built-in wording applies'); setReason(''); void t.reload(); }
    catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <Card>
    <Eyebrow>Notifications</Eyebrow><H2>Email wording per category</H2>
    <P small>{'Plain text with the placeholders {{name}}, {{title}} and {{body}}. Empty subject and body return a category to the built-in wording. Health detail never goes into a notification whatever the template says: the app shows it.'}</P>
    <Field label="Category"><FilterChips options={d.categories.map((c) => ({ value: c, label: `${label(c)}${d.templates?.[c] ? ' (custom)' : ''}` }))} value={cat} onChange={(v) => setCat(String(v))} /></Field>
    {cat ? <>
      <Field label="Subject"><Input value={subject} maxLength={120} onChangeText={setSubject} accessibilityLabel="Subject" /></Field>
      <Field label="Body"><Input value={body} maxLength={2000} onChangeText={setBody} multiline numberOfLines={5} style={{ minHeight: 110, textAlignVertical: 'top' }} accessibilityLabel="Body" /></Field>
      <Field label="Reason (recorded)"><Input value={reason} onChangeText={setReason} accessibilityLabel="Reason (recorded)" /></Field>
      <Button title="Save" small disabled={reason.trim().length < 3} busy={busy} onPress={save} style={{ alignSelf: 'flex-start' }} />
    </> : null}
  </Card>;
}

function IntegrationsCard() {
  const { can } = useAuth();
  const router = useRouter();
  return <Card>
    <Eyebrow>Integrations</Eyebrow><H2>Payments and messaging</H2>
    <P small>The Integrations page shows the payment provider and the email, SMS and push providers, and whether each is live or simulated. Secrets are never shown anywhere in the portal.</P>
    <P small>The laboratory integration is managed in the LabStack section by administrators who hold the “Manage the LabStack integration” permission.</P>
    <Row>
      <Button title="Open Integrations" variant="secondary" small onPress={() => router.push('/admin/integrations' as never)} />
      {can('labstack.manage') ? <Button title="Open LabStack" variant="ghost" small onPress={() => router.push('/admin/integrations/labstack' as never)} /> : null}
    </Row>
  </Card>;
}

function Metrics({ show, tick }: { show: Show; tick: number }) {
  const m = useLoad<{ items: Metric[] }>('admin-metrics-config', () => get('/admin/metrics-config'), [tick]);
  const items = m.data?.items ?? [];
  const set = async (x: Metric, enabled: boolean) => {
    try { const r = await patch<{ items: Metric[] }>(`/admin/metrics-config/${encodeURIComponent(x.metric)}`, { enabled }); if (r?.items) m.setData(r); else void m.reload(); show('Saved'); }
    catch (e) { show(errorText(e), 'error'); }
  };
  return <Card>
    <Eyebrow>Progress</Eyebrow><H2>Metrics members can log</H2>
    <ErrorBox error={m.error} onRetry={m.reload} />
    {!m.data && !m.error ? <Loading /> : items.map((x) => <ListItem key={x.metric} title={x.label} sub={`${x.unit} · ${x.min ?? '—'} to ${x.max ?? '—'}`} right={<Toggle value={x.enabled} onChange={(v) => set(x, v)} label={`${x.label} enabled`} />} />)}
    <P muted small>Self-reported values are never shown as laboratory measurements.</P>
  </Card>;
}
