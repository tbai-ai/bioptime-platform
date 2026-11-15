/* Notifications, a route every role may open (root layout SHARED_ROUTES). Two bodies in one file:
   - a member gets the client app's screen (BUILD_PLAN §6.2): the overlay chrome, the notifications as rows that open
     what they are about (lib/notificationRoute) and are marked read on the way, "Mark all read", the channel switches
     and the quiet hours (FxQuietHours, the same copy and the same API call as the staff body);
   - a coach or an administrator gets today's body unchanged (Notifications and QuietHours below, with the staff kit).
   The quiet-hours helpers and every quiet-hours sentence stay in this file: the portal's copy is checked against them
   (portalShared). */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { api, errorText, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Button, Card, Empty, ErrorBox, Eyebrow, Field, H2, Input, Notice, P, Row, Screen, StaleBanner } from '@/components/ui';
import { colors, space } from '@/theme';
import {
  Button as FxButton, EmptyState, ErrorState, Eyebrow as FxEyebrow, Field as FxField, fx, GlassCard, Input as FxInput, Notice as FxNotice,
  Overlay, P as FxP, pollUpdates, RowDivider, StaleBanner as FxStaleBanner, T, toast, Toggle, useFocusRefresh,
} from '@/fx';
import { NotificationRow } from '@/screens/home/Inbox';
import type { AppNotice } from '@/screens/home/data';

/* Quiet hours as the API keeps them (PUT /notification-preferences/quiet-hours; api/domain/reminders.ts): minutes after
   local midnight in the person's time zone, a start and an end or neither. A window may cross midnight; equal ends would
   mean none, so they are refused here. Inside the window a reminder from the reminder queue is written as an in-app
   notification only and nothing else goes out for it, then or later; notifications sent directly (consultation
   reminders, messages, results, security messages) are not affected. The portal has the same helpers in
   dashboard/src/pages/client/quietHours.ts. */
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const clockToMinute = (s: string): number | null => { const m = CLOCK_RE.exec(s.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const minuteToClock = (n: number | null | undefined): string => (n === null || n === undefined || !Number.isInteger(n) || n < 0 || n > 1439 ? '' : `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`);
const savedQuietHours = (p: any): { start: number; end: number } | null => (typeof p?.quiet_start_minute === 'number' && typeof p?.quiet_end_minute === 'number' && p.quiet_start_minute !== p.quiet_end_minute ? { start: p.quiet_start_minute, end: p.quiet_end_minute } : null);
const zoneName = (tz: string | null | undefined) => (!tz || tz === 'Asia/Kolkata' ? 'India Standard Time' : tz);

/** The staff body (coach, administrator): unchanged. */
function Notifications() {
  const n = useLoad<any>('notifications', () => get('/notifications?limit=50'), []);
  const prefs = useLoad<any>('notification-prefs', () => get('/notification-preferences'), []);
  const [toast, setToast] = useState<string | null>(null);
  const readAll = async () => { try { await post('/notifications/read', { all: true }); await n.reload(); } catch (e) { setToast(errorText(e)); } };
  const setPref = async (key: string, value: boolean) => { try { const r = await patch('/notification-preferences', { [key]: value }); prefs.setData(r); } catch (e) { setToast(errorText(e)); } };
  const p = prefs.data;
  return <Screen refreshing={n.loading} onRefresh={() => { void n.reload(); void prefs.reload(); }}>
    <StaleBanner at={n.stale} /><ErrorBox error={n.error} onRetry={n.reload} />
    {toast ? <Notice kind="error">{toast}</Notice> : null}
    <Card><Row between><Eyebrow>In the app</Eyebrow>{n.data?.items?.some((x: any) => !x.read_at) ? <Button title="Mark all read" small variant="ghost" onPress={readAll} /> : null}</Row>
      {n.data?.items?.length ? n.data.items.map((x: any) => <View key={x.id} style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: x.read_at ? 0.7 : 1 }}><Row between><Text style={{ color: colors.text, fontWeight: x.read_at ? '400' : '700', flex: 1 }}>{x.title}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{relative(x.created_at)}</Text></Row><Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{x.body}</Text><Text style={{ color: colors.disabled, fontSize: 11, marginTop: 2 }}>{label(x.category)}</Text></View>) : <Empty title="Nothing yet" />}
    </Card>
    <Card><Eyebrow>Channels</Eyebrow><P muted small>Security messages (password resets and changes) are always sent. Health details never appear in a notification; the app shows them. Notifications reach you in the app and by email; push, SMS and lock-screen detail are not available yet.</P>
      {p ? (['email', 'reminders', 'marketing'] as const).map((k) => <Row key={k} between style={{ paddingVertical: 6 }}><Text style={{ color: colors.text }}>{label(k)}</Text><Switch value={!!p[k]} onValueChange={(v) => setPref(k, v)} trackColor={{ true: colors.brand, false: colors.borderStrong }} thumbColor="#fff" /></Row>) : null}
    </Card>
    {p ? <QuietHours prefs={p} onSaved={(r) => prefs.setData(r)} /> : null}
  </Screen>;
}

