/* M2 Progress, the coach's review: the "Check-ins to review" card on Today (never the answers, only who sent what and
   when) and the reply dialog the client record opens. The reply is shown to the member; the private note stays with the
   coaching team (coach_notes, visibility private). Reviewing needs the member's health sharing; the server checks it. */
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { relative } from '../../lib/format';
import { Link } from '../../lib/nav';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Skeleton, Textarea, errorText, useApi } from '../../ui';
import { AnswersView, type Checkin } from './shared';

type QueueItem = { id: string; memberId: string; memberName: string; title: string; dueDate: string; submittedAt: string | null; healthShared: boolean };

export function CheckinReviewCard() {
  const q = useApi<{ items: QueueItem[] }>(() => api.get('/coach/checkins?status=submitted'), []);
  return <Card>
    <CardHead eyebrow="Needs you" title="Check-ins to review" />
    {q.error ? <Alert kind="error">{q.error}</Alert> : !q.data ? <Skeleton rows={3} /> : q.data.items.length ? <div className="stack">{q.data.items.slice(0, 8).map((c) => <div key={c.id} className="row between">
      <div><Link to={`/clients/${c.memberId}?tab=goals`}><b>{c.memberName}</b></Link><div className="small">{c.title} · sent {relative(c.submittedAt)}{c.healthShared ? '' : ' · health records not shared'}</div></div>
      <Link className="bp-btn bp-btn-secondary bp-btn-sm" to={`/clients/${c.memberId}?tab=goals`}>{c.healthShared ? 'Review' : 'Open'}</Link>
    </div>)}</div> : <Empty title="Nothing to review" body="Check-ins your clients send appear here." />}
  </Card>;
}

export function ReviewDialog({ checkin, onClose, onDone }: { checkin: Checkin | null; onClose: () => void; onDone: () => void }) {
  const [response, setResponse] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setResponse(''); setNote(''); setErr(''); }, [checkin?.id]);
  const send = async () => {
    if (!checkin) return;
    setBusy(true); setErr('');
    try { await api.post(`/coach/checkins/${checkin.id}/review`, { response: response.trim() || undefined, privateNote: note.trim() || undefined }); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={!!checkin} onClose={onClose} title={checkin ? `Review: ${checkin.title}` : 'Review'} footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} onClick={send}>{response.trim() ? 'Send the reply' : 'Mark reviewed'}</Button></>}>
    {checkin && <AnswersView questions={checkin.questions} answers={checkin.answers} />}
    <div className="form" style={{ marginTop: 12 }}>
      <Field label="Reply to the member" optional hint="They read it under Progress, Check-ins."><Textarea value={response} onChange={(e) => setResponse(e.target.value)} maxLength={2000} /></Field>
      <Field label="Private note for the coaching team" optional hint="Never shown to the member."><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} /></Field>
    </div>
    {err && <Alert kind="error">{err}</Alert>}
  </Dialog>;
}
