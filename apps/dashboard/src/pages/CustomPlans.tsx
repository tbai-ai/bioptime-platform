import React, { useState } from 'react';
import { Link } from '../lib/nav';
import { api, qs } from '../lib/api';
import { fmtDate, fmtInr, label, relative } from '../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Input, Pill, Select, Skeleton, Textarea, useApi, useToast, errorText } from '../ui';
import { useAuth } from '../lib/auth';

export function CustomPlans() {
  const [status, setStatus] = useState('');
  const list = useApi(() => api.get(`/admin/custom-plans${qs({ status })}`), [status]);
  const coaches = useApi(() => api.get('/admin/coaches'), []);
  const [open, setOpen] = useState<any>(null);
  const toast = useToast();
  const items = ((list.data as any)?.items ?? []) as any[];
  return <div className="stack">
    <div className="pageHead"><div><h1>Custom plans</h1><p className="sub">Bespoke programmes move through review, scoping, approval and proposal. Nothing activates until the member accepts and the order is paid through the same verified path as a package.</p></div><div className="actions"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['enquiry_received', 'under_review', 'scoping', 'awaiting_professional_input', 'awaiting_internal_approval', 'proposal_sent', 'accepted', 'payment_pending', 'activated', 'declined', 'expired', 'completed'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></div></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {list.loading && !list.data ? <Skeleton rows={3} /> : items.length ? <div className="grid">{items.map((r) => <div key={r.id} className="span6"><Card><CardHead eyebrow={`${r.reference} · ${relative(r.created_at)}`} title={r.member_id ? <Link to={`/clients/${r.member_id}`}>{r.contact_name}</Link> : r.contact_name} right={<Pill status={r.status} />} /><p className="small">{r.goals}</p><dl className="kv" style={{ marginTop: 10 }}><dt>Asked for</dt><dd>{r.duration ?? '—'} · budget {fmtInr(r.budgetInr)}</dd>{r.proposal?.priceInr && <><dt>Proposal</dt><dd>{r.proposal.durationLabel}, {r.proposal.consultations ?? 0} consults, {r.proposal.bloodworkEntitlements ?? 0} tests, {fmtInr(r.proposal.priceInr)}</dd></>}<dt>Owner</dt><dd>{r.owner_name ?? 'Unassigned'}</dd><dt>Coach</dt><dd>{r.coach_name ?? '—'}</dd></dl><div className="bp-card-foot"><Button size="sm" variant="primary" onClick={() => setOpen(r)}>Work on it</Button>{r.order && <Pill status={r.order.status}>Order {r.order.reference}: {label(r.order.status)}</Pill>}</div></Card></div>)}</div> : <Card><Empty title="No bespoke requests" /></Card>}
    <WorkDialog r={open} coaches={((coaches.data as any)?.items ?? []) as any[]} onClose={() => setOpen(null)} onDone={() => { toast('Updated'); list.reload(); }} />
  </div>;
}

function WorkDialog({ r, coaches, onClose, onDone }: { r: any; coaches: any[]; onClose: () => void; onDone: () => void }) {
  const { can } = useAuth();
  const canApprove = can('custom_plans.approve'); // sending a proposal or recording an approval needs it (admin.ts transition route)
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [approval, setApproval] = useState('');
  const [p, setP] = useState<any>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // activation only ever comes from a verified payment, and only the member records acceptance (which moves the request to
  // payment pending), so none of the three is set from here; the server's allowedNext may therefore be short or empty
  const nextStates: string[] = (r?.allowedNext ?? []).filter((s: string) => !['activated', 'accepted', 'payment_pending'].includes(s) && (canApprove || s !== 'proposal_sent'));
  React.useEffect(() => { if (r) { setTo(nextStates[0] ?? ''); setNote(''); setApproval(''); setP({ durationMonths: r.proposal?.durationMonths ?? '', durationLabel: r.proposal?.durationLabel ?? '', consultations: r.proposal?.consultations ?? '', bloodworkEntitlements: r.proposal?.bloodworkEntitlements ?? '', priceInr: r.proposal?.priceInr ?? '', coachId: r.proposal?.coachId ?? r.assigned_coach_id ?? '', deliverables: (r.proposal?.deliverables ?? []).join('\n'), conditions: r.proposal?.conditions ?? '', reviewSchedule: r.proposal?.reviewSchedule ?? '' }); setErr(''); } }, [r]);
  const set = (k: string, v: unknown) => setP((s: any) => ({ ...s, [k]: v }));
  const go = async () => {
    setBusy(true); setErr('');
    const proposal: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) { if (v === '' || v === undefined) continue; proposal[k] = ['durationMonths', 'consultations', 'bloodworkEntitlements', 'priceInr'].includes(k) ? Number(v) : k === 'deliverables' ? String(v).split('\n').map((s) => s.trim()).filter(Boolean) : v; }
    try { await api.post(`/admin/custom-plans/${r.id}/transition`, { to, note: note || undefined, approval: canApprove ? approval || undefined : undefined, proposal, coachId: p.coachId || null }); onDone(); onClose(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  if (!r) return null;
  return <Dialog open={!!r} onClose={onClose} title={`${r.reference} · ${label(r.status)}`} footer={<><Button variant="tertiary" onClick={onClose}>Close</Button>{nextStates.length > 0 && <Button variant="primary" busy={busy} disabled={!to || !nextStates.includes(to)} onClick={go}>Move to {label(to)}</Button>}</>}>
    <div className="form">
      <ul className="timeline">{(r.events ?? []).map((e: any) => <li key={e.id} className="done"><b>{label(e.to_state)}</b>{e.note ? ` · ${e.note}` : ''}<time>{e.actor_name ?? 'system'} · {fmtDate(e.at)}</time></li>)}</ul>
      {!nextStates.length && <Alert kind="info" title="No change to make here">{r.status === 'accepted' || r.status === 'payment_pending' ? 'Activation happens by itself when the member\'s payment is confirmed.' : r.status === 'proposal_sent' ? 'Only the member can accept the proposal.' : 'There is no further state an administrator can set for this request.'}</Alert>}
      {nextStates.length > 0 && <>
      <Field label="Next state" hint={r.status === 'accepted' || r.status === 'payment_pending' ? 'Activation happens by itself when the member\'s payment is confirmed.' : r.status === 'proposal_sent' ? 'Only the member can accept the proposal.' : undefined}><Select value={to} onChange={(e) => setTo(e.target.value)}>{nextStates.map((s: string) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
      <div className="row"><Field label="Duration (months)"><Input type="number" min={1} value={p.durationMonths} onChange={(e) => set('durationMonths', e.target.value)} /></Field><Field label="Duration label"><Input value={p.durationLabel} onChange={(e) => set('durationLabel', e.target.value)} placeholder="6 months" /></Field></div>
      <div className="row"><Field label="Consultations"><Input type="number" min={0} value={p.consultations} onChange={(e) => set('consultations', e.target.value)} /></Field><Field label="Blood tests"><Input type="number" min={0} value={p.bloodworkEntitlements} onChange={(e) => set('bloodworkEntitlements', e.target.value)} /></Field><Field label="Price ₹"><Input type="number" min={0} value={p.priceInr} onChange={(e) => set('priceInr', e.target.value)} /></Field></div>
      <Field label="Recommended coach" optional><Select value={p.coachId} onChange={(e) => set('coachId', e.target.value)}><option value="">None yet</option>{coaches.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}</Select></Field>
      <Field label="Deliverables (one per line)" optional><Textarea value={p.deliverables} onChange={(e) => set('deliverables', e.target.value)} /></Field>
      <div className="row"><Field label="Conditions" optional><Input value={p.conditions} onChange={(e) => set('conditions', e.target.value)} /></Field><Field label="Review schedule" optional><Input value={p.reviewSchedule} onChange={(e) => set('reviewSchedule', e.target.value)} placeholder="every 4 weeks" /></Field></div>
      {canApprove && (to === 'proposal_sent' || r.status === 'awaiting_internal_approval') && <Field label="Approval (who approved, recorded)" hint="A proposal cannot be sent without a recorded approval."><Input value={approval} onChange={(e) => setApproval(e.target.value)} placeholder="Approved by the owner" /></Field>}
      <Field label="Note" optional><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </>}
      {err && <Alert kind="error">{err}</Alert>}
      {r.approvals?.length ? <p className="muted">Approvals: {r.approvals.join(' · ')}</p> : null}
    </div>
  </Dialog>;
}
