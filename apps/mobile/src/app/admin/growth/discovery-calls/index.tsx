/* Admin › Discovery calls (the web's /admin/growth/discovery-calls, modules/growth/AdminDiscoveryCalls.tsx; growth module,
   growth.manage): people without an account who asked for a short call from the website, and the times the team offers
   on the discovery call page. Requests: filtered by status and by who handles them; a request opens its own screen
   (/admin/growth/discovery-calls/[id]). Offered times: offer a time (entered in India time), withdraw one with a reason.
   GET /admin/growth/discovery-calls?status&assigned → { items, counts } (the phone number only with
   members.view_restricted); GET /admin/growth/slots, POST /admin/growth/slots { startAt, endAt },
   POST …/:id/withdraw { reason }. Nothing here is kept on the device: the lists carry people's contact details. */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post, qs } from '@/lib/api';
import { relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { DISCOVERY_STATUSES, SOURCE_LABELS, cut, growthPill, istPartsToIso, type DiscoveryCall, type SlotRow } from '@/lib/admin/modules2/growth';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast, type ToastKind } from '@/components/adminA/toast';
import { PickerField, istLabel } from '@/components/coachModules/shared';
import { Button, Card, ErrorBox, Loading, Screen, Title } from '@/components/ui';
import { DatePickerField, EmptyState, FilterChips, RecordList, SegmentTabs, TimePickerField } from '@/components/workspace';
import { AdminModuleGate, Hint, ItemRow, SectionCard } from '@/components/adminModules2/frame';
import { Enter } from '@/motion';

const TITLE = 'Discovery calls';
type Tab = 'requests' | 'times';

export default function AdminDiscoveryCallsScreen() {
  return <AdminModuleGate title={TITLE} module="growth" permission="growth.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'times' ? 'times' : 'requests');
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  return <View style={{ flex: 1 }}><Screen refreshing={loading} onRefresh={() => setTick((n) => n + 1)}>
    <Enter><Title sub="People without an account who asked for a short call from the website. They were told someone will be in touch; nothing is booked until the team has spoken with them. A closed request is deleted with its notes 180 days after it was closed, and one nobody has changed for a year is deleted too.">{TITLE}</Title></Enter>
    <SegmentTabs items={[{ id: 'requests', label: 'Requests' }, { id: 'times', label: 'Offered times' }]} value={tab} onChange={(v) => setTab(v as Tab)} />
    {tab === 'requests' ? <Requests tick={tick} onLoading={setLoading} /> : <Times tick={tick} onLoading={setLoading} toast={toast} />}
  </Screen>{toast.float}</View>;
}

function Requests({ tick, onLoading }: { tick: number; onLoading: (b: boolean) => void }) {
  const router = useRouter();
  const [status, setStatus] = useState('open');
  const [assigned, setAssigned] = useState('');
  const list = useLoad<{ items: DiscoveryCall[]; counts: Record<string, number> }>(null, () => get(`/admin/growth/discovery-calls${qs({ status, assigned })}`), [status, assigned, tick]);
  useEffect(() => { onLoading(list.loading); }, [list.loading, onLoading]);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } void list.reload(); }, [list.reload])); // eslint-disable-line react-hooks/exhaustive-deps
  const items = list.data?.items ?? [];
  const c = list.data?.counts ?? {};
  return <>
    <FilterChips options={[{ value: 'open', label: `Open (${(c.new ?? 0) + (c.contacted ?? 0) + (c.booked ?? 0)})` }, ...DISCOVERY_STATUSES.map((s) => ({ value: s.id, label: `${s.label} (${c[s.id] ?? 0})` })), { value: 'all', label: 'All' }]} value={status} onChange={(v) => setStatus(String(v))} />
    <FilterChips options={[{ value: '', label: 'Anyone' }, { value: 'me', label: 'Mine' }, { value: 'none', label: 'Not assigned' }]} value={assigned} onChange={(v) => setAssigned(String(v))} />
    <ErrorBox error={list.error} onRetry={list.reload} />
    {!list.data ? (list.error ? null : <Loading />) : items.length ? <Enter index={1}><RecordList title="Discovery call requests">
      {items.map((r) => {
        const times = `${r.preferredSlots.map((s) => s.label).join('; ')}${r.preferredWindows ? `${r.preferredSlots.length ? '; ' : ''}“${r.preferredWindows}”` : ''}`;
        return <ItemRow key={r.id} title={r.name} onPress={() => router.push(`/admin/growth/discovery-calls/${r.id}`)}
          lines={[`${r.reference} · ${SOURCE_LABELS[r.source] ?? r.source}`, `${r.email}${r.phone ? ` · ${r.phone}` : ''}`, cut(r.goals), times ? `Preferred times: ${times}` : null, `Handled by: ${r.assignedTo?.name ?? 'Not assigned'}`, r.status === 'booked' && r.bookedAt ? `Booked: ${istLabel(r.bookedAt)}` : null, `Received ${relative(r.createdAt)}`]}
          pills={[growthPill(r.status)]} />;
      })}
    </RecordList></Enter> : <Card><EmptyState title="Nothing in this view" body="Requests from the discovery call page appear here." /></Card>}
  </>;
}

