/* Admin › Approvals / Custom plans (the web's /admin/approvals and /admin/custom-plans, pages/CustomPlans.tsx,
   custom_plans.manage): bespoke requests (GET /admin/custom-plans?status=) and the "Work on it" sheet that moves one
   through its workflow (POST /admin/custom-plans/:id/transition) with the proposal fields, a recommended coach
   (GET /admin/coaches) and, with custom_plans.approve, the recorded approval. The next states are the server's
   allowedNext minus activated / accepted / payment_pending (activation comes only from a verified payment and only the
   member accepts), and minus proposal_sent without the approve permission, exactly as the web filters them. */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, inr, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { labelOr, tone } from '@/lib/admin/a/format';
import { AdminHeader, Choice, FormField, TimelineItem, TwoUp } from '@/components/adminA/parts';
import { useToast } from '@/components/adminA/toast';
import { Button, Card, Empty, ErrorBox, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { FilterChips, KeyValue, RecordList, RecordRow, Sheet } from '@/components/workspace';
import { notifyBadges, RequirePermission, RoleGate } from '@/components/workspaceShell';
import { Enter } from '@/motion';
import { space } from '@/theme';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = any;
type Coach = { id: string; displayName: string };

const STATES = ['enquiry_received', 'under_review', 'scoping', 'awaiting_professional_input', 'awaiting_internal_approval', 'proposal_sent', 'accepted', 'payment_pending', 'activated', 'declined', 'expired', 'completed'];

export default function AdminApprovals() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const list = useLoad<{ items: Rec[] }>(status ? null : 'admin-custom-plans', () => get(`/admin/custom-plans${qs({ status })}`), [status]);
  const coaches = useLoad<{ items: Coach[] }>('admin-coaches', () => get('/admin/coaches'), []);
  const [open, setOpen] = useState<Rec | null>(null);
  const toast = useToast();
  const items = list.data?.items ?? [];
  return <RoleGate workspace="admin"><View style={{ flex: 1 }}><Screen refreshing={list.loading} onRefresh={list.reload} depth>
    <AdminHeader title="Approvals" />
    <Title sub="Bespoke programmes move through review, scoping, approval and proposal. Nothing activates until the member accepts and the order is paid through the same verified path as a package.">Custom plans</Title>
    <RequirePermission permission="custom_plans.manage">
      <StaleBanner at={list.stale} /><ErrorBox error={list.error} onRetry={list.reload} />
      <Enter index={1}><FilterChips options={[{ value: '', label: 'Any status' }, ...STATES.map((s) => ({ value: s, label: label(s) }))]} value={status} onChange={(v) => setStatus(String(v))} /></Enter>
      <Enter index={2}>{list.loading && !list.data ? <Loading /> : items.length ? <View style={{ gap: space.md }}>{items.map((r) => <Card key={r.id}>
        <Eyebrow>{`${r.reference} · ${relative(r.created_at)}`}</Eyebrow>
        <Row between>{r.member_id ? <Button title={r.contact_name} variant="ghost" small onPress={() => router.push(`/admin/clients/${r.member_id}` as never)} style={{ paddingHorizontal: 0 }} /> : <H2>{r.contact_name}</H2>}<Pill tone={tone(r.status)}>{labelOr(r.status)}</Pill></Row>
        {r.goals ? <P small>{r.goals}</P> : null}
        <KeyValue rows={[
          ['Asked for', `${r.duration ?? '—'} · budget ${inr(r.budgetInr)}`],
          ...(r.proposal?.priceInr ? [['Proposal', `${r.proposal.durationLabel ?? ''}, ${r.proposal.consultations ?? 0} consults, ${r.proposal.bloodworkEntitlements ?? 0} tests, ${inr(r.proposal.priceInr)}`] as [string, string]] : []),
          ['Owner', r.owner_name ?? 'Unassigned'], ['Coach', r.coach_name ?? '—'],
        ]} />
        <Row between><Button title="Work on it" small onPress={() => setOpen(r)} />{r.order ? <Pill tone={tone(r.order.status)}>{`Order ${r.order.reference}: ${label(r.order.status)}`}</Pill> : null}</Row>
      </Card>)}</View> : list.data ? <Card><Empty title="No bespoke requests" /></Card> : null}</Enter>
      <WorkSheet r={open} coaches={coaches.data?.items ?? []} onClose={() => setOpen(null)} onDone={() => { toast.show('Updated'); void list.reload(); notifyBadges(); }} />
    </RequirePermission>
  </Screen>{toast.float}</View></RoleGate>;
}

const NUMERIC = ['durationMonths', 'consultations', 'bloodworkEntitlements', 'priceInr'];

