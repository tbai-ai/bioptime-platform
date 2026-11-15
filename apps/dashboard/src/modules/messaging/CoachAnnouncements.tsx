/* /coach/announcements: a coach announces to their own assigned clients (nobody else can be chosen), now or at a set
   time, and withdraws their own with a reason. The list shows how many clients each reaches and how many read it;
   never a client's contact details. */
import React, { useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { Alert, Button, Card, CardHead, Empty, Field, Input, ReasonDialog, Skeleton, Textarea, useApi, useToast, errorText } from '../../ui';
import { AnnouncementBody, AnnouncementStatus, localToIso, whenText, type ManagedAnnouncement } from './shared';

type List = { items: ManagedAnnouncement[]; clients: number };

export function CoachAnnouncements() {
  const list = useApi(() => api.get<List>('/coach/announcements'), []);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [later, setLater] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState<ManagedAnnouncement | null>(null);
  const clients = list.data?.clients ?? 0;
  const items = list.data?.items ?? [];
  const send = async () => {
    setBusy(true); setErrs({});
    try {
      const out = await api.post<ManagedAnnouncement>('/coach/announcements', { title: title.trim(), body: body.trim(), ...(later ? { publishAt: localToIso(later) } : {}) });
      toast(out.status === 'scheduled' ? 'Scheduled' : 'Sent to your clients');
      setTitle(''); setBody(''); setLater(''); list.reload();
    } catch (e) {
      if (e instanceof ApiRequestError && Array.isArray(e.details)) { const fe: Record<string, string> = {}; for (const i of e.details as Array<{ path: string; message: string }>) if (i.path && !fe[i.path]) fe[i.path] = i.message; setErrs(fe); }
      toast(errorText(e), 'error');
    } finally { setBusy(false); }
  };
  return <div className="stack">
    <div className="pageHead"><div><h1>Announcements</h1><p className="sub">A note to all of your assigned clients at once, such as a change to your working hours. For one client, use Messages.</p></div></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    <div className="grid">
      <div className="span5"><Card><CardHead eyebrow="New" title="Announce to your clients" />
        {!list.data ? <Skeleton rows={4} /> : <div className="form">
          <Alert kind="info">{clients ? `Goes to your ${clients} assigned client${clients === 1 ? '' : 's'} only. ` : 'You have no assigned clients yet, so there is nobody to send to. '}Service news only: never a diagnosis, results or medical advice.</Alert>
          <Field label="Title" error={errs.title}><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Message" hint="Plain text; line breaks are kept." error={errs.body}><Textarea value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 140 }} /></Field>
          <Field label="Send later" optional hint="Leave empty to send now." error={errs.publishAt}><Input type="datetime-local" value={later} onChange={(e) => setLater(e.target.value)} /></Field>
          <div className="row"><Button variant="primary" busy={busy} disabled={!clients || title.trim().length < 3 || !body.trim()} onClick={send}>{later ? 'Schedule' : 'Send now'}</Button></div>
        </div>}
      </Card></div>
      <div className="span7"><Card><CardHead eyebrow="Sent" title="Your announcements" />
        {!list.data ? <Skeleton rows={5} /> : items.length ? <ul className="annList">{items.map((a) => <li key={a.id}>
          <div className="annMeta"><AnnouncementStatus a={a} /><span>{whenText(a)}</span>{a.status !== 'withdrawn' && <span>{`${a.reach.members ?? 0} client${a.reach.members === 1 ? '' : 's'} · ${a.reach.reads} read`}</span>}</div>
          <h4 className="annTitle">{a.title}</h4>
          <AnnouncementBody text={a.body} />
          {a.status === 'withdrawn' ? <p className="muted small">{`Reason: ${a.withdrawReason ?? ''}`}</p> : <div><Button size="sm" variant="tertiary" onClick={() => setWithdrawing(a)}>Withdraw</Button></div>}
        </li>)}</ul> : <Empty title="No announcements yet" body="What you send appears here with how many of your clients read it." />}
      </Card></div>
    </div>
    <ReasonDialog open={!!withdrawing} onClose={() => setWithdrawing(null)} danger title={`Withdraw “${withdrawing?.title ?? ''}”?`} confirmLabel="Withdraw"
      body="It disappears for your clients at once, and the notification it sent loses its text."
      onConfirm={async (reason) => { await api.post(`/coach/announcements/${withdrawing!.id}/withdraw`, { reason }); toast('Withdrawn'); list.reload(); }} />
  </div>;
}
