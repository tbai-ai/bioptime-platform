/* The old Workouts screen: this week's sessions now live in the Train tab (This week). Kept so old links still work. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function Workouts() {
  return <Redirect href="/(tabs)/train?view=week" />;
}
