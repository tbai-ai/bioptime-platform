/* Coach › Courses › one lesson of a member course, read before assigning it (the web's /coach/courses/:courseId/:lessonId,
   LessonView mode="preview"): GET /coach/lessons/:id. Read only: progress is recorded only for its learners, so there is
   no "Mark as complete". Flag: learning. */
import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { NotificationBell, RoleGate } from '@/components/workspaceShell';
import { ModuleGate } from '@/components/coachWorkouts/parts';
import { LessonView } from '@/components/coachLearning/views';

export default function CoursePreviewLessonScreen() {
  const { courseId = '', lessonId = '' } = useLocalSearchParams<{ courseId: string; lessonId: string }>();
  return <>
    <Stack.Screen options={{ title: 'Lesson', headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="learning"><LessonView key={lessonId} mode="preview" courseId={courseId} lessonId={lessonId} /></ModuleGate></RoleGate>
  </>;
}
