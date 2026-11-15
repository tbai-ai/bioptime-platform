/* Admin › Courses (the web's /admin/learning, modules/learning/AdminCourses.tsx; learning module, learning.manage): every
   course for members and coach training with its audience, status, lesson and learner counts, a status filter, and
   "New course" (a draft; the editor opens next). GET /admin/courses?status → { items, video };
   GET /admin/learning/options for the packages a package course comes with. */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { get, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { audienceLabel, coursePill, type CourseRow, type LearningOptions, type VideoStatus } from '@/lib/admin/modules2/learning';
import { DetailRow } from '@/components/adminB2/parts';
import { Button, Card, ErrorBox, Loading, Notice, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState, FilterChips, RecordList } from '@/components/workspace';
import { AdminModuleGate } from '@/components/adminModules2/frame';
import { CreateCourseSheet } from '@/components/adminModules2/learning';
import { Enter } from '@/motion';

const TITLE = 'Courses';
const STATUS_OPTIONS = [{ value: '', label: 'Every status' }, { value: 'draft', label: 'Drafts' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' }];

export default function AdminCoursesScreen() {
  return <AdminModuleGate title={TITLE} module="learning" permission="learning.manage"><Body /></AdminModuleGate>;
}

function Body() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useLoad<{ items: CourseRow[]; video: VideoStatus }>(`admin-courses-${status || 'all'}`, () => get(`/admin/courses${qs({ status })}`), [status]);
  const options = useLoad<LearningOptions>(creating ? 'admin-learning-options' : null, () => (creating ? get('/admin/learning/options') : Promise.resolve(null as unknown as LearningOptions)), [creating]);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } void list.reload(); }, [list.reload])); // eslint-disable-line react-hooks/exhaustive-deps
  const d = list.data;
  return <Screen refreshing={list.loading} onRefresh={list.reload}>
    <Enter><Title sub="Courses, modules and lessons for members and coach training. A course is a draft until you publish it, and needs at least one published lesson. You write the text; nothing is filled in for you.">{TITLE}</Title></Enter>
    <Enter index={1}><Button title="New course" small onPress={() => setCreating(true)} style={{ alignSelf: 'flex-start' }} /></Enter>
    <FilterChips options={STATUS_OPTIONS} value={status} onChange={(v) => setStatus(String(v))} />
    {d && d.video.status !== 'live' ? <Notice kind="info" title="Video lessons: pending configuration">{`${d.video.note} Missing: ${d.video.missing.join('; ')}.`}</Notice> : null}
    <StaleBanner at={list.stale} />
    <ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading && !d ? <Loading /> : d ? (d.items.length ? <Enter index={2}><RecordList title="Courses">
      {d.items.map((c) => <DetailRow key={c.id} title={c.title}
        lines={[
          c.slug,
          `${audienceLabel(c.audience)}${c.packages.length ? `: ${c.packages.map((p) => p.name).join(', ')}` : ''}`,
          `Lessons: ${c.lessonCounts.published}${c.lessonCounts.draft ? ` + ${c.lessonCounts.draft} draft` : ''} · Learners: ${c.enrolments.active} active · ${c.enrolments.completed} done`,
          `Updated ${fmtDate(c.updatedAt)}`,
        ]}
        pills={[coursePill(c.status)]}
        onPress={() => router.push(`/admin/learning/${c.id}`)} />)}
    </RecordList></Enter> : <Card><EmptyState title={status ? 'No courses with this status' : 'No courses yet'} body="Create a course, add modules and lessons, then publish it." action={{ title: 'New course', onPress: () => setCreating(true) }} /></Card>) : null}
    <CreateCourseSheet open={creating} options={options.data} onClose={() => setCreating(false)} onCreated={(c) => router.push(`/admin/learning/${c.id}`)} />
  </Screen>;
}