const LENGTHS = ['15', '20', '30', '45', '60'];

/** The Offered times tab; its toast is the screen's, floating over the page. */
function Times({ tick, onLoading, toast }: { tick: number; onLoading: (b: boolean) => void; toast: { show: (text: string, kind?: ToastKind) => void } }) {
  const list = useLoad<{ items: SlotRow[] }>('admin-growth-slots', () => get('/admin/growth/slots'), [tick]);
  useEffect(() => { onLoading(list.loading); }, [list.loading, onLoading]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [minutes, setMinutes] = useState('20');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [withdraw, setWithdraw] = useState<SlotRow | null>(null);
  const add = async () => {
    const startAt = istPartsToIso(date, time);
    if (!startAt) { setErr('Choose a date and time'); return; }
    setBusy(true); setErr('');
    try { await post('/admin/growth/slots', { startAt, endAt: new Date(Date.parse(startAt) + Number(minutes) * 60_000).toISOString() }); toast.show('Time offered on the website'); setDate(''); setTime(''); void list.reload(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const items = list.data?.items ?? [];
  return <>
    <Enter index={1}><SectionCard eyebrow="Offer a time" title="Times on the discovery call page">
      <Hint>Visitors may name up to three of these as preferences. Choosing one books nothing: you agree the time with them. Times are in India time (IST).</Hint>
      <DatePickerField label="Starts (IST)" value={date} onChange={(v) => { setDate(v); setErr(''); }} error={err || undefined} />
      <TimePickerField label="Time (IST)" value={time} onChange={(v) => { setTime(v); setErr(''); }} />
      <PickerField label="Length" value={minutes} options={LENGTHS.map((m) => ({ value: m, label: `${m} minutes` }))} onChange={setMinutes} />
      <Button title="Offer this time" small busy={busy} disabled={!date} onPress={add} style={{ alignSelf: 'flex-start' }} />
    </SectionCard></Enter>
    <ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Loading /> : list.data ? (items.length ? <RecordList title="Offered times">
      {items.map((s) => <ItemRow key={s.id} title={`${s.label}${s.past ? ' · past' : ''}`} lines={[`Open requests naming it: ${s.requests}`]} pills={[growthPill(s.status)]}
        actions={s.status === 'published' && !s.past ? <Button title="Withdraw" variant="ghost" small onPress={() => setWithdraw(s)} /> : undefined} />)}
    </RecordList> : <Card><EmptyState title="No times offered" body="Without offered times, visitors write when suits them in their own words." /></Card>) : null}
    <ReasonSheet open={!!withdraw} onClose={() => setWithdraw(null)} title={`Stop offering ${withdraw?.label ?? ''}?`} confirmLabel="Withdraw" body="The website stops offering it. Requests that already named it keep it, marked as no longer offered."
      onConfirm={async (reason) => { const s = withdraw; if (!s) return; await post(`/admin/growth/slots/${s.id}/withdraw`, { reason }); toast.show('Withdrawn'); void list.reload(); }} />
  </>;
}
