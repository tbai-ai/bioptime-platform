/* Coach › Learning › Courses (the web's /coach/courses, apps/dashboard/src/modules/learning/CoachCourses.tsx): the
   published member courses a coach may assign, each with its outline and the packages it comes with, to read before
   assigning it (from the client's record, on the Learning tab, or from the course itself). GET /coach/courses.
   Flag: learning. */
import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { get } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { audienceLabel, lessonsText, type CatalogueCourse, type VideoStatus } from '@/lib/coach/learning';
import { Button, Card, ErrorBox, Eyebrow, Loading, P, Screen, StaleBanner, Title } from '@/components/ui';
import { EmptyState } from '@/components/workspace';
import { NotificationBell, RoleGate } from '@/components/workspaceShell';
import { ModuleGate } from '@/components/coachWorkouts/parts';
import { Enter, MotionCard } from '@/motion';
import { colors, font, space } from '@/theme';

const TITLE = 'Courses';

export default function CoursesScreen() {
  return <>
    <Stack.Screen options={{ title: TITLE, headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="learning"><Body /></ModuleGate></RoleGate>
  </>;
}

function Body() {
  const router = useRouter();
  const data = useLoad<{ items: CatalogueCourse[]; video: VideoStatus }>('coach.courses', () => get('/coach/courses'), []);
  const items = data.data?.items;
  const open = (id: string) => router.push(`/coach/courses/${id}`);
  return <Screen refreshing={data.loading} onRefresh={data.reload}>
    <Enter><Title sub="Published courses from the Bioptime team that you can assign to your clients. Read one here; assign it from the client’s record, on the Learning tab.">{TITLE}</Title></Enter>
    <StaleBanner at={data.stale} />
    <ErrorBox error={data.error} onRetry={data.reload} />
    {!items ? (data.error ? null : <Loading />) : items.length ? items.map((c, i) => <MotionCard key={c.id} index={1 + i} pressable={false}><Card>
      <Eyebrow>{`${audienceLabel(c.audience)} · ${lessonsText(c)}`}</Eyebrow>
      <Pressable accessibilityRole="link" accessibilityLabel={c.title} onPress={() => open(c.id)}><Text style={styles.title}>{c.title}</Text></Pressable>
      {c.summary ? <P small>{c.summary}</P> : null}
      {c.packages.length ? <P muted small>{`Comes with: ${c.packages.map((p) => p.name).join(', ')}. Only clients who hold one of these can be assigned it.`}</P> : null}
      <View style={styles.outline}>{c.modules.map((m) => <View key={m.id} style={styles.module}>
        <Text style={styles.moduleTitle}>{m.title}</Text>
        <Text style={styles.lessons}>{m.lessons.map((l) => l.title).join(' · ')}</Text>
      </View>)}</View>
      <View style={styles.foot}><Button title="Read the course" variant="secondary" small onPress={() => open(c.id)} style={{ alignSelf: 'flex-start' }} /></View>
    </Card></MotionCard>) : <EmptyState title="No courses yet" body="Courses appear here when the Bioptime team publishes them." icon="school-outline" />}
  </Screen>;
}

const styles = StyleSheet.create({
  title: { color: colors.accentText, fontSize: font.h2, fontWeight: '700' },
  outline: { gap: space.sm, marginTop: space.xs },
  module: { borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: space.md, gap: 2 },
  moduleTitle: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  lessons: { color: colors.muted, fontSize: font.small, lineHeight: 18 },
  foot: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, marginTop: space.sm },
});
