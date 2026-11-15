/* The Learning tab on the coach's client record (the web's modules/learning/LearningTab.tsx, coach mode): the client's
   courses and progress. A coach always sees the courses coaches assigned, and the client's own choices and package
   courses only while the client shares with their coach (the server leaves those out otherwise). A coach assigns
   published courses with an optional note. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { fmtDate, label, relative } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/coach/moduleTabs';
import { Button, Card, Empty, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row } from '@/components/ui';
import { Sheet } from '@/components/workspace';
import { Bar, KvList, PickerField, StatusPill, TabState, useFlash, useRecordTick } from '@/components/coachModules/shared';
import { colors, font, space } from '@/theme';

type Progress = { completed: number; total: number; pct: number | null; lastActivityAt?: string | null };
type Row_ = { id: string; courseId: string; courseTitle: string; courseStatus: string; audience: string; source: string; status: string; assignedByName: string | null; assignedByMe: boolean; assignedNote: string | null; enrolledAt: string; completedAt: string | null; progress: Progress };
type Option = { id: string; title: string; audience: string; lessons: number; packages: Array<{ name: string }> };

const AUDIENCE: Record<string, string> = { all_members: 'Every member', packages: 'Members with a package', assigned_only: 'Assigned by a coach', coaches: 'Coaches (training)' };
const audienceLabel = (id?: string | null) => (id ? AUDIENCE[id] ?? label(id) : label(id));
const SOURCES: Record<string, string> = { self: 'Chosen by the member', coach_assigned: 'Assigned by a coach', package: 'With their package' };
const sourceLabel = (s?: string | null) => (s ? SOURCES[s] ?? label(s) : '—');

function EnrollmentPill({ status }: { status: string }) {
  if (status === 'active') return <Pill tone="warning">In progress</Pill>;
  if (status === 'withdrawn') return <Pill tone="info">Left</Pill>;
  return <StatusPill status={status} />;
}

export function LearningTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId } = ctx;
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const data = useLoad<{ items: Row_[]; sharing: boolean }>(`coach-learning-${memberId}`, () => get(`/coach/clients/${memberId}/learning`), [memberId, tick]);
  const [assigning, setAssigning] = useState(false);
  const { show, node: flash } = useFlash();
  const d = data.data;
  return <TabState loading={data.loading && !d} error={data.error} onRetry={data.reload}>
    {d ? <View style={{ gap: space.md }}>
      {flash}
      {!d.sharing ? <Notice kind="warning" title="Only the courses coaches assigned">The client has not turned on sharing with their coach. You see the courses a coach assigned them, with the progress they made from the assignment on, and nothing about courses they chose themselves.</Notice> : null}
      <Card>
        <Row between><View style={{ flex: 1 }}><Eyebrow>Learning</Eyebrow><H2>Courses and progress</H2></View><Button title="Assign a course" small onPress={() => setAssigning(true)} /></Row>
        {d.items.length ? d.items.map((e) => <View key={e.id} style={st.item}>
          <Row between><Text style={st.title}>{e.courseTitle}</Text><EnrollmentPill status={e.status} /></Row>
          <Text style={st.meta}>{`${audienceLabel(e.audience)}${e.courseStatus !== 'published' ? ` · course ${e.courseStatus}` : ''}`}</Text>
          {e.assignedNote ? <Text style={st.meta}>{`Note: ${e.assignedNote}`}</Text> : null}
          <KvList rows={[
            ['How', `${sourceLabel(e.source)}${e.assignedByName ? ` · ${e.assignedByMe ? 'by you' : `by ${e.assignedByName}`}` : ''}`],
            e.completedAt ? ['Completed', fmtDate(e.completedAt)] : null,
            ['Started', fmtDate(e.enrolledAt)],
            ['Last activity', e.progress.lastActivityAt ? relative(e.progress.lastActivityAt) : '—'],
          ]} />
          <Text style={st.meta}>{e.progress.total ? `${e.progress.completed} of ${e.progress.total} lessons` : 'No lessons yet'}</Text>
          {e.progress.pct !== null ? <Bar pct={e.progress.pct} tone="success" /> : null}
        </View>) : <Empty title="No courses" body={d.sharing ? 'Assign a course from the Bioptime team; the client is told and finds it on their Learn page.' : 'No course from a coach yet. Assign one; the client is told and finds it on their Learn page.'} />}
      </Card>
      {assigning ? <AssignSheet memberId={memberId} onClose={() => setAssigning(false)} onDone={() => { show('Course assigned: the client is told'); data.reload(); }} /> : null}
    </View> : null}
  </TabState>;
}

function AssignSheet({ memberId, onClose, onDone }: { memberId: string; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const list = useLoad<{ items: Option[] }>('coach-courses', () => get('/coach/courses'), []);
  const items = list.data?.items;
  const [courseId, setCourseId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const chosen = items?.find((c) => c.id === courseId);
  const send = async () => {
    setBusy(true); setErr('');
    try { await post(`/coach/clients/${memberId}/courses`, { courseId, note: note.trim() || null }); onDone(); onClose(); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return <Sheet open onClose={onClose} title="Assign a course" footer={<Row><Button title="Not now" variant="ghost" onPress={onClose} disabled={busy} /><Button title="Assign" busy={busy} disabled={!courseId} onPress={send} style={{ flex: 1 }} /></Row>}>
    {list.error ? <Notice kind="error">{list.error.message}</Notice> : !items ? <Loading /> : items.length ? <>
      <PickerField label="Course" hint="Published courses from the Bioptime team." value={courseId} placeholder="Choose a course" options={items.map((c) => ({ value: c.id, label: `${c.title} (${c.lessons} ${c.lessons === 1 ? 'lesson' : 'lessons'})` }))} onChange={setCourseId} />
      {chosen ? <View style={{ marginBottom: space.md }}><P small>{`${audienceLabel(chosen.audience)}${chosen.packages.length ? `: ${chosen.packages.map((p) => p.name).join(', ')}. Only a client who holds one of these can be assigned it.` : '.'}`}</P><Button title="Read it first" variant="ghost" small onPress={() => { onClose(); router.push(`/coach/courses/${chosen.id}`); }} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} /></View> : null}
      <Field label="Note for the client (optional)" hint="Shown with the course on their Learn page; not included in the notification."><Input value={note} onChangeText={setNote} maxLength={500} multiline style={{ minHeight: 64, textAlignVertical: 'top' }} /></Field>
      {err ? <Notice kind="error">{err}</Notice> : null}
    </> : <Empty title="No courses to assign" body="Courses appear here when the Bioptime team publishes them." />}
  </Sheet>;
}

const st = {
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  title: { color: colors.text, fontSize: font.body, fontWeight: '600' as const, flex: 1 },
  meta: { color: colors.muted, fontSize: font.small },
};
