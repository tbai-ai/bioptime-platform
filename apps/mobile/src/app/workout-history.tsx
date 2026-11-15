/* The old Workout history screen: now Train › History (with the personal records). Kept so old links still work. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function WorkoutHistory() {
  return <Redirect href="/(tabs)/train?view=history" />;
}
