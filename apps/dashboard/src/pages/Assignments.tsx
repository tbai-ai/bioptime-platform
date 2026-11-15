import React, { useState } from 'react';
import { Link } from '../lib/nav';
import { api, qs } from '../lib/api';
import { fmtDate, label, relative } from '../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Pill, ReasonDialog, Select, Skeleton, Table, Tabs, Textarea, useApi, useToast, errorText } from '../ui';

export function Assignments() {
  const [tab, setTab] = useState<'requests' | 'assignments'>('requests');
  const [status, setStatus] = useState('open');
  const requests = useApi(() => api.get(`/admin/assignments/requests${qs({ status: status === 'all' ? '' : status })}`), [status]);
  const assignments = useApi(() => api.get('/admin/assignments'), []);
  const coaches = useApi(() => api.get('/admin/coaches'), []);
  const toast = useToast();
  const [assign, setAssign] = useState<any>(null);
  const [act, setAct] = useState<{ a: any; action: 'pause' | 'resume' | 'end' | 'reassign' } | null>(null);
  const req = ((requests.data as any)?.items ?? []) as any[];
  const asg = ((assignments.data as any)?.items ?? []) as any[];
  return <div className="stack">
    <div className="pageHead"><div><h1>Assignments</h1><p className="sub">The hybrid engine recommends; the policy decides whether it assigns or you confirm. A recommended coach is never shown as assigned until confirmed. Every change is recorded with a reason.</p></div></div>
    <Tabs items={[{ id: 'requests', label: 'Requests', count: req.filter((r) => r.status === 'open' || r.status === 'exception').length }, { id: 'assignments', label: 'All assignments' }]} value={tab} onChange={setTab}>
    {tab === 'requests' && <>
      <div className="row"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="exception">Exceptions</option><option value="assigned">Assigned</option><option value="all">All</option></Select></div>
      {requests.loading && !requests.data ? <Skeleton rows={3} /> : req.length ? <div className="stack">{req.map((r) => <Card key={r.id}><CardHead eyebrow={`${label(r.policy)} policy · requested ${relative(r.created_at)}`} title={<Link to={`/clients/${r.member_id}`}>{r.member_name}</Link>} right={<div className="row"><Pill status={r.status} />{(r.status === 'open' || r.status === 'exception') && <Button variant="primary" size="sm" onClick={() => setAssign(r)}>Choose coach</Button>}</div>} />{r.reason && <Alert kind={r.status === 'exception' ? 'warning' : 'info'}>{r.reason}</Alert>}<Table head={<><th>Coach</th><th className="num">Score</th><th>Eligible</th><th>Reasons</th></>}>{(r.recommendation ?? []).slice(0, 5).map((c: any) => <tr key={c.coachId}><td>{c.name}</td><td className="num">{c.score}</td><td><Pill status={c.eligible ? 'active' : 'exception'}>{c.eligible ? 'Yes' : 'No'}</Pill></td><td className="small">{c.reasons.join(' · ')}</td></tr>)}</Table></Card>)}</div> : <Card><Empty title="No requests" body="A paid activation opens a request here." /></Card>}
    </>}
    {tab === 'assignments' && (asg.length ? <Card dense><Table head={<><th>Member</th><th>Coach</th><th>Status</th><th>Method</th><th>Since</th><th>Reason</th><th></th></>}>{asg.map((a) => <tr key={a.id}><td><Link to={`/clients/${a.member_id}`}>{a.member_name}</Link></td><td>{a.coach_name ?? '—'}</td><td><Pill status={a.status} /></td><td>{a.method}</td><td>{fmtDate(a.effective_at)}</td><td className="small">{a.reason}</td><td><div className="row">{a.status === 'active' && <Button size="sm" variant="tertiary" onClick={() => setAct({ a, action: 'pause' })}>Pause</Button>}{a.status === 'paused' && <Button size="sm" variant="tertiary" onClick={() => setAct({ a, action: 'resume' })}>Resume</Button>}{(a.status === 'active' || a.status === 'paused') && <><Button size="sm" variant="tertiary" onClick={() => setAct({ a, action: 'reassign' })}>Reassign</Button><Button size="sm" variant="destructive" onClick={() => setAct({ a, action: 'end' })}>End</Button></>}</div></td></tr>)}</Table></Card> : <Card><Empty title="No assignments yet" /></Card>)}
    </Tabs>
    <AssignDialog r={assign} coaches={((coaches.data as any)?.items ?? []) as any[]} onClose={() => setAssign(null)} onDone={() => { toast('Coach assigned; member and coach notified'); requests.reload(); assignments.reload(); }} />
    {act && act.action !== 'reassign' && <ReasonDialog open onClose={() => setAct(null)} title={`${label(act.action)} the assignment for ${act.a.member_name}?`} danger={act.action === 'end'} confirmLabel={label(act.action)} onConfirm={async (reason) => { await api.post(`/admin/assignments/${act.a.id}/${act.action}`, { reason }); toast('Updated'); assignments.reload(); }} />}
    {act && act.action === 'reassign' && <AssignDialog r={{ member_id: act.a.member_id, member_name: act.a.member_name, reassign: true }} coaches={((coaches.data as any)?.items ?? []) as any[]} onClose={() => setAct(null)} onDone={() => { toast('Reassigned'); assignments.reload(); }} />}
  </div>;
}

function AssignDialog({ r, coaches, onClose, onDone }: { r: any; coaches: any[]; onClose: () => void; onDone: () => void }) {
  const [coachId, setCoachId] = useState('');
  const [method, setMethod] = useState<'manual' | 'override'>('manual');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { if (r) { setCoachId(r.recommendation?.find((c: any) => c.eligible)?.coachId ?? ''); setReason(''); setErr(''); setMethod('manual'); } }, [r]);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      if (r.reassign) await api.post('/admin/assignments', { memberId: r.member_id, coachId, reason, method: 'override' });
      else await api.post(`/admin/assignments/requests/${r.id}/assign`, { coachId, reason, method });
      onDone(); onClose();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={!!r} onClose={onClose} title={`Assign a coach to ${r?.member_name ?? ''}`} footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!coachId || reason.trim().length < 3} onClick={go}>{r?.reassign ? 'Reassign' : 'Confirm assignment'}</Button></>}>
    <div className="form"><Field label="Coach"><Select value={coachId} onChange={(e) => setCoachId(e.target.value)}><option value="">Choose</option>{coaches.map((c) => <option key={c.id} value={c.id}>{c.displayName} · {c.caseload}/{c.caseloadLimit}{c.available ? '' : ' · away'}</option>)}</Select></Field>
      {!r?.reassign && <Field label="Method" hint="Override skips the availability and capacity checks; it needs a strong reason."><Select value={method} onChange={(e) => setMethod(e.target.value as 'manual' | 'override')}><option value="manual">Confirm (checks apply)</option><option value="override">Override (checks skipped)</option></Select></Field>}
      <Field label="Reason (recorded)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recommended by the rule: sleep expertise, lowest caseload" /></Field>{err && <Alert kind="error">{err}</Alert>}</div>
  </Dialog>;
}
