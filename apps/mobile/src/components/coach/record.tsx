/* The seven core tabs of the coach's client record (the portal's pages/ClientDetail.tsx for a coach: Overview, Plan,
   Bloodwork, Appointments, Progress, Messages, Notes), with the portal's cards, wording, empties and gating. Everything
   the admin branch of that page shows (Account tab, entitlement ledger, adjustments, state changes) is not here. The
   record payload is GET /coach/clients/:id as the screen loaded it; `withheld` is the health-sharing gate. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errorText, post } from '@/lib/api';
import { fmtDate, fmtDateTime, label, relative } from '@/lib/format';
import { wellnessLabel } from '@/lib/coach/core/format';
import { Button, Card, Empty, Eyebrow, Input, Row } from '@/components/ui';
import { KeyValue } from '@/components/workspace';
import { Bold, CardHead, Code, LinkText, Muted, PickerField, Readout, Small, Spark, StatusPill, TextArea, Tile, TimelineItem, WarnPills } from './shared';
import { colors, font, space } from '@/theme';

export const WITHHELD_TITLE = 'Not shared with you';
export const WITHHELD_BODY = 'This member has not shared health information (measurements, progress log, blood tests and reports) with their coach. It appears here once they turn on sharing in the app.';

export function WithheldCard() { return <Card><Empty title={WITHHELD_TITLE} body={WITHHELD_BODY} /></Card>; }

function Accordion({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <View style={{ marginTop: space.sm }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)}><Text style={styles.summary}>{`${open ? '▾' : '▸'} ${title}`}</Text></Pressable>
    {open ? <View style={{ marginTop: space.sm }}>{children}</View> : null}
  </View>;
}

/* ---------- Overview ---------- */

