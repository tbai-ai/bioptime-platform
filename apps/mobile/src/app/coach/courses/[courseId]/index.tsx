/* Coach › Courses › one member course, read before assigning it (the web's /coach/courses/:courseId, CourseView
   mode="preview"): GET /coach/courses/:id; the outline without progress, "Read the first lesson", and the course
   assigned to a client from here (components/coachLearning/AssignSheet). Flag: learning. */
import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { NotificationBell, RoleGate } from '@/components/workspaceShell';
import { ModuleGate } from '@/components/coachWorkouts/parts';
import { CourseView } from '@/components/coachLearning/views';

export default function CoursePreviewScreen() {
  const { courseId = '' } = useLocalSearchParams<{ courseId: string }>();
  return <>
    <Stack.Screen options={{ title: 'Course', headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="learning"><CourseView key={courseId} mode="preview" courseId={courseId} /></ModuleGate></RoleGate>
  </>;
}
