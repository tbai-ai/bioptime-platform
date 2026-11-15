/* The four cards of the coach's Settings, also used on My profile (the portal's pages/Settings.tsx: Security, Sessions,
   CoachProfile, Availability), with the portal's fields, buttons, toasts and notes. MFA enrolment is shown exactly as
   the portal shows it: only to administrators and owners (the API's /auth/mfa/* routes are auth: 'admin'); a coach sees
   the MFA pill and the password form. */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api, errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, relative } from '@/lib/format';
import { clockToMinutes, istToIso, minutesToClock, WEEKDAYS } from '@/lib/coach/core/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, Pill, Row } from '@/components/ui';
import { DatePickerField, KeyValue, TimePickerField } from '@/components/workspace';
import { CardHead, Code, Muted, PickerField, Small, TextArea, Tile, ToastView, useToast } from './shared';
import { space } from '@/theme';

/* ---------- Security ---------- */

export function SecurityCard() {
  const { user, refresh } = useAuth();
  const { toast, show } = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const change = async () => {
    setBusy(true);
    try { await post('/auth/password/change', { currentPassword: cur, newPassword: next }); setCur(''); setNext(''); show('Password changed; other sessions signed out'); }
    catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const privileged = user?.role === 'admin' || user?.role === 'owner';
  return <Card>
    <CardHead eyebrow="Security" title="Password and MFA" right={<Pill tone={user?.mfaEnabled ? 'success' : 'warning'}>{user?.mfaEnabled ? 'MFA on' : 'MFA off'}</Pill>} />
    <ToastView toast={toast} />
    <Field label="Current password"><Input value={cur} onChangeText={setCur} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" accessibilityLabel="Current password" /></Field>
    <Field label="New password" hint="At least 10 characters."><Input value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" accessibilityLabel="New password" /></Field>
    <Button title="Change password" small variant="secondary" busy={busy} disabled={!cur || next.length < 10} onPress={change} style={{ alignSelf: 'flex-start' }} />
    {privileged ? <View style={{ gap: space.sm, marginTop: space.sm }}>
      {!user?.mfaEnabled && !mfa ? <Button title="Set up authenticator (MFA)" small onPress={async () => { try { setMfa(await post('/auth/mfa/setup')); } catch (e) { show(errorText(e), 'error'); } }} style={{ alignSelf: 'flex-start' }} /> : null}
      {mfa ? <>
        <Notice kind="info" title="Add this secret to your authenticator app"><View><Small>Secret:</Small><Code>{mfa.secret}</Code><Small>{mfa.otpauth}</Small></View></Notice>
        <Field label="Code from the app"><Input value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} accessibilityLabel="Code from the app" /></Field>
        <Button title="Confirm" small onPress={async () => { try { await post('/auth/mfa/confirm', { code }); setMfa(null); setCode(''); show('MFA enabled'); await refresh(); } catch (e) { show(errorText(e), 'error'); } }} style={{ alignSelf: 'flex-start' }} />
      </> : null}
      {user?.mfaEnabled ? <Row><Input placeholder="Current code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} style={{ maxWidth: 160 }} accessibilityLabel="Current code" /><Button title="Disable MFA" small variant="danger" onPress={async () => { try { await post('/auth/mfa/disable', { code }); setCode(''); show('MFA disabled'); await refresh(); } catch (e) { show(errorText(e), 'error'); } }} /></Row> : null}
    </View> : null}
  </Card>;
}

/* ---------- Sessions ---------- */

type Session = { id: string; kind: string; user_agent: string | null; ip?: string | null; last_seen_at: string };

export function SessionsCard() {
  const s = useLoad<{ items: Session[]; current: string }>(null, () => get('/auth/sessions'), []);
  const { toast, show } = useToast();
  const [ending, setEnding] = useState('');
  const d = s.data;
  const end = async (x: Session) => { setEnding(x.id); try { await api('DELETE', `/auth/sessions/${x.id}`); show('Session signed out'); void s.reload(); } catch (e) { show(errorText(e), 'error'); } finally { setEnding(''); } };
  return <Card>
    <CardHead eyebrow="Devices" title="Active sessions" />
    <ToastView toast={toast} />
    <ErrorBox error={s.error} onRetry={s.reload} />
    {!d ? (s.error ? null : <Loading />) : d.items.map((x) => <Row key={x.id} between style={{ paddingVertical: space.sm, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <View style={{ flex: 1, minWidth: 0 }}><Small style={{ color: undefined }}>{`${x.kind}${x.id === d.current ? ' · this one' : ''}`}</Small><Muted>{`${(x.user_agent ?? '').slice(0, 60) || 'unknown device'}${x.ip ? ` · ${x.ip}` : ''}`}</Muted><Muted>{`Last seen ${relative(x.last_seen_at)}`}</Muted></View>
      {x.id !== d.current ? <Button title="Sign out" small variant="ghost" busy={ending === x.id} onPress={() => end(x)} /> : null}
    </Row>)}
  </Card>;
}

/* ---------- Profile form ---------- */

type Form = { displayName: string; bio: string; expertise: string; languages: string; city: string };

export function CoachProfileCard({ onSaved }: { onSaved?: () => void }) {
  const p = useLoad<any>('coach-profile', () => get('/coach/profile'), []);
  const { toast, show } = useToast();
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const d = p.data;
  useEffect(() => { if (d) setF({ displayName: d.displayName ?? '', bio: d.bio ?? '', expertise: (d.expertise ?? []).join(', '), languages: (d.languages ?? []).join(', '), city: d.city ?? '' }); }, [d]);
  const save = async () => {
    if (!f) return;
    setBusy(true);
    try { await api('PATCH', '/coach/profile', { displayName: f.displayName, bio: f.bio, expertise: f.expertise.split(',').map((s) => s.trim()).filter(Boolean), languages: f.languages.split(',').map((s) => s.trim()).filter(Boolean), city: f.city }); show('Profile saved'); void p.reload(); onSaved?.(); }
    catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <Card>
    <CardHead eyebrow="Profile" title="What members see" />
    <Muted>Designation, qualifications and scope are set by Bioptime</Muted>
    <ToastView toast={toast} />
    <ErrorBox error={p.error} onRetry={p.reload} />
    {!f ? (p.error ? null : <Loading />) : <>
      <Field label="Display name"><Input value={f.displayName} onChangeText={(v) => setF({ ...f, displayName: v })} maxLength={120} accessibilityLabel="Display name" /></Field>
      <Field label="Bio"><TextArea rows={3} value={f.bio} onChangeText={(v) => setF({ ...f, bio: v })} maxLength={2000} accessibilityLabel="Bio" /></Field>
      <Field label="Expertise" hint="Comma separated."><Input value={f.expertise} onChangeText={(v) => setF({ ...f, expertise: v })} accessibilityLabel="Expertise" /></Field>
      <Field label="Languages" hint="Comma separated."><Input value={f.languages} onChangeText={(v) => setF({ ...f, languages: v })} accessibilityLabel="Languages" /></Field>
      <Field label="City"><Input value={f.city} onChangeText={(v) => setF({ ...f, city: v })} accessibilityLabel="City" /></Field>
      <Button title="Save" small busy={busy} onPress={save} style={{ alignSelf: 'flex-start' }} />
      <Muted>Qualifications and scope are set by an administrator and shown to members only once verified.</Muted>
    </>}
  </Card>;
}

/* ---------- Availability ---------- */

type Rule = { weekday: number; start: string; end: string; slot: number };
const SLOTS = [15, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} min` }));
const DAYS = WEEKDAYS.map((d, i) => ({ value: String(i), label: d }));

export function AvailabilityCard({ onChanged }: { onChanged?: () => void }) {
  const a = useLoad<any>('coach-availability', () => get('/coach/availability'), []);
  // the card is tall: each message is drawn next to the part that caused it (hours, status or blocks), never far above it
  const { toast, show: showToast } = useToast();
  const [toastAt, setToastAt] = useState<'hours' | 'status' | 'block'>('hours');
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [block, setBlock] = useState({ startDate: '', startTime: '', endDate: '', endTime: '', reason: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const d = a.data;
  useEffect(() => { if (d && !rules) setRules((d.rules as any[]).map((r) => ({ weekday: r.weekday, start: minutesToClock(r.start_minute), end: minutesToClock(r.end_minute), slot: r.slot_minutes ?? 30 }))); }, [d, rules]);
  const sectionOf = (key: string): 'hours' | 'status' | 'block' => (key === 'status' ? 'status' : key === 'hours' ? 'hours' : 'block');
  let current: 'hours' | 'status' | 'block' = 'hours';
  const show = (text: string, kind?: 'ok' | 'error') => { setToastAt(current); showToast(text, kind); };
  const run = async (key: string, fn: () => Promise<void>) => { current = sectionOf(key); setBusy(key); try { await fn(); } catch (e) { show(errorText(e), 'error'); } finally { setBusy(null); } };
  const save = () => run('hours', async () => {
    const body = (rules ?? []).map((r) => ({ weekday: r.weekday, startMinute: clockToMinutes(r.start) ?? -1, endMinute: clockToMinutes(r.end) ?? -1, slotMinutes: r.slot }));
    if (body.some((r) => r.startMinute < 0 || r.endMinute < 0)) throw new Error('Write each start and end as HH:MM on the 24-hour clock.');
    await api('PUT', '/coach/availability', { rules: body }); show('Working hours saved'); setRules(null); void a.reload(); onChanged?.();
  });
  const setStatus = (available: boolean) => {
    if (reason.trim().length < 3) { current = 'status'; show('Say why first; the reason is recorded.', 'error'); return; }
    void run('status', async () => { await post('/coach/availability/status', { available, ...(until ? { unavailableUntil: until } : {}), reason: reason.trim() }); show(available ? 'You are available' : 'Marked away; your assignments are paused'); setReason(''); setUntil(''); void a.reload(); onChanged?.(); });
  };
  const addBlock = () => run('block', async () => {
    const startAt = istToIso(block.startDate, block.startTime), endAt = istToIso(block.endDate, block.endTime);
    if (!startAt || !endAt) throw new Error('Write both ends of the block as a date (YYYY-MM-DD) and a time (HH:MM).');
    await post('/coach/availability/blocks', { startAt, endAt, ...(block.reason.trim() ? { reason: block.reason.trim() } : {}) }); show('Blocked'); setBlock({ startDate: '', startTime: '', endDate: '', endTime: '', reason: '' }); void a.reload();
  });
  const removeBlock = (id: string) => run(`rm-${id}`, async () => { await api('DELETE', `/coach/availability/blocks/${id}`); void a.reload(); });
  const setRule = (i: number, p: Partial<Rule>) => setRules((rs) => (rs ?? []).map((r, k) => (k === i ? { ...r, ...p } : r)));
  const blockOk = !!(block.startDate && block.startTime && block.endDate && block.endTime);
  return <Card>
    <CardHead eyebrow="Availability" title="Working hours, status, blocks" right={d ? <Pill tone={d.coach?.available ? 'success' : 'info'}>{d.coach?.available ? 'Available' : 'Away'}</Pill> : undefined} />
    <ErrorBox error={a.error} onRetry={a.reload} />
    {!d || !rules ? (a.error ? null : <Loading />) : <>
      <View style={{ gap: space.sm }}>
        {rules.map((r, i) => <Tile key={i}>
          <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}><PickerField label="Weekday" value={String(r.weekday)} options={DAYS} onChange={(v) => setRule(i, { weekday: Number(v) })} /></View>
            <View style={{ flex: 1 }}><PickerField label="Slot" value={String(r.slot)} options={SLOTS} onChange={(v) => setRule(i, { slot: Number(v) })} /></View>
          </Row>
          <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}><TimePickerField label="Start" value={r.start} onChange={(v) => setRule(i, { start: v })} /></View>
            <View style={{ flex: 1 }}><TimePickerField label="End" value={r.end} onChange={(v) => setRule(i, { end: v })} /></View>
          </Row>
          <Button title="Remove window" small variant="ghost" onPress={() => setRules((rs) => (rs ?? []).filter((_, k) => k !== i))} style={{ alignSelf: 'flex-start' }} />
        </Tile>)}
        {!rules.length ? <Muted>No working hours yet; members can book only inside your windows.</Muted> : null}
        <Row><Button title="Add window" small variant="ghost" onPress={() => setRules((rs) => [...(rs ?? []), { weekday: 1, start: '09:00', end: '12:00', slot: 30 }])} /><Button title="Save hours" small busy={busy === 'hours'} onPress={save} /></Row>
        {toastAt === 'hours' ? <ToastView toast={toast} /> : null}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: 'transparent', marginTop: space.md }}>
        <DatePickerField label="Away until (optional)" value={until} onChange={setUntil} />
        <Field label="Reason"><Input value={reason} onChangeText={setReason} placeholder="Leave, travel" maxLength={300} accessibilityLabel="Reason" /></Field>
        {d.coach?.available ? <Button title="Mark me away" small variant="danger" busy={busy === 'status'} disabled={reason.trim().length < 3} onPress={() => setStatus(false)} style={{ alignSelf: 'flex-start' }} /> : <Button title="Mark me available" small busy={busy === 'status'} disabled={reason.trim().length < 3} onPress={() => setStatus(true)} style={{ alignSelf: 'flex-start' }} />}
        {toastAt === 'status' ? <ToastView toast={toast} /> : null}
        <Muted style={{ marginTop: space.sm }}>Away pauses your assignments; your members are told their plan and bookings stay and messages wait for you, and Bioptime can reassign them if needed.</Muted>
      </View>
      <View style={{ marginTop: space.md }}>
        <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><View style={{ flex: 1 }}><DatePickerField label="Block from" value={block.startDate} onChange={(v) => setBlock({ ...block, startDate: v })} /></View><View style={{ flex: 1 }}><TimePickerField label="From time (IST)" value={block.startTime} onChange={(v) => setBlock({ ...block, startTime: v })} /></View></Row>
        <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><View style={{ flex: 1 }}><DatePickerField label="to" value={block.endDate} onChange={(v) => setBlock({ ...block, endDate: v })} /></View><View style={{ flex: 1 }}><TimePickerField label="To time (IST)" value={block.endTime} onChange={(v) => setBlock({ ...block, endTime: v })} /></View></Row>
        <Field label="Reason (optional)"><Input value={block.reason} onChangeText={(v) => setBlock({ ...block, reason: v })} maxLength={200} accessibilityLabel="Block reason" /></Field>
        <Button title="Add block" small variant="secondary" busy={busy === 'block'} disabled={!blockOk} onPress={addBlock} style={{ alignSelf: 'flex-start' }} />
        {toastAt === 'block' ? <ToastView toast={toast} /> : null}
        {(d.blocks as any[]).length ? <View style={{ marginTop: space.sm }}>{(d.blocks as any[]).map((b) => <Row key={b.id} between style={{ paddingVertical: space.xs, flexWrap: 'nowrap' }}><Small style={{ flex: 1 }}>{`Blocked ${fmtDateTime(b.start_at)} → ${fmtDateTime(b.end_at)}${b.reason ? ` · ${b.reason}` : ''}`}</Small><Button title="Remove" small variant="ghost" busy={busy === `rm-${b.id}`} onPress={() => { void removeBlock(b.id); }} /></Row>)}</View> : null}
      </View>
    </>}
  </Card>;
}

/** The "Professional record" card of My profile (set by Bioptime). */
export function ProfessionalRecordCard({ d }: { d: any }) {
  const { user } = useAuth();
  return <Card>
    <CardHead eyebrow="Set by Bioptime" title="Professional record" />
    <KeyValue rows={[['Designation', d.designation ?? '—'], ['Qualifications', (d.qualifications ?? []).join(', ') || 'None recorded'], ['Scope', (d.scope ?? []).join(', ') || '—'], ['Languages', (d.languages ?? []).join(', ') || '—'], ['Caseload limit', String(d.caseloadLimit ?? '—')], ['MFA', user?.mfaEnabled ? 'on' : 'off (optional for coaches)']]} />
    <Muted>These change through the administration workflow; ask the Bioptime team.</Muted>
  </Card>;
}
