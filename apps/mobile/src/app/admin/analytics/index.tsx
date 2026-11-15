/* Admin › Analytics (the web's /admin/analytics, reports.view; apps/dashboard/src/pages/Analytics.tsx): the overview's
   operational numbers as readouts, the 12-week bars, programmes, bloodwork and bespoke counts, and "Run a report": the
   named reports over a date range, shown as one card per row (the web's table) with the CSV through the share sheet
   on a phone and as a download on the web (lib/admin/b1/csv). Revenue counts signature-verified captures only. */
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, inr, istDate, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { exportReportCsv } from '@/lib/admin/b1/csv';
import type { Overview, ReportRun } from '@/lib/admin/b1/types';
import { AdminBell } from '@/components/adminB1/adminBell';
import { Bars, Readout } from '@/components/adminB1/parts';
import { useToast } from '@/components/adminB1/toast';
import { Button, Card, ErrorBox, Eyebrow, Field, H2, Loading, P, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { DatePickerField, FilterChips, isIsoDate, KeyValue, type KeyValueRow } from '@/components/workspace';
import { RequirePermission, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

const ROWS_SHOWN = 200;

/** The revenue note (simulated payments) follows the 12-week line only where the server flags its payments as
 *  simulated, as on the web (Analytics.tsx:19). */
function revenueNote(d: Overview | null): string {
  return d && d.demo && d.revenue.note ? ' ' + d.revenue.note : '';
}

export default function AdminAnalytics() {
  const { can } = useAuth();
  const allowed = can('reports.view');
  const ov = useLoad<Overview | null>(allowed ? 'admin-overview' : null, () => (allowed ? get('/admin/overview') : Promise.resolve(null)), [allowed]);
  const d = ov.data;
  const weeks = d?.ordersByWeek ?? [];
  const simulatedNote = revenueNote(d);
  return <Screen refreshing={ov.loading} onRefresh={ov.reload}>
    <Stack.Screen options={{ title: 'Analytics', headerRight: () => <AdminBell /> }} />
    <RoleGate workspace="admin">
      <RequirePermission permission="reports.view">
        <Enter><Title sub="Operational numbers from the live tables. Revenue counts signature-verified captures only. Self-reported progress is never presented as a health outcome.">Analytics</Title></Enter>
        <StaleBanner at={ov.stale} /><ErrorBox error={ov.error} onRetry={ov.reload} />
        {ov.loading && !d ? <Loading /> : d ? <>
          <Enter index={1}><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            <Readout eyebrow="Members total" value={d.members.total} sub={`${d.members.active} active · ${d.members.onboarding} onboarding`} />
            <Readout eyebrow="New members · 30 d" value={d.members.new30d} />
            <Readout eyebrow="Verified revenue · all time" value={inr(d.revenue.verifiedInrAll)} sub={`refunded ${inr(d.revenue.refundedInr)}`} />
            <Readout eyebrow="Activated · 30 d" value={d.orders.activated30d} sub={`${d.orders.pendingPayment} pending payment`} />
          </View></Enter>
          <Enter index={2}><Card><Eyebrow>12 weeks</Eyebrow><H2>Orders and verified revenue per week</H2>
            <Bars series={weeks.map((w) => Math.round(w.inr))} labels={weeks.map((w) => w.week.slice(5))} />
            <P muted small>{`Bars: verified revenue (₹) per ISO week. Orders: ${weeks.map((w) => `${w.week.slice(5)}:${w.n}`).join(' · ')}.${simulatedNote}`}</P>
          </Card></Enter>
          <Enter index={3}><Card><Eyebrow>Programmes</Eyebrow><H2>Active and ending</H2>
            <KeyValue rows={[['Active', d.programmes.active], ['Ending in 7 days', d.programmes.endingIn7d], ['Unassigned members', d.assignments.unassigned], ['Coach utilisation', `${d.coaches.utilisationPct}%`], ['Appointments · 7 d', d.appointments.upcoming7d], ['Requested appointments', d.appointments.requested]]} />
          </Card></Enter>
          <Enter index={4}><Card><Eyebrow>Bloodwork</Eyebrow><H2>Bookings by status</H2>
            <KeyValue rows={[...Object.entries(d.bloodwork).map(([k, v]): KeyValueRow => [label(k), v]), ['Reports awaiting review', d.reportsAwaitingReview]]} />
          </Card></Enter>
          <Enter index={5}><Card><Eyebrow>Bespoke</Eyebrow><H2>Custom plans by status</H2>
            {Object.keys(d.customPlans).length ? null : <P small>None</P>}
            <KeyValue rows={[...Object.entries(d.customPlans).map(([k, v]): KeyValueRow => [label(k), v]), ['New enquiries', d.enquiries.new]]} />
          </Card></Enter>
          <Enter index={6}><Reports /></Enter>
          <P muted small>{`Generated ${fmtDateTime(d.generatedAt)}. No health-outcome claims are derived from these numbers.`}</P>
        </> : null}
      </RequirePermission>
    </RoleGate>
  </Screen>;
}

/** Named reports over a date range, as cards here or a CSV through the share sheet; every run is in the audit log. */
function Reports() {
  const names = useLoad<{ items: string[] }>('admin-analytics-names', () => get('/admin/analytics'), []);
  const { toast, show } = useToast();
  const [name, setName] = useState('');
  const [from, setFrom] = useState(istDate(-90));
  const [to, setTo] = useState(istDate(0));
  const [data, setData] = useState<ReportRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const datesOk = isIsoDate(from) && isIsoDate(to);
  const run = async () => {
    if (!name || !datesOk) return;
    setBusy(true);
    try { setData(await get<ReportRun>(`/admin/analytics/${encodeURIComponent(name)}${qs({ from, to })}`)); }
    catch (e) { show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const csv = async () => {
    if (!name || !datesOk) return;
    setCsvBusy(true);
    try {
      const r = await exportReportCsv(name, from, to);
      show(r.how === 'download' ? `Downloading ${r.filename}` : r.how === 'share' ? `${r.filename} is ready to share` : `Saved ${r.filename} in the app's files`);
    } catch (e) { show(errorText(e), 'error'); } finally { setCsvBusy(false); }
  };
  const rows = data?.rows ?? [];
  return <Card>
    <Row between><View><Eyebrow>Reports</Eyebrow><H2>Run a report</H2></View>{data ? <Button title="Download CSV" variant="secondary" small onPress={csv} busy={csvBusy} /> : null}</Row>
    <ErrorBox error={names.error} onRetry={names.reload} />
    <Field label="Report">{names.loading && !names.data ? <Loading /> : <FilterChips options={(names.data?.items ?? []).map((n) => ({ value: n, label: label(n) }))} value={name} onChange={(v) => { setName(String(v)); setData(null); }} />}</Field>
    <Row><View style={{ flex: 1 }}><DatePickerField label="From" value={from} onChange={setFrom} /></View><View style={{ flex: 1 }}><DatePickerField label="To" value={to} onChange={setTo} /></View></Row>
    <Button title="Run" onPress={run} busy={busy} disabled={!name || !datesOk} style={{ alignSelf: 'flex-start' }} small />
    {toast}
    {data ? <View style={{ gap: space.sm, marginTop: space.sm }}>
      <Text style={{ color: colors.text, fontSize: font.small }}><Text style={{ fontWeight: '700' }}>{data.title}</Text>{` · ${data.from} to ${data.to} · ${rows.length} row${rows.length === 1 ? '' : 's'}`}</Text>
      <P muted small>{data.note}</P>
      {rows.length ? rows.slice(0, ROWS_SHOWN).map((r, i) => <KeyValue key={i} rows={data.columns.map((c): KeyValueRow => [label(c), r[c] === null || r[c] === undefined ? '' : String(r[c])])} />) : <P small>No rows in that range.</P>}
      {rows.length > ROWS_SHOWN ? <P muted small>{`Showing the first ${ROWS_SHOWN} rows; the CSV has all ${rows.length}.`}</P> : null}
    </View> : null}
  </Card>;
}
