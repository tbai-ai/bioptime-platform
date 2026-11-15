/* /admin/help-articles (content.manage): the help centre's articles for members, coaches or both. Drafts are saved
   as they are written; publishing and withdrawing ask for a reason, and so does editing a published article. The
   server keeps the body to the CMS allowlist. */
import React, { useEffect, useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { fmtDateTime, label } from '../../lib/format';
import { Alert, Button, Card, CardHead, Empty, Field, Input, Pill, ReasonDialog, Select, Skeleton, Table, Textarea, useApi, useToast, errorText } from '../../ui';
import { ArticleBody } from './shared';

type Article = { id: string; slug: string; title: string; body: string; audience: 'member' | 'coach' | 'all'; category: string; status: 'draft' | 'published'; sort: number; updatedAt: string; updatedBy: string | null; publishedAt: string | null };
type Draft = { id?: string; slug: string; title: string; body: string; audience: Article['audience']; category: string; sort: string; status?: Article['status'] };

const AUDIENCES = [{ id: 'member', label: 'Members' }, { id: 'coach', label: 'Coaches' }, { id: 'all', label: 'Members and coaches' }];
const EMPTY: Draft = { slug: '', title: '', body: '', audience: 'member', category: '', sort: '0' };

export default function AdminHelpArticles() {
  const list = useApi(() => api.get<{ items: Article[] }>('/admin/help-articles'), []);
  const toast = useToast();
  const [edit, setEdit] = useState<Draft | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<null | { kind: 'publish' | 'unpublish' | 'save'; article: Draft }>(null);
  useEffect(() => { setErrs({}); }, [edit?.id]);
  const items = list.data?.items ?? [];
  const payload = (d: Draft) => ({ title: d.title.trim(), body: d.body, audience: d.audience, category: d.category.trim() || undefined, sort: Number(d.sort) || 0, ...(d.slug.trim() ? { slug: d.slug.trim() } : {}) });
  const save = async (d: Draft, reason?: string) => {
    setBusy(true); setErrs({});
    try {
      const saved = d.id ? await api.patch<Article>(`/admin/help-articles/${d.id}`, { ...payload(d), ...(reason ? { reason } : {}) }) : await api.post<Article>('/admin/help-articles', payload(d));
      toast(d.id ? 'Saved' : 'Draft saved'); setEdit(toDraft(saved)); list.reload();
    } catch (e) {
      if (e instanceof ApiRequestError && Array.isArray(e.details)) { const fe: Record<string, string> = {}; for (const i of e.details as Array<{ path: string; message: string }>) if (i.path && !fe[i.path]) fe[i.path] = i.message; setErrs(fe); }
      toast(errorText(e), 'error'); throw e;
    } finally { setBusy(false); }
  };
  const onSave = () => { if (!edit) return; if (edit.id && edit.status === 'published') setReasonFor({ kind: 'save', article: edit }); else void save(edit).catch(() => {}); };
  return <div className="stack">
    <div className="pageHead"><div><h1>Help articles</h1><p className="sub">What members and coaches read under Help in the portal and the app. Save a draft, read it back, then publish it with a reason.</p></div><div className="actions"><Button variant="primary" size="sm" onClick={() => setEdit({ ...EMPTY })}>New article</Button></div></div>
    <Alert kind="info" title="Words Bioptime supplies">Write how to use Bioptime. Clinical guidance, response times or service levels, and legal or policy text need the owner’s and counsel’s approved wording before they appear here. Bodies keep paragraphs, bold, italics, lists, small headings and https or same-site links; anything else is removed when saved.</Alert>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    <div className="grid">
      <div className={edit ? 'span5' : 'span12'}><Card dense>{!list.data && !list.error ? <Skeleton rows={5} /> : items.length ? <Table label="Help articles" head={<><th>Title</th>{!edit && <th>For</th>}<th>Status</th>{!edit && <th>Updated</th>}</>}>{items.map((a) => <tr key={a.id} className="link" onClick={() => setEdit(toDraft(a))} aria-selected={edit?.id === a.id}><td>{a.title}<div className="muted small">{edit ? AUDIENCES.find((x) => x.id === a.audience)?.label : `${a.category} · /${a.slug}`}</div></td>{!edit && <td className="small">{AUDIENCES.find((x) => x.id === a.audience)?.label}</td>}<td><Pill status={a.status === 'published' ? 'published' : 'draft'} /></td>{!edit && <td className="small">{fmtDateTime(a.updatedAt)}{a.updatedBy ? <div className="muted">{a.updatedBy}</div> : null}</td>}</tr>)}</Table> : <Empty title="No articles yet" body="Write the first one with New article." />}</Card></div>
      {edit && <div className="span7"><Card><CardHead eyebrow={edit.id ? label(edit.status) : 'New'} title={edit.id ? 'Edit article' : 'New article'} right={<Button size="sm" variant="tertiary" onClick={() => setEdit(null)}>Close</Button>} />
        <div className="form">
          <Field label="Title" error={errs.title}><Input value={edit.title} maxLength={160} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <div className="row"><Field label="For" error={errs.audience}><Select value={edit.audience} onChange={(e) => setEdit({ ...edit, audience: e.target.value as Draft['audience'] })}>{AUDIENCES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field><Field label="Section" optional hint="Articles are grouped by it." error={errs.category}><Input value={edit.category} maxLength={60} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Field><Field label="Order" optional error={errs.sort}><Input inputMode="numeric" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: e.target.value.replace(/\D/g, '') })} /></Field></div>
          <Field label="Address" optional hint="Lower-case letters, digits and hyphens. Taken from the title when empty." error={errs.slug}><Input value={edit.slug} maxLength={80} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></Field>
          <Field label="Body" error={errs.body}><Textarea value={edit.body} maxLength={20000} onChange={(e) => setEdit({ ...edit, body: e.target.value })} style={{ minHeight: 200, fontFamily: 'var(--bp-font-mono)', fontSize: 12.5 }} /></Field>
          <div className="muted small">Allowed: &lt;p&gt; &lt;br&gt; &lt;strong&gt; &lt;em&gt; &lt;ul&gt; &lt;ol&gt; &lt;li&gt; &lt;h3&gt; &lt;a href="https://… or /…"&gt;.</div>
          {edit.body.trim() && <div className="cmsPreview"><ArticleBody html={edit.body} /></div>}
          <div className="row"><Button variant="primary" busy={busy} disabled={edit.title.trim().length < 3 || !edit.body.trim()} onClick={onSave}>{edit.id ? 'Save' : 'Save draft'}</Button>
            {edit.id && edit.status === 'draft' && <Button onClick={() => setReasonFor({ kind: 'publish', article: edit })}>Publish</Button>}
            {edit.id && edit.status === 'published' && <Button variant="tertiary" onClick={() => setReasonFor({ kind: 'unpublish', article: edit })}>Withdraw</Button>}</div>
        </div>
      </Card></div>}
    </div>
    <ReasonDialog open={!!reasonFor} onClose={() => setReasonFor(null)}
      title={reasonFor?.kind === 'publish' ? `Publish “${reasonFor.article.title}”?` : reasonFor?.kind === 'unpublish' ? `Withdraw “${reasonFor?.article.title}”?` : 'Save the published article?'}
      confirmLabel={reasonFor?.kind === 'publish' ? 'Publish' : reasonFor?.kind === 'unpublish' ? 'Withdraw' : 'Save'}
      body={reasonFor?.kind === 'publish' ? `Readers see it at once (${AUDIENCES.find((x) => x.id === reasonFor.article.audience)?.label.toLowerCase()}). Unsaved changes are not published; save first.` : reasonFor?.kind === 'unpublish' ? 'It goes back to draft and disappears from Help.' : 'Readers see the change at once.'}
      onConfirm={async (reason) => {
        const r = reasonFor!;
        if (r.kind === 'save') { await save(r.article, reason); return; }
        const out = await api.post<Article>(`/admin/help-articles/${r.article.id}/${r.kind}`, { reason });
        toast(r.kind === 'publish' ? 'Published' : 'Withdrawn'); setEdit(toDraft(out)); list.reload();
      }} />
  </div>;
}

function toDraft(a: Article): Draft { return { id: a.id, slug: a.slug, title: a.title, body: a.body, audience: a.audience, category: a.category, sort: String(a.sort ?? 0), status: a.status }; }