export function OverviewTab({ d, withheld }: { d: any; withheld: boolean }) {
  const m = d.member ?? {};
  const profile = d.profile?.profile ?? {};
  const consents: Record<string, { granted: boolean }> = d.profile?.consents ?? {};
  const ents: any[] = Array.isArray(d.entitlements) ? d.entitlements : [];
  const profileRows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Member ID', value: <Code>{m.memberCode ?? profile.memberCode ?? '—'}</Code> },
    { label: 'Goals', value: (profile.goals ?? []).join(', ') || '—' },
  ];
  if (profile.age != null) profileRows.push({ label: 'Age', value: String(profile.age) });
  if (profile.gender) profileRows.push({ label: 'Gender', value: label(profile.gender) });
  if ('city' in profile) profileRows.push({ label: 'City', value: profile.city ?? '—' });
  profileRows.push({ label: 'Onboarding', value: profile.onboardingCompletedAt ? `done ${fmtDate(profile.onboardingCompletedAt)}` : label(profile.onboardingStep) || '—' });
  profileRows.push({ label: 'Consents', value: Object.entries(consents).map(([k, v]) => `${label(k)}: ${v?.granted ? 'yes' : 'no'}`).join(' · ') || '—' });
  const answers = d.onboardingResponses && typeof d.onboardingResponses === 'object' ? Object.entries(d.onboardingResponses as Record<string, any>) : [];
  const history: any[] = Array.isArray(d.assignmentHistory) ? d.assignmentHistory : [];
  return <View style={{ gap: space.md }}>
    <Card>
      <CardHead eyebrow="Package" title={d.programme?.packageName ?? 'None'} right={d.programme ? <StatusPill status={d.programme.status} /> : undefined} />
      <KeyValue rows={[['Started', fmtDate(d.programme?.startAt)], ['Ends', fmtDate(d.programme?.endAt)]]} />
      {ents.length ? <View style={{ gap: space.xs }}>
        <View style={styles.entHead}><Text style={[styles.entCell, { flex: 2 }]}>Service</Text><Text style={styles.entNum}>Left</Text><Text style={styles.entNum}>Used</Text><Text style={styles.entNum}>Held</Text></View>
        {ents.map((e) => <View key={e.id} style={styles.entRow}>
          <View style={{ flex: 2 }}><Text style={styles.entText}>{label(e.serviceType)}</Text>{e.status !== 'active' && e.status !== 'available' ? <Muted>{label(e.status)}</Muted> : null}{!e.orderId ? <Muted>manual adjustment</Muted> : null}</View>
          <Text style={[styles.entText, styles.entNum]}>{`${e.remaining ?? Math.max(0, e.quantity - e.used - e.reserved)} / ${e.quantity}`}</Text><Text style={[styles.entText, styles.entNum]}>{String(e.used)}</Text><Text style={[styles.entText, styles.entNum]}>{String(e.reserved)}</Text>
        </View>)}
        <Muted>Held = reserved for a booked collection or consultation.</Muted>
      </View> : null}
    </Card>
    <Card>
      <CardHead eyebrow="Profile" title="Goals and details" />
      <KeyValue rows={profileRows} />
      <Muted>Phone, address and identity documents stay with Bioptime; message the member here or ask the team.</Muted>
      {answers.length ? <Accordion title="Onboarding answers"><KeyValue rows={answers.map(([step, data]) => ({ label: label(step), value: data && typeof data === 'object' ? Object.entries(data as Record<string, unknown>).map(([k, v]) => `${label(k)}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v)}`).join(' · ') || 'seen' : String(data) }))} /></Accordion> : null}
      {history.length ? <Accordion title={`Assignment history (${history.length})`}>{history.map((a) => <TimelineItem key={a.id} done title={`${label(a.status)} · ${a.method}${a.reason ? ` · ${a.reason}` : ''}`} time={`${fmtDate(a.effective_at)}${a.ended_at ? ` → ${fmtDate(a.ended_at)}` : ''}`} />)}</Accordion> : null}
    </Card>
    <Card>
      <CardHead eyebrow="Next" title="What is coming" />
      {d.nextAppointment ? <Row><Bold>{label(d.nextAppointment.kind)}</Bold><Small>{`· ${fmtDateTime(d.nextAppointment.start_at)}`}</Small><StatusPill status={d.nextAppointment.status} /></Row> : <Small>No appointment booked.</Small>}
      {withheld ? <Small>Blood tests not shared with you.</Small> : d.bloodwork ? <View><Row><Bold>{d.bloodwork.test_name}</Bold><Small>{`· ${d.bloodwork.reference}`}</Small><StatusPill status={d.bloodwork.status} /></Row>{d.bloodwork.flag ? <Small>{d.bloodwork.flag}</Small> : null}</View> : <Small>No blood test booked.</Small>}
      <Muted>{`Wellness Score: ${withheld ? 'not shared' : m.wellnessScore == null ? 'not yet calculated' : `${m.wellnessScore} (${wellnessLabel(m.wellnessScoreLabel)})`} · unread messages ${d.unread?.messages ?? 0}`}</Muted>
    </Card>
    {Array.isArray(d.milestones) ? <Card>
      <CardHead eyebrow="Milestones" title="Derived from the record" />
      {d.milestones.map((ms: any) => <TimelineItem key={ms.key} done={!!ms.achievedAt} title={ms.title} meta={`${ms.achievedAt ? fmtDate(ms.achievedAt) : 'not yet'} · ${ms.detail}`} />)}
    </Card> : null}
    <Card>
      <CardHead eyebrow="Today" title="Plan tasks due" />
      {d.todaysActions?.length ? d.todaysActions.map((t: any) => <Row key={t.id} between style={styles.taskRow}><View style={{ flex: 1, minWidth: 0 }}><Bold>{t.title}</Bold><Small>{`${label(t.kind)} · ${t.overdue === true ? `overdue since ${fmtDate(t.due_at)}` : fmtDate(t.due_at)}`}</Small></View><StatusPill status={t.status} /></Row>) : <Empty title="No tasks due today" />}
    </Card>
  </View>;
}

/* ---------- Plan ---------- */

export function PlanTab({ d, memberId }: { d: any; memberId: string }) {
  const router = useRouter();
  const plans: any[] = d.plans ?? [];
  if (!plans.length) return <Card><Empty title="No plan yet" body="Write a draft, then publish it to generate the member's tasks." /><Button title="Write a plan" small onPress={() => router.push(`/coach/plans/new?member=${memberId}`)} style={{ alignSelf: 'center', marginBottom: space.md }} /></Card>;
  return <View style={{ gap: space.md }}>{plans.map((p) => {
    const weeks = Array.from(new Set<number>(((p.tasks ?? []) as any[]).map((t) => Number(t.week)))).sort((a, b) => a - b);
    return <Card key={p.id}>
      <CardHead eyebrow={`Version ${p.current_version} · ${label(p.status)}`} title={p.title} right={<><Button title={p.status === 'draft' ? 'Edit and publish' : 'Revise'} small variant="secondary" onPress={() => router.push(`/coach/plans/${p.id}`)} /><StatusPill status={p.status} /></>} />
      {(p.goals ?? []).length ? <Small>{p.goals.join(' · ')}</Small> : null}
      {p.tasks?.length ? <View style={{ gap: space.sm }}>{weeks.map((w) => <Tile key={w}><Eyebrow>{`Week ${w}`}</Eyebrow>{p.tasks.filter((t: any) => Number(t.week) === w).map((t: any) => <Text key={t.id} style={[styles.task, t.status === 'done' && styles.taskDone]}>{`• ${t.title}`}</Text>)}</Tile>)}</View> : <Muted>No tasks generated yet (publish the draft).</Muted>}
    </Card>;
  })}</View>;
}

