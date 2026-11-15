/* LabStack, administrators only. The server-side adapter (apps/api/src/vendors) is the integration: catalogue sync,
   home-collection orders, signed webhooks and the safety net. This page shows the connection state, the health card,
   the actions an administrator may take, and, for owners outside production, a test webhook. The provider's own
   console (https://integration.labstack.in/dashboard) is reachable only from here, as an external link that opens in
   a new tab with the provider's own sign-in: it is not embedded and no credential is forwarded. Without credentials
   the page shows the pending-configuration state and the exact variables to set.

   Everything shown comes from GET /admin/integrations/labstack/status (labstack.manage); a field the status payload
   does not carry is left out rather than guessed. The server mode that hides the test webhook in production comes
   from the public configuration, which needs no permission.

   Below the status card, the LabStack operations module (flag 'labstackOps') adds the operations view, laid out like
   the console's own home: counters, streams at a glance, "Breaching now" (oldest first) and "Escalations open", each
   filterable by stream, recent activity, the catalogue summary, webhook and safety-net health, a row of links into the
   console's sections, and the partner-key card. All of it comes from GET /admin/integrations/labstack/operations
   (labstack.manage), computed from Bioptime's own records; while the module is off the view is not drawn and the page is
   the status card alone, exactly as before the module existed (the switch is on Admin › Modules). The partner key is shown as configured or not, never its value, and no widget token is
   minted (LabStack's token API documentation is not in the project). The console is never embedded. */
import React, { useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Link } from '../../lib/nav';
import { useFeatures } from '../../modules/runtime';
import { fmtDateTime, label, relative } from '../../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Input, Pill, Readout, Select, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../../ui';

const CONSOLE_URL = 'https://integration.labstack.in/dashboard';
/* The console's own sections, with the addresses its sidebar uses. Each opens in a new tab behind LabStack's sign-in. */
const CONSOLE_SECTIONS: Array<{ label: string; href: string }> = [
  { label: 'Orders', href: `${CONSOLE_URL}/orders` },
  { label: 'Appointments', href: `${CONSOLE_URL}/appointments?datePreset=ANY` },
  { label: 'Escalations', href: `${CONSOLE_URL}/escalations` },
  { label: 'Catalog', href: `${CONSOLE_URL}/catalog` },
  { label: 'Widget configs', href: `${CONSOLE_URL}/store/widget-configs` },
];

