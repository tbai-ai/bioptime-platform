/* Admin › Assignments (the web's /admin/assignments, pages/Assignments.tsx, assignments.manage): the requests the
   hybrid engine opened (GET /admin/assignments/requests?status=) with their ranked candidates and "Choose coach"
   (POST /admin/assignments/requests/:id/assign), and every assignment (GET /admin/assignments) with Pause, Resume,
   Reassign (POST /admin/assignments, override) and End, each with a recorded reason. The coach picker reads
   GET /admin/coaches. A recommended coach is never shown as assigned until confirmed. */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorText, get, post, qs } from '@/lib/api';
import { fmtDate, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { labelOr, tone } from '@/lib/admin/a/format';
import { AdminHeader, Choice, NotedRow } from '@/components/adminA/parts';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { Button, Card, Empty, ErrorBox, Eyebrow, Field, Input, Loading, Notice, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { FilterChips, RecordList, RecordRow, SegmentTabs, Sheet } from '@/components/workspace';
import { notifyBadges, RequirePermission, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { colors, space } from '@/theme';

/** A row with actions under it keeps one bottom line after the actions, so the buttons read as that assignment's. */
const styles = StyleSheet.create({
  actions: { paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: -space.lg, paddingHorizontal: space.lg },
});

type Candidate = { coachId: string; name: string; score: number; eligible: boolean; reasons: string[]; caseload: number; caseloadLimit: number; available: boolean };
type Request = { id: string; member_id: string; status: string; policy?: string; recommendation?: Candidate[]; reason?: string | null; created_at: string; member_name: string; member_email?: string };
type Assignment = { id: string; member_id: string; coach_id: string; status: string; method?: string; reason?: string | null; effective_at?: string; member_name: string; coach_name?: string | null };
type Coach = { id: string; displayName: string; caseload: number; caseloadLimit: number; available: boolean };
type AssignTarget = { requestId?: string; member_id: string; member_name: string; recommendation?: Candidate[]; reassign?: boolean };

export default function AdminAssignments() {
  const router = useRouter();
  const [tab, setTab] = useState<'requests' | 'assignments'>('requests');
  const [status, setStatus] = useState('open');
  const requests = useLoad<{ items: Request[] }>(status === 'open' ? 'admin-assignment-requests' : null, () => get(`/admin/assignments/requests${qs({ status: status === 'all' ? '' : status })}`), [status]);
  const assignments = useLoad<{ items: Assignment[] }>('admin-assignments', () => get('/admin/assignments'), []);
  const coaches = useLoad<{ items: Coach[] }>('admin-coaches', () => get('/admin/coaches'), []);
  const toast = useToast();
  const [assign, setAssign] = useState<AssignTarget | null>(null);
  const [act, setAct] = useState<{ a: Assignment; action: 'pause' | 'resume' | 'end' } | null>(null);
  const req = requests.data?.items ?? [];
  const asg = assignments.data?.items ?? [];
  const reloadAll = () => { void requests.reload(); void assignments.reload(); notifyBadges(); };
  return <RoleGate workspace="admin"><View style={{ flex: 1 }}><Screen refreshing={requests.loading || assignments.loading} onRefresh={reloadAll}>
    <AdminHeader title="Assignments" />
    <Title sub="The hybrid engine recommends; the policy decides whether it assigns or you confirm. A recommended coach is never shown as assigned until confirmed. Every change is recorded with a reason.">Assignments</Title>
    <RequirePermission permission="assignments.manage">
      <StaleBanner at={requests.stale ?? assignments.stale} />
      <ErrorBox error={requests.error ?? assignments.error} onRetry={reloadAll} />
      <SegmentTabs items={[{ id: 'requests', label: 'Requests', count: req.filter((r) => r.status === 'open' || r.status === 'exception').length }, { id: 'assignments', label: 'All assignments' }]} value={tab} onChange={(t) => setTab(t as 'requests' | 'assignments')} />
      {tab === 'requests' ? <Enter index={1} key="requests"><View style={{ gap: space.md }}>
        <FilterChips options={[{ value: 'open', label: 'Open' }, { value: 'exception', label: 'Exceptions' }, { value: 'assigned', label: 'Assigned' }, { value: 'all', label: 'All' }]} value={status} onChange={(v) => setStatus(String(v))} />
        {requests.loading && !requests.data ? <Loading /> : req.length ? req.map((r) => <Card key={r.id}>
          <Eyebrow>{`${label(r.policy)} policy · requested ${relative(r.created_at)}`}</Eyebrow>
          <Row between><Button title={r.member_name} variant="ghost" small onPress={() => router.push(`/admin/clients/${r.member_id}` as never)} style={{ paddingHorizontal: 0 }} /><Pill tone={tone(r.status)}>{labelOr(r.status)}</Pill></Row>
          {r.reason ? <Notice kind={r.status === 'exception' ? 'warning' : 'info'}>{r.reason}</Notice> : null}
          {(r.recommendation ?? []).length ? <RecordList>{(r.recommendation ?? []).slice(0, 5).map((c) => <NotedRow key={c.coachId} title={`${c.name} · score ${c.score}`} notes={[(c.reasons ?? []).join(' · ')]} pills={[{ label: c.eligible ? 'Yes' : 'No', tone: c.eligible ? 'success' : 'error' }]} />)}</RecordList> : null}
          {r.status === 'open' || r.status === 'exception' ? <Button title="Choose coach" small onPress={() => setAssign({ requestId: r.id, member_id: r.member_id, member_name: r.member_name, recommendation: r.recommendation })} style={{ alignSelf: 'flex-start' }} /> : null}
        </Card>) : requests.data ? <Card><Empty title="No requests" body="A paid activation opens a request here." /></Card> : null}
      </View></Enter> : null}
      {tab === 'assignments' ? <Enter index={1} key="assignments"><View style={{ gap: space.md }}>
        {assignments.loading && !assignments.data ? <Loading /> : asg.length ? <RecordList title="All assignments">{asg.map((a) => { const actions = a.status === 'active' || a.status === 'paused'; return <View key={a.id}>
          <NotedRow title={`${a.member_name} → ${a.coach_name ?? '—'}`} meta={`${a.method ?? '—'} · since ${fmtDate(a.effective_at)}`} notes={[a.reason]} pills={[{ label: labelOr(a.status), tone: tone(a.status) }]} onPress={() => router.push(`/admin/clients/${a.member_id}` as never)} line={!actions} />
          {actions ? <Row style={styles.actions}>
            {a.status === 'active' ? <Button title="Pause" small variant="ghost" onPress={() => setAct({ a, action: 'pause' })} /> : null}
            {a.status === 'paused' ? <Button title="Resume" small variant="ghost" onPress={() => setAct({ a, action: 'resume' })} /> : null}
            <Button title="Reassign" small variant="ghost" onPress={() => setAssign({ member_id: a.member_id, member_name: a.member_name, reassign: true })} />
            <Button title="End" small variant="danger" onPress={() => setAct({ a, action: 'end' })} />
          </Row> : null}
        </View>; })}</RecordList> : assignments.data ? <Card><Empty title="No assignments yet" /></Card> : null}
      </View></Enter> : null}
      <AssignSheet r={assign} coaches={coaches.data?.items ?? []} onClose={() => setAssign(null)} onDone={(reassigned) => { toast.show(reassigned ? 'Reassigned' : 'Coach assigned; member and coach notified'); reloadAll(); }} />
      <ReasonSheet open={!!act} onClose={() => setAct(null)} title={act ? `${label(act.action)} the assignment for ${act.a.member_name}?` : ''} destructive={act?.action === 'end'} confirmLabel={act ? label(act.action) : 'Confirm'}
        onConfirm={async (reason) => { if (!act) return; await post(`/admin/assignments/${act.a.id}/${act.action}`, { reason }); toast.show('Updated'); reloadAll(); }} />
    </RequirePermission>
  </Screen>{toast.float}</View></RoleGate>;
}

/** The web's Assign dialog: the coach (the first eligible recommendation preselected), the method for a request
 *  (confirm or override), the reason; a reassignment always goes through POST /admin/assignments as an override. */
function AssignSheet({ r, coaches, onClose, onDone }: { r: AssignTarget | null; coaches: Coach[]; onClose: () => void; onDone: (reassigned: boolean) => void }) {
  const [coachId, setCoachId] = useState('');
  const [method, setMethod] = useState<'manual' | 'override'>('manual');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (r) { setCoachId(r.recommendation?.find((c) => c.eligible)?.coachId ?? ''); setReason(''); setErr(''); setMethod('manual'); } }, [r]);
  const go = async () => {
    if (!r) return;
    setBusy(true); setErr('');
    try {
      if (r.reassign) await post('/admin/assignments', { memberId: r.member_id, coachId, reason: reason.trim(), method: 'override' });
      else await post(`/admin/assignments/requests/${r.requestId}/assign`, { coachId, reason: reason.trim(), method });
      onDone(!!r.reassign); onClose();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={!!r} onClose={onClose} title={`Assign a coach to ${r?.member_name ?? ''}`} footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} /><Button title={r?.reassign ? 'Reassign' : 'Confirm assignment'} busy={busy} disabled={!coachId || reason.trim().length < 3} onPress={go} style={{ flex: 1 }} /></View>}>
    <Field label="Coach">{coaches.length ? <RecordList>{coaches.map((c) => <RecordRow key={c.id} title={c.displayName} meta={`caseload ${c.caseload}/${c.caseloadLimit}${c.available ? '' : ' · away'}`} selected={coachId === c.id} onPress={() => setCoachId(c.id)} />)}</RecordList> : null}</Field>
    {!r?.reassign ? <Choice label="Method" hint="Override skips the availability and capacity checks; it needs a strong reason." options={[{ value: 'manual', label: 'Confirm (checks apply)' }, { value: 'override', label: 'Override (checks skipped)' }]} value={method} onChange={(v) => setMethod(v as 'manual' | 'override')} /> : null}
    <Field label="Reason (recorded)"><Input value={reason} onChangeText={setReason} placeholder="e.g. Recommended by the rule: sleep expertise, lowest caseload" multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Reason (recorded)" /></Field>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}