/* ---------- Bloodwork ---------- */

export function BloodworkTab({ d, withheld }: { d: any; withheld: boolean }) {
  const router = useRouter();
  if (withheld) return <WithheldCard />;
  const bookings: any[] = d.bookings ?? [];
  const reports: any[] = d.reports ?? [];
  return <View style={{ gap: space.md }}>
    <Card>
      <CardHead eyebrow="Bookings" title="Blood tests" />
      {bookings.length ? bookings.map((b) => <Row key={b.id} between style={styles.taskRow}><View style={{ flex: 1, minWidth: 0 }}><Bold>{b.test?.name ?? 'Blood test'}</Bold><Small>{`${b.reference} · ${fmtDateTime(b.slotAt)}`}</Small>{b.flag ? <Muted>{b.flag}</Muted> : null}</View><StatusPill status={b.status} /></Row>) : <Empty title="No bookings" />}
    </Card>
    <Card>
      <CardHead eyebrow="Reports" title="Laboratory reports" />
      {reports.length ? reports.map((r) => <Row key={r.id} between style={styles.taskRow}>
        <View style={{ flex: 1, minWidth: 0 }}><LinkText onPress={() => router.push(`/coach/reports/${r.id}`)}>{r.test?.name ?? 'Report'}</LinkText><Small>{`${r.reference} · delivered ${fmtDate(r.deliveredAt)} · ${r.reviewed ? `reviewed by ${r.reviewerName}` : 'awaiting review'}`}</Small><WarnPills items={r.flagged} /></View>
        <Button title={r.reviewed ? 'Open' : 'Review'} small variant={r.reviewed ? 'secondary' : 'primary'} onPress={() => router.push(`/coach/reports/${r.id}`)} />
      </Row>) : <Empty title="No reports" />}
    </Card>
  </View>;
}

/* ---------- Appointments ---------- */

export function AppointmentsTab({ d, onSchedule }: { d: any; onSchedule: () => void }) {
  const items: any[] = d.appointments ?? [];
  return <Card>
    <CardHead eyebrow="All" title="Appointments" right={<Button title="Schedule" small onPress={onSchedule} />} />
    {items.length ? items.map((a) => <Row key={a.id} between style={styles.taskRow}><View style={{ flex: 1, minWidth: 0 }}><Bold>{fmtDateTime(a.startAt)}</Bold><Small>{`${label(a.kind)} · ${a.coachName ?? '—'}`}</Small>{a.note ?? a.memberNote ? <Small>{a.note ?? a.memberNote}</Small> : null}</View><StatusPill status={a.status} /></Row>) : <Empty title="No appointments" />}
  </Card>;
}

/* ---------- Progress ---------- */

export function ProgressTab({ d, withheld, onRecord }: { d: any; withheld: boolean; onRecord: () => void }) {
  const p = d.progress ?? {};
  const metrics: any[] = withheld ? [] : (p.metrics ?? []);
  return <View style={{ gap: space.md }}>
    <Card>
      <CardHead eyebrow="Programme" title={p.programmeCompletion == null ? 'Completion not available' : `Completion ${p.programmeCompletion}%`} right={!withheld ? <Button title="Record a value" small variant="secondary" onPress={onRecord} /> : undefined} />
      {p.note ? <Muted>{p.note}</Muted> : null}
    </Card>
    {withheld ? <WithheldCard /> : <View style={{ gap: space.sm }}>{metrics.map((mt) => <View key={mt.metric}><Readout eyebrow={mt.label} value={mt.latest ? String(mt.latest.value) : '—'} unit={mt.unit} sub={mt.latest ? `${label(mt.latest.source)} · ${relative(mt.latest.at)}` : 'no entries'} />{mt.series?.length > 1 ? <Spark points={mt.series.map((s: any) => Number(s.value))} /> : null}</View>)}</View>}
  </View>;
}

