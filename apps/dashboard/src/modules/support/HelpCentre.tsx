/* Help and support for members (/client/help) and coaches (/coach/help): the help articles for their audience, their
   own support requests with the team's replies, and, for members, the data export they asked for. Coaches also see
   their onboarding checklist here. Each part shows only while its switch is on (help_centre, support_requests). */
import React, { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Link, useNavigate } from '../../lib/nav';
import { fmtDate, fmtDateTime, relative } from '../../lib/format';
import { Alert, Button, Card, CardHead, Dialog, Empty, Field, Input, Pill, Select, Skeleton, Table, Tabs, Textarea, useApi, useToast, errorText } from '../../ui';
import { ArticleBody, CATEGORIES, RequestStatus, Thread, fmtBytes, useSupportParts } from './shared';
import CoachOnboarding from './CoachOnboarding';
import { openLater } from '../../lib/ids';

type Tab = 'articles' | 'requests' | 'export';
type Article = { id: string; slug: string; title: string; category: string; audience: string; summary: string; updatedAt: string };
type Req = { id: string; reference: string; category: string; categoryLabel: string; subject: string; status: string; createdAt: string; updatedAt: string; lastMessageAt: string | null };

export default function HelpCentre() {
  const { slug, id } = useParams();
  const parts = useSupportParts();
  if (!parts) return <Skeleton rows={6} />;
  if (slug) return <ArticlePage slug={slug} />;
  if (id) return <RequestPage id={id} />;
  return <HelpHome parts={parts} />;
}

function HelpHome({ parts }: { parts: { requests: boolean; help: boolean } }) {
  const { isMember, isCoach } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs: Array<{ id: Tab; label: string }> = [
    ...(parts.help ? [{ id: 'articles' as Tab, label: 'Help articles' }] : []),
    ...(parts.requests ? [{ id: 'requests' as Tab, label: 'My requests' }] : []),
    ...(isMember ? [{ id: 'export' as Tab, label: 'Your data export' }] : []),
  ];
  const asked = params.get('tab') as Tab | null;
  const tab = tabs.find((t) => t.id === asked)?.id ?? tabs[0]?.id;
  const setTab = (t: Tab) => { params.set('tab', t); setParams(params, { replace: true }); };
  return <div className="stack">
    <div className="pageHead"><div><h1>{isCoach ? 'Help' : 'Help and support'}</h1><p className="sub">{isCoach ? 'Articles for coaches, your questions to the Bioptime team, and your onboarding checklist.' : 'Articles from the Bioptime team, your questions to the team and the copy of your data you asked for.'}</p></div></div>
    {isCoach && <CoachOnboarding />}
    {tab ? <Tabs items={tabs} value={tab} onChange={setTab}>
      {tab === 'articles' && <Articles />}
      {tab === 'requests' && <Requests />}
      {tab === 'export' && <DataExport />}
    </Tabs> : !isCoach && <Card><Empty title="Nothing here yet" body="Help articles and support requests are switched off for now." /></Card>}
  </div>;
}

/* ---------- articles ---------- */

function Articles() {
  const list = useApi(() => api.get<{ items: Article[] }>('/help/articles'), []);
  const [q, setQ] = useState('');
  const items = list.data?.items ?? [];
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? items.filter((a) => `${a.title} ${a.summary} ${a.category}`.toLowerCase().includes(s)) : items; }, [items, q]);
  const groups = useMemo(() => { const m = new Map<string, Article[]>(); for (const a of shown) m.set(a.category, [...(m.get(a.category) ?? []), a]); return [...m]; }, [shown]);
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  if (!list.data) return <Skeleton rows={5} />;
  if (!items.length) return <Card><Empty title="No articles yet" body="The Bioptime team publishes help articles here. Ask a question under My requests in the meantime." /></Card>;
  return <div className="stack">
    <div className="row"><Input type="search" placeholder="Search the articles" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the help articles" style={{ maxWidth: 360 }} /></div>
    {groups.length ? <div className="grid">{groups.map(([category, list]) => <div key={category} className="span6"><Card><CardHead eyebrow="Help" title={category} /><ul className="supList">{list.map((a) => <li key={a.id}><Link to={`/help/articles/${a.slug}`}><b style={{ color: 'var(--bp-color-text-primary)' }}>{a.title}</b><div className="small">{a.summary}</div></Link></li>)}</ul></Card></div>)}</div> : <Card><Empty title="No article matches" body="Try another word, or ask the team under My requests." /></Card>}
  </div>;
}

