/* Admin › LabStack (the web's /admin/integrations/labstack, pages/admin/LabStack.tsx; labstack.manage, admin workspace
   only: coaches and members never reach it). The connection state (GET /admin/integrations/labstack/status), the
   catalogue sync and the safety net (POST …/sync, …/safety-net, both audited server-side), for owners outside
   production a test webhook (POST …/test-webhook, reason recorded), and the provider's own console as links that open
   the system browser with LabStack's own sign-in: Bioptime embeds nothing and forwards no credential.
   Below the status card the LabStack operations module (flag 'labstackOps') adds the operations view from
   GET /admin/integrations/labstack/operations: counters, streams at a glance, "Breaching now" and "Escalations open"
   filterable by stream, recent activity, the catalogue summary, webhook and safety-net health, the partner-key card
   and the console's sections. While the module is off the page is the status card alone, as on the web.
   The counters are links, as on the web: each scrolls the screen to its card (components/adminB2/JumpScreen). The
   console links open a new tab on the web build and the system browser on a phone (parts openOutside). Nothing is
   requested without labstack.manage: the loaders are gated with RequirePermission's own test. */
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ApiError, errorText, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { fmtDateTime, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { gated, pillTone, useAllowed } from '@/lib/admin/b2/pill';
import { JumpScreen, JumpTarget, useJump } from '@/components/adminB2/JumpScreen';
import { ChoiceChips, DetailRow, LabStatusMark, MONO_FONT, MonoText, openOutside, RightPill, useToast } from '@/components/adminB2/parts';
import { Button, Card, Chip, Empty, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row, StaleBanner } from '@/components/ui';
import { KeyValue, RecordList, Sheet } from '@/components/workspace';
import { NotificationBell, notifyBadges, RequirePermission, RoleGate } from '@/components/workspaceShell';
import { Enter, MotionCard, PressDepth } from '@/motion';
import { colors, font, space } from '@/theme';

const CONSOLE_URL = 'https://integration.labstack.in/dashboard';
/* The console's own sections, with the addresses its sidebar uses. Each opens the system browser behind LabStack's sign-in. */
const CONSOLE_SECTIONS: Array<{ label: string; href: string }> = [
  { label: 'Orders', href: `${CONSOLE_URL}/orders` },
  { label: 'Appointments', href: `${CONSOLE_URL}/appointments?datePreset=ANY` },
  { label: 'Escalations', href: `${CONSOLE_URL}/escalations` },
  { label: 'Catalog', href: `${CONSOLE_URL}/catalog` },
  { label: 'Widget configs', href: `${CONSOLE_URL}/store/widget-configs` },
];
const WEBHOOK_STATUSES = ['PHLEBO_ASSIGNED', 'SAMPLE_COLLECTED', 'SAMPLE_PROCESSED', 'REPORT_DELIVERED', 'PATIENT_MISSED', 'SAMPLE_REJECTED', 'CANCELED'];

type LabStatus = { state: string; configured: boolean; mode: 'live' | 'standin'; vendor: string; lastCatalogueSync: string | null; lastWebhook: string | null; lastSafetyNet: string | null; openOrders: number; silent24h: number; failedCalls24h: number; keyExpiresAt: string | null; keyRejectedAt: string | null; catalogueCount: number | null; webhookAddress?: string; note?: string };

/** The console opens outside the app (a new tab on the web build, the system browser on a phone), never in a web view
 *  that could receive credentials. */
const openConsole = (href: string) => openOutside(href);

/* Administrators and owners only: anyone else sees the workspace notice, and nothing here asks the API. */
export default function AdminLabStack() {
  return <RoleGate workspace="admin"><AdminLabStackScreen /></RoleGate>;
}

function AdminLabStackScreen() {
  const { user } = useAuth();
  const allowed = useAllowed('labstack.manage');
  const lab = useLoad<LabStatus | null>(allowed ? 'admin-labstack-status' : null, gated(allowed, () => get<LabStatus>('/admin/integrations/labstack/status')), [allowed]);
  const config = useLoad<{ mode?: string } | null>(allowed ? 'public-config-mode' : null, gated(allowed, () => get<{ mode?: string }>('/public/config')), [allowed]);
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(false);
  const [tb, setTb] = useState({ bookingId: '', orderStatus: 'SAMPLE_COLLECTED', reason: '' });
  const [opsTick, setOpsTick] = useState(0); // reloads the operations view after Refresh, a sync or a safety-net run
  const opsOn = useFeatures(allowed)?.has('labstackOps') === true;
  const l = lab.data;
  const liveMode = l?.mode === 'live';
  const production = config.data?.mode === 'production';
  const refresh = () => { void lab.reload(); setOpsTick((t) => t + 1); };
  const run = async (what: 'sync' | 'safety-net') => {
    setBusy(what);
    try {
      const r = await post<Record<string, number | undefined>>(`/admin/integrations/labstack/${what}`);
      showToast(what === 'sync' ? `Catalogue synced${r.tests ?? r.count ? `: ${r.tests ?? r.count} tests` : ''}` : `Safety net: ${r.checked} checked, ${r.applied} applied, ${r.placed} placed`);
      refresh();
      notifyBadges(); // a sync or a safety-net run can open or close operations tasks, which the Operations badge counts
    } catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(''); }
  };
  const sendTest = async () => {
    setBusy('test');
    try { await post('/admin/integrations/labstack/test-webhook', tb); showToast('Test webhook requested; watch the booking timeline'); setTest(false); setTb({ bookingId: '', orderStatus: 'SAMPLE_COLLECTED', reason: '' }); }
    catch (e) { showToast(errorText(e), 'error'); } finally { setBusy(''); }
  };

  return <JumpScreen title="LabStack integration" sub="Home blood-collection partner. Bioptime talks to LabStack from the server only: catalogue, orders, status webhooks and reports. Coaches and members never see this page or the provider console; they see bookings and released reports inside Bioptime." refreshing={lab.loading} onRefresh={refresh}>
    <Stack.Screen options={{ title: 'LabStack', headerRight: () => <NotificationBell /> }} />
    <RequirePermission permission="labstack.manage">
      <Enter index={1}><Row between><View style={{ flex: 1 }} /><Button title="Refresh" variant="ghost" small onPress={refresh} /></Row></Enter>
      {toast}
      <StaleBanner at={lab.stale} /><ErrorBox error={lab.error} onRetry={lab.reload} />
      {lab.loading && !l ? <Loading /> : l ? <>
        {!liveMode ? <Enter index={2}><Notice kind="warning" title="Pending configuration: the stand-in vendor is answering">No LabStack credentials are set, so the server runs its built-in stand-in laboratory (simulated slots, orders and reports, clearly labelled). To connect the real service, set LABSTACK_API_KEY and LABSTACK_WEBHOOK_SECRET (and LABSTACK_BASE_URL for the sandbox) in the server environment, register the webhook address below with LabStack, restart, then run the catalogue sync. Nothing here claims a connection that was not verified.</Notice></Enter> : null}
        <MotionCard index={3} pressable={false}><Card accent={!liveMode}>
          <Row between><Eyebrow>Connection</Eyebrow><Pill tone={pillTone(liveMode ? 'active' : 'draft')}>{liveMode ? 'live' : 'stand-in'}</Pill></Row>
          <H2>{l.vendor ?? 'LabStack'}</H2>
          <KeyValue rows={[
            ['Credentials', liveMode ? `present (server environment)${l.keyExpiresAt ? `, key expires ${fmtDateTime(l.keyExpiresAt)}` : ''}` : 'not set'],
            // a node, not a string: the address has no spaces, so it takes the column's whole width and breaks inside itself
            ...(l.webhookAddress ? [{ label: 'Webhook address', value: <Text selectable style={{ alignSelf: 'stretch', color: colors.text, fontSize: font.small, fontFamily: MONO_FONT, textAlign: 'right' }}>{l.webhookAddress}</Text> }] : []),
            ['Last catalogue sync', l.lastCatalogueSync ? relative(l.lastCatalogueSync) : 'never'],
            ['Last webhook received', l.lastWebhook ? relative(l.lastWebhook) : 'none yet'],
            ['Last safety net', l.lastSafetyNet ? relative(l.lastSafetyNet) : 'not yet'],
            ['Open orders', <View style={{ alignItems: 'flex-end', gap: space.xs }}><P small>{String(l.openOrders)}</P>{l.silent24h ? <RightPill tone="warning">{`${l.silent24h} silent for 24 h`}</RightPill> : null}</View>],
            ['Failed calls, 24 h', <View style={{ alignItems: 'flex-end', gap: space.xs }}><P small>{String(l.failedCalls24h)}</P>{l.failedCalls24h > 0 ? <RightPill tone="warning">see Operations</RightPill> : null}</View>],
          ]} />
          <Row>
            <Button title="Sync catalogue now" small busy={busy === 'sync'} onPress={() => run('sync')} />
            <Button title="Run the safety net" small busy={busy === 'safety-net'} onPress={() => run('safety-net')} />
            {user?.role === 'owner' && config.data && !production ? <Button title="Send a test webhook" small variant="ghost" onPress={() => setTest(true)} /> : null}
          </Row>
          <P muted small>Webhooks are verified by signature and deduplicated; the safety net runs every 30 minutes and on demand; status moves forward only, with the documented exceptions. Secrets are never shown or editable here.</P>
        </Card></MotionCard>
        <MotionCard index={4} pressable={false}><Card>
          <Eyebrow>Provider console</Eyebrow><H2>LabStack dashboard</H2>
          <P small>The provider's own administration console. It opens in a new tab with LabStack's sign-in; Bioptime does not embed it and forwards no credential. Use it for what the API does not cover (account, invoices, support).</P>
          <Button title="Open the LabStack console" variant="secondary" small onPress={() => openConsole(CONSOLE_URL)} style={{ alignSelf: 'flex-start' }} />
          <P muted small>Administrators with this permission only. The link exists nowhere else in Bioptime.</P>
        </Card></MotionCard>
        <MotionCard index={5} pressable={false}><Card>
          <Eyebrow>What flows</Eyebrow><H2>Inside Bioptime</H2>
          {['Members book from their package entitlement; the order is placed with the laboratory after consent and profile checks.', 'Status webhooks move the booking through the seven agreed statuses; cancellations and reschedules are checked with the laboratory first.', 'Reports are released to the member only after the assigned coach has reviewed them, with the laboratory\'s values kept apart from the coach\'s note.', 'Collection addresses are never shown to coaches.'].map((t) => <P key={t} small>{`• ${t}`}</P>)}
        </Card></MotionCard>
        {opsOn ? <LabStackOperations tick={opsTick} /> : null}
      </> : null}
      <Sheet open={test} onClose={() => setTest(false)} title="Send one test webhook" footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Cancel" variant="secondary" onPress={() => setTest(false)} style={{ flex: 1 }} /><Button title="Send" busy={busy === 'test'} disabled={!tb.bookingId || tb.reason.trim().length < 3} onPress={sendTest} style={{ flex: 1 }} /></View>}>
        <P small>Owner only, never in production. The vendor sends a webhook for the booking at the chosen status; the order at the vendor does not change.</P>
        <Field label="Booking id"><Input value={tb.bookingId} onChangeText={(v) => setTb({ ...tb, bookingId: v })} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Booking id" /></Field>
        <Field label="Status"><ChoiceChips options={WEBHOOK_STATUSES.map((x) => ({ value: x, label: x }))} value={tb.orderStatus} onChange={(v) => setTb({ ...tb, orderStatus: v })} /></Field>
        <Field label="Reason (recorded)"><Input value={tb.reason} onChangeText={(v) => setTb({ ...tb, reason: v })} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Reason (recorded)" /></Field>
      </Sheet>
    </RequirePermission>
  </JumpScreen>;
}

