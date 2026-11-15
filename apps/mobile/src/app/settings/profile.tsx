/* Profile details (PATCH /me/profile): name, phone, date of birth, gender, address, city, state, PIN code and goals,
   with what the coach sees said up front. Below, confirming the saved phone number for phone sign-in (while the
   phone_sign_in switch is on). Reached from Profile › Settings.
   The date of birth is written the way members read dates, DD/MM/YYYY (the slashes come by themselves as the digits are
   typed, so the number pad is enough); it is checked here and sent to the API as its ISO date. */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, errorText, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { useLoad } from '@/lib/useLoad';
import { Button, ErrorState, Field, FilterChip, fx, GlassCard, haptics, Input, Notice, Overlay, Pill, RingSpinner, T, Tag } from '@/fx';

const GOALS = ['Energy and sleep', 'Strength', 'Fat loss', 'Endurance', 'Longevity', 'Stress', 'Mobility', 'Habits'];
const GENDERS = [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' }, { value: 'prefer_not_to_say', label: 'Prefer not to say' }];

/** What is typed, as DD/MM/YYYY: the digits only, a slash after the day and after the month. */
function dobMask(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}

/** The API's ISO date as DD/MM/YYYY ("1990-01-31" → "31/01/1990"); anything else as it is. */
function dobShown(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso ?? '';
}

/** DD/MM/YYYY → the ISO date the API keeps, or null for a date that does not exist or is not a past date of birth. */
function dobIso(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  if (year < 1900 || d.getTime() > Date.now()) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export default function Profile() {
  const { refresh } = useAuth();
  const p = useLoad<any>('profile', () => get('/me/profile'), []);
  const [f, setF] = useState<any>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const features = useFeatures(true); // GET /public/config: confirming the number is offered only while phone_sign_in is on
  useEffect(() => { if (p.data && !f) setF({ name: p.data.name ?? '', phone: p.data.phone ?? '', gender: p.data.profile.gender ?? '', city: p.data.profile.city ?? '', state: p.data.profile.state ?? '', pincode: p.data.profile.pincode ?? '', address: p.data.profile.address ?? '', dateOfBirth: dobShown(p.data.profile.dateOfBirth), goals: p.data.profile.goals ?? [] }); }, [p.data, f]);
  const save = async () => {
    setMsg(null); setErrs({});
    const dob = String(f.dateOfBirth ?? '').trim();
    const dobSent = dob ? dobIso(dob) : null;
    if (dob && !dobSent) { setErrs({ dateOfBirth: 'Write it as DD/MM/YYYY, for example 31/01/1990.' }); setMsg({ kind: 'error', text: 'Check the date of birth.' }); haptics.error(); return; }
    setBusy(true);
    const body: Record<string, unknown> = { goals: f.goals };
    for (const k of ['name', 'phone', 'gender', 'city', 'state', 'pincode', 'address']) if (String(f[k]).trim()) body[k] = String(f[k]).trim();
    if (dobSent) body.dateOfBirth = dobSent;
    try { await patch('/me/profile', body); await refresh(); p.reload(); setMsg({ kind: 'success', text: 'Saved.' }); haptics.success(); }
    catch (e) { if (e instanceof ApiError) { const fe = e.fieldErrors(); if (Object.keys(fe).length) setErrs(fe); } setMsg({ kind: 'error', text: errorText(e) }); haptics.error(); } finally { setBusy(false); }
  };
  const set = (k: string) => (v: string) => setF({ ...f, [k]: v });
  return <Overlay kind="back" title="Profile" subtitle="Your details and goals" fallback="/(tabs)/profile?tab=settings"
    footer={f ? <Button title="Save" shape="flow" onPress={save} busy={busy} commit /> : undefined}>
    <ErrorState error={p.error} onRetry={p.reload} />
    {!f ? (p.error ? null : <View style={styles.loading}><RingSpinner label="Loading your profile" /></View>) : <>
      <Notice kind="info">Your coach sees your name, member ID, age, gender, goals, programme and plan, and your city and state unless Bioptime switches those off. Never your phone, email, address, PIN code or date of birth. Your address is used for home collections.</Notice>
      <Field label="Name" error={errs.name}><Input value={f.name} onChangeText={set('name')} autoComplete="name" /></Field>
      <Field label="Phone" error={errs.phone} hint="With the country code."><Input value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" /></Field>
      <Field label="Date of birth" error={errs.dateOfBirth} hint="Day, month and year, as 31/01/1990. The laboratory needs it, with your gender, to book a collection."><Input value={f.dateOfBirth} onChangeText={(v) => set('dateOfBirth')(dobMask(v))} keyboardType="number-pad" maxLength={10} mono placeholder="DD/MM/YYYY" /></Field>
      <Field label="Gender" error={errs.gender}>
        <View style={styles.chips} accessibilityRole="radiogroup">{GENDERS.map((g) => <FilterChip key={g.value} label={g.label} selected={f.gender === g.value} onPress={() => setF({ ...f, gender: g.value })} />)}</View>
      </Field>
      <Field label="Address" error={errs.address}><Input value={f.address} onChangeText={set('address')} multiline style={styles.multi} autoComplete="street-address" /></Field>
      <View style={styles.row}>
        <Field label="City" error={errs.city} style={styles.flex}><Input value={f.city} onChangeText={set('city')} /></Field>
        <Field label="State" error={errs.state} style={styles.flex}><Input value={f.state} onChangeText={set('state')} /></Field>
      </View>
      <Field label="PIN code" error={errs.pincode}><Input value={f.pincode} onChangeText={set('pincode')} keyboardType="number-pad" maxLength={6} mono /></Field>
      <Field label="Goals">
        <View style={styles.chips}>{GOALS.map((g) => <Tag key={g} label={g} selected={f.goals.includes(g)} onPress={() => setF({ ...f, goals: f.goals.includes(g) ? f.goals.filter((x: string) => x !== g) : [...f.goals, g] })} />)}</View>
      </Field>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
      {features?.has('phone_sign_in') && p.data?.phone ? <PhoneConfirm phone={p.data.phone} verified={!!p.data.phoneVerified} unsaved={f.phone.trim() !== p.data.phone} onChange={p.reload} /> : null}
    </>}
  </Overlay>;
}

type ConfirmStart = { sentTo: string; expiresInMinutes: number; delivered: boolean; message: string };

/* Confirming the number saved on the profile, so it can be used to sign in with a phone code: offered while the switch
   phone_sign_in is on and the saved number is not confirmed. POST /auth/phone/confirm/start sends a code to it and answers
   how it travels; while texts go to the outbox (delivered: false) no code arrives, so the screen shows the server's
   message and asks for no code. With a delivered code, POST /auth/phone/confirm { code }. Changing the number on the
   profile clears the confirmation (api/domain/members.ts). RATE_LIMITED shows the server's own message: it tells apart the
   number's 15-minute and daily limits (api/auth/phoneSignIn.ts checkPhoneLimit) and the route's limit (api/http/app.ts). */
function PhoneConfirm({ phone, verified, unsaved, onChange }: { phone: string; verified: boolean; unsaved: boolean; onChange: () => void }) {
  const [sent, setSent] = useState<ConfirmStart | null>(null);
  const [code, setCode] = useState('');
  const [note, setNote] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<'start' | 'confirm' | null>(null);
  useEffect(() => { setSent(null); setCode(''); }, [phone, verified]);
  // a note about the previous number (“Number confirmed.”, a refusal) is not true of a new one; confirming keeps its note
  useEffect(() => { setNote(null); }, [phone]);
  const failed = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'INVALID_STATE' && (e.details as { code?: string } | undefined)?.code === 'PHONE_ALREADY_CONFIRMED') { setNote({ kind: 'success', text: 'This number is already confirmed.' }); onChange(); return; }
    if (e instanceof ApiError && e.code === 'PHONE_CODE_INVALID') setCode('');
    if (e instanceof ApiError && (e.code === 'PHONE_MISSING' || e.code === 'PHONE_IN_USE')) setSent(null);
    setNote({ kind: 'error', text: e instanceof ApiError && e.code === 'FEATURE_DISABLED' ? 'Confirming a number is not available right now.' : errorText(e) });
  };
  const start = async () => {
    setBusy('start'); setNote(null);
    try { setSent(await post<ConfirmStart>('/auth/phone/confirm/start', {})); setCode(''); }
    catch (e) { failed(e); } finally { setBusy(null); }
  };
  const confirm = async () => {
    if (code.length !== 6 || busy) return;
    setBusy('confirm'); setNote(null);
    try { await post('/auth/phone/confirm', { code: code.trim() }); setNote({ kind: 'success', text: 'Number confirmed.' }); onChange(); }
    catch (e) { failed(e); } finally { setBusy(null); }
  };
  return <GlassCard style={styles.card}>
    <View style={styles.cardHead}><T v="cardTitle" accessibilityRole="header" style={styles.flex}>Phone sign-in</T><Pill tone={verified ? 'success' : 'warning'}>{verified ? 'Confirmed' : 'Not confirmed'}</Pill></View>
    {verified ? <T v="bodySm" color={fx.ink.a70}>{`${phone} is confirmed. You can sign in with a phone code for it from the sign-in screen.`}</T> : <View style={styles.gap}>
      <T v="bodySm" color={fx.ink.a70}>{`Confirm ${phone} to sign in with a six-digit code for it instead of your password.`}</T>
      {unsaved ? <T v="caption" color={fx.ink.a55}>Save your details first: the number confirmed is the one saved on your profile.</T> : null}
      {sent ? <Notice kind="info">{sent.message}</Notice> : null}
      {sent?.delivered ? <>
        <Field label="Six-digit code" hint={`Sent to ${sent.sentTo}. It works once, for ${sent.expiresInMinutes} minutes; five wrong tries end it.`}><Input value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" maxLength={6} mono onSubmitEditing={confirm} /></Field>
        <Button title="Confirm" onPress={confirm} busy={busy === 'confirm'} disabled={code.length !== 6 || busy !== null} />
      </> : null}
      {/* no second request while texts go to the outbox: the answer already says no code will arrive */}
      {!sent || sent.delivered ? <Button title={sent ? 'Send a new code' : 'Confirm this number'} variant="soft" onPress={start} busy={busy === 'start'} disabled={unsaved || busy !== null} /> : null}
    </View>}
    {note ? <Notice kind={note.kind} style={styles.note}>{note.text}</Notice> : null}
  </GlassCard>;
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 48, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  multi: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  card: { marginTop: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  gap: { gap: 12 },
  note: { marginTop: 12 },
});