function ArticlePage({ slug }: { slug: string }) {
  const a = useApi(() => api.get<Article & { body: string }>(`/help/articles/${encodeURIComponent(slug)}`), [slug]);
  return <div className="stack">
    <div className="pageHead"><div><h1>{a.data?.title ?? 'Help article'}</h1><p className="sub">{a.data ? `${a.data.category} · updated ${fmtDate(a.data.updatedAt)}` : ' '}</p></div><div className="actions"><Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/help?tab=articles">All articles</Link></div></div>
    {a.error ? <Alert kind="error">{a.error}</Alert> : !a.data ? <Skeleton rows={6} /> : <Card><ArticleBody html={a.data.body} /></Card>}
    <p className="muted small">Not what you needed? <Link to="/help?tab=requests">Ask the Bioptime team</Link>.</p>
  </div>;
}

/* ---------- my requests ---------- */

function Requests() {
  const list = useApi(() => api.get<{ items: Req[] }>('/support-requests'), []);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const items = list.data?.items ?? [];
  return <div className="stack">
    <div className="row between"><p className="small" style={{ margin: 0 }}>Questions about your account, payments, tests, the app or your coaching. The team answers here, and a notification tells you when they have.</p><Button variant="primary" size="sm" onClick={() => setCreating(true)}>New request</Button></div>
    {list.error && <Alert kind="error">{list.error}</Alert>}
    {!list.data && !list.error ? <Skeleton rows={4} /> : items.length ? <Card dense><Table label="My support requests" head={<><th>Reference</th><th>Subject</th><th>Topic</th><th>Status</th><th>Last activity</th></>}>{items.map((r) => <tr key={r.id} className="link" onClick={() => nav(`/help/requests/${r.id}`)}><td><Link to={`/help/requests/${r.id}`}>{r.reference}</Link></td><td>{r.subject}</td><td className="small">{r.categoryLabel}</td><td><RequestStatus status={r.status} /></td><td className="small">{relative(r.updatedAt)}</td></tr>)}</Table></Card> : <Card><Empty title="No requests yet" body="Ask the team anything about your account or the service." action={<Button size="sm" onClick={() => setCreating(true)}>New request</Button>} /></Card>}
    <NewRequest open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); nav(`/help/requests/${id}`); }} />
  </div>;
}