export function LabStack() {
  const { user, can } = useAuth();
  const lab = useApi(() => api.get('/admin/integrations/labstack/status'), []);
  const config = useApi(() => api.get('/public/config'), []);
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState(false);
  const [tb, setTb] = useState({ bookingId: '', orderStatus: 'SAMPLE_COLLECTED', reason: '' });
  const [opsTick, setOpsTick] = useState(0); // reloads the operations view after Refresh, a sync or a safety-net run
  const opsOn = useFeatures(true)?.has('labstackOps') === true; // the operations view belongs to the LabStack operations module; while it is off the page is the status card alone
  if (!can('labstack.manage')) return <Alert kind="warning" title="Permission needed">Managing the LabStack integration needs the “Manage the LabStack integration” permission, which administrators do not hold by default. An owner can grant it under Users and permissions.</Alert>;
  const l = lab.data as any;
  if (lab.error) return <Alert kind="error">{lab.error}</Alert>;
  if (!l) return <Skeleton rows={8} />;
  const live = l.mode === 'live';
  const production = (config.data as any)?.mode === 'production';
  const run = async (what: 'sync' | 'safety-net') => { setBusy(what); try { const r = await api.post<any>(`/admin/integrations/labstack/${what}`); toast(what === 'sync' ? `Catalogue synced${r.tests ?? r.count ? `: ${r.tests ?? r.count} tests` : ''}` : `Safety net: ${r.checked} checked, ${r.applied} applied, ${r.placed} placed`); lab.reload(); setOpsTick((t) => t + 1); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(''); } };
  const sendTest = async () => { setBusy('test'); try { await api.post('/admin/integrations/labstack/test-webhook', tb); toast('Test webhook requested; watch the booking timeline'); setTest(false); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(''); } };
  return <div className="stack">
    <div className="pageHead"><div><h1>LabStack integration</h1><p className="sub">Home blood-collection partner. Bioptime talks to LabStack from the server only: catalogue, orders, status webhooks and reports. Coaches and members never see this page or the provider console; they see bookings and released reports inside Bioptime.</p></div>
      <div className="actions"><Button size="sm" variant="tertiary" onClick={() => { lab.reload(); setOpsTick((t) => t + 1); }}>Refresh</Button></div></div>
    {!live && <Alert kind="warning" title="Pending configuration: the stand-in vendor is answering">No LabStack credentials are set, so the server runs its built-in stand-in laboratory (simulated slots, orders and reports, clearly labelled). To connect the real service, set <code>LABSTACK_API_KEY</code> and <code>LABSTACK_WEBHOOK_SECRET</code> (and <code>LABSTACK_BASE_URL</code> for the sandbox) in the server environment, register the webhook address below with LabStack, restart, then run the catalogue sync. Nothing here claims a connection that was not verified.</Alert>}
    <div className="grid">
      <div className="span7"><Card accent={!live}><CardHead eyebrow="Connection" title={`${l.vendor ?? 'LabStack'}`} right={<Pill status={live ? 'active' : 'draft'}>{live ? 'live' : 'stand-in'}</Pill>} />
        <dl className="kv">
          <dt>Credentials</dt><dd>{live ? <>present (server environment){l.keyExpiresAt ? `, key expires ${fmtDateTime(l.keyExpiresAt)}` : ''}</> : 'not set'}</dd>
          {l.webhookAddress && <><dt>Webhook address</dt><dd className="small"><code>{l.webhookAddress}</code></dd></>}
          <dt>Last catalogue sync</dt><dd>{l.lastCatalogueSync ? relative(l.lastCatalogueSync) : 'never'}</dd>
          <dt>Last webhook received</dt><dd>{l.lastWebhook ? relative(l.lastWebhook) : 'none yet'}</dd>
          <dt>Last safety net</dt><dd>{l.lastSafetyNet ? relative(l.lastSafetyNet) : 'not yet'}</dd>
          <dt>Open orders</dt><dd>{l.openOrders}{l.silent24h ? <span className="bp-pill bp-pill-warning" style={{ marginLeft: 8 }}>{l.silent24h} silent for 24 h</span> : null}</dd>
          <dt>Failed calls, 24 h</dt><dd>{l.failedCalls24h}{l.failedCalls24h > 0 && <span className="bp-pill bp-pill-warning" style={{ marginLeft: 8 }}>see Operations</span>}</dd>
        </dl>
        <div className="bp-card-foot"><Button size="sm" busy={busy === 'sync'} onClick={() => run('sync')}>Sync catalogue now</Button><Button size="sm" busy={busy === 'safety-net'} onClick={() => run('safety-net')}>Run the safety net</Button>{user?.role === 'owner' && config.data && !production && <Button size="sm" variant="tertiary" onClick={() => setTest(true)}>Send a test webhook</Button>}</div>
        <p className="muted small" style={{ marginTop: 8 }}>Webhooks are verified by signature and deduplicated; the safety net runs every 30 minutes and on demand; status moves forward only, with the documented exceptions. Secrets are never shown or editable here.</p></Card></div>
      <div className="span5"><div className="stack">
        <Card><CardHead eyebrow="Provider console" title="LabStack dashboard" /><p className="small">The provider's own administration console. It opens in a new tab with LabStack's sign-in; Bioptime does not embed it and forwards no credential. Use it for what the API does not cover (account, invoices, support).</p><div className="bp-card-foot"><a className="bp-btn bp-btn-secondary bp-btn-sm" href={CONSOLE_URL} target="_blank" rel="noopener noreferrer">Open the LabStack console</a></div><p className="muted small" style={{ marginTop: 8 }}>Administrators with this permission only. The link exists nowhere else in Bioptime.</p></Card>
        <Card><CardHead eyebrow="What flows" title="Inside Bioptime" /><ul className="small" style={{ paddingLeft: 18, display: 'grid', gap: 6 }}><li>Members book from their package entitlement; the order is placed with the laboratory after consent and profile checks.</li><li>Status webhooks move the booking through the seven agreed statuses; cancellations and reschedules are checked with the laboratory first.</li><li>Reports are released to the member only after the assigned coach has reviewed them, with the laboratory's values kept apart from the coach's note.</li><li>Collection addresses are never shown to coaches.</li></ul></Card>
      </div></div>
    </div>
    {opsOn && <LabStackOperations tick={opsTick} />}
    <Dialog open={test} onClose={() => setTest(false)} title="Send one test webhook" footer={<><Button variant="tertiary" onClick={() => setTest(false)}>Cancel</Button><Button variant="primary" busy={busy === 'test'} disabled={!tb.bookingId || tb.reason.trim().length < 3} onClick={sendTest}>Send</Button></>}>
      <p className="small">Owner only, never in production. The vendor sends a webhook for the booking at the chosen status; the order at the vendor does not change.</p>
      <div className="form" style={{ marginTop: 12 }}><Field label="Booking id"><Input value={tb.bookingId} onChange={(e) => setTb({ ...tb, bookingId: e.target.value })} /></Field><Field label="Status"><Select value={tb.orderStatus} onChange={(e) => setTb({ ...tb, orderStatus: e.target.value })}>{['PHLEBO_ASSIGNED', 'SAMPLE_COLLECTED', 'SAMPLE_PROCESSED', 'REPORT_DELIVERED', 'PATIENT_MISSED', 'SAMPLE_REJECTED', 'CANCELED'].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field><Field label="Reason (recorded)"><Textarea value={tb.reason} onChange={(e) => setTb({ ...tb, reason: e.target.value })} /></Field></div>
    </Dialog>
  </div>;
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

const show = (n: number | null) => (n === null ? '—' : n);

/** The calls to LabStack in plain words, for the escalation breakdown ("order placement 2"); anything else as named. */
const CALL_LABELS: Record<string, string> = { catalogue_sync: 'catalogue sync', placeOrder: 'order placement', cancelOrder: 'order cancellation', rescheduleOrder: 'reschedule', getSlots: 'slot lookup', getOrders: 'order status check', getReportRawValues: 'report values' };
const callList = (entries: Array<[string, number]>) => entries.map(([c, n]) => `${CALL_LABELS[c] ?? c} ${n}`).join(' · ');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The console's stream buckets as a filter; streams Bioptime does not book are listed but cannot be picked. */
function StreamFilter({ value, onChange, counts, total, integration, labelText }: { value: StreamFilterValue; onChange: (v: StreamFilterValue) => void; counts: Record<Bucket, number>; total: number; integration?: boolean; labelText: string }) {
  return <Select aria-label={labelText} value={value} onChange={(e) => onChange(e.target.value as StreamFilterValue)}>
    <option value="all">All streams ({total})</option>
    <option value="lab_orders">Lab Orders ({counts.lab_orders ?? 0})</option>
    <option value="appointments" disabled>Appointments: not booked through Bioptime</option>
    <option value="pharma_orders" disabled>Pharma Orders: not booked through Bioptime</option>
    {integration && <option value="integration">Integration, no single order ({counts.integration ?? 0})</option>}
  </Select>;
}

function LabStackOperations({ tick }: { tick: number }) {
  const { can } = useAuth();
  const ops = useApi<Ops | { disabled: true }>(() => api.get<Ops>('/admin/integrations/labstack/operations').catch((e: unknown) => {
    if (e instanceof ApiRequestError && e.code === 'FEATURE_DISABLED') return { disabled: true as const };
    throw e;
  }), [tick]);
  const [bf, setBf] = useState<StreamFilterValue>('all');
  const [ef, setEf] = useState<StreamFilterValue>('all');
  const [allActivity, setAllActivity] = useState(false);
  const jump = (id: string) => { const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); };

  if (ops.error) return <Alert kind="error" title="LabStack operations could not be loaded">{ops.error}</Alert>;
  const d = ops.data;
  if (!d) return <Skeleton rows={6} />;
  if ('disabled' in d) return <Alert kind="info" title="LabStack operations is switched off">The operations view (counters, breaching and escalation lists, recent activity, catalogue and webhook health, the console shortcuts and the partner-key status) is part of the LabStack operations module, which is off. An administrator holding “Manage modules” can switch it on under Modules, with a reason. The status card above works without it.{can('modules.manage') && <> <Link to="/modules">Open Modules</Link>.</>}</Alert>;

  const Counter = ({ n, text, target, hot, sub }: { n: React.ReactNode; text: string; target: string; hot?: boolean; sub?: React.ReactNode }) => <Card dense className={`queue ${hot ? 'hot' : ''}`}><div role="link" tabIndex={0} onClick={() => jump(target)} onKeyDown={(e) => { if (e.key === 'Enter') jump(target); }}><Readout eyebrow={text} value={n} sub={sub} /></div></Card>;
  const home = d.streams.find((s) => s.key === 'lab_orders')?.types.find((t) => t.used) ?? null;
  const breaching = d.breaching.items.filter((x) => bf === 'all' || x.stream === bf);
  const escalations = d.escalations.items.filter((x) => ef === 'all' || x.stream === ef);
  const activity = allActivity ? d.activity.items : d.activity.items.slice(0, 15);
  const covered = Object.entries(d.escalations.coveredFailedCalls ?? {});
  const closedCalls = Object.entries(d.escalations.closedFailedCalls ?? {});
  const src = d.escalations.bySource;
  const pk = d.partnerKey;
  const wh = d.health.webhook, sn = d.health.safetyNet, cat = d.catalogue;
  const whPill = wh.state === 'ok' ? <Pill status="active">receiving</Pill> : wh.state === 'silent' ? <Pill status="exception">silent</Pill> : <Pill status="pending">none yet</Pill>;
  const snPill = sn.state === 'ok' ? <Pill status="active">on time</Pill> : sn.state === 'late' ? <Pill status="exception">late</Pill> : <Pill status="pending">not run yet</Pill>;
  const job = (j: OpsJob) => (j ? <>{relative(j.startedAt)} · {j.ok === null ? 'running' : j.ok ? 'ok' : 'failed'}</> : 'no run logged');

  return <div className="stack">
    <Card><CardHead eyebrow="Operations" title="LabStack operations" right={<Button size="sm" variant="tertiary" onClick={() => ops.reload()}>Refresh</Button>} />
      <p className="small">{d.source} Shown {relative(d.generatedAt)}; times in India time.</p>
      {d.vendor.simulated && <p className="muted" style={{ marginTop: 6 }}>Stand-in: these bookings and their statuses are simulated inside this server; no laboratory is involved.</p>}
    </Card>

    <div className="grid">
      <div className="span3"><Counter n={d.counters.breachingNow} text="Breaching now" target="ls-breaching" hot={d.counters.breachingNow > 0} sub="oldest first below" /></div>
      <div className="span3"><Counter n={d.counters.escalationsOpen} text="Escalations open" target="ls-escalations" hot={d.counters.escalationsOpen > 0} sub={src ? `${plural(src.tasks, 'open task', 'open tasks')} · ${plural(src.failedCalls, 'failing call', 'failing calls')}` : 'tasks and failed calls'} /></div>
      <div className="span3"><Counter n={d.counters.labOrdersToday} text="Lab orders today" target="ls-streams" sub={`${d.counters.openLabOrders} open in all`} /></div>
      <div className="span3"><Counter n={d.counters.collectionsToday} text="Home collections today" target="ls-streams" sub="slots falling today" /></div>
    </div>

    <div className="grid">
      <div className="span12" id="ls-streams"><Card><CardHead eyebrow="Streams at a glance" title="Orders by LabStack order type" />
        <Table dense label="Orders by LabStack order type" head={<><th>Stream</th><th>Order type</th><th className="num">Open</th><th className="num">Breaching</th><th className="num">Escalations</th><th className="num">Today</th><th className="num">All time</th></>}>
          {d.streams.flatMap((s) => s.types.map((t, i) => <tr key={`${s.key}:${t.key}`}>
            {i === 0 && <td rowSpan={s.types.length}><b>{s.label}</b>{!s.used && <div className="muted">not booked through Bioptime</div>}</td>}
            <td>{t.used ? <b>{t.label}</b> : t.label}</td>
            <td className="num">{show(t.open)}</td><td className="num">{show(t.breaching)}</td><td className="num">{show(t.escalations)}</td><td className="num">{show(t.today)}</td><td className="num">{show(t.total)}</td>
          </tr>))}
        </Table>
        <p className="muted" style={{ marginTop: 8 }}>Every Bioptime booking is a home sample collection. The other order types exist in LabStack&rsquo;s console; Bioptime places none of them, so it has no figures for them (— rather than 0). {d.rules.ordersToday}</p>
      </Card></div>
    </div>

    <div className="grid">
      <div className="span6" id="ls-breaching"><Card><CardHead eyebrow="Oldest first" title={`Breaching now (${d.breaching.total})`} />
        <div className="row" style={{ marginBottom: 10 }}><span className="small">Stream</span><div style={{ flex: '0 1 300px' }}><StreamFilter value={bf} onChange={setBf} counts={d.breaching.byStream} total={d.breaching.total} labelText="Filter breaching bookings by stream" /></div></div>
        {breaching.length ? <Table dense label="Bookings breaching now, oldest first" head={<><th>Booking</th><th>Missed</th><th>Overdue</th><th>Status</th></>}>
          {breaching.map((b) => <tr key={b.bookingId}>
            <td><b>{b.reference}</b><div className="muted">{b.testName ?? '—'}{b.memberName ? ` · ${b.memberName}` : ''}</div></td>
            <td>{b.kindLabel}<div className="muted">{fmtDateTime(b.dueAt)}</div></td>
            <td className="num">{span(b.overdueMinutes)}</td>
            <td><span className={`bp-labstatus bp-labstatus-${b.status}`}>{label(b.status)}</span>{b.vendorStatus && <div className="muted">{b.vendorStatus}</div>}{!b.vendorOrderPlaced && <div className="muted">order not yet placed with LabStack</div>}{b.flag && <div className="muted">{b.flag}</div>}</td>
          </tr>)}
        </Table> : <Empty title="Nothing breaching" body={bf === 'all' ? 'No booking has missed its collection slot or expected report time.' : 'Nothing breaching in this stream.'} />}
        {d.breaching.truncated && <p className="muted" style={{ marginTop: 8 }}>Showing the oldest {d.breaching.items.length} of {d.breaching.total}.</p>}
        <p className="muted" style={{ marginTop: 8 }}>{d.rules.breaching}</p>
        {(can('integrations.manage') || can('reports.view')) && <div className="bp-card-foot"><Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/bloodwork">Open Bloodwork</Link></div>}
      </Card></div>
      <div className="span6" id="ls-escalations"><Card><CardHead eyebrow="Oldest first" title={`Escalations open (${d.escalations.total})`} />
        <div className="row" style={{ marginBottom: 10 }}><span className="small">Stream</span><div style={{ flex: '0 1 300px' }}><StreamFilter value={ef} onChange={setEf} counts={d.escalations.byStream} total={d.escalations.total} integration labelText="Filter open escalations by stream" /></div></div>
        {escalations.length ? <Table dense label="Open escalations, oldest first" head={<><th>Opened</th><th>What</th><th>Booking</th><th>State</th></>}>
          {escalations.map((e) => <tr key={e.id}>
            <td className="small">{span(e.ageMinutes)} ago<div className="muted">{fmtDateTime(e.openedAt)}</div></td>
            <td><b>{e.kindLabel}</b><div className="small">{e.title}</div>{e.detail && <div className="muted">{e.detail}</div>}</td>
            <td>{e.reference ?? '—'}{e.memberName && <div className="muted">{e.memberName}</div>}</td>
            <td>{e.source === 'task' ? <Pill status={e.status} /> : <Pill status="failed">{e.count} in 24 h</Pill>}{e.ownerName ? <div className="muted">{e.ownerName}</div> : e.source === 'task' ? <div className="muted">unassigned</div> : null}</td>
          </tr>)}
        </Table> : <Empty title="No open escalations" body={ef === 'all' ? 'No laboratory task is open and no call to LabStack failed in the last 24 hours.' : 'No open escalations in this stream.'} />}
        {d.escalations.truncated && <p className="muted" style={{ marginTop: 8 }}>Showing the oldest {d.escalations.items.length} of {d.escalations.total}.</p>}
        {src && <dl className="kv" style={{ marginTop: 8 }}>
          <dt>Open laboratory tasks</dt><dd>{src.tasks}</dd>
          <dt>Calls failing with no task, 24 h</dt><dd>{src.failedCalls}{src.failedCalls > 0 && <span className="muted"> ({plural(src.failedCallFailures, 'failure', 'failures')})</span>}</dd>
          <dt>Failures counted under an open task</dt><dd>{covered.length ? callList(covered) : 'none'}</dd>
          <dt>Failures whose task is closed</dt><dd>{closedCalls.length ? <>{callList(closedCalls)} <span className="muted">(not counted)</span></> : 'none'}</dd>
        </dl>}
        <p className="muted" style={{ marginTop: 8 }}>{d.rules.escalations}</p>
        {can('operations.manage') && <div className="bp-card-foot"><Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/operations">Open the operations queue</Link></div>}
      </Card></div>
    </div>

    <div className="grid">
      <div className="span7"><Card><CardHead eyebrow="Last 24 hours" title={`Recent activity (${d.activity.total})`} />
        {activity.length ? <Table dense label="Booking activity in the last 24 hours, newest first" head={<><th>When</th><th>Booking</th><th>Change</th><th>By</th></>}>
          {activity.map((a, i) => <tr key={`${a.bookingId}:${a.at}:${i}`}>
            <td className="small">{relative(a.at)}<div className="muted">{fmtDateTime(a.at)}</div></td>
            <td><b>{a.reference}</b>{a.testName && <div className="muted">{a.testName}</div>}</td>
            <td>{a.from && a.from !== a.to ? <>{label(a.from)} → {label(a.to)}</> : label(a.to)}{a.vendorStatus && <div className="muted">{a.vendorStatus}</div>}{a.note && <div className="muted">{a.note}</div>}</td>
            <td className="small">{label(a.source)}</td>
          </tr>)}
        </Table> : <Empty title="Nothing moved in the last day" />}
        {(d.activity.items.length > 15 || d.activity.truncated) && <div className="bp-card-foot">{d.activity.items.length > 15 && <Button size="sm" variant="tertiary" onClick={() => setAllActivity(!allActivity)}>{allActivity ? 'Show fewer' : `Show all ${d.activity.items.length}`}</Button>}{d.activity.truncated && <span className="muted">The latest {d.activity.items.length} of {d.activity.total} are listed.</span>}</div>}
      </Card></div>
      <div className="span5"><div className="stack">
        <Card><CardHead eyebrow="Lab Orders · Home sample" title="By status" />
          {home?.byStatus ? <dl className="kv">{Object.entries(home.byStatus).map(([s, n]) => <React.Fragment key={s}><dt><span className={`bp-labstatus bp-labstatus-${s}`}>{label(s)}</span></dt><dd className="num">{n}</dd></React.Fragment>)}</dl> : <Empty title="No bookings yet" />}
          <p className="muted" style={{ marginTop: 8 }}>All bookings Bioptime has placed, by the seven shared statuses.</p>
        </Card>
        <Card><CardHead eyebrow="Catalogue" title="Tests and packages" />
          <dl className="kv">
            <dt>Enabled for members</dt><dd>{cat.enabled} <span className="muted">({cat.enabledTests} tests, {cat.enabledPackages} packages)</span></dd>
            <dt>Hidden</dt><dd>{cat.hidden}</dd>
            <dt>Priced</dt><dd>{cat.priced}</dd>
            <dt>Without a price</dt><dd>{cat.unpriced}{cat.visibleUnpriced > 0 && <span className="muted"> ({cat.visibleUnpriced} not hidden, still not bookable)</span>}</dd>
            <dt>Last sync</dt><dd>{cat.lastSync ? <>{relative(cat.lastSync)}{cat.vendorItemsAtLastSync !== null && <span className="muted"> · {cat.vendorItemsAtLastSync} items from LabStack</span>}</> : 'never'}</dd>
            <dt>Next sync</dt><dd>{cat.nextSyncDue ? fmtDateTime(cat.nextSyncDue) : d.health.jobsEnabled ? 'after the first sync' : 'background jobs are off: on demand only'} <span className="muted">(every {cat.syncEveryHours} h)</span></dd>
            <dt>Last sync job</dt><dd>{job(cat.lastJob)}</dd>
            {cat.lastSyncFailure && <><dt>Last sync failure</dt><dd>{relative(cat.lastSyncFailure.at)}<div className="muted">{cat.lastSyncFailure.message}</div></dd></>}
            <dt>Laboratories on bookings</dt><dd>{cat.labsSeen}</dd>
          </dl>
          <p className="muted" style={{ marginTop: 8 }}>New tests from a sync stay hidden until Bioptime sets a price. LabStack&rsquo;s own partner-lab list is in the console&rsquo;s Catalog.</p>
        </Card>
        <Card><CardHead eyebrow="Health" title="Webhooks and safety net" />
          <dl className="kv">
            <dt>Webhooks</dt><dd>{whPill}</dd>
            <dt>Last received</dt><dd>{wh.lastReceivedAt ? relative(wh.lastReceivedAt) : 'none yet'}</dd>
            <dt>Received, 24 h</dt><dd>{wh.received24h.total} <span className="muted">({wh.received24h.applied} applied, {wh.received24h.repeat} repeats, {wh.received24h.unknown_order} unknown orders)</span></dd>
            <dt>Rejected, 24 h</dt><dd>{wh.rejected24h}{wh.rejected24h > 0 && <span className="muted"> wrong or missing header</span>}</dd>
            <dt>Safety net</dt><dd>{snPill}</dd>
            <dt>Last run</dt><dd>{sn.lastRunAt ? relative(sn.lastRunAt) : 'not yet'} <span className="muted">({d.health.jobsEnabled ? `every ${sn.everyMinutes} min` : 'background jobs are off: on demand only'})</span></dd>
            <dt>Last safety-net job</dt><dd>{job(sn.lastJob)}</dd>
            <dt>Failed calls, 24 h</dt><dd>{d.health.failedCalls24h}{Object.keys(d.health.failedCallsByCall).length > 0 && <span className="muted"> ({Object.entries(d.health.failedCallsByCall).map(([c, n]) => `${c} ${n}`).join(', ')})</span>}</dd>
            {d.health.keyRejectedAt && <><dt>API key rejected</dt><dd>{fmtDateTime(d.health.keyRejectedAt)}</dd></>}
          </dl>
          <p className="muted" style={{ marginTop: 8 }}>Webhooks count as silent when orders are open and none has arrived for {wh.silenceHours} hours; the safety net is late when two of its intervals pass without a run.</p>
        </Card>
      </div></div>
    </div>

    <div className="grid">
      <div className="span6"><Card accent={!pk.configured}><CardHead eyebrow="Pending configuration" title="Partner key and widget" right={<Pill status={pk.configured ? 'active' : 'draft'}>{pk.configured ? 'key configured' : 'not configured'}</Pill>} />
        <p className="small">A partner key lets Bioptime&rsquo;s own server mint tokens that open LabStack&rsquo;s widget on Bioptime pages and in one-time links. The account owner generates it in the LabStack console under Widget configs → Access; LabStack shows it once.</p>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>Partner key</dt><dd>{pk.configured ? 'configured in the server environment' : 'not configured'}</dd>
          <dt>Where it is kept</dt><dd><code>{pk.variable}</code> in the server environment only. It is never shown here or sent to a browser.</dd>
          <dt>Widget tokens</dt><dd>Not implemented. Minting them needs LabStack&rsquo;s token API documentation, which the project does not have.</dd>
        </dl>
        <p className="muted" style={{ marginTop: 8 }}>Missing: {pk.widget.missing.join('; ')}.</p>
      </Card></div>
      <div className="span6"><Card><CardHead eyebrow="Provider console" title="Open in LabStack console" />
        <p className="small">Each section opens in a new tab with LabStack&rsquo;s own sign-in. Bioptime does not embed the console and forwards no credential.</p>
        <div className="row" style={{ marginTop: 10 }}>{CONSOLE_SECTIONS.map((s) => <a key={s.label} className="bp-btn bp-btn-secondary bp-btn-sm" href={s.href} target="_blank" rel="noopener noreferrer">{s.label}<span className="sr"> (opens LabStack&rsquo;s sign-in in a new tab)</span></a>)}</div>
        <p className="muted small" style={{ marginTop: 8 }}>Administrators with this permission only. These links exist nowhere else in Bioptime.</p>
      </Card></div>
    </div>
  </div>;
}
