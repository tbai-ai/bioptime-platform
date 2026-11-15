/* Coach › Learning › Training (the web's /coach/training, apps/dashboard/src/modules/learning/LearnHome.tsx
   mode="training"): the coach's own training courses from the Bioptime team (audience "coaches"): the ones started,
   with their progress, and the ones they can start. GET /coach/training; "Start this course" →
   POST /coach/training/:id/enroll → toast "Enrolled" → the first lesson. Flag: learning. */
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { accessLabel, enrollmentPill, lessonsText, MODES, type CourseCard, type TrainingHome } from '@/lib/coach/learning';
import { Button, Card, ErrorBox, Eyebrow, H2, Loading, Notice, P, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState } from '@/components/workspace';
import { NotificationBell, RoleGate } from '@/components/workspaceShell';
import { useToast } from '@/components/adminA/toast';
import { ModuleGate, useRefreshOnFocus } from '@/components/coachWorkouts/parts';
import { ProgressBar } from '@/components/coachLearning/parts';
import { Enter, MotionCard } from '@/motion';
import { colors, font, radius, space } from '@/theme';

const TITLE = 'Training';
const m = MODES.training;

export default function TrainingScreen() {
  return <>
    <Stack.Screen options={{ title: TITLE, headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="learning"><Body /></ModuleGate></RoleGate>
  </>;
}

function Body() {
  const data = useLoad<TrainingHome>('coach.training', () => get('/coach/training'), []);
  const toast = useToast();
  useRefreshOnFocus(data.reload); // back from a course or a lesson: the progress just made
  const d = data.data;
  return <Screen refreshing={data.loading} onRefresh={data.reload}>
    <Enter><Title sub="Courses for coaches from the Bioptime team. Your progress is saved as you mark each lesson complete.">{TITLE}</Title></Enter>
    <StaleBanner at={data.stale} />
    <ErrorBox error={data.error} onRetry={data.reload} />
    {toast.node}
    {!d ? (data.error ? null : <Loading />) : <>
      <MotionCard index={1} pressable={false}><Card>
        <Eyebrow>Your training</Eyebrow><H2>In progress and done</H2>
        {d.enrolled.length ? d.enrolled.map((c) => <Enrolled key={c.id} c={c} />)
          : <EmptyState title="No training started" body={d.available.length ? 'Start one of the courses below.' : 'Training courses appear here when the Bioptime team publishes them.'} icon="book-outline" />}
      </Card></MotionCard>
      {d.available.length ? <MotionCard index={2} pressable={false}><Card>
        <Eyebrow>Available to you</Eyebrow><H2>Training you can start</H2>
        {d.available.map((c) => <Available key={c.id} c={c} onJoined={() => { toast.show('Enrolled'); void data.reload(); }} onFailed={(e) => toast.show(errorText(e), 'error')} />)}
      </Card></MotionCard> : null}
    </>}
  </Screen>;
}

function CourseLink({ c }: { c: CourseCard }) {
  const router = useRouter();
  return <Pressable accessibilityRole="link" accessibilityLabel={c.title} onPress={() => router.push(`${m.base}/${c.id}`)} style={{ flex: 1 }}><Text style={styles.title}>{c.title}</Text></Pressable>;
}

function Enrolled({ c }: { c: CourseCard }) {
  const router = useRouter();
  const e = c.enrollment!;
  const pill = enrollmentPill(e.status);
  return <View style={styles.tile}>
    <Row between><CourseLink c={c} /><Pill tone={pill.tone}>{pill.label}</Pill></Row>
    {c.locked ? <Notice kind="warning">Your access ended with your package. Your progress is kept.</Notice> : <ProgressBar p={e.progress} />}
    <P muted small>{`${accessLabel(c.access)}${e.assignedByName ? ` · assigned by ${e.assignedByName}` : ''}${e.completedAt ? ` · completed ${fmtDate(e.completedAt)}` : ` · started ${fmtDate(e.enrolledAt)}`}`}</P>
    {e.assignedNote ? <P small>{`“${e.assignedNote}”`}</P> : null}
    {!c.locked ? <Row>
      {c.nextLessonId ? <Button title={e.progress.completed ? 'Continue' : 'Start'} small onPress={() => router.push(`${m.base}/${c.id}/${c.nextLessonId}`)} /> : null}
      <Button title="Lessons" variant="secondary" small onPress={() => router.push(`${m.base}/${c.id}`)} />
    </Row> : null}
  </View>;
}

function Available({ c, onJoined, onFailed }: { c: CourseCard; onJoined: () => void; onFailed: (e: unknown) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    try { const r = await post<{ nextLessonId?: string | null }>(m.enroll!(c.id)); onJoined(); if (r?.nextLessonId) router.push(`${m.base}/${c.id}/${r.nextLessonId}?enrolled=1`); }
    catch (e) { onFailed(e); } finally { setBusy(false); }
  };
  return <View style={styles.tile}>
    <CourseLink c={c} />
    {c.summary ? <P small>{c.summary}</P> : null}
    <P muted small>{`${lessonsText(c)} · ${accessLabel(c.access)}`}</P>
    <Row><Button title="Start this course" small busy={busy} onPress={join} /><Button title="See the lessons" variant="secondary" small onPress={() => router.push(`${m.base}/${c.id}`)} /></Row>
  </View>;
}

const styles = StyleSheet.create({
  tile: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, gap: space.sm, backgroundColor: colors.base, marginTop: space.sm },
  title: { color: colors.text, fontSize: font.body, fontWeight: '700' },
});
