/* Learn (M10; S9). With ?course=<id>: that course, its lessons and my progress, to start, continue or leave
   (src/screens/store/learn/CourseScreen). Without: the old Learn link, which now lands on the Store's Learn shelf. */
import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { CourseScreen } from '@/screens/store/learn/CourseScreen';

export default function Learn() {
  const { course } = useLocalSearchParams<{ course?: string }>();
  return course ? <CourseScreen id={String(course)} /> : <Redirect href="/(tabs)/store?section=learn" />;
}
