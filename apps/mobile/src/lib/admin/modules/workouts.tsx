/* The Workouts tab on the administrator's member record (the web's modules/workouts/WorkoutsTab.tsx in admin mode,
   members.manage): the member's programmes and sessions, read only; a session opens with its sets, effort, duration,
   notes and the coach's feedback (GET /admin/members/:id/workouts, GET /admin/workouts/:id, both audited). */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { get } from '@/lib/api';
import { fmtDate, fmtDateTime, label } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import type { RecordTabContext } from '@/lib/admin/moduleTabs';
import { Button, Card, Empty, Eyebrow, H2, Loading, Notice, P, Pill, Row, StaleBanner } from '@/components/ui';
import { Sheet } from '@/components/workspace';
import { KvList, StatusPill, TabState, Tile, useRecordTick } from '@/components/coachModules/shared';
import { colors, font, space } from '@/theme';

type Program = { id: string; title: string; coachName: string; status: string; draft: unknown; currentVersion: number; startDate: string | null; sessions: { completed: number; partial: number; skipped: number; scheduled: number } };
type Session = { id: string; scheduledDate: string; week: number; day: number; title: string; programTitle: string; status: string; setsDone: number; setsPrescribed: number; rpe: number | null; durationMinutes: number | null; feedbackCount: number };
type Payload = { today: string; healthShared?: boolean; programs: Program[]; sessions: Session[] };
type Detail = { id: string; today?: string; title: string; programTitle: string; week: number; scheduledDate: string; completedAt: string | null; status: string; healthWithheld: boolean; rpe: number | null; durationMinutes: number | null; memberNote: string | null; skipReason: string | null; items: Array<{ id: string; exerciseName: string; sets: number; reps?: string | null; durationSeconds?: number | null; restSeconds?: number | null; logs?: Array<{ setNumber: number; repsDone: number | null; durationSeconds: number | null; loadKg: number | null; completed: boolean }> }>; feedback: Array<{ id: string; body: string; coachName: string; createdAt: string }> };

