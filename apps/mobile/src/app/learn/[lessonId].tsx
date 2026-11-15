/* One lesson (M10 Learning; S9): src/screens/store/learn/LessonScreen. */
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { LessonScreen } from '@/screens/store/learn/LessonScreen';

export default function Lesson() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  return <LessonScreen lessonId={String(lessonId)} />;
}