function QuietHours({ prefs, onSaved }: { prefs: any; onSaved: (prefs: any) => void }) {
  const profile = useLoad<any>('profile', () => get('/me/profile'), []);
  const saved = savedQuietHours(prefs);
  const [start, setStart] = useState(minuteToClock(saved?.start));
  const [end, setEnd] = useState(minuteToClock(saved?.end));
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => { setStart(minuteToClock(saved?.start)); setEnd(minuteToClock(saved?.end)); }, [saved?.start, saved?.end]);
  const s = clockToMinute(start), e = clockToMinute(end);
  const usable = s !== null && e !== null && s !== e;
  const same = s !== null && s === e;
  const put = async (which: 'save' | 'clear', body: { startMinute: number | null; endMinute: number | null }) => {
    setBusy(which); setMsg(null);
    try { const r = await api('PUT', '/notification-preferences/quiet-hours', body); onSaved(r); setMsg({ kind: 'success', text: which === 'save' ? 'Quiet hours saved.' : 'Quiet hours turned off.' }); }
    catch (err) { setMsg({ kind: 'error', text: errorText(err) }); } finally { setBusy(null); }
  };
  return <Card><Eyebrow>Reminders</Eyebrow><H2>Quiet hours</H2>
    <P muted small>Habit, check-in, blood test preparation and live session reminders that fall due inside your quiet hours appear only here in the app and in the portal, with no email, and are not sent again afterwards. Everything else arrives as usual, including consultation reminders, messages from your coach, results and security messages.</P>
    {!prefs.reminders ? <P muted small>Reminders is switched off above, so those reminders are not sent at all for now.</P> : null}
    <P small>{saved ? `On: ${minuteToClock(saved.start)} until ${minuteToClock(saved.end)}` : 'Off'}</P>
    {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
    <Field label="From" hint="HH:MM, 24-hour"><Input value={start} onChangeText={setStart} placeholder="22:00" maxLength={5} keyboardType="numbers-and-punctuation" /></Field>
    <Field label="Until" error={same ? 'Choose an end that differs from the start.' : undefined} hint={`Times are ${zoneName(profile.data?.profile?.timezone)}. A window can run past midnight, for example 22:00 until 07:00.`}><Input value={end} onChangeText={setEnd} placeholder="07:00" maxLength={5} keyboardType="numbers-and-punctuation" /></Field>
    <Row><Button title="Save quiet hours" small busy={busy === 'save'} disabled={!usable || busy !== null} onPress={() => { if (usable) void put('save', { startMinute: s, endMinute: e }); }} style={{ flex: 1 }} />{saved ? <Button title="Turn off" variant="ghost" small busy={busy === 'clear'} disabled={busy !== null} onPress={() => void put('clear', { startMinute: null, endMinute: null })} /> : null}</Row>
  </Card>;
}

/* ---------- the member's screen ---------- */

export default function NotificationsRoute() {
  const { user } = useAuth();
  return user && user.role !== 'member' ? <Notifications /> : <FxNotifications />;
}

const CHANNELS = ['email', 'reminders', 'marketing'] as const;

