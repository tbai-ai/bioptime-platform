/* Coach › Libraries › Check-in templates (the web's /coach/checkin-templates, apps/dashboard/src/modules/progress/CheckinTemplates.tsx
   in coach mode): the published library and the coach's own templates, each row opening its questions; "Write your own"
   writes a template usable at once by this coach alone (POST /coach/checkin-templates, the web's TemplateDialog). No
   edit, publish or archive for a coach: the API has no such coach route; those are the administrator's.
   From an opened template the coach can also use it with one of their clients, with the web's weekly check-in card
   (CoachGoalsTab.tsx ScheduleCard) and its endpoints: POST /coach/clients/:id/checkin-schedules { templateId, weekday }
   ("Set weekly" / "Replace weekly") and POST /coach/clients/:id/checkins { templateId } ("Ask for one now"); the
   client's current schedule is read from GET /coach/clients/:id/checkin-schedules. Shown while the progress module is on. */
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { fieldErrorsOf, libraryPill, plural, useFlash } from '@/lib/coach/libraries/shared';
import { EMPTY_QUESTION, questionLine, questionsReady, scheduleLine, WEEKDAYS, type Question, type Schedule, type Template, type TemplateList } from '@/lib/coach/libraries/progress';
import { Button, ErrorBox, Field, Input, Loading, Notice, P, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, RecordList, RecordRow, Sheet } from '@/components/workspace';
import { NotificationBell, notifyBadges, RoleGate } from '@/components/workspaceShell';
import { ModuleGate } from '@/components/coachLibraries/ModuleGate';
import { QuestionsEditor } from '@/components/coachLibraries/QuestionsEditor';
import { SelectField } from '@/components/coachLibraries/SelectField';
import { Enter } from '@/motion';
import { colors, space } from '@/theme';

const TITLE = 'Check-in templates';
type Client = { id: string; name: string; memberCode?: string | null };

