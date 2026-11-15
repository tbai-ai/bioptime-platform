/* The Workouts tab on the coach's client record (the web's modules/workouts/WorkoutsTab.tsx): the client's workout
   programmes and sessions. The coach sees the schedule and statuses always, and the set logs, effort, duration and
   notes only while the client shares health data (the server leaves them out otherwise). A session of a client who
   does not share health data offers Open, not Review. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/coach/moduleTabs';
import { Button, Card, Empty, Eyebrow, Field, H2, Input, Loading, Notice, P, Pill, Row } from '@/components/ui';
import { Sheet } from '@/components/workspace';
import { KvList, StatusPill, TabState, Tile, useFlash, useRecordTick } from '@/components/coachModules/shared';
import { colors, font, space } from '@/theme';

type Program = { id: string; title: string; coachName: string; status: string; draft: unknown; currentVersion: number; startDate: string | null; sessions: { completed: number; partial: number; skipped: number; scheduled: number } };
type Session = { id: string; scheduledDate: string; week: number; day: number; title: string; programTitle: string; status: string; setsDone: number; setsPrescribed: number; rpe: number | null; durationMinutes: number | null; feedbackCount: number };
type Payload = { today: string; healthShared?: boolean; programs: Program[]; sessions: Session[] };
type Detail = { id: string; title: string; programTitle: string; week: number; scheduledDate: string; completedAt: string | null; status: string; today?: string; healthWithheld: boolean; rpe: number | null; durationMinutes: number | null; memberNote: string | null; skipReason: string | null; items: Array<{ id: string; exerciseName: string; sets: number; reps?: string | null; durationSeconds?: number | null; restSeconds?: number | null; logs?: Array<{ setNumber: number; repsDone: number | null; durationSeconds: number | null; loadKg: number | null; completed: boolean }> }>; feedback: Array<{ id: string; body: string; coachName: string; createdAt: string }> };

const fmtDay = (date?: string | null) => (date ? fmtDate(`${date}T06:30:00.000Z`) : '—');
const seconds = (s: number) => (s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const prescription = (i: { sets: number; reps?: string | null; durationSeconds?: number | null; restSeconds?: number | null }) => `${i.sets} × ${i.reps ? i.reps : i.durationSeconds ? seconds(i.durationSeconds) : ''}${i.restSeconds ? ` · rest ${seconds(i.restSeconds)}` : ''}`;

function SessionPill({ status, overdue }: { status: string; overdue?: boolean }) {
  if (status === 'scheduled' && overdue) return <Pill tone="warning">Not logged</Pill>;
  if (status === 'partial') return <Pill tone="warning">Partly done</Pill>;
  return <StatusPill status={status} />;
}

export function WorkoutsTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId } = ctx;
  const router = useRouter();
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const data = useLoad<Payload>(`coach-workouts-${memberId}`, () => get(`/coach/clients/${memberId}/workouts`), [memberId, tick]);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const { show, node: flash } = useFlash();
  const d = data.data;
  const programs = d?.programs ?? [];
  const sessions = d?.sessions ?? [];
  const health = d?.healthShared !== false;
  const shown = all ? sessions : sessions.slice(0, 30);
  return <TabState loading={data.loading && !d} error={data.error} onRetry={data.reload}>
    {d ? <View style={{ gap: space.md }}>
      {flash}
      {!health ? <Notice kind="warning" title="Workout logs not shared">You see the schedule and whether each session was done. Sets, effort, duration and notes appear once the client turns on sharing with their coach in the app; feedback needs the same.</Notice> : null}
      <Card>
        <Row between><View style={{ flex: 1 }}><Eyebrow>Programmes</Eyebrow><H2>Workout programmes</H2></View><Button title="New workout programme" small onPress={() => router.push(`/coach/workout-programs/new?member=${memberId}`)} /></Row>
        {programs.length ? programs.map((p) => <View key={p.id} style={st.item}>
          <Text style={st.itemTitle}>{p.title}</Text><Text style={st.itemMeta}>{`by ${p.coachName}`}</Text>
          <Row><StatusPill status={p.status} />{p.draft && p.status === 'published' ? <Text style={st.itemMeta}>draft revision</Text> : null}</Row>
          <KvList rows={[['Version', String(p.currentVersion)], ['Starts', fmtDay(p.startDate)], ['Sessions', `${p.sessions.completed + p.sessions.partial} done · ${p.sessions.skipped} skipped · ${p.sessions.scheduled} to come`]]} />
          <Button title={p.status === 'archived' ? 'View' : 'Edit'} variant="secondary" small onPress={() => router.push(`/coach/workout-programs/${p.id}`)} style={{ alignSelf: 'flex-start' }} />
        </View>) : <Empty title="No workout programme" body="Write one from the exercise library templates; the client gets the sessions once you publish it." />}
      </Card>
      <Card>
        <Eyebrow>Sessions</Eyebrow><H2>Schedule and logs</H2>
        {sessions.length ? shown.map((s) => <View key={s.id} style={st.item}>
          <Row between><Text style={st.itemTitle}>{s.title}</Text><SessionPill status={s.status} overdue={s.scheduledDate < d.today} /></Row>
          <Text style={st.itemMeta}>{`${fmtDay(s.scheduledDate)} · week ${s.week} · day ${s.day} · ${s.programTitle}`}</Text>
          <Text style={st.itemMeta}>{`${health ? `Sets done ${s.status === 'scheduled' || s.status === 'skipped' ? '—' : `${s.setsDone} of ${s.setsPrescribed}`} · Effort ${s.rpe ? `${s.rpe}/10` : '—'} · Minutes ${s.durationMinutes ?? '—'} · ` : ''}Feedback ${s.feedbackCount || '—'}`}</Text>
          {s.status !== 'scheduled' ? <Button title={health ? 'Review' : 'Open'} variant="ghost" small onPress={() => setOpen(s.id)} style={{ alignSelf: 'flex-start' }} /> : null}
        </View>) : <Empty title="No sessions yet" body="Sessions appear when a programme is published." />}
        {sessions.length > 30 && !all ? <Button title={`Show all ${sessions.length}`} variant="secondary" small onPress={() => setAll(true)} style={{ alignSelf: 'flex-start' }} /> : null}
      </Card>
      {open ? <SessionSheet id={open} onClose={() => setOpen(null)} onChanged={data.reload} show={show} /> : null}
    </View> : null}
  </TabState>;
}

function SessionSheet({ id, onClose, onChanged, show }: { id: string; onClose: () => void; onChanged: () => void; show: (t: string, k?: 'success' | 'error') => void }) {
  const s = useLoad<Detail>(`coach-workout-${id}`, () => get(`/coach/workouts/${id}`), [id]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState('');
  const d = s.data;
  const send = async () => { setBusy(true); setErr(''); try { await post(`/coach/workouts/${id}/feedback`, { body: body.trim() }); setBody(''); setSent('Feedback sent: the client is told'); show('Feedback sent: the client is told'); s.reload(); onChanged(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  return <Sheet open onClose={onClose} title={d ? d.title : 'Session'} footer={<Button title="Close" variant="secondary" onPress={onClose} />}>
    {s.error ? <Notice kind="error">{s.error.message}</Notice> : !d ? <Loading /> : <View style={{ gap: space.sm }}>
      <Row><Text style={st.itemMeta}>{`${d.programTitle} · week ${d.week} · ${fmtDay(d.scheduledDate)}${d.completedAt ? ` · logged ${fmtDateTime(d.completedAt)}` : ''}`}</Text><SessionPill status={d.status} overdue={!!d.today && d.scheduledDate < d.today} /></Row>
      {d.healthWithheld ? <Notice kind="warning">Sets, effort, duration and notes are not shared with you: the client has not turned on sharing with their coach, and feedback needs the same.</Notice> : <>
        <KvList rows={[['Effort', d.rpe ? `${d.rpe}/10 (self-rated)` : 'Not rated'], ['Duration', d.durationMinutes ? `${d.durationMinutes} min` : '—'], d.memberNote ? ['Client’s note', d.memberNote] : null, d.skipReason ? ['Why skipped', d.skipReason] : null]} />
        {d.items.map((it) => <Tile key={it.id}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{it.exerciseName} <Text style={{ color: colors.muted, fontWeight: '400', fontSize: font.small }}>{prescription(it)}</Text></Text>
          {(it.logs ?? []).length ? <Text style={{ color: colors.text, fontSize: font.small }}>{(it.logs ?? []).map((l) => `Set ${l.setNumber}: ${[l.repsDone != null ? `${l.repsDone} reps` : '', l.durationSeconds != null ? `${l.durationSeconds} s` : '', l.loadKg != null ? `${l.loadKg} kg` : ''].filter(Boolean).join(', ') || 'done'}${l.completed ? '' : ' (not done)'}`).join(' · ')}</Text> : <Text style={st.itemMeta}>No sets logged</Text>}
        </Tile>)}
      </>}
      {(d.feedback ?? []).length ? <View style={{ gap: space.xs }}>{d.feedback.map((f) => <View key={f.id}><P small>{f.body}</P><Text style={st.itemMeta}>{`${f.coachName} · ${fmtDate(f.createdAt)}`}</Text></View>)}</View> : null}
      {!d.healthWithheld ? <View>
        <Field label="Feedback for the client" hint="The client reads it with this session and is notified."><Input value={body} onChangeText={setBody} maxLength={2000} multiline style={{ minHeight: 72, textAlignVertical: 'top' }} /></Field>
        {err ? <Notice kind="error">{err}</Notice> : sent ? <Notice kind="success">{sent}</Notice> : null}
        <Button title="Send feedback" small busy={busy} disabled={body.trim().length < 2} onPress={send} style={{ alignSelf: 'flex-start' }} />
      </View> : null}
    </View>}
  </Sheet>;
}

export { label as kindLabel };

const st = {
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  itemTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' as const, flex: 1 },
  itemMeta: { color: colors.muted, fontSize: font.small },
};