function FxNotifications() {
  const n = useLoad<{ items: AppNotice[]; unread: number }>('notifications', () => get('/notifications?limit=50'), []);
  const prefs = useLoad<any>('notification-prefs', () => get('/notification-preferences'), []);
  const [busy, setBusy] = useState(false);
  useFocusRefresh(() => Promise.all([n.reload(), prefs.reload()]));
  const items = n.data?.items ?? [];
  const p = prefs.data;
  const readAll = async () => {
    setBusy(true);
    try { await post('/notifications/read', { all: true }); await n.reload(); void pollUpdates(); }
    catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  const open = (x: AppNotice, route: string | null) => {
    if (!x.read_at) {
      n.setData({ ...(n.data ?? { items: [], unread: 0 }), items: items.map((i) => (i.id === x.id ? { ...i, read_at: new Date().toISOString() } : i)), unread: Math.max(0, (n.data?.unread ?? 1) - 1) });
      void post('/notifications/read', { ids: [x.id] }).then(() => pollUpdates(), () => undefined);
    }
    if (route) router.push(route);
  };
  const setPref = async (key: string, value: boolean) => {
    const before = p;
    prefs.setData({ ...p, [key]: value });
    try { const r = await patch('/notification-preferences', { [key]: value }); prefs.setData(r); }
    catch (e) { prefs.setData(before); toast.error(errorText(e)); }
  };
  const unread = items.some((x) => !x.read_at);
  return <Overlay title="Notifications" subtitle={n.data ? (n.data.unread ? `${n.data.unread} unread` : 'All read') : undefined} kind="back" fallback="/(tabs)">
    <FxStaleBanner at={n.stale} />
    <ErrorState error={n.error} onRetry={n.reload} />
    <GlassCard padding={0}>
      <View style={fxs.cardHead}>
        <FxEyebrow kind="label">In the app</FxEyebrow>
        {unread ? <FxButton title="Mark all read" variant="link" iconRight={null} busy={busy} onPress={() => { void readAll(); }} /> : null}
      </View>
      {items.length ? <View style={fxs.rows}>{items.map((x) => <NotificationRow key={x.id} n={x} onOpen={open} lines={3} />)}</View>
        : n.data ? <EmptyState icon="bell" title="Nothing yet" body="Messages from your coach, results, bookings and reminders appear here." /> : null}
    </GlassCard>
    <GlassCard>
      <FxEyebrow kind="label">Channels</FxEyebrow>
      <FxP muted small style={fxs.gapTop}>Security messages (password resets and changes) are always sent. Health details never appear in a notification; the app shows them. Notifications reach you in the app and by email; push, SMS and lock-screen detail are not available yet.</FxP>
      {p ? CHANNELS.map((k, i) => <View key={k}>
        {i ? <RowDivider /> : null}
        <View style={fxs.switchRow}>
          <T v="section" style={fxs.flex}>{label(k)}</T>
          <Toggle value={!!p[k]} label={label(k)} onChange={(v) => { void setPref(k, v); }} />
        </View>
      </View>) : null}
    </GlassCard>
    {p ? <FxQuietHours prefs={p} onSaved={(r) => prefs.setData(r)} /> : null}
  </Overlay>;
}

/** The member's quiet hours: the same window, rules, sentences and API call as QuietHours above, in the client look. */
function FxQuietHours({ prefs, onSaved }: { prefs: any; onSaved: (prefs: any) => void }) {
  const profile = useLoad<any>('profile', () => get('/me/profile'), []);
  const saved = savedQuietHours(prefs);
  const [start, setStart] = useState(minuteToClock(saved?.start));
  const [end, setEnd] = useState(minuteToClock(saved?.end));
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => { setStart(minuteToClock(saved?.start)); setEnd(minuteToClock(saved?.end)); }, [saved?.start, saved?.end]);
  const s = clockToMinute(start), e = clockToMinute(end);
  const usable = s !== null && e !== null && s !== e;
  const same = s !== null && s === e;
  const put = async (which: 'save' | 'clear', body: { startMinute: number | null; endMinute: number | null }) => {
    setBusy(which); setMsg(null);
    try { const r = await api('PUT', '/notification-preferences/quiet-hours', body); onSaved(r); setMsg({ kind: 'success', text: which === 'save' ? 'Quiet hours saved.' : 'Quiet hours turned off.' }); }
    catch (err) { setMsg({ kind: 'error', text: errorText(err) }); } finally { setBusy(null); }
  };
  return <GlassCard>
    <FxEyebrow kind="label">Reminders</FxEyebrow>
    <T v="heading" style={fxs.gapTop}>Quiet hours</T>
    <FxP muted small style={fxs.gapTop}>Habit, check-in, blood test preparation and live session reminders that fall due inside your quiet hours appear only here in the app and in the portal, with no email, and are not sent again afterwards. Everything else arrives as usual, including consultation reminders, messages from your coach, results and security messages.</FxP>
    {!prefs.reminders ? <FxP muted small style={fxs.gapTop}>Reminders is switched off above, so those reminders are not sent at all for now.</FxP> : null}
    <T v="sectionStrong" color={saved ? fx.hue.green400 : fx.ink.a70} style={fxs.state}>{saved ? `On: ${minuteToClock(saved.start)} until ${minuteToClock(saved.end)}` : 'Off'}</T>
    {msg ? <FxNotice kind={msg.kind} style={fxs.gapBottom}>{msg.text}</FxNotice> : null}
    <FxField label="From" hint="HH:MM, 24-hour" style={fxs.gapBottom}><FxInput value={start} onChangeText={setStart} placeholder="22:00" maxLength={5} keyboardType="numbers-and-punctuation" mono /></FxField>
    <FxField label="Until" error={same ? 'Choose an end that differs from the start.' : undefined} hint={`Times are ${zoneName(profile.data?.profile?.timezone)}. A window can run past midnight, for example 22:00 until 07:00.`} style={fxs.gapBottom}><FxInput value={end} onChangeText={setEnd} placeholder="07:00" maxLength={5} keyboardType="numbers-and-punctuation" mono /></FxField>
    <View style={fxs.actions}>
      <FxButton title="Save quiet hours" small busy={busy === 'save'} disabled={!usable || busy !== null} commit onPress={() => { if (usable) void put('save', { startMinute: s, endMinute: e }); }} style={fxs.flex} />
      {saved ? <FxButton title="Turn off" variant="ghost" busy={busy === 'clear'} disabled={busy !== null} onPress={() => void put('clear', { startMinute: null, endMinute: null })} /> : null}
    </View>
  </GlassCard>;
}

const fxs = StyleSheet.create({
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4, minHeight: 44 },
  rows: { paddingHorizontal: 16, paddingBottom: 8 },
  gapTop: { marginTop: 8 },
  gapBottom: { marginBottom: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  flex: { flex: 1 },
  state: { marginTop: 12, marginBottom: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