/* ---------- LabStack operations (module labstackOps) ---------- */

type StreamKey = 'lab_orders' | 'appointments' | 'pharma_orders';
type Bucket = StreamKey | 'integration';
type StreamFilterValue = 'all' | Bucket;
type OpsType = { key: string; label: string; used: boolean; total: number | null; open: number | null; breaching: number | null; escalations: number | null; today: number | null; collectionsToday: number | null; byStatus: Record<string, number> | null };
type OpsStream = { key: StreamKey; label: string; used: boolean; open: number | null; breaching: number | null; escalations: number | null; today: number | null; types: OpsType[] };
type OpsBreach = { bookingId: string; reference: string; memberId: string; memberName: string | null; testName: string | null; stream: Bucket; orderType: string; status: string; vendorStatus: string | null; vendorOrderPlaced: boolean; kind: string; kindLabel: string; dueAt: string; overdueMinutes: number; flag: string | null };
type OpsEscalation = { id: string; source: 'task' | 'vendor_call'; kind: string; kindLabel: string; title: string; detail: string; status: string; ownerName: string | null; openedAt: string; lastAt: string; ageMinutes: number; stream: Bucket; bookingId: string | null; reference: string | null; memberName: string | null; count: number };
type OpsActivity = { at: string; bookingId: string; reference: string; testName: string | null; from: string | null; to: string; vendorStatus: string | null; source: string; note: string | null };
type OpsJob = { startedAt: string; finishedAt: string | null; ok: boolean | null } | null;
type Ops = {
  generatedAt: string; source: string; vendor: { mode: string; simulated: boolean };
  rules: { breaching: string; escalations: string; ordersToday: string; activity: string };
  counters: { breachingNow: number; escalationsOpen: number; labOrdersToday: number; collectionsToday: number; openLabOrders: number };
  streams: OpsStream[];
  breaching: { total: number; byStream: Record<Bucket, number>; truncated: boolean; items: OpsBreach[] };
  escalations: { total: number; byStream: Record<Bucket, number>; truncated: boolean; items: OpsEscalation[]; bySource?: { tasks: number; failedCalls: number; failedCallFailures: number }; coveredFailedCalls?: Record<string, number>; closedFailedCalls?: Record<string, number> };
  activity: { since: string; total: number; truncated: boolean; items: OpsActivity[] };
  catalogue: { enabled: number; enabledTests: number; enabledPackages: number; hidden: number; priced: number; unpriced: number; visibleUnpriced: number; lastSync: string | null; vendorItemsAtLastSync: number | null; syncEveryHours: number; nextSyncDue: string | null; lastSyncFailure: { at: string; message: string } | null; lastJob: OpsJob; labsSeen: number };
  health: { jobsEnabled: boolean; webhook: { state: 'ok' | 'silent' | 'none_yet'; lastReceivedAt: string | null; received24h: { applied: number; repeat: number; unknown_order: number; other: number; total: number }; rejected24h: number; silenceHours: number }; safetyNet: { state: 'ok' | 'late' | 'never'; lastRunAt: string | null; everyMinutes: number; lastJob: OpsJob }; failedCalls24h: number; failedCallsByCall: Record<string, number>; keyRejectedAt: string | null };
  partnerKey: { variable: string; configured: boolean; widget: { state: string; tokenMinting: string; missing: string[] }; generatedIn: string };
};

