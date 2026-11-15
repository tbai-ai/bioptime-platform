/* M6 Workouts, coach workspace: write a workout programme for an assigned client. Weeks of training days, one template
   per day. A draft until published; publishing gives the client their sessions, and a revision keeps every session
   they already did. Once published, weeks keep their numbers (a session belongs to its week and day), so removing a
   week never renumbers the ones after it; the server also refuses to drop a week the client logged in, and keeps every
   logged or skipped day in its week and day with the same template (DAY_HAS_LOGS), so those rows are locked here.
   Admin mode (/admin/workout-programs/:id, members.manage): the same editor for an administrator, against the admin
   endpoints (/admin/members/:id/workout-programs, /admin/workout-programs/:id, …/publish, …/archive), which reuse the
   coach routes' validation. A new programme starts from the member's record (?member=), never from a list of clients,
   from scratch or from a template (one template on the chosen days for a number of weeks, filled in here and editable
   before it is saved). Templates come from GET /admin/members/:id/workout-templates (members.manage, no library
   permission needed; ?programId= for an existing programme): exactly the ones the server accepts, published team
   templates and the programme's coach's own (plus those its published version already uses). */
import React, { useEffect, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Link, useNavigate } from '../../lib/nav';
import { api } from '../../lib/api';
import { fmtDate, todayIst } from '../../lib/format';
import { Alert, Button, Card, CardHead, Field, Input, Pill, ReasonDialog, Select, Skeleton, Textarea, useApi, useToast, errorText } from '../../ui';
import { DAY_NAMES, fmtDay } from './shared';

type Day = { day: number; templateId: string; locked?: boolean };
type Week = { week: number; focus: string; days: Day[] };