const fmtDay = (date?: string | null) => (date ? fmtDate(`${date}T06:30:00.000Z`) : '—');
const seconds = (s: number) => (s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const prescription = (i: { sets: number; reps?: string | null; durationSeconds?: number | null; restSeconds?: number | null }) => `${i.sets} × ${i.reps ? i.reps : i.durationSeconds ? seconds(i.durationSeconds) : ''}${i.restSeconds ? ` · rest ${seconds(i.restSeconds)}` : ''}`;

/** A session's status; a scheduled session whose date has passed reads "Not logged" (the web's SessionPill). */
function SessionPill({ status, overdue }: { status: string; overdue?: boolean }) {
  if (status === 'scheduled' && overdue) return <Pill tone="warning">Not logged</Pill>;
  if (status === 'partial') return <Pill tone="warning">Partly done</Pill>;
  return <StatusPill status={status === 'skipped' ? 'cancelled' : status}>{label(status)}</StatusPill>;
}

export function AdminWorkoutsTab({ ctx }: { ctx: RecordTabContext }) {
  const { memberId } = ctx;
  const tick = useRecordTick(ctx.record); // the record screen's pull to refresh reloads this tab's data too
  const data = useLoad<Payload>(`admin-workouts-${memberId}`, () => get(`/admin/members/${memberId}/workouts`), [memberId, tick]);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const d = data.data;
  const programs = d?.programs ?? [];
  const sessions = d?.sessions ?? [];
  const shown = all ? sessions : sessions.slice(0, 30);
  const health = d?.healthShared !== false;
  return <TabState loading={data.loading && !d} error={data.error} onRetry={data.reload}>
    {d ? <View style={{ gap: space.md }}>
      <StaleBanner at={data.stale} />
      {!health ? <Notice kind="warning" title="Workout logs not shared">You see the schedule and whether each session was done. Sets, effort, duration and notes appear once the client turns on sharing with their coach in the app; feedback needs the same.</Notice> : null}
      <Card>
        <Eyebrow>Programmes</Eyebrow><H2>Workout programmes</H2>
        {programs.length ? programs.map((p) => <View key={p.id} style={st.item}>
          <Row between><Text style={st.title}>{p.title}</Text><StatusPill status={p.status} /></Row>
          <Text style={st.meta}>{`by ${p.coachName}${p.draft && p.status === 'published' ? ' · draft revision' : ''}`}</Text>
          <KvList rows={[['Version', String(p.currentVersion)], ['Starts', fmtDay(p.startDate)], ['Sessions', `${p.sessions.completed + p.sessions.partial} done · ${p.sessions.skipped} skipped · ${p.sessions.scheduled} to come`]]} />
        </View>) : <Empty title="No workout programme" body="The client’s coach writes one." />}
      </Card>
      <Card>
        <Eyebrow>Sessions</Eyebrow><H2>Schedule and logs</H2>
        {sessions.length ? shown.map((s) => <View key={s.id} style={st.item}>
          <Row between><Text style={st.title}>{s.title}</Text><SessionPill status={s.status} overdue={s.scheduledDate < d.today} /></Row>
          <Text style={st.meta}>{`${fmtDay(s.scheduledDate)} · week ${s.week} · day ${s.day} · ${s.programTitle}`}</Text>
          <Text style={st.meta}>{`${health ? `Sets done ${s.status === 'scheduled' || s.status === 'skipped' ? '—' : `${s.setsDone} of ${s.setsPrescribed}`} · Effort ${s.rpe ? `${s.rpe}/10` : '—'} · Minutes ${s.durationMinutes ?? '—'} · ` : ''}Feedback ${s.feedbackCount || '—'}`}</Text>
          {s.status !== 'scheduled' ? <Button title="View" variant="ghost" small onPress={() => setOpen(s.id)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} /> : null}
        </View>) : <Empty title="No sessions yet" body="Sessions appear when a programme is published." />}
        {sessions.length > 30 && !all ? <Button title={`Show all ${sessions.length}`} variant="ghost" small onPress={() => setAll(true)} style={{ alignSelf: 'flex-start' }} /> : null}
      </Card>
      {open ? <SessionSheet id={open} onClose={() => setOpen(null)} /> : null}
    </View> : null}
  </TabState>;
}

function SessionSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const view = useLoad<Detail>(null, () => get(`/admin/workouts/${id}`), [id]);
  const s = view.data;
  return <Sheet open onClose={onClose} title={s?.title ?? 'Session'} footer={<Button title="Close" variant="secondary" onPress={onClose} />}>
    {view.error ? <Notice kind="error">{view.error.message}</Notice> : !s ? <Loading /> : <View style={{ gap: space.md }}>
      <Row><Text style={st.meta}>{`${s.programTitle} · week ${s.week} · ${fmtDay(s.scheduledDate)}${s.completedAt ? ` · logged ${fmtDateTime(s.completedAt)}` : ''}`}</Text><SessionPill status={s.status} overdue={!!s.today && s.scheduledDate < s.today} /></Row>
      {s.healthWithheld ? <Notice kind="warning">Sets, effort, duration and notes are not shared with you: the client has not turned on sharing with their coach, and feedback needs the same.</Notice> : <KvList rows={[['Effort', s.rpe ? `${s.rpe}/10 (self-rated)` : 'Not rated'], ['Duration', s.durationMinutes ? `${s.durationMinutes} min` : '—'], s.memberNote ? ['Client’s note', s.memberNote] : null, s.skipReason ? ['Why skipped', s.skipReason] : null]} />}
      {!s.healthWithheld ? s.items.map((i) => <Tile key={i.id}>
        <Text style={st.title}>{i.exerciseName}</Text><Text style={st.meta}>{prescription(i)}</Text>
        <Text style={st.meta}>{i.logs?.length ? i.logs.map((l) => `Set ${l.setNumber}: ${[l.repsDone != null ? `${l.repsDone} reps` : '', l.durationSeconds != null ? `${l.durationSeconds} s` : '', l.loadKg != null ? `${l.loadKg} kg` : ''].filter(Boolean).join(', ') || 'done'}${l.completed ? '' : ' (not done)'}`).join(' · ') : 'No sets logged'}</Text>
      </Tile>) : null}
      {s.feedback.length ? <View>{s.feedback.map((f) => <View key={f.id} style={st.item}><P small>{f.body}</P><Text style={st.meta}>{`${f.coachName} · ${fmtDate(f.createdAt)}`}</Text></View>)}</View> : null}
    </View>}
  </Sheet>;
}

const st = StyleSheet.create({
  item: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.xs },
  title: { color: colors.text, fontSize: font.body, fontWeight: '600', flex: 1 },
  meta: { color: colors.muted, fontSize: font.small },
});