function NewRequest({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { isCoach } = useAuth();
  const [f, setF] = useState({ category: 'app', subject: '', body: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr(''); setErrs({});
    try { const r = await api.post<{ id: string }>('/support-requests', { category: f.category, subject: f.subject.trim(), body: f.body.trim() }); setF({ category: 'app', subject: '', body: '' }); onCreated(r.id); }
    catch (e) { if (e instanceof ApiRequestError && Array.isArray(e.details)) { const fe: Record<string, string> = {}; for (const i of e.details as Array<{ path: string; message: string }>) if (i.path && !fe[i.path]) fe[i.path] = i.message; setErrs(fe); } setErr(errorText(e)); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onClose={onClose} title="Ask the Bioptime team" footer={<><Button variant="tertiary" onClick={onClose}>Not now</Button><Button variant="primary" busy={busy} disabled={f.subject.trim().length < 3 || f.body.trim().length < 5} onClick={submit}>Send</Button></>}>
    <div className="form">
      <Field label="Topic"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.filter((c) => !(isCoach && c.id === 'billing')).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
      <Field label="Subject" error={errs.subject}><Input value={f.subject} maxLength={160} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="In a few words" /></Field>
      <Field label="What happened" hint="What you did, what you expected and what you saw. The team reads it in the portal." error={errs.body}><Textarea value={f.body} maxLength={5000} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      <p className="muted small">For a medical emergency call 112. This is not the place for urgent health concerns.</p>
      {err && <Alert kind="error">{err}</Alert>}
    </div>
  </Dialog>;
}

function RequestPage({ id }: { id: string }) {
  const r = useApi(() => api.get<Req & { messages: Array<{ id: string; body: string; createdAt: string; mine: boolean; authorName: string }> }>(`/support-requests/${id}`), [id]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const d = r.data;
  const send = async () => { if (!body.trim()) return; setBusy(true); try { await api.post(`/support-requests/${id}/messages`, { body: body.trim() }); setBody(''); r.reload(); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); } };
  return <div className="stack">
    <div className="pageHead"><div><h1>{d ? d.subject : 'Support request'}</h1><p className="sub">{d ? `${d.reference} · ${d.categoryLabel} · opened ${fmtDateTime(d.createdAt)}` : ' '}</p></div><div className="actions">{d && <RequestStatus status={d.status} />}<Link className="bp-btn bp-btn-tertiary bp-btn-sm" to="/help?tab=requests">All requests</Link></div></div>
    {r.error ? <Alert kind="error">{r.error}</Alert> : !d ? <Skeleton rows={5} /> : <Card>
      <Thread items={d.messages} />
      {d.status === 'closed' ? <Alert kind="info" title="This request is closed">Open a new request and mention {d.reference} if you need more help.</Alert>
        : <div className="form" style={{ marginTop: 12 }}><Textarea value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} placeholder="Write to the Bioptime team" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send(); }} /><div className="row between"><span className="muted small">{d.status === 'resolved' ? 'Marked resolved. Writing again reopens it.' : '⌘/Ctrl+Enter to send.'}</span><Button variant="primary" busy={busy} disabled={!body.trim()} onClick={send}>Send</Button></div></div>}
    </Card>}
  </div>;
}

/* ---------- the member's data export ---------- */

type Export = { id: string; status: string; requestedAt: string; completedAt: string | null; file: { name: string; size: number; createdAt: string } | null };

function DataExport() {
  const list = useApi(() => api.get<{ items: Export[] }>('/me/data-exports'), []);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  // a 5-minute link, opened at once; the file never has a lasting address. The tab opens during the click (openLater), so
  // a popup blocker does not stop the download; if the browser blocks it anyway, the file opens in this tab
  const download = (e: Export) => {
    setBusy(e.id);
    openLater(() => api.post<{ url: string }>(`/me/data-requests/${e.id}/file-token`).then((t) => t.url).finally(() => setBusy(null)), (err) => toast(errorText(err), 'error'));
  };
  const items = list.data?.items ?? [];
  return <div className="grid">
    <div className="span8"><Card><CardHead eyebrow="Your data" title="Copies of your data" right={<Link className="bp-btn bp-btn-secondary bp-btn-sm" to="/profile?tab=data">Ask for a copy</Link>} />
      {list.error && <Alert kind="error">{list.error}</Alert>}
      {!list.data && !list.error ? <Skeleton rows={3} /> : items.length ? <Table label="Your data exports" head={<><th>Requested</th><th>Status</th><th>File</th><th /></>}>{items.map((e) => <tr key={e.id}><td>{fmtDate(e.requestedAt)}</td><td><Pill status={e.status} /></td><td className="small">{e.file ? `${e.file.name} · ${fmtBytes(e.file.size)}` : e.status === 'cancelled' ? '—' : 'Being prepared'}</td><td className="num">{e.file && <Button size="sm" busy={busy === e.id} onClick={() => download(e)}>Download</Button>}</td></tr>)}</Table> : <Empty title="No copy requested" body="Ask for a copy under Profile › Your data. It appears here when the team has prepared it." />}
    </Card></div>
    <div className="span4"><Card><CardHead eyebrow="How it works" title="Only you can open it" /><p className="small">The file is a JSON archive of your records. Anything it does not include yet is named inside it, with the reason. Each time you press Download, a link that works for five minutes opens it; the file has no lasting address and nobody else can open it, not your coach and not the team.</p></Card></div>
  </div>;
}