export default function CheckinTemplatesScreen() {
  return <>
    <Stack.Screen options={{ title: TITLE, headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="progress" title={TITLE}><Body /></ModuleGate></RoleGate>
  </>;
}

function Body() {
  const list = useLoad<TemplateList>('coach.checkin-templates', () => get('/coach/checkin-templates'), []);
  const [open, setOpen] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [using, setUsing] = useState<Template | null>(null);
  const { flash, ok, clear } = useFlash();
  const d = list.data;
  const items = d?.items ?? [];
  const metrics = d?.metrics ?? [];
  return <Screen refreshing={list.loading} onRefresh={list.reload}>
    <Enter><Title sub="The published library and your own templates. Yours are usable at once, by you alone.">{TITLE}</Title></Enter>
    <Enter index={1}><Row><Button title="Write your own" small onPress={() => { clear(); setWriting(true); }} /></Row></Enter>
    {flash ? <Notice kind={flash.kind}>{flash.text}</Notice> : null}
    <StaleBanner at={list.stale} />
    <ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !d ? <Loading /> : d ? <Enter index={2}><View style={{ gap: space.md }}>
      {items.length ? <RecordList title="Check-in templates">
        {items.map((t) => {
          const pill = libraryPill(t.status);
          const kind = t.scope === 'library' ? 'Library' : `${t.createdByName}’s own`;
          const expanded = open === t.id;
          return <View key={t.id}>
            <RecordRow title={t.title} meta={`${kind} · ${plural(t.questions.length, 'question')} · updated ${fmtDate(t.updatedAt)}`} pills={[{ label: pill.label, tone: pill.tone }]} selected={expanded} onPress={() => setOpen(expanded ? null : t.id)} />
            {expanded ? <View style={{ paddingVertical: space.sm, paddingLeft: space.md, gap: space.xs, borderBottomWidth: 1, borderBottomColor: colors.border }} accessibilityLabel={`Questions of ${t.title}`}>
              {t.description ? <P muted small>{t.description}</P> : null}
              {t.questions.map((q, i) => <P key={q.key} small>{`${i + 1}. ${questionLine(q, metrics)}`}</P>)}
              {t.status === 'published' ? <Row style={{ marginTop: space.xs }}><Button title="Use with a client" variant="secondary" small onPress={() => { clear(); setUsing(t); }} /></Row> : null}
            </View> : null}
          </View>;
        })}
      </RecordList> : <EmptyState title="No templates here" body="Write your own, or ask an administrator to publish one to the library." icon="clipboard-outline" />}
      {items.length ? <P muted small>Select a row to see its questions. Answers tied to a measure are logged as the member’s self-reported values.</P> : null}
    </View></Enter> : null}
    <TemplateSheet open={writing} metrics={metrics} onClose={() => setWriting(false)} onSaved={() => { setWriting(false); ok('Template saved; only you can use it'); void list.reload(); }} />
    <UseSheet template={using} onClose={() => setUsing(null)} onDone={(text) => { setUsing(null); ok(text); notifyBadges(); }} />
  </Screen>;
}

/** The web's TemplateDialog (apps/dashboard/src/modules/progress/CoachGoalsTab.tsx:89-107): a coach's own template. */
function TemplateSheet({ open, metrics, onClose, onSaved }: { open: boolean; metrics: TemplateList['metrics']; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<Question[]>([{ ...EMPTY_QUESTION }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const reset = () => { setTitle(''); setQuestions([{ ...EMPTY_QUESTION }]); setErr(null); setErrs({}); };
  const save = async () => {
    setBusy(true); setErr(null); setErrs({});
    try { await post('/coach/checkin-templates', { title: title.trim(), questions }); onSaved(); reset(); }
    catch (e) { setErrs(fieldErrorsOf(e)); setErr(errorText(e)); }
    finally { setBusy(false); }
  };
  const ready = title.trim().length >= 2 && questionsReady(questions);
  return <Sheet open={open} onClose={onClose} title="Write a check-in template" footer={<Row><Button title="Cancel" variant="secondary" small onPress={onClose} disabled={busy} /><Button title="Save" small busy={busy} disabled={!ready} onPress={save} /></Row>}>
    <Field label="Title" error={errs.title}><Input value={title} onChangeText={setTitle} maxLength={120} accessibilityLabel="Title" /></Field>
    <QuestionsEditor value={questions} onChange={setQuestions} metrics={metrics} />
    {errs.questions ? <Notice kind="error">{errs.questions}</Notice> : null}
    <P muted small>Plain coaching questions. A licensed clinical questionnaire is never presented as a screening tool here.</P>
    {err ? <Notice kind="error">{err}</Notice> : null}
  </Sheet>;
}

/** A published template used with one client: the web's weekly check-in card (ScheduleCard) with the template already
 *  chosen. The client's active schedule is shown first, so "Replace weekly" says what it replaces. */
function UseSheet({ template, onClose, onDone }: { template: Template | null; onClose: () => void; onDone: (toast: string) => void }) {
  const router = useRouter();
  const open = !!template;
  const clients = useLoad<{ items: Client[] } | null>(open ? 'coach.clients.pick' : null, () => (open ? get('/coach/clients?limit=100') : Promise.resolve(null)), [open]);
  const [member, setMember] = useState('');
  const [weekday, setWeekday] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const schedules = useLoad<{ items: Schedule[] } | null>(null, () => (member ? get(`/coach/clients/${member}/checkin-schedules`) : Promise.resolve(null)), [member]);
  useEffect(() => { if (!open) { setMember(''); setWeekday('1'); setErr(null); setBusy(false); } }, [open]);
  const active = schedules.data?.items.find((s) => s.active);
  const run = async (fn: () => Promise<unknown>, toast: string) => {
    if (!member) { setErr('Choose the client first'); return; }
    setBusy(true); setErr(null);
    try { await fn(); onDone(toast); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const t = template;
  return <Sheet open={open} onClose={onClose} title="Use with a client">
    {t ? <>
      <P small>{`“${t.title}” · ${plural(t.questions.length, 'question')}`}</P>
      <ErrorBox error={clients.error} onRetry={clients.reload} />
      <SelectField label="Client" value={member} placeholder="Choose a client" searchable options={(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.name, detail: c.memberCode ?? undefined }))} onChange={(v) => { setMember(v); setErr(null); }} />
      {member ? (schedules.loading && !schedules.data ? <Loading /> : schedules.error ? <Notice kind="error">{errorText(schedules.error)}</Notice>
        : <P small>{active ? scheduleLine(active, fmtDate(active.createdAt)) : 'No weekly check-in yet.'}</P>) : null}
      <SelectField label="Every" value={weekday} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} onChange={setWeekday} />
      <Row>
        <Button title={active ? 'Replace weekly' : 'Set weekly'} small busy={busy} disabled={!member} onPress={() => run(() => post(`/coach/clients/${member}/checkin-schedules`, { templateId: t.id, weekday: Number(weekday) }), active ? 'Weekly check-in replaced' : 'Weekly check-in set')} />
        <Button title="Ask for one now" variant="secondary" small busy={busy} disabled={!member} onPress={() => run(() => post(`/coach/clients/${member}/checkins`, { templateId: t.id }), 'Asked; the member was told')} />
      </Row>
      {member ? <Row><Button title="Open the client’s check-ins" variant="ghost" small onPress={() => { onClose(); router.push(`/coach/clients/${member}?tab=goals`); }} /></Row> : null}
      {err ? <Notice kind="error">{err}</Notice> : null}
    </> : null}
  </Sheet>;
}
