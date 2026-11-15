/* The coach's course and lesson screens, each shared by two routes (the web's CourseView and LessonView with a mode;
   apps/dashboard/src/modules/learning/CourseView.tsx, LessonView.tsx):
   - training: the coach's own training (/coach/training/:courseId[/:lessonId]): GET /coach/training/:id,
     GET /coach/lessons/:id, POST /coach/training/:id/enroll ("Start this course"), POST /coach/lessons/:id/start (once,
     when a lesson is opened while enrolled), POST /coach/lessons/:id/complete ("Mark as complete");
   - preview: a member course read before assigning it (/coach/courses/:courseId[/:lessonId]): GET /coach/courses/:id,
     GET /coach/lessons/:id; read only, no progress pills, nothing marked complete. The course can be assigned to a client
     from here (components/coachLearning/AssignSheet: the same request as the client's Learning tab).
   The web's two columns stack in their order: lessons, then the cover, the progress card and the video note. */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { get, post, errorText } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { accessLabel, enrollmentPill, lessonMeta, lessonsText, MODES, type Course, type LearnMode, type Lesson } from '@/lib/coach/learning';
import { Button, Card, ErrorBox, Eyebrow, H2, Loading, Notice, P, Pill, Row, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, KeyValue, type KeyValueRow } from '@/components/workspace';
import { useToast } from '@/components/adminA/toast';
import { BackLink, InfoRow, useRefreshOnFocus } from '@/components/coachWorkouts/parts';
import { Enter, MotionCard } from '@/motion';
import { colors, space } from '@/theme';
import { AssignSheet } from './AssignSheet';
import { CourseCover, LessonBody, ProgressBar } from './parts';

export function CourseView({ mode, courseId }: { mode: LearnMode; courseId: string }) {
  const m = MODES[mode];
  const router = useRouter();
  const toast = useToast();
  const data = useLoad<Course>(`coach.learning.${mode}.course.${courseId}`, () => get(m.course(courseId)), [courseId, mode]);
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);
  useRefreshOnFocus(data.reload); // back from a lesson: the progress just made
  const c = data.data;
  const preview = mode === 'preview';
  const back = <BackLink title={`← ${m.listLabel}`} onPress={() => router.push(m.base)} />;
  if (!c) return <Screen refreshing={data.loading} onRefresh={data.reload}>{back}{data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : <Loading />}</Screen>;
  const e = c.enrollment ?? null;
  const join = async () => {
    if (!m.enroll) return;
    setBusy(true);
    try { const r = await post<{ nextLessonId?: string | null }>(m.enroll(c.id)); toast.show('Enrolled'); void data.reload(); if (r?.nextLessonId) router.push(`${m.base}/${c.id}/${r.nextLessonId}?enrolled=1`); }
    catch (ex) { toast.show(errorText(ex), 'error'); } finally { setBusy(false); }
  };
  const pill = e ? enrollmentPill(e.status) : null;
  const kv: KeyValueRow[] = e ? [['Access', accessLabel(c.access)], ...(e.assignedByName ? [['Assigned by', e.assignedByName] as KeyValueRow] : []), ...(e.assignedNote ? [['Note', e.assignedNote] as KeyValueRow] : []), ['Started', fmtDate(e.enrolledAt)], ...(e.completedAt ? [['Completed', fmtDate(e.completedAt)] as KeyValueRow] : [])] : [];
  const hasVideo = c.modules.some((mod) => mod.lessons.some((l) => l.kind === 'video'));
  return <Screen refreshing={data.loading} onRefresh={data.reload}>
    <Enter><View>{back}<Title sub={c.summary || undefined}>{c.title}</Title></View></Enter>
    <Enter index={1}><Row>
      {!preview && e && c.nextLessonId ? <Button title={e.progress.completed ? 'Continue' : 'Start'} small onPress={() => router.push(`${m.base}/${c.id}/${c.nextLessonId}`)} /> : null}
      {!preview && !e && !c.archived ? <Button title="Start this course" small busy={busy} onPress={join} /> : null}
      {preview && c.nextLessonId ? <Button title="Read the first lesson" variant="secondary" small onPress={() => router.push(`${m.base}/${c.id}/${c.nextLessonId}`)} /> : null}
      {preview ? <Button title="Assign to a client" small onPress={() => setAssigning(true)} /> : null}
    </Row></Enter>
    <StaleBanner at={data.stale} />
    {toast.node}
    {c.archived ? <Notice kind="info">This course has been retired. You can still read it and finish it.</Notice> : null}
    {preview ? <Notice kind="info">{`You are reading this course as its learners see it. Assign it from a client’s record, on the Learning tab.${c.packages?.length ? ` It comes with: ${c.packages.map((p) => p.name).join(', ')}.` : ''}`}</Notice> : null}
    <MotionCard index={2} pressable={false}><Card>
      <Eyebrow>{lessonsText(c)}</Eyebrow><H2>Lessons</H2>
      {c.modules.length ? c.modules.map((mod) => <View key={mod.id} style={{ marginTop: space.xs }}>
        <Eyebrow>{mod.title}</Eyebrow>
        {mod.lessons.map((l, i) => <InfoRow key={l.id} title={l.title} meta={lessonMeta(l)} last={i === mod.lessons.length - 1}
          pills={!preview && l.progress === 'completed' ? [{ label: 'Done', tone: 'success' }] : !preview && l.progress === 'started' ? [{ label: 'Opened', tone: 'warning' }] : undefined}
          onPress={() => router.push(`${m.base}/${c.id}/${l.id}`)} forward />)}
      </View>) : <EmptyState title="No lessons yet" />}
    </Card></MotionCard>
    {c.cover ? <CourseCover cover={c.cover} /> : null}
    {!preview ? <MotionCard index={3} pressable={false}><Card>
      <Row between><View style={{ flex: 1 }}><Eyebrow>Your progress</Eyebrow><H2>{e ? 'In this course' : 'Not started'}</H2></View>{pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}</Row>
      {e ? <View style={{ gap: space.sm }}><ProgressBar p={e.progress} /><KeyValue rows={kv} /></View> : <P small>{`${accessLabel(c.access)}. Start the course to keep your progress.`}</P>}
    </Card></MotionCard> : null}
    {hasVideo && c.video?.status !== 'live' ? <Notice kind="info" title="Video">{c.video?.note}</Notice> : null}
    {preview ? <AssignSheet open={assigning} course={{ id: c.id, title: c.title, lessons: c.lessons, audience: c.audience, packages: c.packages }} onClose={() => setAssigning(false)} onDone={() => toast.show('Course assigned: the client is told')} /> : null}
  </Screen>;
}

