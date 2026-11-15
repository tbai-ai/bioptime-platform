/* Coach › Training › one training course with the coach's progress (the web's /coach/training/:courseId, CourseView
   mode="training"): GET /coach/training/:id; "Continue" / "Start" (the next lesson) or "Start this course"
   (POST /coach/training/:id/enroll → toast "Enrolled" → the first lesson); lessons with "Done" / "Opened"; the progress
   card. Training has no "Leave the course" (only members have it). Flag: learning. */
import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { NotificationBell, RoleGate } from '@/components/workspaceShell';
import { ModuleGate } from '@/components/coachWorkouts/parts';
import { CourseView } from '@/components/coachLearning/views';

export default function TrainingCourseScreen() {
  const { courseId = '' } = useLocalSearchParams<{ courseId: string }>();
  return <>
    <Stack.Screen options={{ title: 'Training course', headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="learning"><CourseView key={courseId} mode="training" courseId={courseId} /></ModuleGate></RoleGate>
  </>;
}