export function ProgramEditor({ mode = 'coach' }: { mode?: 'coach' | 'admin' }) {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
  const loc = useLocation() as { state?: { memberName?: string; coachId?: string } };
  const nav = useNavigate();
  const toast = useToast();
  const isNew = id === 'new';
  const admin = mode === 'admin';
  const base = admin ? '/admin' : '/coach';
  const existing = useApi(() => (isNew ? Promise.resolve(null) : api.get(`${base}/workout-programs/${id}`)), [id, base]);
  const clients = useApi(() => (admin ? Promise.resolve(null) : api.get('/coach/clients')), [admin]);
  const [member, setMember] = useState(params.get('member') ?? '');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [startDate, setStartDate] = useState(todayIst());
  const [weeks, setWeeks] = useState<Week[]>([{ week: 1, focus: '', days: [] }]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState(false);
  const [fill, setFill] = useState<{ templateId: string; weeks: string; days: number[] }>({ templateId: '', weeks: '4', days: [1, 3, 5] });
  const p = existing.data as any;
  // an administrator chooses from the templates the server accepts for this member's programme (the member comes from
  // ?member= for a new one, from the programme otherwise)
  const adminMember = admin ? (isNew ? params.get('member') ?? '' : p?.memberId ?? '') : '';
  const templates = useApi(() => (!admin ? api.get('/coach/workout-templates') : adminMember ? api.get(`/admin/members/${adminMember}/workout-templates${isNew ? '' : `?programId=${id}`}`) : Promise.resolve(null)), [admin, adminMember, isNew, id]);
  useEffect(() => {
    if (!p) return;
    // a draft revision keeps its own title and start date until it is published
    setMember(p.memberId); setTitle(p.draft?.title ?? p.title); const start = p.draft?.startDate ?? p.startDate; if (start) setStartDate(start);
    const v = p.draft ?? p.published;
    setSummary(v?.summary ?? '');
    const ws = (v?.structure?.weeks ?? []) as any[];
    // a day the client logged or skipped stays in its week and day with the same template
    const loggedDays = ((p.loggedDays ?? []) as Array<{ week: number; day: number; templateId: string }>);
    const isLogged = (week: number, d: any) => loggedDays.some((x) => x.week === week && x.day === d.day && x.templateId === d.templateId);
    if (ws.length) setWeeks(ws.map((w) => ({ week: w.week, focus: w.focus ?? '', days: (w.days ?? []).map((d: any) => ({ day: d.day, templateId: d.templateId, locked: isLogged(w.week, d) })) })));
  }, [p]);

  // the admin list is already the set the server accepts (checkStructure); a template without exercises is refused
  // (TEMPLATE_EMPTY), so it is not offered
  const tplList = (((templates.data as any)?.items ?? []) as any[]).filter((t) => !admin || t.usable !== false);
  const tplName = (tid: string) => tplList.find((t) => t.id === tid)?.title ?? p?.templates?.[tid]?.title ?? 'Template';
  const save = async (publish: boolean) => {
    setBusy(true); setErr('');
    try {
      const structure = { weeks: weeks.map((w) => ({ week: w.week, ...(w.focus.trim() ? { focus: w.focus.trim() } : {}), days: w.days.filter((d) => d.templateId).map((d) => ({ day: d.day, templateId: d.templateId })) })) };
      let programId = id;
      if (isNew) { const r = admin ? await api.post(`/admin/members/${member}/workout-programs`, { title, summary, startDate, structure }) : await api.post('/coach/workout-programs', { memberId: member, title, summary, startDate, structure }); programId = r.id; }
      else if (p.status !== 'archived') await api.patch(`${base}/workout-programs/${id}`, { title, summary, startDate, structure });
      if (publish) { await api.post(`${base}/workout-programs/${programId}/publish`, { startDate }); toast('Published: the client has their sessions'); }
      else toast('Draft saved');
      if (isNew) nav(`/workout-programs/${programId}`, { replace: true }); else existing.reload();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const setWeek = (i: number, patch: Partial<Week>) => setWeeks((ws) => ws.map((w, k) => (k === i ? { ...w, ...patch } : w)));
  const setDay = (wi: number, di: number, patch: Partial<Day>) => setWeeks((ws) => ws.map((w, k) => (k === wi ? { ...w, days: w.days.map((d, j) => (j === di ? { ...d, ...patch } : d)) } : w)));
  const nextFreeDay = (w: Week) => [1, 2, 3, 4, 5, 6, 7].find((n) => !w.days.some((d) => d.day === n)) ?? 7;
  const fillWeeks = Math.min(52, Math.max(1, Math.floor(Number(fill.weeks)) || 0));
  const applyFill = () => setWeeks(Array.from({ length: fillWeeks }, (_, i) => ({ week: i + 1, focus: '', days: [...fill.days].sort((a, b) => a - b).map((day) => ({ day, templateId: fill.templateId })) })));

  if (!isNew && existing.error) return <Alert kind="error">{existing.error}</Alert>;
  if (!isNew && !p) return <Skeleton rows={6} />;
  if (admin && isNew && !member) return <Alert kind="info" title="Start from the member’s record">Open the member under Members, then use New workout programme on their Workouts tab.</Alert>;
  const templatesRefused = admin && !!templates.error;
  const archived = !isNew && p.status === 'archived';
  const hasDraft = isNew || !!p.draft;
  const fixedWeeks = !isNew && p.status !== 'draft'; // published once: week numbers are what the client's sessions hang on
  const logged = new Set<number>(isNew ? [] : (p.loggedWeeks ?? []));
  const canRemoveWeek = (w: Week, wi: number) => weeks.length > 1 && (!fixedWeeks || (wi === weeks.length - 1 && !logged.has(w.week)));
  const removeWeek = (wi: number) => setWeeks((ws) => { const rest = ws.filter((_, k) => k !== wi); return fixedWeeks ? rest : rest.map((x, k) => ({ ...x, week: k + 1 })); });
  const back = member ? `/clients/${member}?tab=workouts` : '/clients';
  return <div className="stack">
    <div className="pageHead"><div><Link className="muted" to={back}>← Client</Link><h1 style={{ marginTop: 4 }}>{isNew ? 'New workout programme' : p.title}</h1><p className="sub">{isNew ? `${admin && loc.state?.memberName ? `For ${loc.state.memberName}. ` : ''}A draft until you publish it. Publishing gives the client their sessions and tells them.` : `Version ${p.currentVersion} · ${p.memberName}${admin && p.coachName ? ` · coach ${p.coachName}` : ''}${p.draft && p.status === 'published' ? ' · draft revision not yet published' : ''}`}</p></div>
      <div className="actions">{!isNew && <Pill status={p.status} />}{!archived && <><Button busy={busy} onClick={() => save(false)}>Save draft</Button><Button variant="primary" busy={busy} onClick={() => save(true)}>{isNew || p.status === 'draft' ? 'Publish' : 'Publish revision'}</Button></>}{!isNew && !archived && <Button variant="tertiary" onClick={() => setArchive(true)}>Archive</Button>}</div></div>
    {err && <Alert kind="error">{err}</Alert>}
    {archived && <Alert kind="info" title="Archived">This programme is closed. Sessions the client logged stay in their history.</Alert>}
    {!isNew && !hasDraft && !archived && <Alert kind="info">Editing creates a draft revision; the published version stays with the client until you publish it. Sessions the client already did are kept.</Alert>}
    <div className="grid">
      <div className="span4"><Card><CardHead eyebrow="Programme" title="Basics" /><div className="form">
        {isNew && !admin && <Field label="Client"><Select value={member} onChange={(e) => setMember(e.target.value)}><option value="">Choose a client</option>{(((clients.data as any)?.items ?? []) as any[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        <Field label="Title"><Input value={title} disabled={archived} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Block 1: full body twice a week" /></Field>
        <Field label="Summary for the client" optional><Textarea value={summary} disabled={archived} onChange={(e) => setSummary(e.target.value)} /></Field>
        <Field label="Start date (sessions are dated from it)"><Input type="date" value={startDate} disabled={archived} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <p className="muted">Only training within your professional scope. No medical, rehabilitation or injury-prevention claims; no calorie figures.</p>
      </div></Card>
      {admin && isNew && <Card><CardHead eyebrow="Optional" title="Start from a template" /><div className="form">
        <p className="small">Puts one template on the days you choose for a number of weeks; change any week or day afterwards. Or build the weeks yourself.</p>
        <Field label="Template"><Select value={fill.templateId} onChange={(e) => setFill((f) => ({ ...f, templateId: e.target.value }))}><option value="">Choose a template</option>{tplList.map((t) => <option key={t.id} value={t.id}>{t.title}{t.source === 'team' ? ' · team' : ` · ${t.authorName ?? 'coach'}`}</option>)}</Select></Field>
        <Field label="Weeks"><Input type="number" min={1} max={52} value={fill.weeks} onChange={(e) => setFill((f) => ({ ...f, weeks: e.target.value }))} /></Field>
        <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, gap: 10 }}><legend className="bp-label">Training days</legend>{DAY_NAMES.map((n, k) => <label key={k} className="bp-check"><input type="checkbox" checked={fill.days.includes(k + 1)} onChange={(e) => setFill((f) => ({ ...f, days: e.target.checked ? [...f.days, k + 1] : f.days.filter((d) => d !== k + 1) }))} /> {n}</label>)}</fieldset>
        <div><Button size="sm" disabled={!fill.templateId || !fill.days.length || !fillWeeks} onClick={applyFill}>Fill the weeks</Button></div>
      </div></Card>}
      {!isNew && <Card><CardHead eyebrow="Sessions" title="So far" /><dl className="kv"><dt>Done</dt><dd>{p.sessions.completed} completed, {p.sessions.partial} partly</dd><dt>Skipped</dt><dd>{p.sessions.skipped}</dd><dt>To come</dt><dd>{p.sessions.scheduled}</dd><dt>Started</dt><dd>{fmtDay(p.startDate)}</dd></dl></Card>}
      </div>
      <div className="span8"><Card><CardHead eyebrow="Weekly structure" title={`${weeks.length} week${weeks.length === 1 ? '' : 's'}`} right={!archived ? <Button size="sm" onClick={() => setWeeks((ws) => [...ws, { week: Math.max(0, ...ws.map((x) => x.week)) + 1, focus: '', days: ws[ws.length - 1]?.days.map((d) => ({ day: d.day, templateId: d.templateId })) ?? [] }])}>Add week</Button> : undefined} />
        {fixedWeeks && !archived && <p className="small muted">Weeks keep their numbers once published, and a day your client logged or skipped stays in its week and day with the same template (those rows are locked). To take out a week in the middle, remove its days still to come. Only the last week can be removed, and only while nothing in it is logged.</p>}
        {!tplList.length && templates.data ? <Alert kind="info">No templates yet. Create one in the <Link to="/exercise-library">exercise library</Link> first.</Alert> : null}
        {templatesRefused ? <Alert kind="warning" title="Templates could not be loaded">{templates.error}</Alert> : null}
        <div className="stack">{weeks.map((w, wi) => <div key={wi} className="bp-tile"><div className="row between"><div className="row"><b style={{ color: 'var(--bp-color-text-primary)' }}>Week {w.week}</b><Input style={{ maxWidth: 220 }} placeholder="Focus (optional)" value={w.focus} disabled={archived} onChange={(e) => setWeek(wi, { focus: e.target.value })} /></div>
          {!archived && <div className="row"><Button size="sm" variant="tertiary" disabled={w.days.length >= 7} onClick={() => setWeek(wi, { days: [...w.days, { day: nextFreeDay(w), templateId: '' }] })}>Add day</Button>{canRemoveWeek(w, wi) && <Button size="sm" variant="tertiary" onClick={() => removeWeek(wi)}>Remove week</Button>}</div>}</div>
          <div className="stack" style={{ marginTop: 10 }}>{w.days.length ? w.days.map((d, di) => <div key={di} className="row">
            <Select style={{ maxWidth: 110 }} value={d.day} disabled={archived || d.locked} aria-label="Day of the week" onChange={(e) => setDay(wi, di, { day: Number(e.target.value) })}>{DAY_NAMES.map((n, k) => <option key={k} value={k + 1}>{n}</option>)}</Select>
            <Select style={{ flex: '1 1 240px' }} value={d.templateId} disabled={archived || d.locked} aria-label="Template" onChange={(e) => setDay(wi, di, { templateId: e.target.value })}><option value="">Choose a template</option>{d.templateId && !tplList.some((t) => t.id === d.templateId) && <option value={d.templateId}>{tplName(d.templateId)}</option>}{tplList.map((t) => <option key={t.id} value={t.id}>{t.title}{t.source === 'team' ? ' · team' : admin ? ` · ${t.authorName ?? 'coach'}` : ' · mine'}</option>)}</Select>
            {!archived && (d.locked ? <span className="small muted">Logged</span> : <Button size="sm" variant="tertiary" aria-label="Remove day" onClick={() => setWeek(wi, { days: w.days.filter((_, j) => j !== di) })}>✕</Button>)}
          </div>) : <p className="small muted">A rest week. Add a day to plan a session.</p>}</div>
        </div>)}</div>
      </Card></div>
    </div>
    {!isNew && <Card><CardHead eyebrow="Versions" title="History" /><ul className="timeline">{(p.versions ?? []).map((v: any) => <li key={v.id} className={v.status === 'published' ? 'done' : ''}><b>Version {v.version}</b> · {v.status}{v.summary ? ` · ${v.summary}` : ''}<time>{fmtDate(v.publishedAt ?? v.createdAt)}</time></li>)}</ul></Card>}
    <ReasonDialog open={archive} onClose={() => setArchive(false)} title="Archive this programme?" body="Sessions still to come are removed; what the client logged stays in their history." confirmLabel="Archive" danger onConfirm={async (reason) => { await api.post(`${base}/workout-programs/${id}/archive`, { reason }); toast('Programme archived'); existing.reload(); }} />
  </div>;
}