export function LessonView({ mode, courseId, lessonId }: { mode: LearnMode; courseId: string; lessonId: string }) {
  const m = MODES[mode];
  const router = useRouter();
  const toast = useToast();
  const data = useLoad<Lesson>(`coach.learning.${mode}.lesson.${lessonId}`, () => get(m.lesson(lessonId)), [lessonId, mode]);
  const [busy, setBusy] = useState(false);
  const { enrolled } = useLocalSearchParams<{ enrolled?: string }>();
  // opened right after "Start this course": the web's toast follows to the first lesson, so the app shows it here
  useEffect(() => { if (enrolled === '1') toast.show('Enrolled'); }, [enrolled]); // eslint-disable-line react-hooks/exhaustive-deps
  const l = data.data;
  // opening a lesson while enrolled is noted once (the server ignores repeats and records nothing when not enrolled)
  useEffect(() => { if (l && l.id === lessonId && l.enrolled && !l.progress && m.start) void post(m.start(l.id)).catch(() => undefined); }, [l?.id, l?.enrolled]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) {
    return <Screen refreshing={data.loading} onRefresh={data.reload}>
      <BackLink title="← The course" onPress={() => router.push(`${m.base}/${courseId}`)} />
      {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : <Loading />}
    </Screen>;
  }
  const done = l.progress?.status === 'completed';
  const canComplete = !!m.complete && !l.preview;
  const courseHref = `${m.base}/${l.course.id}`;
  const complete = async () => {
    if (!m.complete) return;
    setBusy(true);
    try { const r = await post<Lesson>(m.complete(l.id)); data.setData(r); toast.show(r.enrollmentStatus === 'completed' && l.enrollmentStatus !== 'completed' ? 'Lesson complete: you have finished the course' : 'Lesson complete'); }
    catch (e) { toast.show(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return <Screen refreshing={data.loading} onRefresh={data.reload}>
    <Enter><View>
      <BackLink title={`← ${l.course.title}`} onPress={() => router.push(courseHref)} />
      <Title sub={`${l.module.title} · lesson ${l.position.index} of ${l.position.of} · ${lessonMeta(l)}`}>{l.title}</Title>
    </View></Enter>
    {done ? <Row><Pill tone="success">{`Done${l.progress?.completedAt ? ` ${fmtDate(l.progress.completedAt)}` : ''}`}</Pill></Row> : null}
    <StaleBanner at={data.stale} />
    <MotionCard index={1} pressable={false}><Card>
      {l.video ? <Notice kind="info" title="Video not available yet">{l.video.note}</Notice> : null}
      <LessonBody html={l.body} fallback={l.bodyText} />
      <View style={styles.foot}>
        <Row>
          {l.prevLessonId ? <Button title="← Previous" variant="ghost" small onPress={() => router.replace(`${courseHref}/${l.prevLessonId}`)} /> : null}
          {l.nextLessonId ? <Button title="Next lesson →" variant={done ? 'primary' : 'secondary'} small onPress={() => router.replace(`${courseHref}/${l.nextLessonId}`)} /> : null}
        </Row>
        {canComplete && !done ? <Button title="Mark as complete" small busy={busy} onPress={complete} /> : null}
      </View>
    </Card></MotionCard>
    {toast.node}
    {l.preview ? <Notice kind="info">You are reading a member course before assigning it. Progress is recorded only for its learners.</Notice>
      : l.courseProgress ? <MotionCard index={2} pressable={false}><Card><Eyebrow>Your progress</Eyebrow><ProgressBar p={l.courseProgress} />{l.enrollmentStatus === 'completed' ? <P small>You have completed this course.</P> : null}</Card></MotionCard>
      : <MotionCard index={2} pressable={false}><Card><Eyebrow>Your progress</Eyebrow><P small>Marking this lesson complete starts the course and keeps your progress.</P></Card></MotionCard>}
  </Screen>;
}

const styles = StyleSheet.create({
  foot: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, marginTop: space.sm, gap: space.sm, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' },
});
