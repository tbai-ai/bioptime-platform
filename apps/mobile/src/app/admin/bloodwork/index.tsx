/* Admin › Bloodwork (the web's /admin/bloodwork, apps/dashboard/src/pages/Bloodwork.tsx): laboratory reports across
   members (reports.view), every member's bookings and the catalogue (integrations.manage), each tab shown for its own
   permission and each list asked for only when it is held. Three dialogs as on the web: Release (a report no coach can
   review, with a note for the member and a reason), Override (owners only: a booking status without a laboratory
   event, with a reason; the portal's ReasonDialog, components/adminA/ReasonSheet, with the new status as its extra
   field) and Set price (price, visibility and a reason). Statuses otherwise move only on laboratory events or a
   review. A report row opens the report, as the web's Open button does, and carries "Open client" for the member's
   record (the web's member link). The laboratory column keeps its header as the line's label ("Laboratory: …"), and
   the review column reads with the report page's words ("Reviewed by … on …"), since a phone list has no headers. */
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError, errorText, get, patch, post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, inr, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { LAB_STATUSES, tone } from '@/lib/admin/b1/common';
import type { Booking, LabTest, Report } from '@/lib/admin/b1/types';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { AdminBell } from '@/components/adminB1/adminBell';
import { DetailRow, LoadError } from '@/components/adminB1/parts';
import { useToast } from '@/components/adminB1/toast';
import { Button, Check, Chip, Field, Input, Loading, Notice, P, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, FilterChips, RecordList, SegmentTabs, Sheet, type RecordPill, type SegmentItem } from '@/components/workspace';
import { notifyBadges, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { space } from '@/theme';

type Tab = 'reports' | 'bookings' | 'catalogue';
const footer = (left: React.ReactNode, right: React.ReactNode) => <View style={{ flexDirection: 'row', gap: space.sm }}>{left}{right}</View>;

export default function AdminBloodwork() {
  const router = useRouter();
  const { user, can } = useAuth();
  // /admin/reports needs reports.view; /admin/bloodwork/bookings and /admin/bloodwork/tests need integrations.manage (apps/api/src/http/routes/admin.ts)
  const canReports = can('reports.view');
  const canBookings = can('integrations.manage');
  const [tab, setTab] = useState<Tab>(canReports ? 'reports' : 'bookings');
  const [status, setStatus] = useState('');
  const reports = useLoad<{ items: Report[] } | null>(canReports ? 'admin-reports' : null, () => (canReports ? get('/admin/reports') : Promise.resolve(null)), [canReports]);
  const bookings = useLoad<{ items: Booking[] } | null>(canBookings ? `admin-bookings-${status}` : null, () => (canBookings ? get(`/admin/bloodwork/bookings${qs({ status })}`) : Promise.resolve(null)), [canBookings, status]);
  const tests = useLoad<{ items: LabTest[] } | null>(canBookings ? 'admin-tests' : null, () => (canBookings ? get('/admin/bloodwork/tests') : Promise.resolve(null)), [canBookings]);
  const { toast, show } = useToast();
  const [releasing, setReleasing] = useState<Report | null>(null);
  const [override, setOverride] = useState<Booking | null>(null);
  const [price, setPrice] = useState<LabTest | null>(null);
  // a tab whose permission is not held is never shown, even if it was the one last chosen
  const shown: Tab = (tab === 'reports' && !canReports) || (tab !== 'reports' && !canBookings) ? (canReports ? 'reports' : 'bookings') : tab;
  const rep = reports.data?.items ?? [];
  const bk = bookings.data?.items ?? [];
  const ts = tests.data?.items ?? [];
  const current = shown === 'reports' ? reports : shown === 'bookings' ? bookings : tests;
  const reloadAll = () => { void reports.reload(); void bookings.reload(); void tests.reload(); };
  const sub = `${canReports && canBookings ? 'Laboratory reports, bookings across members and the catalogue.' : canReports ? 'Laboratory reports across members. Bookings and the catalogue need the “integrations.manage” permission.' : 'Bookings across members and the catalogue. Laboratory reports need the “reports.view” permission.'} Statuses move only on laboratory events or a review (the coach's, or a release by the Bioptime team); anything else is an owner override with a reason.`;
  const tabs: SegmentItem[] = [...(canReports ? [{ id: 'reports', label: 'Reports', count: rep.filter((r) => !r.reviewed).length }] : []), ...(canBookings ? [{ id: 'bookings', label: 'Bookings' }, { id: 'catalogue', label: 'Catalogue' }] : [])];
  const reportPills = (r: Report): RecordPill[] => [...(r.flagged ?? []).map((f) => ({ label: f, tone: 'warning' as const })), ...(r.reviewed ? [] : [{ label: 'Awaiting review', tone: 'warning' as const }])];
  return <Screen refreshing={current.loading} onRefresh={reloadAll}>
    <Stack.Screen options={{ title: 'Bloodwork', headerRight: () => <AdminBell /> }} />
    <RoleGate workspace="admin">
      {!canReports && !canBookings ? <Notice kind="warning" title="Permission needed">Bloodwork shows the laboratory reports (the “reports.view” permission) and every member's bookings and the catalogue (the “integrations.manage” permission). Your administrator account holds neither; an owner can grant them under Users and permissions.</Notice> : <>
        <Enter><Title sub={sub}>Bloodwork</Title></Enter>
        {can('labstack.manage') ? <Button title="Laboratory integration" variant="secondary" small onPress={() => router.push('/admin/integrations/labstack')} style={{ alignSelf: 'flex-start' }} /> : null}
        <SegmentTabs items={tabs} value={shown} onChange={(v) => setTab(v as Tab)} />
        {toast}
        {shown === 'reports' && canReports ? <Enter index={1}>
          <StaleBanner at={reports.stale} />
          {reports.error ? <LoadError title="Reports could not be loaded" error={reports.error} onRetry={reports.reload} /> : reports.loading && !reports.data ? <Loading /> : rep.length ? <RecordList>
            {rep.map((r, i) => {
              const releasable = !r.reviewed && r.coachCanReview === false && canBookings;
              return <DetailRow key={r.id} last={i === rep.length - 1} title={`${r.memberName ?? r.memberId} · ${r.test?.name ?? 'Report'}`}
                lines={[`${r.reference} · delivered ${relative(r.deliveredAt)}`, r.reviewed ? `Reviewed by ${r.reviewerName ?? '—'} on ${fmtDate(r.reviewedAt)}` : r.coachCanReview === false ? 'No coach can review it (no active coach, or coach sharing off)' : null]}
                pills={reportPills(r)} onPress={() => router.push(`/admin/reports/${r.id}`)}
                actions={<><Button title="Open" variant="secondary" small onPress={() => router.push(`/admin/reports/${r.id}`)} />{releasable ? <Button title="Release" small onPress={() => setReleasing(r)} /> : null}<Button title="Open client" variant="ghost" small onPress={() => router.push(`/admin/clients/${r.memberId}`)} /></>} />;
            })}
          </RecordList> : <EmptyState title="No reports" body="Laboratory reports appear here when the vendor delivers them." icon="water-outline" />}
        </Enter> : null}
        {shown === 'bookings' && canBookings ? <Enter index={1}>
          <FilterChips options={[{ value: '', label: 'Any status' }, ...LAB_STATUSES.map((s) => ({ value: s, label: label(s) }))]} value={status} onChange={(v) => setStatus(String(v))} />
          <StaleBanner at={bookings.stale} />
          {bookings.error ? <LoadError title="Bookings could not be loaded" error={bookings.error} onRetry={bookings.reload} /> : bookings.loading && !bookings.data ? <Loading /> : bk.length ? <RecordList>
            {bk.map((b, i) => <DetailRow key={b.id} last={i === bk.length - 1} title={`${b.reference} · ${b.memberName}`}
              lines={[`${b.test?.name ?? '—'} · ${fmtDateTime(b.slotAt)}`, `Laboratory: ${b.vendorOrderId ?? '—'}${b.vendorStatus ? ` · ${b.vendorStatus}` : ''}${b.simulated ? ' · stand-in' : ''}`, b.flag]}
              pills={[{ label: label(b.status), tone: tone(b.status) }]} onPress={() => router.push(`/admin/clients/${b.memberId}`)}
              actions={user?.role === 'owner' ? <Button title="Override" variant="ghost" small onPress={() => setOverride(b)} /> : undefined} />)}
          </RecordList> : <EmptyState title="No bookings" icon="water-outline" />}
        </Enter> : null}
        {shown === 'catalogue' && canBookings ? <Enter index={1}>
          <StaleBanner at={tests.stale} />
          {tests.error ? <LoadError title="The catalogue could not be loaded" error={tests.error} onRetry={tests.reload} /> : tests.loading && !tests.data ? <Loading /> : <RecordList>
            {ts.map((t, i) => <DetailRow key={t.id} last={i === ts.length - 1} title={t.name}
              lines={[`${label(t.kind)} · ${t.vendorTestId}`, `${inr(t.priceInr)} · fasting ${t.fastingHours ? `${t.fastingHours} h` : 'no'} · turnaround ${t.turnaround || '—'}`]}
              pills={[{ label: t.hidden ? 'Hidden' : 'Shown', tone: t.hidden ? 'warning' : 'success' }]}
              actions={<Button title="Set price" variant="ghost" small onPress={() => setPrice(t)} />} />)}
            <P muted small style={{ paddingVertical: space.md }}>A new test from the vendor stays hidden until Bioptime sets its price; withdrawn tests are hidden, never deleted.</P>
          </RecordList>}
        </Enter> : null}
        <ReleaseDialog r={releasing} onClose={() => setReleasing(null)} onDone={() => { show('Report released to the member'); void reports.reload(); notifyBadges(); }} />
        <OverrideDialog b={override} onClose={() => setOverride(null)} onDone={() => { show('Status overridden and audited'); void bookings.reload(); }} />
        <PriceDialog t={price} onClose={() => setPrice(null)} onDone={() => { show('Catalogue updated'); void tests.reload(); }} />
      </>}
    </RoleGate>
  </Screen>;
}

/** Releases a report no coach can review (POST /admin/reports/:id/release, integrations.manage): a note for the member and a reason (Bloodwork.tsx:9-25). */
function ReleaseDialog({ r, onClose, onDone }: { r: Report | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<{ note?: string; reason?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (r) { setNote(''); setReason(''); setErrs({}); setBusy(false); } }, [r]);
  const go = async () => {
    if (!r) return;
    const n = note.trim(), why = reason.trim();
    const e: { note?: string; reason?: string } = {};
    if (n.length < 5) e.note = 'Write a note for the member (at least 5 characters).';
    if (why.length < 3 || why.length > 300) e.reason = 'Say why, in 3 to 300 characters.';
    setErrs(e); if (e.note || e.reason) return;
    setBusy(true);
    try { await post(`/admin/reports/${r.id}/release`, { note: n, reason: why }); onDone(); onClose(); }
    catch (err) { setErrs({ form: errorText(err) }); setBusy(false); }
  };
  return <Sheet open={!!r} onClose={onClose} title={`Release ${r?.reference ?? 'report'}`} footer={footer(<Button title="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />, <Button title="Release to the member" onPress={go} busy={busy} style={{ flex: 1 }} />)}>
    <P muted small>No coach can review this report: the member has no active coach or keeps coach sharing off. Releasing it opens the report in the member’s app with your note; the reason goes to the audit log.</P>
    <Field label="Note for the member" error={errs.note}><Input value={note} onChangeText={setNote} multiline numberOfLines={4} maxLength={4000} style={{ minHeight: 96, textAlignVertical: 'top' }} /></Field>
    <Field label="Reason (recorded in the audit log)" error={errs.reason}><Input value={reason} onChangeText={setReason} maxLength={300} /></Field>
    {errs.form ? <Notice kind="error">{errs.form}</Notice> : null}
  </Sheet>;
}

/** An owner moves a booking's status without a laboratory event (PATCH /admin/bookings/:id, owner + integrations.manage), with a reason:
 *  the portal's ReasonDialog with the new status as its extra field (Bloodwork.tsx:64-67). The statuses wrap, so the
 *  preselected one (Cancelled, the web's default) is in view as the web's select shows it. A refusal stays in the sheet. */
function OverrideDialog({ b, onClose, onDone }: { b: Booking | null; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<string>('cancelled');
  useEffect(() => { if (b) setStatus('cancelled'); }, [b]);
  return <ReasonSheet open={!!b} onClose={onClose} destructive title={`Override ${b?.reference ?? ''}?`} confirmLabel="Override status"
    body={`Moves the booking from ${label(b?.status)} without a laboratory event. The member is notified and the change is audited with your name.`}
    extra={<Field label="New status"><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>{LAB_STATUSES.map((s) => <Chip key={s} selected={status === s} onPress={() => setStatus(s)}>{label(s)}</Chip>)}</View></Field>}
    onConfirm={async (reason) => { if (!b) return; await patch(`/admin/bookings/${b.id}`, { status, reason }); onDone(); }} />;
}

/** Price or visibility of one catalogue test (PATCH /admin/bloodwork/tests/:id). The reason is typed by the administrator and
 *  recorded verbatim in the audit log (3 to 300 characters, the server's limit); nothing is sent until it passes (Bloodwork.tsx:71-85). */
function PriceDialog({ t, onClose, onDone }: { t: LabTest | null; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState('');
  const [hidden, setHidden] = useState(false);
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (t) { setPrice(t.priceInr === null || t.priceInr === undefined ? '' : String(t.priceInr)); setHidden(!!t.hidden); setReason(''); setErrs({}); setErr(null); setBusy(false); } }, [t]);
  const go = async () => {
    if (!t) return;
    const r = reason.trim();
    if (r.length < 3 || r.length > 300) { setErrs({ reason: 'Say why, in 3 to 300 characters.' }); return; }
    setErrs({}); setErr(null); setBusy(true);
    try { await patch(`/admin/bloodwork/tests/${t.id}`, { priceInr: price.trim() === '' ? null : Number(price), hidden, reason: r }); onDone(); onClose(); }
    catch (e) { if (e instanceof ApiError) { const fe = e.fieldErrors(); if (Object.keys(fe).length) setErrs(fe); } setErr(errorText(e)); setBusy(false); }
  };
  return <Sheet open={!!t} onClose={onClose} title={t?.name ?? ''} footer={footer(<Button title="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />, <Button title="Save" onPress={go} busy={busy} style={{ flex: 1 }} />)}>
    <Field label="Price (₹, including GST)" hint="Leave empty to keep the test unpriced and hidden." error={errs.priceInr}><Input value={price} onChangeText={(v) => setPrice(v.replace(/[^\d]/g, ''))} keyboardType="number-pad" placeholder="On request" /></Field>
    <Check checked={hidden} onChange={setHidden} label="Hidden from members" />
    <Row style={{ height: space.sm }}><View /></Row>
    <Field label="Reason (recorded in the audit log)" error={errs.reason}><Input value={reason} onChangeText={setReason} maxLength={300} placeholder="e.g. vendor price revised on 1 November" /></Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}