function WorkSheet({ r, coaches, onClose, onDone }: { r: Rec | null; coaches: Coach[]; onClose: () => void; onDone: () => void }) {
  const { can } = useAuth();
  const canApprove = can('custom_plans.approve');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [approval, setApproval] = useState('');
  const [p, setP] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nextStates: string[] = ((r?.allowedNext ?? []) as string[]).filter((s) => !['activated', 'accepted', 'payment_pending'].includes(s) && (canApprove || s !== 'proposal_sent'));
  useEffect(() => {
    if (!r) return;
    const pr = r.proposal ?? {};
    setTo(nextStates[0] ?? ''); setNote(''); setApproval(''); setErr('');
    setP({ durationMonths: pr.durationMonths != null ? String(pr.durationMonths) : '', durationLabel: pr.durationLabel ?? '', consultations: pr.consultations != null ? String(pr.consultations) : '', bloodworkEntitlements: pr.bloodworkEntitlements != null ? String(pr.bloodworkEntitlements) : '', priceInr: pr.priceInr != null ? String(pr.priceInr) : '', coachId: pr.coachId ?? r.assigned_coach_id ?? '', deliverables: (pr.deliverables ?? []).join('\n'), conditions: pr.conditions ?? '', reviewSchedule: pr.reviewSchedule ?? '' });
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string) => (v: string) => setP((s) => ({ ...s, [k]: v }));
  const digits = (v: string) => v.replace(/\D/g, '');
  const go = async () => {
    if (!r) return;
    setBusy(true); setErr('');
    const proposal: Record<string, unknown> = {};
    // exactly as the web builds it (pages/CustomPlans.tsx WorkDialog): every filled field, the chosen coach included, so
    // the stored proposal (merged on the server, domain/customPlans.ts) never keeps an earlier coach
    for (const [k, v] of Object.entries(p)) { if (v === '' || v === undefined) continue; proposal[k] = NUMERIC.includes(k) ? Number(v) : k === 'deliverables' ? String(v).split('\n').map((s) => s.trim()).filter(Boolean) : v; }
    try { await post(`/admin/custom-plans/${r.id}/transition`, { to, note: note.trim() || undefined, approval: canApprove ? approval.trim() || undefined : undefined, proposal, coachId: p.coachId || null }); onDone(); onClose(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const waiting = r?.status === 'accepted' || r?.status === 'payment_pending';
  const noChange = waiting ? 'Activation happens by itself when the member\'s payment is confirmed.' : r?.status === 'proposal_sent' ? 'Only the member can accept the proposal.' : 'There is no further state an administrator can set for this request.';
  return <Sheet open={!!r} onClose={onClose} title={r ? `${r.reference} · ${label(r.status)}` : ''} footer={<View style={{ flexDirection: 'row', gap: space.sm }}><Button title="Close" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />{nextStates.length > 0 ? <Button title={`Move to ${label(to)}`} busy={busy} disabled={!to || !nextStates.includes(to)} onPress={go} style={{ flex: 1 }} /> : null}</View>}>
    {r ? <>
      {(r.events ?? []).length ? <View>{r.events.map((e: Rec) => <TimelineItem key={e.id} title={label(e.to_state)} detail={e.note} time={`${e.actor_name ?? 'system'} · ${fmtDate(e.at)}`} />)}</View> : null}
      {!nextStates.length ? <Notice kind="info" title="No change to make here">{noChange}</Notice> : <>
        <Choice label="Next state" hint={waiting ? 'Activation happens by itself when the member\'s payment is confirmed.' : r.status === 'proposal_sent' ? 'Only the member can accept the proposal.' : undefined} options={nextStates.map((s) => ({ value: s, label: label(s) }))} value={to} onChange={setTo} />
        <TwoUp>
          <Field label="Duration (months)"><Input value={p.durationMonths ?? ''} onChangeText={(v) => set('durationMonths')(digits(v))} keyboardType="number-pad" accessibilityLabel="Duration (months)" /></Field>
          <Field label="Duration label"><Input value={p.durationLabel ?? ''} onChangeText={set('durationLabel')} placeholder="6 months" accessibilityLabel="Duration label" /></Field>
        </TwoUp>
        <TwoUp>
          <Field label="Consultations"><Input value={p.consultations ?? ''} onChangeText={(v) => set('consultations')(digits(v))} keyboardType="number-pad" accessibilityLabel="Consultations" /></Field>
          <Field label="Blood tests"><Input value={p.bloodworkEntitlements ?? ''} onChangeText={(v) => set('bloodworkEntitlements')(digits(v))} keyboardType="number-pad" accessibilityLabel="Blood tests" /></Field>
          <Field label="Price ₹"><Input value={p.priceInr ?? ''} onChangeText={(v) => set('priceInr')(digits(v))} keyboardType="number-pad" accessibilityLabel="Price ₹" /></Field>
        </TwoUp>
        <FormField label="Recommended coach" optional><RecordList><RecordRow title="None yet" selected={!p.coachId} onPress={() => set('coachId')('')} />{coaches.map((c) => <RecordRow key={c.id} title={c.displayName} selected={p.coachId === c.id} onPress={() => set('coachId')(c.id)} />)}</RecordList></FormField>
        <FormField label="Deliverables (one per line)" optional><Input value={p.deliverables ?? ''} onChangeText={set('deliverables')} multiline numberOfLines={3} style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Deliverables (one per line)" /></FormField>
        <TwoUp>
          <FormField label="Conditions" optional><Input value={p.conditions ?? ''} onChangeText={set('conditions')} accessibilityLabel="Conditions" /></FormField>
          <FormField label="Review schedule" optional><Input value={p.reviewSchedule ?? ''} onChangeText={set('reviewSchedule')} placeholder="every 4 weeks" accessibilityLabel="Review schedule" /></FormField>
        </TwoUp>
        {canApprove && (to === 'proposal_sent' || r.status === 'awaiting_internal_approval') ? <Field label="Approval (who approved, recorded)" hint="A proposal cannot be sent without a recorded approval."><Input value={approval} onChangeText={setApproval} placeholder="Approved by the owner" accessibilityLabel="Approval (who approved, recorded)" /></Field> : null}
        <FormField label="Note" optional><Input value={note} onChangeText={setNote} accessibilityLabel="Note" /></FormField>
      </>}
      {err ? <Notice kind="error">{err}</Notice> : null}
      {r.approvals?.length ? <P muted small>{`Approvals: ${r.approvals.join(' · ')}`}</P> : null}
    </> : null}
  </Sheet>;
}