/* ---------- Messages ---------- */

export function MessagesTab({ memberId }: { memberId: string }) {
  const router = useRouter();
  return <Card>
    <CardHead eyebrow="Thread" title="Messages" right={<Button title="Open conversations" small variant="secondary" onPress={() => router.push(`/(coach)/messages?member=${memberId}`)} />} />
    <Small>Messaging lives in the Messages section so threads stay in one place.</Small>
  </Card>;
}

/* ---------- Notes ---------- */

const VISIBILITY = [{ value: 'private', label: 'Private to the team' }, { value: 'client', label: 'Visible to the member' }];

export function NotesTab({ d, memberId, reload, show }: { d: any; memberId: string; reload: () => void; show: (t: string, k?: 'ok' | 'error') => void }) {
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'client'>('private');
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState<'note' | 'follow' | null>(null);
  const notes: any[] = d.notes ?? [];
  const addNote = async () => {
    setBusy('note');
    try { await post(`/coach/clients/${memberId}/notes`, { body: note.trim(), visibility }); setNote(''); show(visibility === 'client' ? 'Recommendation sent to the member' : 'Note saved'); reload(); }
    catch (e) { show(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const addFollowUp = async () => {
    setBusy('follow');
    try { await post(`/coach/clients/${memberId}/follow-ups`, { title: followUp.trim() }); setFollowUp(''); show('Follow-up created'); reload(); }
    catch (e) { show(errorText(e), 'error'); } finally { setBusy(null); }
  };
  return <View style={{ gap: space.md }}>
    <Card>
      <CardHead eyebrow="Notes" title="Coach notes" />
      <Muted>Three kinds: private (coaching team and administrators), client-visible recommendations (the member reads them under My program), administrative (written by Bioptime). Laboratory results are never notes.</Muted>
      <TextArea rows={3} value={note} onChangeText={setNote} maxLength={4000} placeholder={visibility === 'client' ? 'A recommendation the member will read' : 'What you observed, decided or agreed'} accessibilityLabel="Note" />
      <PickerField label="Who may read this note" value={visibility} options={VISIBILITY} onChange={(v) => setVisibility(v as 'private' | 'client')} />
      <Button title={visibility === 'client' ? 'Send to the member' : 'Save note'} small disabled={!note.trim()} busy={busy === 'note'} onPress={addNote} style={{ alignSelf: 'flex-start' }} />
      <View style={{ marginTop: space.sm }}>
        {notes.length ? notes.map((n) => <TimelineItem key={n.id} done title={`${n.coach_name} · ${label(n.kind)}`} right={<StatusPill status={n.visibility === 'client' ? 'active' : n.visibility === 'admin' ? 'draft' : 'pending'}>{n.visibility === 'client' ? 'member can read' : n.visibility === 'admin' ? 'administrative' : 'private'}</StatusPill>} body={n.body} time={relative(n.created_at)} />) : <Muted>No notes yet.</Muted>}
      </View>
    </Card>
    <Card>
      <CardHead eyebrow="Follow-ups" title="Tasks for me" />
      <Input placeholder="e.g. Check sleep log next week" value={followUp} onChangeText={setFollowUp} maxLength={200} accessibilityLabel="Follow-up" />
      <Button title="Add" small variant="secondary" disabled={followUp.trim().length < 2} busy={busy === 'follow'} onPress={addFollowUp} style={{ alignSelf: 'flex-start' }} />
      <Muted>Follow-ups appear on Today until resolved.</Muted>
    </Card>
  </View>;
}

const styles = StyleSheet.create({
  summary: { color: colors.accentText, fontSize: font.small, fontWeight: '600' },
  entHead: { flexDirection: 'row', gap: space.sm, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  entRow: { flexDirection: 'row', gap: space.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'flex-start' },
  entCell: { color: colors.muted, fontSize: font.tiny, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '600' },
  entNum: { width: 56, textAlign: 'right', color: colors.muted, fontSize: font.tiny, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '600' },
  entText: { color: colors.text, fontSize: font.small, textTransform: 'none', letterSpacing: 0, fontWeight: '400' },
  taskRow: { paddingVertical: space.sm, alignItems: 'flex-start', flexWrap: 'nowrap', borderBottomWidth: 1, borderBottomColor: colors.border },
  task: { color: colors.text, fontSize: font.small, lineHeight: 19 },
  taskDone: { color: colors.muted, textDecorationLine: 'line-through' },
});