/** "3 h 20 min", "2 d 4 h": how long ago a deadline passed or a task opened. */
function span(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}
const show = (n: number | null) => (n === null ? '—' : String(n));
/** The calls to LabStack in plain words, for the escalation breakdown ("order placement 2"); anything else as named. */
const CALL_LABELS: Record<string, string> = { catalogue_sync: 'catalogue sync', placeOrder: 'order placement', cancelOrder: 'order cancellation', rescheduleOrder: 'reschedule', getSlots: 'slot lookup', getOrders: 'order status check', getReportRawValues: 'report values' };
const callList = (entries: Array<[string, number]>) => entries.map(([c, n]) => `${CALL_LABELS[c] ?? c} ${n}`).join(' · ');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The console's stream buckets as a filter; streams Bioptime does not book are listed but cannot be picked. */
function StreamFilter({ value, onChange, counts, total, integration }: { value: StreamFilterValue; onChange: (v: StreamFilterValue) => void; counts: Record<Bucket, number>; total: number; integration?: boolean }) {
  return <View style={{ gap: space.xs }}>
    <P muted small>Stream</P>
    <Row>
      <Chip selected={value === 'all'} onPress={() => onChange('all')}>{`All streams (${total})`}</Chip>
      <Chip selected={value === 'lab_orders'} onPress={() => onChange('lab_orders')}>{`Lab Orders (${counts.lab_orders ?? 0})`}</Chip>
      {integration ? <Chip selected={value === 'integration'} onPress={() => onChange('integration')}>{`Integration, no single order (${counts.integration ?? 0})`}</Chip> : null}
    </Row>
    <P muted small>Appointments: not booked through Bioptime · Pharma Orders: not booked through Bioptime</P>
  </View>;
}

