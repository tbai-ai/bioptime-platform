/* /admin/announcements (announcements.manage): the team writes announcements to members as drafts, chooses who they
   reach (every member, members on chosen packages, one coach's clients), then publishes now or schedules them.
   Withdrawing asks for a reason and removes the announcement for members at once. Coaches' announcements to their own
   clients are listed too: the team can withdraw one, not rewrite it. Plain text only; service news, never clinical. */
import React, { useEffect, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { label } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Field, Input, ReasonDialog, Select, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../../ui';
import { AnnouncementBody, AnnouncementStatus, audienceText, localToIso, whenText, type ManagedAnnouncement } from './shared';

type Options = { packages: Array<{ id: string; name: string; kind: string; active: boolean }>; coaches: Array<{ id: string; name: string }>; allMembers: number };
type Draft = { id?: string; title: string; body: string; packageIds: string[]; coachId: string; status?: ManagedAnnouncement['status']; origin?: ManagedAnnouncement['origin'] };
const EMPTY: Draft = { title: '', body: '', packageIds: [], coachId: '' };

function toDraft(a: ManagedAnnouncement): Draft { return { id: a.id, title: a.title, body: a.body, packageIds: a.audience.packageIds, coachId: a.audience.coachId ?? '', status: a.status, origin: a.origin }; }

export function AdminAnnouncements() {
  const list = useApi(() => api.get<{ items: ManagedAnnouncement[] }>('/admin/announcements'), []);
  const options = useApi(() => api.get<Options>('/admin/announcements/options'), []);
  const toast = useToast();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [later, setLater] = useState('');
  const [withdrawing, setWithdrawing] = useState<ManagedAnnouncement | null>(null);
  useEffect(() => { setErrs({}); setLater(''); }, [edit?.id]);
  const items = list.data?.items ?? [];
  const current = edit?.id ? items.find((a) => a.id === edit.id) ?? null : null;
  const editable = !edit?.id || (edit.origin === 'team' && (edit.status === 'draft' || edit.status === 'scheduled'));

  const fail = (e: unknown) => {
    if (e instanceof ApiRequestError && Array.isArray(e.details)) { const fe: Record<string, string> = {}; for (const i of e.details as Array<{ path: string; message: string }>) if (i.path && !fe[i.path]) fe[i.path] = i.message; setErrs(fe); }
    toast(errorText(e), 'error');
  };
  const payload = (d: Draft) => ({ title: d.title.trim(), body: d.body.trim(), audience: { packageIds: d.packageIds, coachId: d.coachId || null } });
  const save = async (): Promise<ManagedAnnouncement | null> => {
    if (!edit) return null;
    setBusy(true); setErrs({});
    try {
      const out = edit.id ? await api.patch<ManagedAnnouncement>(`/admin/announcements/${edit.id}`, payload(edit)) : await api.post<ManagedAnnouncement>('/admin/announcements', payload(edit));
      setEdit(toDraft(out)); list.reload(); return out;
    } catch (e) { fail(e); return null; } finally { setBusy(false); }
  };
  const publish = async (when: 'now' | 'later') => {
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      const out = await api.post<ManagedAnnouncement>(`/admin/announcements/${saved.id}/publish`, when === 'later' ? { publishAt: localToIso(later) } : {});
      toast(out.status === 'scheduled' ? 'Scheduled' : 'Published: members in its audience are notified');
      setEdit(toDraft(out)); list.reload();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const togglePackage = (id: string) => { if (!edit) return; setEdit({ ...edit, packageIds: edit.packageIds.includes(id) ? edit.packageIds.filter((p) => p !== id) : [...edit.packageIds, id] }); };

  return <div className="stack">
    <div className="pageHead"><div><h1>Announcements</h1><p className="sub">News for members in the portal and the app: write a draft, choose who it reaches, then publish it or schedule it. Members are notified when it goes out.</p></div><div className="actions"><Button variant="primary" size="sm" onClick={() => setEdit({ ...EMPTY })}>New announcement</Button></div></div>
    <Alert kind="info" title="Service news only">Announcements carry service news, such as opening hours or a change to bookings. Clinical guidance, results, prices or promises need the owner’s approved wording first. Text is kept plain: any markup is removed when saved.</Alert>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    <div className="grid">
      <div className={edit ? 'span5' : 'span12'}><Card dense>{!list.data && !list.error ? <Skeleton rows={5} /> : items.length ? <Table label="Announcements" head={<><th>Title</th>{!edit && <th>Reaches</th>}<th>Status</th>{!edit && <th className="num">Read</th>}</>}>
        {items.map((a) => <tr key={a.id} className="link" onClick={() => setEdit(toDraft(a))} aria-selected={edit?.id === a.id}>
          <td>{a.title}<div className="muted small">{a.origin === 'coach' ? `From ${a.createdBy.name ?? 'a coach'}` : whenText(a)}</div></td>
          {!edit && <td className="small">{audienceText(a)}{a.reach.members !== null ? ` · ${a.reach.members}` : ''}</td>}
          <td><AnnouncementStatus a={a} /></td>
          {!edit && <td className="num">{a.status === 'published' || a.status === 'withdrawn' ? a.reach.reads : '—'}</td>}
        </tr>)}
      </Table> : <Empty title="No announcements yet" body="Write one with New announcement." />}</Card></div>
      {edit && <div className="span7"><Card><CardHead eyebrow={edit.id ? label(edit.status) : 'New'} title={edit.id ? (editable ? 'Edit announcement' : 'Announcement') : 'New announcement'} right={<Button size="sm" variant="tertiary" onClick={() => setEdit(null)}>Close</Button>} />
        {editable ? <div className="form">
          <Field label="Title" error={errs.title}><Input value={edit.title} maxLength={120} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="Message" hint="Plain text; line breaks are kept." error={errs.body}><Textarea value={edit.body} maxLength={4000} onChange={(e) => setEdit({ ...edit, body: e.target.value })} style={{ minHeight: 160 }} /></Field>
          <Field label="Packages" optional hint={`Leave all unticked for every member${options.data ? ` (${options.data.allMembers} now)` : ''}. Ticked: members with an active programme of one of them.`} error={errs['audience.packageIds'] ?? errs.audience}>
            {options.error ? <Alert kind="error">{options.error}</Alert> : !options.data ? <Skeleton rows={2} /> : <div className="row" style={{ flexWrap: 'wrap' }}>{options.data.packages.map((p) => <label key={p.id} className="bp-check"><input type="checkbox" checked={edit.packageIds.includes(p.id)} onChange={() => togglePackage(p.id)} /> <span>{p.name}{p.active ? '' : ' (inactive)'}</span></label>)}</div>}
          </Field>
          <Field label="Coach" optional hint="Only this coach’s assigned clients." error={errs['audience.coachId']}>
            <Select value={edit.coachId} onChange={(e) => setEdit({ ...edit, coachId: e.target.value })}><option value="">Any coach</option>{(options.data?.coaches ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </Field>
          <div className="row"><Button variant="primary" busy={busy} disabled={edit.title.trim().length < 3 || !edit.body.trim()} onClick={() => void save().then((out) => { if (out) toast('Draft saved'); })}>{edit.id ? 'Save' : 'Save draft'}</Button>
            <Button busy={busy} disabled={edit.title.trim().length < 3 || !edit.body.trim()} onClick={() => void publish('now')}>Publish now</Button>
            {current && <Button variant="tertiary" onClick={() => setWithdrawing(current)}>{current.status === 'draft' ? 'Discard' : 'Withdraw'}</Button>}</div>
          <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Or schedule for" optional error={errs.publishAt}><Input type="datetime-local" value={later} onChange={(e) => setLater(e.target.value)} /></Field><Button busy={busy} disabled={!later || edit.title.trim().length < 3 || !edit.body.trim()} onClick={() => void publish('later')}>Schedule</Button></div>
          {current?.status === 'scheduled' && <p className="muted small">{whenText(current)}. Publishing now sends it at once instead.</p>}
          {edit.body.trim() && <div className="cmsPreview"><AnnouncementBody text={edit.body.trim()} /></div>}
        </div> : current ? <div className="stack">
          <div className="annMeta"><AnnouncementStatus a={current} /><span>{whenText(current)}</span><span>{audienceText(current)}</span></div>
          <h4 className="annTitle">{current.title}</h4>
          <AnnouncementBody text={current.body} />
          <dl className="kv">
            <dt>Written by</dt><dd>{current.createdBy.name ?? '—'}{current.origin === 'coach' ? ' (coach)' : ''}</dd>
            {current.publishedBy && <><dt>Published by</dt><dd>{current.publishedBy.name ?? '—'}</dd></>}
            {current.status !== 'withdrawn' && <><dt>Reaches now</dt><dd>{current.reach.members ?? 0} members</dd></>}
            <dt>Read by</dt><dd>{current.reach.reads}</dd>
            {current.status === 'withdrawn' && <><dt>Withdrawn by</dt><dd>{current.withdrawnBy?.name ?? '—'}</dd><dt>Reason</dt><dd>{current.withdrawReason ?? '—'}</dd></>}
          </dl>
          {current.status !== 'withdrawn' && <div className="row"><Button variant="destructive" onClick={() => setWithdrawing(current)}>Withdraw</Button></div>}
        </div> : <Skeleton rows={4} />}
      </Card></div>}
    </div>
    <ReasonDialog open={!!withdrawing} onClose={() => setWithdrawing(null)} danger title={`Withdraw “${withdrawing?.title ?? ''}”?`} confirmLabel="Withdraw"
      body={withdrawing?.status === 'published' ? 'It disappears for members at once, and the notifications it sent lose their text.' : 'It will not be published.'}
      onConfirm={async (reason) => { const out = await api.post<ManagedAnnouncement>(`/admin/announcements/${withdrawing!.id}/withdraw`, { reason }); toast('Withdrawn'); setEdit(toDraft(out)); list.reload(); }} />
  </div>;
}
