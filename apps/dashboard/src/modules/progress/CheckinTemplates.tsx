/* M2 Progress, check-in templates.
   - Admin (/admin/checkin-templates, library.manage): the library every coach uses. A template is a draft until it is
     published with a reason; a published one is never edited (archive it and write a new one), so what a member was
     asked never changes. Coaches' own templates are listed for oversight.
   - Coach (/coach/checkin-templates): the published library and the coach's own templates; a coach writes their own,
     usable at once by them alone.
   Templates hold plain coaching questions. A licensed clinical questionnaire is never presented as a screening tool. */
import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Alert, Button, Card, Dialog, Empty, Field, Input, Pill, ReasonDialog, Select, Skeleton, Table, Textarea, errorText, useApi, useToast } from '../../ui';
import { QUESTION_TYPE_LABELS, QuestionsEditor, questionsReady, type Metric, type Question, type Template } from './shared';
import { TemplateDialog } from './CoachGoalsTab';

const STATUS_PILL: Record<Template['status'], [string, string]> = { draft: ['draft', 'Draft'], published: ['published', 'Published'], archived: ['cancelled', 'Archived'] };

function QuestionList({ questions, metrics }: { questions: Question[]; metrics: Metric[] }) {
  return <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{questions.map((q) => <li key={q.key}>{q.label} <span className="muted">· {QUESTION_TYPE_LABELS[q.type]}{q.metric ? ` · logs ${metrics.find((m) => m.metric === q.metric)?.label ?? q.metric}` : ''}</span></li>)}</ol>;
}

export function CheckinTemplates({ mode }: { mode: 'admin' | 'coach' }) {
  const toast = useToast();
  const [scope, setScope] = useState<'library' | 'coach' | 'all'>('library');
  const list = useApi<{ items: Template[]; metrics: Metric[] }>(() => api.get(mode === 'admin' ? `/admin/checkin-templates${qs({ scope })}` : '/coach/checkin-templates'), [mode, scope]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [publishing, setPublishing] = useState<Template | null>(null);
  const [archiving, setArchiving] = useState<Template | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const metrics = list.data?.metrics ?? [];
  const items = list.data?.items ?? [];
  return <div className="stack">
    <div className="pageHead"><div><h1>Check-in templates</h1><p className="sub">{mode === 'admin' ? 'The library coaches use for weekly and one-off check-ins. Publish a draft to make it available; archive a published one to retire it. Members always keep the questions they were asked.' : 'The published library and your own templates. Yours are usable at once, by you alone.'}</p></div>
      <div className="actions">{mode === 'admin' && <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} aria-label="Which templates" style={{ width: 'auto' }}><option value="library">Library</option><option value="coach">Coaches’ own</option><option value="all">All</option></Select>}<Button variant="primary" size="sm" onClick={() => setCreating(true)}>{mode === 'admin' ? 'Write a library template' : 'Write your own'}</Button></div></div>
    {list.error ? <Alert kind="error">{list.error}</Alert> : !list.data ? <Skeleton rows={6} /> : items.length ? <Card>
      <Table label="Check-in templates" head={<><th>Title</th><th>Kind</th><th>Status</th><th className="num">Questions</th><th>Updated</th><th /></>}>
        {items.map((t) => <React.Fragment key={t.id}>
          <tr className="link" onClick={() => setOpen(open === t.id ? null : t.id)}><td><b style={{ color: 'var(--bp-color-text-primary)' }}>{t.title}</b>{t.description && <div className="small">{t.description}</div>}</td><td>{t.scope === 'library' ? 'Library' : `${t.createdByName}’s own`}</td><td><Pill status={STATUS_PILL[t.status][0]}>{STATUS_PILL[t.status][1]}</Pill></td><td className="num">{t.questions.length}</td><td>{fmtDate(t.updatedAt)}</td>
            <td onClick={(e) => e.stopPropagation()}>{mode === 'admin' && t.scope === 'library' && <div className="row">
              {t.status === 'draft' && <Button size="sm" onClick={() => setEditing(t)}>Edit</Button>}
              {t.status === 'draft' && <Button size="sm" variant="primary" onClick={() => setPublishing(t)}>Publish</Button>}
              {t.status !== 'archived' && <Button size="sm" variant="tertiary" onClick={() => setArchiving(t)}>Archive</Button>}
            </div>}</td></tr>
          {open === t.id && <tr><td colSpan={6}><QuestionList questions={t.questions} metrics={metrics} /></td></tr>}
        </React.Fragment>)}
      </Table>
      <p className="muted" style={{ marginTop: 8 }}>Select a row to see its questions. Answers tied to a measure are logged as the member’s self-reported values.</p>
    </Card> : <Card><Empty title="No templates here" body={mode === 'admin' ? 'Write the first one; it stays a draft until you publish it.' : 'Write your own, or ask an administrator to publish one to the library.'} /></Card>}
    {mode === 'admin' ? <LibraryDialog open={creating || !!editing} template={editing} metrics={metrics} onClose={() => { setCreating(false); setEditing(null); }} onSaved={(what) => { toast(what); list.reload(); }} />
      : <TemplateDialog open={creating} onClose={() => setCreating(false)} metrics={metrics} onSaved={() => { toast('Template saved; only you can use it'); list.reload(); }} />}
    <ReasonDialog open={!!publishing} onClose={() => setPublishing(null)} title={`Publish “${publishing?.title ?? ''}”?`} body="Every coach can then use it. A published template cannot be edited; archive it and write a new one instead." confirmLabel="Publish" onConfirm={async (reason) => { await api.post(`/admin/checkin-templates/${publishing!.id}/publish`, { reason }); toast('Published'); list.reload(); }} />
    <ReasonDialog open={!!archiving} onClose={() => setArchiving(null)} title={`Archive “${archiving?.title ?? ''}”?`} body="Coaches can no longer choose it. Check-ins already requested keep their questions; weekly schedules using it keep running until a coach changes them." confirmLabel="Archive" danger onConfirm={async (reason) => { await api.patch(`/admin/checkin-templates/${archiving!.id}`, { status: 'archived', reason }); toast('Archived'); list.reload(); }} />
  </div>;
}

function LibraryDialog({ open, template, metrics, onClose, onSaved }: { open: boolean; template: Template | null; metrics: Metric[]; onClose: () => void; onSaved: (what: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = open ? (template?.id ?? 'new') : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    setTitle(template?.title ?? ''); setDescription(template?.description ?? ''); setQuestions(template?.questions ?? [{ key: '', label: '', type: 'scale_1_5' }]); setErr('');
  }
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { title: title.trim(), description: description.trim(), questions };
      if (template) await api.patch(`/admin/checkin-templates/${template.id}`, body); else await api.post('/admin/checkin-templates', body);
      onSaved(template ? 'Draft saved' : 'Draft created; publish it when it is ready'); onClose();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Dialog open={open} onClose={onClose} title={template ? 'Edit the draft' : 'Write a library template'} footer={<><Button variant="tertiary" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={title.trim().length < 2 || !questionsReady(questions)} onClick={save}>Save the draft</Button></>}>
    <div className="form">
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
      <Field label="Description" optional><Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></Field>
      <QuestionsEditor value={questions} onChange={setQuestions} metrics={metrics} />
      <p className="muted">Plain coaching questions. A licensed clinical questionnaire is never presented as a screening tool here.</p>
    </div>
    {err && <Alert kind="error">{err}</Alert>}
  </Dialog>;
}

export function CheckinTemplatesAdmin() { return <CheckinTemplates mode="admin" />; }
export function CheckinTemplatesCoach() { return <CheckinTemplates mode="coach" />; }

