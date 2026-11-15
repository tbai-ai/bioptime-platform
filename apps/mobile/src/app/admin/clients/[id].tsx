/* Admin › Member record (the web's /admin/clients/:id, pages/ClientDetail.tsx in admin mode, members.manage):
   GET /admin/members/:id (the server audits every open as member.record_viewed), the header, and the tabs in the web's
   order: Overview, Plan, Bloodwork, Appointments, Progress, the module tabs (lib/admin/moduleTabs MODULE_RECORD_TABS,
   each behind its flag and permission), Notes, Account. Actions: the entitlement ledger and "Adjust entitlements by
   hand" (entitlements.adjust), an administrative note, suspend / reactivate with a reason, password reset and
   verification links. Phone, address, PIN code, date of birth and session IPs show only with members.view_restricted
   (the server leaves the keys out otherwise and the screen says "Restricted", as the web does). */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { errorText, get, patch, post, randomKey } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFeatures } from '@/lib/features';
import { fmtDate, fmtDateTime, inr, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { MODULE_RECORD_TABS } from '@/lib/admin/moduleTabs';
import { actionLabel, labelOr, tone, wellnessLabel } from '@/lib/admin/a/format';
import { AdminHeader, Choice, Code, NotedRow, Readout, TimelineItem } from '@/components/adminA/parts';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { Spark } from '@/components/coach/shared';
import { Button, Card, Empty, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row, Screen, StaleBanner } from '@/components/ui';
import { KeyValue, RecordList, RecordRow, SegmentTabs, Sheet, type KeyValueRow } from '@/components/workspace';
import { RequirePermission, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { colors, font, radius, space } from '@/theme';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = any;
/** How many audit rows GET /admin/members/:id returns (listAudit limit in apps/api http/routes/admin.ts). */
const AUDIT_WINDOW = 100;
const CORE_TABS = ['overview', 'plan', 'bloodwork', 'appointments', 'messages', 'notes', 'progress', 'account'];
const RESTRICTED_TITLE = 'Needs the “View members’ restricted contact fields” permission';

/** The route keys the record by its id, so a record opened in place of another starts afresh (no earlier member's
 *  data, tab, dialogs or toast stay on screen). */
export default function AdminClientRecordRoute() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return <AdminClientRecord key={id} id={id} />;
}

function AdminClientRecord({ id }: { id: string }) {
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const { can } = useAuth();
  const router = useRouter();
  const features = useFeatures(true);
  const toast = useToast();
  const rec = useLoad<Rec>(id ? `admin-member-${id}` : null, () => get(`/admin/members/${id}`), [id]);
  const [tab, setTab] = useState(typeof tabParam === 'string' && tabParam ? tabParam : 'overview');
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [stateDlg, setStateDlg] = useState<'suspended' | 'active' | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [ledger, setLedger] = useState<{ e: Rec; items: Rec[] } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const d = rec.data;
  const moduleTabs = useMemo(() => MODULE_RECORD_TABS.filter((t) => !CORE_TABS.includes(t.id) && !!features && features.has(t.module) && (!t.feature || features.has(t.feature)) && (!t.permission || can(t.permission))), [features, can]);

  const m = d?.member ?? {};
  const profile = d?.profile?.profile ?? {};
  const consents: Record<string, Rec> = d?.profile?.consents ?? {};
  const restricted = d?.profile?.restricted === true;
  const plans: Rec[] = d?.plans ?? [];
  const reports: Rec[] = d?.reports ?? [];
  const tabs = [
    { id: 'overview', label: 'Overview' }, { id: 'plan', label: 'Plan', count: plans.filter((p) => p.status === 'draft').length }, { id: 'bloodwork', label: 'Bloodwork', count: reports.filter((r) => !r.reviewed).length },
    { id: 'appointments', label: 'Appointments' }, { id: 'progress', label: 'Progress' }, ...moduleTabs.map((t) => ({ id: t.id, label: t.label })), { id: 'notes', label: 'Notes' }, { id: 'account', label: 'Account' },
  ];
  const auditRows: Rec[] = d?.audit ?? [];
  const history = auditRows.filter((a) => !/[._]viewed$/.test(String(a.action ?? '')));
  const auditCut = auditRows.length >= AUDIT_WINDOW;

  const openLedger = async (e: Rec) => { try { const r = await get<{ items: Rec[] }>(`/admin/members/${id}/entitlements/${e.id}/transactions`); setLedger({ e, items: r.items ?? [] }); } catch (ex) { toast.show(errorText(ex), 'error'); } };
  const addNote = async () => { setNoteBusy(true); try { await post(`/admin/members/${id}/notes`, { body: note.trim() }); setNote(''); toast.show('Note saved'); void rec.reload(); } catch (e) { toast.show(errorText(e), 'error'); } finally { setNoteBusy(false); } };
  const simple = async (key: string, path: string, done: string) => { setBusyAction(key); try { await post(`/admin/members/${id}/${path}`); toast.show(done); } catch (e) { toast.show(errorText(e), 'error'); } finally { setBusyAction(null); } };
  const R = <Text style={styles.restricted} accessibilityLabel={RESTRICTED_TITLE}>Restricted</Text>;
  const restrictedOr = (v: React.ReactNode) => (restricted ? R : v ?? '—');

  return <RoleGate workspace="admin"><View style={{ flex: 1 }}><Screen refreshing={rec.loading} onRefresh={rec.reload}>
    <AdminHeader title={m.name ?? 'Member'} />
    <RequirePermission permission="members.manage">
      <StaleBanner at={rec.stale} /><ErrorBox error={rec.error} onRetry={rec.reload} />
      {rec.loading && !d ? <Loading /> : d ? <>
        <Enter index={0}><View style={{ gap: space.xs }}>
          <Row><Text style={styles.name}>{m.name}</Text>{m.memberCode ?? profile.memberCode ? <Code>{String(m.memberCode ?? profile.memberCode)}</Code> : null}<Pill tone={tone(m.state)}>{labelOr(m.state)}</Pill></Row>
          <P muted small>{`${d.programme ? `${d.programme.packageName} · ${d.programme.durationLabel ?? ''} · ends ${fmtDate(d.programme.endAt)}` : 'No active programme'} · ${d.coach ? `coach ${d.coach.displayName}` : `assignment ${label(d.assignmentStatus)}`}`}</P>
        </View></Enter>
        <SegmentTabs items={tabs} value={tab} onChange={setTab} />

        {tab === 'overview' ? <Enter index={1} key="overview"><View style={{ gap: space.md }}>
          <Card>
            <Row between><View><Eyebrow>Package</Eyebrow><H2>{d.programme?.packageName ?? 'None'}</H2></View>{d.programme ? <Pill tone={tone(d.programme.status)}>{labelOr(d.programme.status)}</Pill> : null}</Row>
            <KeyValue rows={[['Started', fmtDate(d.programme?.startAt)], ['Ends', fmtDate(d.programme?.endAt)]]} />
            {Array.isArray(d.entitlements) && d.entitlements.length > 0 ? <View style={{ gap: space.sm }}>
              <RecordList>{d.entitlements.map((e: Rec) => {
                const left = e.remaining ?? Math.max(0, e.quantity - e.used - e.reserved);
                const subs = [e.status !== 'active' && e.status !== 'available' ? label(e.status) : '', !e.orderId ? 'manual adjustment' : ''].filter(Boolean).join(' · ');
                return <RecordRow key={e.id} title={label(e.serviceType)} meta={`Left ${left} / ${e.quantity} · used ${e.used} · held ${e.reserved}${subs ? `\n${subs}` : ''}`} onPress={() => void openLedger(e)} />;
              })}</RecordList>
              <P muted small>Held = reserved for a booked collection or consultation. Select a service to open its ledger.</P>
            </View> : null}
            {can('entitlements.adjust') ? <Button title="Adjust entitlements" small variant="secondary" onPress={() => setAdjust(true)} style={{ alignSelf: 'flex-start' }} /> : null}
          </Card>
          <Card>
            <Eyebrow>Profile</Eyebrow><H2>Goals and details</H2>
            <KeyValue rows={([
              ['Member ID', <Code key="code">{String(m.memberCode ?? profile.memberCode ?? '—')}</Code>],
              ['Goals', (profile.goals ?? []).join(', ') || '—'],
              ...(profile.age != null ? [['Age', String(profile.age)]] : []),
              ...(profile.gender ? [['Gender', label(profile.gender)]] : []),
              ...('city' in profile ? [['City', profile.city ?? '—']] : []),
              ['Email', m.email ?? '—'],
              ['Phone', restrictedOr(d.profile?.phone)],
              ['Address', restrictedOr(profile.address)],
              ['PIN code', restrictedOr(profile.pincode)],
              ['Date of birth', restricted ? R : profile.dateOfBirth ? fmtDate(profile.dateOfBirth) : '—'],
              ['Onboarding', profile.onboardingCompletedAt ? `done ${fmtDate(profile.onboardingCompletedAt)}` : labelOr(profile.onboardingStep)],
              ['Consents', Object.entries(consents).map(([k, v]) => `${label(k)}: ${v?.granted ? 'yes' : 'no'}`).join(' · ') || '—'],
            ] as KeyValueRow[])} />
            {restricted ? <P muted small>Phone, address, PIN code and date of birth are restricted: your administrator account does not hold “View members’ restricted contact fields”. An owner can grant it under Users and permissions.</P> : null}
          </Card>
          <Card>
            <Eyebrow>Next</Eyebrow><H2>What is coming</H2>
            {d.nextAppointment ? <Row><P style={{ fontWeight: '600' }}>{label(d.nextAppointment.kind)}</P><P muted>{`· ${fmtDateTime(d.nextAppointment.start_at)}`}</P><Pill tone={tone(d.nextAppointment.status)}>{labelOr(d.nextAppointment.status)}</Pill></Row> : <P muted small>No appointment booked.</P>}
            {d.bloodwork ? <View><Row><P style={{ fontWeight: '600' }}>{d.bloodwork.test_name}</P><P muted>{`· ${d.bloodwork.reference}`}</P><Pill tone={tone(d.bloodwork.status)}>{labelOr(d.bloodwork.status)}</Pill></Row>{d.bloodwork.flag ? <P muted small>{d.bloodwork.flag}</P> : null}</View> : <P muted small>No blood test booked.</P>}
            <P muted small>{`Wellness Score: ${m.wellnessScore == null ? 'not yet calculated' : `${m.wellnessScore} (${wellnessLabel(m.wellnessScoreLabel)})`} · unread messages ${d.unread?.messages ?? 0}`}</P>
          </Card>
          <Card>
            <Eyebrow>Today</Eyebrow><H2>Plan tasks due</H2>
            {d.todaysActions?.length ? <RecordList>{d.todaysActions.map((t: Rec) => <RecordRow key={t.id} title={t.title} meta={`${label(t.kind)} · ${t.overdue === true ? `overdue since ${fmtDate(t.due_at)}` : fmtDate(t.due_at)}`} pills={[{ label: labelOr(t.status), tone: tone(t.status) }]} />)}</RecordList> : <Empty title="No tasks due today" />}
          </Card>
        </View></Enter> : null}

        {tab === 'plan' ? <Enter index={1} key="plan"><View style={{ gap: space.md }}>
          {plans.length ? plans.map((p) => {
            const tasks: Rec[] = p.tasks ?? [];
            const weeks = Array.from(new Set(tasks.map((t) => t.week)));
            return <Card key={p.id}>
              <Row between><View style={{ flex: 1 }}><Eyebrow>{`Version ${p.current_version} · ${label(p.status)}`}</Eyebrow><H2>{p.title}</H2></View><Pill tone={tone(p.status)}>{labelOr(p.status)}</Pill></Row>
              {(p.goals ?? []).length ? <P small muted>{(p.goals ?? []).join(' · ')}</P> : null}
              {tasks.length ? <View style={{ gap: space.sm }}>{weeks.map((w) => <View key={String(w)} style={styles.tile}><Eyebrow>{`Week ${w}`}</Eyebrow>{tasks.filter((t) => t.week === w).map((t) => <Text key={t.id} style={[styles.task, t.status === 'done' && styles.taskDone]}>{`• ${t.title}`}</Text>)}</View>)}</View> : <P muted>No tasks generated yet (publish the draft).</P>}
            </Card>;
          }) : <Card><Empty title="No plan yet" body="Write a draft, then publish it to generate the member's tasks." /></Card>}
        </View></Enter> : null}

        {tab === 'bloodwork' ? <Enter index={1} key="bloodwork"><View style={{ gap: space.md }}>
          <Card>
            <Eyebrow>Bookings</Eyebrow><H2>Blood tests</H2>
            {(d.bookings ?? []).length ? <RecordList>{d.bookings.map((b: Rec) => <NotedRow key={b.id} title={b.reference} meta={`${b.test?.name ?? ''} · ${fmtDateTime(b.slotAt)}`} notes={[b.flag]} pills={[{ label: labelOr(b.status), tone: tone(b.status) }]} />)}</RecordList> : <Empty title="No bookings" />}
          </Card>
          <Card>
            <Eyebrow>Reports</Eyebrow><H2>Laboratory reports</H2>
            {reports.length ? <RecordList>{reports.map((r) => <RecordRow key={r.id} title={r.test?.name ?? r.reference} meta={`${r.reference} · delivered ${fmtDate(r.deliveredAt)} · ${r.reviewed ? `reviewed by ${r.reviewerName}` : 'awaiting review'}`} pills={(r.flagged ?? []).map((f: string) => ({ label: f, tone: 'warning' as const }))} right={<Button title={r.reviewed ? 'Open' : 'Review'} small variant={r.reviewed ? 'secondary' : 'primary'} onPress={() => router.push(`/admin/reports/${r.id}` as never)} />} />)}</RecordList> : <Empty title="No reports" />}
          </Card>
        </View></Enter> : null}

        {tab === 'appointments' ? <Enter index={1} key="appointments"><Card>
          <Eyebrow>All</Eyebrow><H2>Appointments</H2>
          {(d.appointments ?? []).length ? <RecordList>{d.appointments.map((a: Rec) => <NotedRow key={a.id} title={fmtDateTime(a.startAt)} meta={`${label(a.kind)} · ${a.coachName ?? '—'}`} notes={[a.note ?? a.memberNote]} pills={[{ label: labelOr(a.status), tone: tone(a.status) }]} />)}</RecordList> : <Empty title="No appointments" />}
        </Card></Enter> : null}

        {tab === 'progress' ? <Enter index={1} key="progress"><View style={{ gap: space.md }}>
          <Card><Eyebrow>Programme</Eyebrow><H2>{d.progress?.programmeCompletion == null ? 'Completion not available' : `Completion ${d.progress.programmeCompletion}%`}</H2>{d.progress?.note ? <P muted small>{d.progress.note}</P> : null}</Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>{(d.progress?.metrics ?? []).map((mt: Rec) => <View key={mt.metric} style={{ flex: 1, minWidth: 150 }}>
            <Readout eyebrow={mt.label} value={mt.latest ? String(mt.latest.value) : '—'} unit={mt.unit} sub={mt.latest ? `${label(mt.latest.source)} · ${relative(mt.latest.at)}` : 'no entries'}>
              {mt.series?.length > 1 ? <Spark points={mt.series.map((s: Rec) => Number(s.value) || 0)} /> : null}
            </Readout>
          </View>)}</View>
        </View></Enter> : null}

        {moduleTabs.filter((t) => t.id === tab).map((t) => <Enter index={1} key={t.id}><View>{t.render({ memberId: id, record: d, reload: rec.reload })}</View></Enter>)}

        {tab === 'notes' ? <Enter index={1} key="notes"><View style={{ gap: space.md }}>
          <Card>
            <Eyebrow>Notes</Eyebrow><H2>Administrative and coaching notes</H2>
            <P muted small>Three kinds: private (coaching team and administrators), client-visible recommendations (the member reads them under My program), administrative (written by Bioptime). Laboratory results are never notes.</P>
            <Input value={note} onChangeText={setNote} placeholder="An administrative note for the record (the assigned coach reads it)" multiline numberOfLines={3} style={{ minHeight: 80, textAlignVertical: 'top' }} accessibilityLabel="Administrative note" />
            <Button title="Save administrative note" small disabled={!note.trim()} busy={noteBusy} onPress={addNote} style={{ alignSelf: 'flex-start' }} />
            <View style={{ marginTop: space.sm }}>{(d.notes ?? []).length ? d.notes.map((n: Rec) => <View key={n.id} style={styles.noteRow}>
              <Row><P small style={{ fontWeight: '700' }}>{n.coach_name ?? '—'}</P><P small muted>{`· ${label(n.kind)} ·`}</P><Pill tone={n.visibility === 'client' ? 'success' : 'warning'}>{n.visibility === 'client' ? 'member can read' : n.visibility === 'admin' ? 'administrative' : 'private'}</Pill></Row>
              <P small>{n.body}</P><P small muted style={{ fontSize: font.tiny }}>{relative(n.created_at)}</P>
            </View>) : <P muted small>No notes yet.</P>}</View>
          </Card>
          <Card><Eyebrow>Follow-ups</Eyebrow><H2>Tasks for me</H2><P muted small>Follow-ups appear on Today until resolved.</P></Card>
        </View></Enter> : null}

        {tab === 'account' ? <Enter index={1} key="account"><View style={{ gap: space.md }}>
          <Card>
            <Row between><View><Eyebrow>Account</Eyebrow><H2>State and recovery</H2></View><Pill tone={tone(m.state)}>{labelOr(m.state)}</Pill></Row>
            <View style={styles.twoByTwo}>
              <Button title="Suspend" small variant="danger" onPress={() => setStateDlg('suspended')} style={styles.half} />
              <Button title="Reactivate" small variant="secondary" onPress={() => setStateDlg('active')} style={styles.half} />
              <Button title="Send password reset" small variant="secondary" busy={busyAction === 'reset'} onPress={() => void simple('reset', 'password-reset', 'Reset link queued to the outbox')} style={styles.half} />
              <Button title="Resend verification" small variant="secondary" busy={busyAction === 'verify'} onPress={() => void simple('verify', 'resend-verification', 'Verification link queued')} style={styles.half} />
            </View>
            <RecordList title="Sessions">{(d.sessions ?? []).map((s: Rec) => <RecordRow key={s.id} title={String(s.kind ?? '—')} meta={`IP ${restricted ? 'Restricted' : s.ip ?? '—'} · last seen ${relative(s.last_seen_at)}\n${s.revoked_at ? 'revoked' : `expires ${fmtDate(s.expires_at)}`}`} />)}</RecordList>
            {restricted ? <P muted small>Session IP addresses need the “View members’ restricted contact fields” permission.</P> : null}
          </Card>
          <Card>
            <Eyebrow>Commerce</Eyebrow><H2>Orders</H2>
            {(d.orders ?? []).length ? <RecordList>{d.orders.map((o: Rec) => <RecordRow key={o.id} title={o.reference} meta={`${o.packageName ?? '—'} · ${inr(o.totalInr)}`} pills={[{ label: labelOr(o.status), tone: tone(o.status) }]} onPress={() => router.push({ pathname: '/admin/orders', params: { ref: o.reference } } as never)} />)}</RecordList> : <Empty title="No orders" />}
            <Eyebrow>Data requests</Eyebrow>
            {(d.dataRequests ?? []).length ? <RecordList>{d.dataRequests.map((r: Rec) => <NotedRow key={r.id} title={r.kind} meta={`requested ${fmtDate(r.created_at)}`} notes={[r.note ? `Member’s note: “${r.note}”` : null, r.adminNote ? `Team note: ${r.adminNote}` : null]} pills={[{ label: labelOr(r.status), tone: tone(r.status) }]} />)}</RecordList> : <P muted>None.</P>}
          </Card>
          <Card>
            <Eyebrow>Audit</Eyebrow><H2>History</H2>
            {history.length ? history.slice(0, 30).map((a) => <TimelineItem key={a.id} title={actionLabel(a.action)} detail={a.reason} time={`${a.actor_name ?? a.actor_role} · ${fmtDateTime(a.at)}`} />) : <P muted small>{auditCut ? `The latest ${auditRows.length} entries are all record views; any earlier changes are in the audit log.` : 'No changes recorded yet.'}</P>}
            <P muted small>Record views are not listed here; the audit log keeps every one.</P>
          </Card>
        </View></Enter> : null}

        <ReasonSheet open={!!stateDlg} onClose={() => setStateDlg(null)} title={stateDlg === 'suspended' ? `Suspend ${m.name}?` : `Reactivate ${m.name}?`} destructive={stateDlg === 'suspended'} confirmLabel={stateDlg === 'suspended' ? 'Suspend account' : 'Reactivate'} body={stateDlg === 'suspended' ? 'The member is signed out everywhere and cannot sign in until reactivated.' : 'The member can sign in again.'} onConfirm={async (reason) => { await patch(`/admin/members/${id}/state`, { state: stateDlg, reason }); toast.show('Account updated'); void rec.reload(); }} />
        {can('entitlements.adjust') ? <AdjustSheet open={adjust} onClose={() => setAdjust(false)} memberId={id} onDone={() => { toast.show('Entitlements adjusted'); void rec.reload(); }} /> : null}
        <Sheet open={!!ledger} onClose={() => setLedger(null)} title={ledger ? `Ledger · ${label(ledger.e.serviceType)} · ${ledger.e.quantity} granted` : ''} footer={<Button title="Close" onPress={() => setLedger(null)} />}>
          {ledger && ledger.items.length ? <RecordList>{ledger.items.map((t) => <NotedRow key={t.id} title={`${label(t.kind)} · ${t.quantity > 0 ? '+' : ''}${t.quantity}`} meta={`${fmtDateTime(t.created_at)}${t.ref_type ? `\n${t.ref_type} ${t.ref_id ?? ''}` : ''}`} notes={[t.note, t.created_by ? `by ${t.created_by}` : null]} />)}</RecordList> : null}
        </Sheet>
      </> : null}
    </RequirePermission>
  </Screen>{toast.float}</View></RoleGate>;
}

/** The web's "Adjust entitlements by hand": a fresh idempotency key per opening and per change of service or delta,
 *  so an unchanged retry applies once and a changed request is a new one. */
function AdjustSheet({ open, onClose, memberId, onDone }: { open: boolean; onClose: () => void; memberId: string; onDone: () => void }) {
  const [serviceType, setServiceType] = useState('consultation');
  const [delta, setDelta] = useState('1');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(randomKey);
  useEffect(() => { setKey(randomKey()); }, [open, serviceType, delta]);
  useEffect(() => { if (open) { setErr(''); } }, [open]);
  const n = Number(delta);
  const negative = n < 0;
  const go = async () => {
    setBusy(true); setErr('');
    try { await post(`/admin/members/${memberId}/entitlements/adjust`, { serviceType, delta: n, reason: reason.trim(), idempotencyKey: key }); setReason(''); onDone(); onClose(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title="Adjust entitlements by hand" footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} /><Button title={negative ? 'Remove units' : 'Grant units'} variant={negative ? 'danger' : 'primary'} busy={busy} disabled={!n || !Number.isInteger(n) || Math.abs(n) > 50 || reason.trim().length < 3} onPress={go} style={{ flex: 1 }} /></View>}>
    <Choice label="Service" options={[{ value: 'consultation', label: 'Consultations' }, { value: 'bloodwork', label: 'Blood tests' }]} value={serviceType} onChange={setServiceType} />
    <Field label="Change" hint="Positive grants, negative removes unused units only."><Input value={delta} onChangeText={(v) => setDelta(v.replace(/[^\d-]/g, '').slice(0, 3))} keyboardType="numbers-and-punctuation" accessibilityLabel="Change" /></Field>
    <Field label="Reason (recorded on the ledger and in the audit log)"><Input value={reason} onChangeText={setReason} placeholder="e.g. goodwill after a missed collection" multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Reason (recorded on the ledger and in the audit log)" /></Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
    <P muted small>Used and held units are never removed. Every adjustment is a ledger row with the actor, the reason and the time.</P>
  </Sheet>;
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: font.title, fontWeight: '700', letterSpacing: -0.5 },
  restricted: { color: colors.muted, fontSize: font.small, textAlign: 'right' },
  tile: { backgroundColor: colors.base, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: 2 },
  task: { color: colors.text, fontSize: font.small, lineHeight: 19 },
  taskDone: { color: colors.muted, textDecorationLine: 'line-through' },
  noteRow: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  twoByTwo: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  half: { flexBasis: '47%', flexGrow: 1 },
});
