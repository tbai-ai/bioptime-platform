/* One course (M10 Learning; /learn?course=<id>, opened from the Store's Learn shelf): the cover (the API's, else
   learn.cover.fallback) stretching over the top, the title in Bebas, the summary; the member's progress (lessons done,
   the bar, who assigned it and their note, when it started or was completed) with Start / Continue / Start this course
   / Leave the course; then each module with its lessons (written, checklist or video; Done or Opened), each opening the
   lesson overlay. A retired course can still be read and finished. Video lessons say that video hosting is pending
   configuration. Draft lessons never reach the app. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { errorText, get, post } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import {
  Button, ErrorState, Eyebrow, fx, GlassCard, H, Icon, invalidate, Notice, Overlay, Pill, ProgressBar, Reveal, Skeleton, StaleBanner, T, useFocusRefresh,
} from '@/fx';
import { ACCESS, progressText, type CourseCard } from '../data';
import { CoverPhoto, FILL_OVERLAY, ReadingScroll } from './ReadingScroll';

type Outline = Array<{ id: string; title: string; lessons: Array<{ id: string; title: string; kind: string; durationMinutes: number | null; progress: string | null }> }>;
type Course = CourseCard & { archived?: boolean; modules: Outline; video: { status: string; note: string } };

export const KIND: Record<string, string> = { written: 'Written', checklist: 'Checklist', video: 'Video' };
const KIND_ICON = { written: 'file-text', checklist: 'list-checks', video: 'video' } as const;

export function CourseScreen({ id }: { id: string }) {
  const router = useRouter();
  const c = useLoad<Course>(`learn.course.${id}`, () => get(`/me/courses/${id}`), [id]);
  const { refreshing, onRefresh } = useFocusRefresh(c.reload);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const d = c.data;
  const join = async () => { setBusy(true); setMsg(null); try { const r = await post<Course>(`/me/courses/${id}/enroll`); c.setData(r); invalidate(['learn.courses']); if (r.nextLessonId) router.push(`/learn/${r.nextLessonId}`); } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); } };
  const leave = async () => { setBusy(true); setMsg(null); try { await post(`/me/courses/${id}/leave`); await c.reload(); invalidate(['learn.courses']); } catch (e) { setMsg(errorText(e)); } finally { setBusy(false); } };
  const lessons = d ? d.modules.reduce((n, m) => n + m.lessons.length, 0) : 0;
  let n = 0;

  return <Overlay title="Learn" subtitle={d ? `${lessons} ${lessons === 1 ? 'lesson' : 'lessons'}${d.minutes ? ` · about ${d.minutes} min` : ''}` : undefined} fallback="/(tabs)/store?section=learn" scroll={false} contentStyle={FILL_OVERLAY}>
    <ReadingScroll cover={<CoverPhoto cover={d?.cover} />} refreshing={refreshing} onRefresh={onRefresh}>
      {c.loading && !d ? <View style={styles.gap}><Skeleton height={36} width="70%" /><Skeleton height={60} /><Skeleton height={160} radius={fx.radius.three} /></View> : null}
      <StaleBanner at={c.stale} />
      <ErrorState error={c.error} onRetry={c.reload} />
      {d ? <>
        <Reveal mount index={0}>
          <View style={styles.head}>
            <Eyebrow kind="store">{ACCESS[d.access ?? ''] ?? 'Course'}</Eyebrow>
            <T v="display36">{d.title}</T>
            {d.summary ? <T v="body" color={fx.ink.a80}>{d.summary}</T> : null}
          </View>
        </Reveal>
        {d.archived ? <Notice kind="info">This course has been retired. You can still read it and finish it.</Notice> : null}

        <Reveal mount index={1}>
          <GlassCard variant="three">
            <Eyebrow kind="label">{d.enrollment ? 'Your progress' : 'Not started'}</Eyebrow>
            {d.enrollment ? <View style={styles.progress}>
              <View style={styles.progressRow}>
                <T v="cardTitle">{progressText(d.enrollment.progress)}</T>
                {d.enrollment.progress.pct !== null ? <T v="mono14" color={fx.ink.a70}>{`${d.enrollment.progress.pct}%`}</T> : null}
              </View>
              {d.enrollment.progress.pct !== null ? <ProgressBar value={d.enrollment.progress.pct / 100} size="medium" duration={800} accessibilityLabel={progressText(d.enrollment.progress)} /> : null}
              {d.enrollment.assignedByName ? <T v="bodySm" color={fx.ink.a70}>{`Assigned by ${d.enrollment.assignedByName}${d.enrollment.assignedNote ? `: “${d.enrollment.assignedNote}”` : ''}`}</T> : null}
              <T v="caption" color={fx.ink.a50}>{d.enrollment.completedAt ? `Completed ${fmtDate(d.enrollment.completedAt)}` : `Started ${fmtDate(d.enrollment.enrolledAt)}`}</T>
            </View> : <T v="bodySm" color={fx.ink.a70} style={styles.progress}>{`${ACCESS[d.access ?? ''] ?? ''}. Start the course to keep your progress.`}</T>}
            <View style={styles.actions}>
              {d.enrollment && d.nextLessonId ? <Button title={d.enrollment.progress.completed ? 'Continue' : 'Start'} icon="book-open" shape="flow" small onPress={() => router.push(`/learn/${d.nextLessonId}`)} style={styles.flex} /> : null}
              {!d.enrollment && !d.archived ? <Button title="Start this course" icon="book-open" shape="flow" small commit busy={busy} onPress={join} style={styles.flex} /> : null}
              {d.enrollment ? <Button title="Leave the course" variant="soft" small full={false} disabled={busy} onPress={leave} /> : null}
            </View>
            {msg ? <Notice kind="error" style={styles.msg}>{msg}</Notice> : null}
          </GlassCard>
        </Reveal>

        {d.modules.map((m, mi) => <Reveal key={m.id} index={2 + mi} mount>
          <View>
            <H strong>{m.title}</H>
            <View style={styles.lessons}>
              {m.lessons.map((l) => {
                n += 1;
                const done = l.progress === 'completed';
                const meta = `${KIND[l.kind] ?? l.kind}${l.durationMinutes ? ` · ${l.durationMinutes} min` : ''}`;
                return <Pressable key={l.id} accessibilityRole="button" accessibilityLabel={`Lesson ${n}: ${l.title}. ${meta}${done ? '. Done' : l.progress === 'started' ? '. Opened' : ''}`}
                  onPress={() => router.push(`/learn/${l.id}`)} style={({ pressed }) => [styles.lesson, pressed ? styles.lessonPressed : null]}>
                  <View style={[styles.num, done ? styles.numDone : null]}>
                    {done ? <Icon name="check" size={14} color={fx.hue.green400} stroke={2.5} /> : <T v="mono12" color={fx.ink.a70}>{String(n)}</T>}
                  </View>
                  <View style={styles.flex}>
                    <T v="section">{l.title}</T>
                    <View style={styles.metaRow}>
                      <Icon name={KIND_ICON[l.kind as keyof typeof KIND_ICON] ?? 'file-text'} size={12} color={fx.ink.a50} />
                      <T v="caption" color={fx.ink.a55}>{meta}</T>
                    </View>
                  </View>
                  {done ? <Pill tone="success">Done</Pill> : l.progress === 'started' ? <Pill tone="info">Opened</Pill> : null}
                  <Icon name="chevron-right" size={16} color={fx.ink.a40} />
                </Pressable>;
              })}
            </View>
          </View>
        </Reveal>)}
        {d.modules.some((m) => m.lessons.some((l) => l.kind === 'video')) && d.video.status !== 'live' ? <Notice kind="info" title="Video">{d.video.note}</Notice> : null}
        <T v="caption" color={fx.ink.a50}>Courses are education, not medical advice; ask your doctor about anything specific to your health.</T>
      </> : null}
    </ReadingScroll>
  </Overlay>;
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  flex: { flex: 1 },
  head: { gap: 8 },
  progress: { gap: 10, marginTop: 10 },
  progressRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  msg: { marginTop: 12 },
  lessons: { gap: 8 },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 60, borderRadius: fx.radius.card, borderWidth: 1, borderColor: fx.line.a05, backgroundColor: fx.bg.panelSolid },
  lessonPressed: { borderColor: fx.red.a30, backgroundColor: fx.fill.a05 },
  num: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: fx.line.a10, backgroundColor: fx.fill.a05, alignItems: 'center', justifyContent: 'center' },
  numDone: { borderColor: fx.tone.greenLine, backgroundColor: fx.tone.greenBg },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
});