/** One counter: a link, as on the web, that brings its card to the top of the screen. */
function Counter({ n, text, target, hot, sub }: { n: number; text: string; target: string; hot?: boolean; sub?: string }) {
  const jump = useJump();
  return <PressDepth style={{ flexBasis: '47%', flexGrow: 1 }}>
    <Pressable accessibilityRole="link" accessibilityLabel={`${text}: ${n}`} onPress={() => jump(target)} style={{ flexGrow: 1 }}>
      <Card accent={hot} style={{ flexGrow: 1 }}>
        <Eyebrow>{text}</Eyebrow>
        <Text style={{ color: colors.text, fontSize: font.title, fontWeight: '700' }}>{n}</Text>
        {sub ? <P muted small>{sub}</P> : null}
      </Card>
    </Pressable>
  </PressDepth>;
}

function LabStackOperations({ tick }: { tick: number }) {
  const { can } = useAuth();
  const router = useRouter();
  const ops = useLoad<Ops | { disabled: true }>('admin-labstack-ops', () => get<Ops>('/admin/integrations/labstack/operations').catch((e: unknown) => {
    if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') return { disabled: true as const };
    throw e;
  }), [tick]);
  const [bf, setBf] = useState<StreamFilterValue>('all');
  const [ef, setEf] = useState<StreamFilterValue>('all');
  const [allActivity, setAllActivity] = useState(false);

  if (ops.error) return <Notice kind="error" title="LabStack operations could not be loaded">{ops.error.message}</Notice>;
  const d = ops.data;
  if (!d) return <Loading />;
  if ('disabled' in d) return <Notice kind="info" title="LabStack operations is switched off"><Text style={{ color: colors.muted, fontSize: font.small, lineHeight: 19 }}>The operations view (counters, breaching and escalation lists, recent activity, catalogue and webhook health, the console shortcuts and the partner-key status) is part of the LabStack operations module, which is off. An administrator holding “Manage modules” can switch it on under Modules, with a reason. The status card above works without it.</Text>{can('modules.manage') ? <Button title="Open Modules" variant="secondary" small onPress={() => router.push('/admin/modules' as never)} style={{ alignSelf: 'flex-start', marginTop: space.sm }} /> : null}</Notice>;

  const home = d.streams.find((s) => s.key === 'lab_orders')?.types.find((t) => t.used) ?? null;
  // the order type Bioptime books, named as the server names it (labstackOps STREAMS): the streams note and the
  // by-status card name it as the web does
  const homeStream = d.streams.find((s) => s.types.some((t) => t.used)) ?? null;
  const homeName = home ? home.label.toLowerCase() : null;
  const breaching = d.breaching.items.filter((x) => bf === 'all' || x.stream === bf);
  const escalations = d.escalations.items.filter((x) => ef === 'all' || x.stream === ef);
  const activity = allActivity ? d.activity.items : d.activity.items.slice(0, 15);
  const covered = Object.entries(d.escalations.coveredFailedCalls ?? {});
  const closedCalls = Object.entries(d.escalations.closedFailedCalls ?? {});
  const src = d.escalations.bySource;
  const pk = d.partnerKey;
  const wh = d.health.webhook, sn = d.health.safetyNet, cat = d.catalogue;
  const whPill = wh.state === 'ok' ? <RightPill tone={pillTone('active')}>receiving</RightPill> : wh.state === 'silent' ? <RightPill tone={pillTone('exception')}>silent</RightPill> : <RightPill tone={pillTone('pending')}>none yet</RightPill>;
  const snPill = sn.state === 'ok' ? <RightPill tone={pillTone('active')}>on time</RightPill> : sn.state === 'late' ? <RightPill tone={pillTone('exception')}>late</RightPill> : <RightPill tone={pillTone('pending')}>not run yet</RightPill>;
  const job = (j: OpsJob) => (j ? `${relative(j.startedAt)} · ${j.ok === null ? 'running' : j.ok ? 'ok' : 'failed'}` : 'no run logged');

  return <View style={{ gap: space.md }}>
    <Card>
      <Row between><Eyebrow>Operations</Eyebrow><Button title="Refresh" variant="ghost" small onPress={ops.reload} /></Row>
      <H2>LabStack operations</H2>
      <P small>{`${d.source} Shown ${relative(d.generatedAt)}; times in India time.`}</P>
      {d.vendor.simulated ? <P muted small>Stand-in: these bookings and their statuses are simulated inside this server; no laboratory is involved.</P> : null}
    </Card>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
      <Counter n={d.counters.breachingNow} text="Breaching now" target="ls-breaching" hot={d.counters.breachingNow > 0} sub="oldest first below" />
      <Counter n={d.counters.escalationsOpen} text="Escalations open" target="ls-escalations" hot={d.counters.escalationsOpen > 0} sub={src ? `${plural(src.tasks, 'open task', 'open tasks')} · ${plural(src.failedCalls, 'failing call', 'failing calls')}` : 'tasks and failed calls'} />
      <Counter n={d.counters.labOrdersToday} text="Lab orders today" target="ls-streams" sub={`${d.counters.openLabOrders} open in all`} />
      <Counter n={d.counters.collectionsToday} text="Home collections today" target="ls-streams" sub="slots falling today" />
    </View>

    <JumpTarget id="ls-streams"><Card>
      <Eyebrow>Streams at a glance</Eyebrow><H2>Orders by LabStack order type</H2>
      {d.streams.map((s) => <View key={s.key} style={{ gap: space.xs, paddingVertical: space.xs }}>
        <P>{s.label}</P>
        {!s.used ? <P muted small>not booked through Bioptime</P> : null}
        {s.types.map((t) => <View key={`${s.key}:${t.key}`} style={{ paddingLeft: space.md }}>
          <P small style={t.used ? { fontWeight: '600' } : undefined}>{t.label}</P>
          <P muted small>{`Open ${show(t.open)} · Breaching ${show(t.breaching)} · Escalations ${show(t.escalations)} · Today ${show(t.today)} · All time ${show(t.total)}`}</P>
        </View>)}
      </View>)}
      <P muted small>{`${homeName ? `Every Bioptime booking is a ${homeName} collection. ` : ''}The other order types exist in LabStack’s console; Bioptime places none of them, so it has no figures for them (— rather than 0). ${d.rules.ordersToday}`}</P>
    </Card></JumpTarget>

    <JumpTarget id="ls-breaching"><Card>
      <Eyebrow>Oldest first</Eyebrow><H2>{`Breaching now (${d.breaching.total})`}</H2>
      <StreamFilter value={bf} onChange={setBf} counts={d.breaching.byStream} total={d.breaching.total} />
      {breaching.length ? <RecordList>
        {/* the web's four cells in order: booking, missed (kind and deadline), overdue, then the laboratory status mark
            with the vendor's status, the not-yet-placed note and the flag under it */}
        {breaching.map((b) => <DetailRow key={b.bookingId} title={b.reference} lines={[`${b.testName ?? '—'}${b.memberName ? ` · ${b.memberName}` : ''}`, `${b.kindLabel} · ${fmtDateTime(b.dueAt)}`, `Overdue ${span(b.overdueMinutes)}`]}>
          <LabStatusMark status={b.status} style={{ marginTop: space.xs }} />
          {[b.vendorStatus, !b.vendorOrderPlaced && 'order not yet placed with LabStack', b.flag].filter((x): x is string => !!x).map((x) => <P key={x} muted small>{x}</P>)}
        </DetailRow>)}
      </RecordList> : <Empty title="Nothing breaching" body={bf === 'all' ? 'No booking has missed its collection slot or expected report time.' : 'Nothing breaching in this stream.'} />}
      {d.breaching.truncated ? <P muted small>{`Showing the oldest ${d.breaching.items.length} of ${d.breaching.total}.`}</P> : null}
      <P muted small>{d.rules.breaching}</P>
      {can('integrations.manage') || can('reports.view') ? <Button title="Open Bloodwork" variant="ghost" small onPress={() => router.push('/admin/bloodwork' as never)} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card></JumpTarget>

    <JumpTarget id="ls-escalations"><Card>
      <Eyebrow>Oldest first</Eyebrow><H2>{`Escalations open (${d.escalations.total})`}</H2>
      <StreamFilter value={ef} onChange={setEf} counts={d.escalations.byStream} total={d.escalations.total} integration />
      {escalations.length ? <RecordList>
        {escalations.map((e) => <DetailRow key={e.id} title={e.kindLabel} lines={[e.title, e.detail, `${e.reference ?? '—'}${e.memberName ? ` · ${e.memberName}` : ''}`, `${span(e.ageMinutes)} ago · ${fmtDateTime(e.openedAt)}`, e.ownerName ?? (e.source === 'task' && 'unassigned')]} pills={[e.source === 'task' ? { label: label(e.status), tone: pillTone(e.status) } : { label: `${e.count} in 24 h`, tone: pillTone('failed') }]} />)}
      </RecordList> : <Empty title="No open escalations" body={ef === 'all' ? 'No laboratory task is open and no call to LabStack failed in the last 24 hours.' : 'No open escalations in this stream.'} />}
      {d.escalations.truncated ? <P muted small>{`Showing the oldest ${d.escalations.items.length} of ${d.escalations.total}.`}</P> : null}
      {src ? <KeyValue rows={[
        ['Open laboratory tasks', String(src.tasks)],
        ['Calls failing with no task, 24 h', `${src.failedCalls}${src.failedCalls > 0 ? ` (${plural(src.failedCallFailures, 'failure', 'failures')})` : ''}`],
        ['Failures counted under an open task', covered.length ? callList(covered) : 'none'],
        ['Failures whose task is closed', closedCalls.length ? `${callList(closedCalls)} (not counted)` : 'none'],
      ]} /> : null}
      <P muted small>{d.rules.escalations}</P>
      {can('operations.manage') ? <Button title="Open the operations queue" variant="ghost" small onPress={() => router.push('/(admin)/operations' as never)} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card></JumpTarget>

    <Card>
      <Eyebrow>Last 24 hours</Eyebrow><H2>{`Recent activity (${d.activity.total})`}</H2>
      {activity.length ? <RecordList>
        {activity.map((a, i) => <DetailRow key={`${a.bookingId}:${a.at}:${i}`} title={a.reference} lines={[a.testName, a.from && a.from !== a.to ? `${label(a.from)} → ${label(a.to)}` : label(a.to), a.vendorStatus, a.note, `${relative(a.at)} · ${fmtDateTime(a.at)} · ${label(a.source)}`]} />)}
      </RecordList> : <Empty title="Nothing moved in the last day" />}
      {d.activity.items.length > 15 || d.activity.truncated ? <Row>
        {d.activity.items.length > 15 ? <Button title={allActivity ? 'Show fewer' : `Show all ${d.activity.items.length}`} variant="ghost" small onPress={() => setAllActivity(!allActivity)} /> : null}
        {d.activity.truncated ? <P muted small>{`The latest ${d.activity.items.length} of ${d.activity.total} are listed.`}</P> : null}
      </Row> : null}
    </Card>

    <Card>
      {homeStream && home ? <Eyebrow>{`${homeStream.label} · ${home.label}`}</Eyebrow> : null}<H2>By status</H2>
      {/* each status as the web's laboratory status mark, its count at the end of the row */}
      {home?.byStatus ? <View>{Object.entries(home.byStatus).map(([s, n]) => <Row key={s} between style={{ paddingVertical: space.xs }}><LabStatusMark status={s} /><P small>{String(n)}</P></Row>)}</View> : <Empty title="No bookings yet" />}
      <P muted small>All bookings Bioptime has placed, by the seven shared statuses.</P>
    </Card>

    <Card>
      <Eyebrow>Catalogue</Eyebrow><H2>Tests and packages</H2>
      <KeyValue rows={[
        ['Enabled for members', `${cat.enabled} (${cat.enabledTests} tests, ${cat.enabledPackages} packages)`],
        ['Hidden', String(cat.hidden)],
        ['Priced', String(cat.priced)],
        ['Without a price', `${cat.unpriced}${cat.visibleUnpriced > 0 ? ` (${cat.visibleUnpriced} not hidden, still not bookable)` : ''}`],
        ['Last sync', cat.lastSync ? `${relative(cat.lastSync)}${cat.vendorItemsAtLastSync !== null ? ` · ${cat.vendorItemsAtLastSync} items from LabStack` : ''}` : 'never'],
        ['Next sync', `${cat.nextSyncDue ? fmtDateTime(cat.nextSyncDue) : d.health.jobsEnabled ? 'after the first sync' : 'background jobs are off: on demand only'} (every ${cat.syncEveryHours} h)`],
        ['Last sync job', job(cat.lastJob)],
        ...(cat.lastSyncFailure ? [['Last sync failure', `${relative(cat.lastSyncFailure.at)} · ${cat.lastSyncFailure.message}`] as [string, string]] : []),
        ['Laboratories on bookings', String(cat.labsSeen)],
      ]} />
      <P muted small>New tests from a sync stay hidden until Bioptime sets a price. LabStack’s own partner-lab list is in the console’s Catalog.</P>
    </Card>

    <Card>
      <Eyebrow>Health</Eyebrow><H2>Webhooks and safety net</H2>
      <KeyValue rows={[
        ['Webhooks', whPill],
        ['Last received', wh.lastReceivedAt ? relative(wh.lastReceivedAt) : 'none yet'],
        ['Received, 24 h', `${wh.received24h.total} (${wh.received24h.applied} applied, ${wh.received24h.repeat} repeats, ${wh.received24h.unknown_order} unknown orders)`],
        ['Rejected, 24 h', `${wh.rejected24h}${wh.rejected24h > 0 ? ' wrong or missing header' : ''}`],
        ['Safety net', snPill],
        ['Last run', `${sn.lastRunAt ? relative(sn.lastRunAt) : 'not yet'} (${d.health.jobsEnabled ? `every ${sn.everyMinutes} min` : 'background jobs are off: on demand only'})`],
        ['Last safety-net job', job(sn.lastJob)],
        ['Failed calls, 24 h', `${d.health.failedCalls24h}${Object.keys(d.health.failedCallsByCall).length > 0 ? ` (${Object.entries(d.health.failedCallsByCall).map(([c, n]) => `${c} ${n}`).join(', ')})` : ''}`],
        ...(d.health.keyRejectedAt ? [['API key rejected', fmtDateTime(d.health.keyRejectedAt)] as [string, string]] : []),
      ]} />
      <P muted small>{`Webhooks count as silent when orders are open and none has arrived for ${wh.silenceHours} hours; the safety net is late when two of its intervals pass without a run.`}</P>
    </Card>

    <Card accent={!pk.configured}>
      <Row between><Eyebrow>Pending configuration</Eyebrow><Pill tone={pillTone(pk.configured ? 'active' : 'draft')}>{pk.configured ? 'key configured' : 'not configured'}</Pill></Row>
      <H2>Partner key and widget</H2>
      <P small>A partner key lets Bioptime’s own server mint tokens that open LabStack’s widget on Bioptime pages and in one-time links. The account owner generates it in the LabStack console under Widget configs → Access; LabStack shows it once.</P>
      <KeyValue rows={[
        ['Partner key', pk.configured ? 'configured in the server environment' : 'not configured'],
        ['Where it is kept', <View style={{ alignItems: 'flex-end' }}><MonoText small>{pk.variable}</MonoText><P muted small style={{ textAlign: 'right' }}>in the server environment only. It is never shown here or sent to a browser.</P></View>],
        ['Widget tokens', 'Not implemented. Minting them needs LabStack’s token API documentation, which the project does not have.'],
      ]} />
      <P muted small>{`Missing: ${pk.widget.missing.join('; ')}.`}</P>
    </Card>

    <Card>
      <Eyebrow>Provider console</Eyebrow><H2>Open in LabStack console</H2>
      <P small>Each section opens in a new tab with LabStack’s own sign-in. Bioptime does not embed the console and forwards no credential.</P>
      <Row>{CONSOLE_SECTIONS.map((s) => <Button key={s.label} title={s.label} variant="secondary" small onPress={() => openConsole(s.href)} />)}</Row>
      <P muted small>Administrators with this permission only. These links exist nowhere else in Bioptime.</P>
    </Card>
  </View>;
}
