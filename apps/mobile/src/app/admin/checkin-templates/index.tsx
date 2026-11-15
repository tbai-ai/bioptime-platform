/* Admin › Check-in templates (the web's /admin/checkin-templates, modules/progress/CheckinTemplates.tsx admin mode;
   progress module, library.manage): the library every coach uses for weekly and one-off check-ins. A template is a
   draft until it is published with a reason; a published one is never edited (archive it, with a reason, and write a
   new one), so what a member was asked never changes. Coaches' own templates are listed for oversight (scope chips).
   Templates hold plain coaching questions; a licensed clinical questionnaire is never presented as a screening tool.
   GET /admin/checkin-templates?scope=library|coach|all → { items, metrics }; POST /admin/checkin-templates,
   PATCH …/:id { title, description, questions } or { status: 'archived', reason }, POST …/:id/publish { reason }. */
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { errorText, get, patch, post, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { EMPTY_QUESTION, questionLine, questionsReady, type Metric, type Question, type Template } from '@/lib/coach/libraries/progress';
import { ReasonSheet } from '@/components/adminA/ReasonSheet';
import { useToast } from '@/components/adminA/toast';
import { QuestionsEditor } from '@/components/coachLibraries/QuestionsEditor';
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, P, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, FilterChips, RecordList, Sheet } from '@/components/workspace';
import { AdminModuleGate, Hint } from '@/components/adminModules2/frame';
import { Enter } from '@/motion';
import { colors, font, space } from '@/theme';

const TITLE = 'Check-in templates';
type Scope = 'library' | 'coach' | 'all';
const SCOPES = [{ value: 'library', label: 'Library' }, { value: 'coach', label: 'Coaches’ own' }, { value: 'all', label: 'All' }];
const STATUS_PILL: Record<Template['status'], { label: string; tone: 'warning' | 'success' | 'info' }> = { draft: { label: 'Draft', tone: 'warning' }, published: { label: 'Published', tone: 'success' }, archived: { label: 'Archived', tone: 'info' } };

