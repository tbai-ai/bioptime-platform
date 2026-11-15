/* One lesson (M10 Learning; /learn/<lessonId>): the overlay titled "Lesson n of m", a cover stretching over the top and
   the red reading bar under the header that fills as the text is read; then where it sits (course · module), the title,
   its kind and length, the text (the server's plain-text copy, one paragraph per line; checklist lines as ticks), my
   progress and "Mark as complete" (pinned at the bottom until it is done, then "Next lesson"); previous and next
   lessons; the course's progress. Opening a lesson while enrolled is noted once (the server ignores repeats and
   records nothing when not enrolled). A video lesson says that video hosting is pending configuration. */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import {
  Button, ErrorState, Eyebrow, fx, GlassCard, haptics, Icon, invalidate, Notice, Overlay, Pill, ProgressBar, Reveal, Skeleton, StaleBanner, T,
} from '@/fx';
import type { Progress } from '../data';
import { KIND } from './CourseScreen';
import { CoverPhoto, FILL_OVERLAY, ReadingScroll } from './ReadingScroll';

type Lesson = {
  id: string; title: string; kind: string; bodyText: string; durationMinutes: number | null; video: { status: string; note: string } | null;
  course: { id: string; title: string; sample: boolean; status: string }; module: { id: string; title: string };
  position: { index: number; of: number }; prevLessonId: string | null; nextLessonId: string | null;
  enrolled: boolean; progress: { status: string; completedAt: string | null } | null; courseProgress: Progress | null; enrollmentStatus: string | null;
};

const BULLET = /^\s*(?:[-•*]|\[\s?[xX ]?\s?\])\s+/;

export function LessonScreen({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const l = useLoad<Lesson>(`learn.lesson.${lessonId}`, () => get(`/me/lessons/${lessonId}`), [lessonId]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const d = l.data;
  // opening a lesson while enrolled is noted once (the server ignores repeats and records nothing when not enrolled)
  useEffect(() => { if (d && d.id === lessonId && d.enrolled && !d.progress) void post(`/me/lessons/${d.id}/start`).catch(() => undefined); }, [d?.id, d?.enrolled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMsg(null); }, [lessonId]);
  const complete = async () => {
    if (!d) return;
    setBusy(true); setMsg(null);
    try {
      const r = await post<Lesson>(`/me/lessons/${d.id}/complete`);
      l.setData(r);
      haptics.success();
      const finished = r.enrollmentStatus === 'completed' && d.enrollmentStatus !== 'completed';
      setMsg({ kind: 'success', text: finished ? 'Lesson complete: you have finished the course.' : 'Lesson complete.' });
      invalidate(['learn.courses', `learn.course.${d.course.id}`]);
    } catch (e) { setMsg({ kind: 'error', text: errorText(e) }); } finally { setBusy(false); }
  };
  const done = d?.progress?.status === 'completed';
  const paragraphs = (d?.bodyText ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const footer = d && !done ? <Button title="Mark as complete" icon="circle-check" shape="flow" commit busy={busy} onPress={complete} />
    : d?.nextLessonId ? <Button title="Next lesson" iconRight="arrow-right" shape="flow" onPress={() => router.replace(`/learn/${d.nextLessonId}`)} /> : undefined;

  return <Overlay title={d ? `Lesson ${d.position.index} of ${d.position.of}` : 'Lesson'} subtitle={d?.course.title} fallback={d ? `/learn?course=${d.course.id}` : '/(tabs)/store?section=learn'} scroll={false} contentStyle={FILL_OVERLAY} footer={footer}>
    <ReadingScroll cover={<CoverPhoto />} reading coverHeight={180} refreshing={l.loading && !!d} onRefresh={l.reload}>
      {l.loading && !d ? <View style={styles.gap}><Skeleton height={14} width="50%" /><Skeleton height={34} width="80%" /><Skeleton height={180} /></View> : null}
      <StaleBanner at={l.stale} />
      <ErrorState error={l.error} onRetry={l.reload} />
      {d ? <>
        <Reveal mount index={0}>
          <View style={styles.head}>
            <Eyebrow kind="store">{`${d.course.title} · ${d.module.title}`}</Eyebrow>
            <T v="h1">{d.title}</T>
            <View style={styles.meta}>
              {done ? <Pill tone="success" icon="check">{`Done${d.progress?.completedAt ? ` ${fmtDate(d.progress.completedAt)}` : ''}`}</Pill> : null}
              <T v="caption" color={fx.ink.a60}>{`${KIND[d.kind] ?? d.kind}${d.durationMinutes ? ` · ${d.durationMinutes} min` : ''}`}</T>
            </View>
          </View>
        </Reveal>
        {d.video ? <Notice kind="info" title="Video not available yet">{d.video.note}</Notice> : null}
        <Reveal mount index={1}>
          <View style={styles.text}>
            {paragraphs.map((p, i) => BULLET.test(p)
              ? <View key={i} style={styles.bullet}><View style={styles.tick}><Icon name="check" size={14} color={fx.red.brand} stroke={2.5} /></View><T v="body" style={[styles.para, styles.flex]}>{p.replace(BULLET, '')}</T></View>
              : <T key={i} v="body" style={styles.para}>{p}</T>)}
          </View>
        </Reveal>
        {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
        {d.prevLessonId || (done && d.nextLessonId) ? <View style={styles.row}>
          {d.prevLessonId ? <Button title="Previous" variant="soft" icon="arrow-left" small full={false} onPress={() => router.replace(`/learn/${d.prevLessonId}`)} /> : <View />}
          {!done && d.nextLessonId ? <Button title="Next lesson" variant="soft" iconRight="arrow-right" small full={false} onPress={() => router.replace(`/learn/${d.nextLessonId}`)} /> : null}
        </View> : !done && d.nextLessonId ? <View style={styles.rowEnd}><Button title="Next lesson" variant="soft" iconRight="arrow-right" small full={false} onPress={() => router.replace(`/learn/${d.nextLessonId}`)} /></View> : null}
        {d.courseProgress ? <GlassCard variant="three">
          <Eyebrow kind="label">Your progress</Eyebrow>
          <T v="bodySm" color={fx.ink.a80} style={styles.progressText}>{d.courseProgress.total ? `${d.courseProgress.completed} of ${d.courseProgress.total} lessons` : 'No lessons yet'}</T>
          {d.courseProgress.pct !== null ? <ProgressBar value={d.courseProgress.pct / 100} size="medium" duration={800} accessibilityLabel={`${d.courseProgress.completed} of ${d.courseProgress.total} lessons`} /> : null}
        </GlassCard> : <T v="bodySm" color={fx.ink.a60}>Marking this lesson complete starts the course and keeps your progress.</T>}
        <Button title="All lessons in this course" variant="link" style={styles.center} onPress={() => router.dismissTo({ pathname: '/learn', params: { course: d.course.id } })} />
      </> : null}
    </ReadingScroll>
  </Overlay>;
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  flex: { flex: 1 },
  head: { gap: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  text: { gap: 14 },
  para: { fontSize: 16, lineHeight: 27, color: fx.ink.a90 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tick: { height: 27, justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  rowEnd: { flexDirection: 'row', justifyContent: 'flex-end' },
  progressText: { marginTop: 8, marginBottom: 10 },
  center: { alignSelf: 'center' },
});
