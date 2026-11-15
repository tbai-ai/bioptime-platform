/* Admin › Coach record (the web's /admin/coaches/:id, pages/Coaches.tsx CoachDetail, coaches.manage):
   GET /admin/coaches/:id (the coach, their assignments, working hours and blocks, the audit trail) and the five
   reason-guarded actions: Mark away (with an optional date) and Mark available (POST /admin/coaches/:id/availability),
   Capacity (PATCH /admin/coaches/:id caseloadLimit), Suspend and Reinstate (PATCH /admin/coaches/:id/state). */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { get, patch, post } from '@/lib/api';
import { fmtDate, fmtDateTime, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { actionLabel, labelOr, mm, tone, WEEKDAYS } from '@/lib/admin/a/format';
import { AdminHeader, NotedRow, TimelineItem } from '@/components/adminA/parts';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { Button, Card, Empty, ErrorBox, Eyebrow, Field, H2, Input, Loading, P, Pill, Row, Screen, StaleBanner } from '@/components/ui';
import { DatePickerField, KeyValue, RecordList } from '@/components/workspace';
import { RequirePermission, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = any;

/** The route keys the record by its id, so a record opened in place of another starts afresh (no earlier coach's data,
 *  dialogs or toast stay on screen). */
export default function AdminCoachRecordRoute() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return <AdminCoachRecord key={id} id={id} />;
}

function AdminCoachRecord({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const d = useLoad<Rec>(id ? `admin-coach-${id}` : null, () => get(`/admin/coaches/${id}`), [id]);
  const [away, setAway] = useState(false);
  const [until, setUntil] = useState('');
  const [limitDlg, setLimitDlg] = useState(false);
  const [limit, setLimit] = useState('');
  const [suspend, setSuspend] = useState(false);
  const [back, setBack] = useState(false);
  const [reinstate, setReinstate] = useState(false);
  const c = d.data?.coach;
  const dd = d.data;
  const activeCount = ((dd?.assignments ?? []) as Rec[]).filter((a) => a.status === 'active').length;
  return <RoleGate workspace="admin"><View style={{ flex: 1 }}><Screen refreshing={d.loading} onRefresh={d.reload}>
    <AdminHeader title={c?.displayName ?? 'Coach'} />
    <RequirePermission permission="coaches.manage">
      <StaleBanner at={d.stale} /><ErrorBox error={d.error} onRetry={d.reload} />
      {d.loading && !dd ? <Loading /> : c ? <>
        <Enter index={0}><View style={{ gap: space.sm }}>
          <Text style={styles.name}>{c.displayName}</Text>
          <P muted small>{`${(c.expertise ?? []).join(', ')} · ${(c.languages ?? []).join(', ')} · ${c.city ?? ''} · caseload ${c.caseload}/${c.caseloadLimit}`}</P>
          <Row><Pill tone={tone(c.state)}>{labelOr(c.state)}</Pill><Pill tone={c.available ? 'success' : 'info'}>{c.available ? 'Available' : 'Away'}</Pill></Row>
          <Row>
            {c.available ? <Button title="Mark away" small variant="secondary" onPress={() => { setUntil(''); setAway(true); }} /> : <Button title="Mark available" small variant="secondary" onPress={() => setBack(true)} />}
            <Button title="Capacity" small variant="secondary" onPress={() => { setLimit(String(c.caseloadLimit)); setLimitDlg(true); }} />
            {c.state === 'active' ? <Button title="Suspend" small variant="danger" onPress={() => setSuspend(true)} /> : <Button title="Reinstate" small variant="secondary" onPress={() => setReinstate(true)} />}
          </Row>
        </View></Enter>
        <Enter index={1}><Card>
          <Eyebrow>Assignments</Eyebrow><H2>{`${activeCount} active`}</H2>
          {(dd.assignments ?? []).length ? <RecordList>{dd.assignments.map((a: Rec) => <NotedRow key={a.id} title={a.member_name ?? a.member_id} meta={`${a.method ?? '—'} · since ${fmtDate(a.effective_at)}`} notes={[a.reason]} pills={[{ label: labelOr(a.status), tone: tone(a.status) }]} onPress={() => router.push(`/admin/clients/${a.member_id}` as never)} />)}</RecordList> : <Empty title="No assignments" />}
        </Card></Enter>
        <Enter index={2}><Card>
          <Eyebrow>Availability</Eyebrow><H2>Working hours and blocks</H2>
          {(dd.rules ?? []).length ? <KeyValue rows={dd.rules.map((r: Rec) => [WEEKDAYS[r.weekday] ?? String(r.weekday), `${mm(r.start_minute)}–${mm(r.end_minute)} · ${r.slot_minutes} min`] as [string, string])} /> : <P muted small>No working hours set; the coach sets them in Settings.</P>}
          {(dd.blocks ?? []).length ? <View>{dd.blocks.map((b: Rec) => <TimelineItem key={b.id} title="Blocked" detail={`${fmtDateTime(b.start_at)} → ${fmtDateTime(b.end_at)}${b.reason ? ` · ${b.reason}` : ''}`} time="" />)}</View> : null}
          {c.bio ? <P small muted>{c.bio}</P> : null}
        </Card></Enter>
        <Enter index={3}><Card>
          <Eyebrow>Audit</Eyebrow><H2>History</H2>
          {(dd.audit ?? []).length ? dd.audit.map((a: Rec) => <TimelineItem key={a.id} title={actionLabel(a.action)} detail={a.reason} time={`${a.actor_name ?? a.actor_role} · ${relative(a.at)}`} />) : null}
        </Card></Enter>

        <ReasonSheet open={away} onClose={() => setAway(false)} title={`Mark ${c.displayName} as away?`} confirmLabel="Mark away" body="Their active assignments pause; members are told their plan and bookings stay and messages wait for the coach. Reassign members who need someone sooner. New assignments skip them."
          extra={<DatePickerField label="Until (optional)" value={until} onChange={setUntil} />}
          onConfirm={async (reason) => { await post(`/admin/coaches/${id}/availability`, { available: false, unavailableUntil: until || undefined, reason }); toast.show('Coach marked away'); void d.reload(); }} />
        <ReasonSheet open={back} onClose={() => setBack(false)} title={`Mark ${c.displayName} as available?`} confirmLabel="Mark available" body="Paused assignments resume and members are told their coach is back."
          onConfirm={async (reason) => { await post(`/admin/coaches/${id}/availability`, { available: true, reason }); toast.show('Coach available; paused assignments resumed'); void d.reload(); }} />
        <ReasonSheet open={limitDlg} onClose={() => setLimitDlg(false)} title="Change the caseload limit" confirmLabel="Save" disabled={!(Number(limit) >= 1)}
          extra={<Field label="Maximum active clients"><Input value={limit} onChangeText={(v) => setLimit(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" accessibilityLabel="Maximum active clients" /></Field>}
          onConfirm={async (reason) => { await patch(`/admin/coaches/${id}`, { caseloadLimit: Number(limit), reason }); toast.show('Capacity updated'); void d.reload(); }} />
        <ReasonSheet open={suspend} onClose={() => setSuspend(false)} title={`Suspend ${c.displayName}?`} destructive confirmLabel="Suspend coach" body="The coach is signed out, loses access to the workspace, and their members pause until reassigned or reinstated."
          onConfirm={async (reason) => { await patch(`/admin/coaches/${id}/state`, { state: 'suspended', reason }); toast.show('Coach suspended'); void d.reload(); }} />
        <ReasonSheet open={reinstate} onClose={() => setReinstate(false)} title={`Reinstate ${c.displayName}?`} confirmLabel="Reinstate" body="The coach can sign in again and their paused members resume."
          onConfirm={async (reason) => { await patch(`/admin/coaches/${id}/state`, { state: 'active', reason }); toast.show('Coach reinstated'); void d.reload(); }} />
      </> : null}
    </RequirePermission>
  </Screen>{toast.float}</View></RoleGate>;
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: font.title, fontWeight: '700', letterSpacing: -0.5 },
});