export default function AdminCheckinTemplatesScreen() {
  return <AdminModuleGate title={TITLE} module="progress" permission="library.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const toast = useToast();
  const [scope, setScope] = useState<Scope>('library');
  const list = useLoad<{ items: Template[]; metrics: Metric[] }>(`admin-checkin-templates-${scope}`, () => get(`/admin/checkin-templates${qs({ scope })}`), [scope]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [publishing, setPublishing] = useState<Template | null>(null);
  const [archiving, setArchiving] = useState<Template | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const metrics = list.data?.metrics ?? [];
  const items = list.data?.items ?? [];
  return <View style={{ flex: 1 }}><Screen refreshing={list.loading} onRefresh={list.reload}>
    <Enter><Title sub="The library coaches use for weekly and one-off check-ins. Publish a draft to make it available; archive a published one to retire it. Members always keep the questions they were asked.">{TITLE}</Title></Enter>
    <Enter index={1}><Button title="Write a library template" small onPress={() => setCreating(true)} style={{ alignSelf: 'flex-start' }} /></Enter>
    <FilterChips options={SCOPES} value={scope} onChange={(v) => setScope(String(v) as Scope)} />
    <StaleBanner at={list.stale} />
    <ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !list.data ? <Loading /> : list.data ? (items.length ? <Enter index={2}><View style={{ gap: space.sm }}>
      <RecordList title="Check-in templates">
        {items.map((t) => <View key={t.id} style={st.row}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === t.id }} accessibilityLabel={t.title} onPress={() => setOpen(open === t.id ? null : t.id)} style={({ pressed }) => [{ gap: 2 }, pressed && { opacity: 0.8 }]}>
            <Row between style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Text style={st.title}>{t.title}</Text><Pill tone={STATUS_PILL[t.status].tone}>{STATUS_PILL[t.status].label}</Pill></Row>
            {t.description ? <Text style={st.meta}>{t.description}</Text> : null}
            <Text style={st.meta}>{`${t.scope === 'library' ? 'Library' : `${t.createdByName}’s own`} · ${t.questions.length} ${t.questions.length === 1 ? 'question' : 'questions'} · updated ${fmtDate(t.updatedAt)}`}</Text>
          </Pressable>
          {open === t.id ? <View style={st.questions}>{t.questions.map((q, i) => <Text key={q.key} style={st.q}>{`${i + 1}. ${questionLine(q, metrics)}`}</Text>)}</View> : null}
          {t.scope === 'library' && t.status !== 'archived' ? <Row>
            {t.status === 'draft' ? <Button title="Edit" variant="secondary" small onPress={() => setEditing(t)} /> : null}
            {t.status === 'draft' ? <Button title="Publish" small onPress={() => setPublishing(t)} /> : null}
            <Button title="Archive" variant="ghost" small onPress={() => setArchiving(t)} />
          </Row> : null}
        </View>)}
      </RecordList>
      <Hint>Select a row to see its questions. Answers tied to a measure are logged as the member’s self-reported values.</Hint>
    </View></Enter> : <Card><EmptyState title="No templates here" body="Write the first one; it stays a draft until you publish it." /></Card>) : null}
    <LibrarySheet open={creating || !!editing} template={editing} metrics={metrics} onClose={() => { setCreating(false); setEditing(null); }} onSaved={(what) => { toast.show(what); void list.reload(); }} />
    <ReasonSheet open={!!publishing} onClose={() => setPublishing(null)} title={`Publish “${publishing?.title ?? ''}”?`} body="Every coach can then use it. A published template cannot be edited; archive it and write a new one instead." confirmLabel="Publish"
      onConfirm={async (reason) => { const t = publishing; if (!t) return; await post(`/admin/checkin-templates/${t.id}/publish`, { reason }); toast.show('Published'); void list.reload(); }} />
    <ReasonSheet open={!!archiving} onClose={() => setArchiving(null)} destructive title={`Archive “${archiving?.title ?? ''}”?`} body="Coaches can no longer choose it. Check-ins already requested keep their questions; weekly schedules using it keep running until a coach changes them." confirmLabel="Archive"
      onConfirm={async (reason) => { const t = archiving; if (!t) return; await patch(`/admin/checkin-templates/${t.id}`, { status: 'archived', reason }); toast.show('Archived'); void list.reload(); }} />
  </Screen>{toast.float}</View>;
}

function LibrarySheet({ open, template, metrics, onClose, onSaved }: { open: boolean; template: Template | null; metrics: Metric[]; onClose: () => void; onSaved: (what: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setTitle(template?.title ?? ''); setDescription(template?.description ?? ''); setQuestions(template?.questions ?? [{ ...EMPTY_QUESTION }]); setErr('');
  }, [open, template]);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { title: title.trim(), description: description.trim(), questions };
      if (template) await patch(`/admin/checkin-templates/${template.id}`, body); else await post('/admin/checkin-templates', body);
      onSaved(template ? 'Draft saved' : 'Draft created; publish it when it is ready'); onClose();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={template ? 'Edit the draft' : 'Write a library template'} footer={<Row><Button title="Cancel" variant="ghost" onPress={onClose} disabled={busy} /><Button title="Save the draft" busy={busy} disabled={title.trim().length < 2 || !questionsReady(questions)} onPress={save} style={{ flex: 1 }} /></Row>}>
    <Field label="Title"><Input value={title} onChangeText={setTitle} maxLength={120} accessibilityLabel="Title" /></Field>
    <Field label="Description (optional)"><Input value={description} onChangeText={setDescription} maxLength={1000} multiline style={{ minHeight: 72, textAlignVertical: 'top' }} accessibilityLabel="Description" /></Field>
    <QuestionsEditor value={questions} onChange={setQuestions} metrics={metrics} />
    <P muted small>Plain coaching questions. A licensed clinical questionnaire is never presented as a screening tool here.</P>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

const st = {
  row: { paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.sm },
  title: { color: colors.text, fontSize: font.body, fontWeight: '700' as const, flex: 1 },
  meta: { color: colors.muted, fontSize: font.small },
  questions: { gap: space.xs, paddingLeft: space.sm },
  q: { color: colors.text, fontSize: font.small, lineHeight: 19 },
};
