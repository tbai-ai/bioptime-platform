/* Coach › Training › one lesson, read and marked complete (the web's /coach/training/:courseId/:lessonId, LessonView
   mode="training"): GET /coach/lessons/:id; POST /coach/lessons/:id/start once when opened while enrolled;
   "Mark as complete" → POST /coach/lessons/:id/complete → "Lesson complete" (or "… you have finished the course");
   "← Previous" and "Next lesson →". Flag: learning. */
import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { NotificationBell, RoleGate } from '@/components/workspaceShell';
import { ModuleGate } from '@/components/coachWorkouts/parts';
import { LessonView } from '@/components/coachLearning/views';

export default function TrainingLessonScreen() {
  const { courseId = '', lessonId = '' } = useLocalSearchParams<{ courseId: string; lessonId: string }>();
  return <>
    <Stack.Screen options={{ title: 'Lesson', headerRight: () => <NotificationBell /> }} />
    <RoleGate workspace="coach"><ModuleGate flag="learning"><LessonView key={lessonId} mode="training" courseId={courseId} lessonId={lessonId} /></ModuleGate></RoleGate>
  </>;
}
